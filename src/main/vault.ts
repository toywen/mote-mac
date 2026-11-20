import { createHash } from 'node:crypto'
import { constants, watch, type FSWatcher } from 'node:fs'
import { lstat, open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import {
  parseVaultPath,
  type ContentHash,
  type NoteVersion,
  type VaultChange,
  type VaultConfig,
  type VaultEntry,
  type VaultInfo,
  type VaultPath,
  type WriteResult
} from '../core/ipc'

function missing(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
}

function hash(bytes: Buffer): ContentHash {
  return createHash('sha256').update(bytes).digest('hex') as ContentHash
}

function noteVersion(bytes: Buffer): NoteVersion {
  return {
    text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
    hash: hash(bytes)
  }
}

function kind(name: string): 'note' | 'file' {
  return extname(name).toLowerCase() === '.md' ? 'note' : 'file'
}

async function readConfig(root: string): Promise<VaultConfig> {
  const obsidian = join(root, '.obsidian')
  async function configFile(name: string): Promise<Record<string, unknown>> {
    try {
      const file = join(obsidian, name)
      if ((await realpath(file)) !== file || !(await lstat(file)).isFile()) return {}
      const value: unknown = JSON.parse(await readFile(file, 'utf8'))
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  const [app, daily] = await Promise.all([configFile('app.json'), configFile('daily-notes.json')])
  return {
    useMarkdownLinks: app.useMarkdownLinks === true,
    newLinkFormat:
      app.newLinkFormat === 'relative' || app.newLinkFormat === 'absolute'
        ? app.newLinkFormat
        : 'shortest',
    alwaysUpdateLinks: app.alwaysUpdateLinks === true,
    newFileLocation:
      app.newFileLocation === 'current' || app.newFileLocation === 'folder'
        ? app.newFileLocation
        : 'root',
    newFileFolderPath: typeof app.newFileFolderPath === 'string' ? app.newFileFolderPath : '',
    daily: {
      folder: typeof daily.folder === 'string' ? daily.folder : '',
      format: typeof daily.format === 'string' && daily.format ? daily.format : 'YYYY-MM-DD'
    }
  }
}

export class Vault {
  private entries = new Map<VaultPath, VaultEntry>()
  private readonly ownWrites = new Map<VaultPath, ContentHash>()
  private readonly pending = new Set<VaultPath>()
  private queue: Promise<unknown> = Promise.resolve()
  private timer?: NodeJS.Timeout
  private watcher?: FSWatcher
  private closed = false
  private rescan = false

  private constructor(
    readonly dir: string,
    private readonly config: VaultConfig,
    private readonly notify: (event: VaultChange) => void
  ) {}

  static async open(dir: string, notify: (event: VaultChange) => void): Promise<Vault> {
    const root = await realpath(resolve(dir))
    const vault = new Vault(root, await readConfig(root), notify)
    try {
      vault.watcher = watch(root, { recursive: true }, (_event, name) => vault.schedule(name))
      vault.watcher.on('error', () => vault.schedule(null))
      await vault.run(async () => {
        vault.entries = await vault.scan()
      })
      return vault
    } catch (error) {
      vault.close()
      throw error
    }
  }

  info(): VaultInfo {
    return { dir: this.dir, entries: [...this.entries.values()], config: this.config }
  }

  close(): void {
    this.closed = true
    this.watcher?.close()
    clearTimeout(this.timer)
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }

  private async scan(): Promise<Map<VaultPath, VaultEntry>> {
    const result = new Map<VaultPath, VaultEntry>()
    async function visit(dir: string, prefix: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
        if (!prefix || !missing(error)) throw error
        return []
      })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const path = parseVaultPath(prefix + entry.name)
        if (entry.isDirectory()) {
          result.set(path, { path, kind: 'folder' })
          await visit(join(dir, entry.name), path + '/')
        } else if (entry.isFile()) {
          result.set(path, { path, kind: kind(path) })
        }
      }
    }
    await visit(this.dir, '')
    return result
  }

  private schedule(name: string | null): void {
    if (this.closed || (name && name.split('/').some((part) => part.startsWith('.')))) return
    if (name) this.pending.add(parseVaultPath(name))
    else this.rescan = true
    this.timer ??= setTimeout(() => {
      this.timer = undefined
      const paths = new Set(this.pending)
      const rescan = this.rescan
      this.pending.clear()
      this.rescan = false
      void this.run(() => this.refresh(paths, rescan)).catch((error: unknown) =>
        console.error(error)
      )
    }, 12)
  }

  private async refresh(paths: Set<VaultPath>, rescan: boolean): Promise<void> {
    if (this.closed) return
    const removed: VaultPath[] = []
    let entries: VaultEntry[] | undefined
    const structural = await Promise.all(
      [...paths].map(async (path) => {
        const before = this.entries.get(path)
        const after = await lstat(join(this.dir, path)).catch((error: unknown) => {
          if (!missing(error)) throw error
          return null
        })
        return (
          before?.kind === 'folder' ||
          after?.isDirectory() ||
          Boolean(before) !== Boolean(after?.isFile())
        )
      })
    )
    if (rescan || structural.some(Boolean)) {
      const previous = this.entries
      this.entries = await this.scan()
      entries = [...this.entries.values()]
      for (const path of previous.keys()) {
        if (!this.entries.has(path)) {
          this.ownWrites.delete(path)
          removed.push(path)
        }
      }
      for (const { path, kind } of entries) {
        if (
          kind === 'note' &&
          (rescan ||
            !previous.has(path) ||
            [...paths].some((ancestor) => path.startsWith(ancestor + '/')))
        ) {
          paths.add(path)
        }
      }
    }
    const changed: VaultPath[] = []
    for (const path of paths) {
      if (this.entries.get(path)?.kind !== 'note') continue
      const ownHash = this.ownWrites.get(path)
      if (ownHash) {
        const current = await this.readNote(path)
        if (current?.hash === ownHash) continue
        this.ownWrites.delete(path)
      }
      changed.push(path)
    }
    if (!this.closed && (entries || changed.length || removed.length)) {
      this.notify({ dir: this.dir, entries, changed, removed })
    }
  }

  async filePath(path: VaultPath): Promise<string> {
    const full = join(this.dir, parseVaultPath(path))
    if ((await realpath(dirname(full))) !== dirname(full)) throw new Error('无法访问链接路径')
    return full
  }

  async readNote(path: VaultPath): Promise<NoteVersion | null> {
    if (kind(path) !== 'note') throw new Error('请选择 Markdown 笔记')
    try {
      const file = await open(
        await this.filePath(path),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
      try {
        if (!(await file.stat()).isFile()) return null
        return noteVersion(await file.readFile())
      } finally {
        await file.close()
      }
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
  }

  writeNote(path: VaultPath, text: string, baseHash: ContentHash | null): Promise<WriteResult> {
    return this.run(async () => {
      if (this.closed || kind(path) !== 'note') throw new Error('笔记库已切换或路径无效')
      const bytes = Buffer.from(text, 'utf8')
      const nextHash = hash(bytes)
      try {
        const full = await this.filePath(path)
        const flags =
          baseHash === null
            ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
            : constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK
        const file = await open(full, flags)
        try {
          const before = await file.stat()
          if (!before.isFile()) return { ok: false, disk: null }
          if (baseHash !== null) {
            const disk = noteVersion(await file.readFile())
            const latest = await stat(full)
            if (
              before.ino !== latest.ino ||
              before.dev !== latest.dev ||
              before.mtimeMs !== latest.mtimeMs ||
              before.ctimeMs !== latest.ctimeMs ||
              before.size !== latest.size
            ) {
              return { ok: false, disk: await this.readNote(path) }
            }
            if (disk.hash !== baseHash) return { ok: false, disk }
            if (disk.hash === nextHash) return { ok: true, hash: nextHash }
          }
          for (let offset = 0; offset < bytes.length;) {
            const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, offset)
            if (!bytesWritten) throw new Error('无法写入笔记')
            offset += bytesWritten
          }
          await file.truncate(bytes.length)
          this.ownWrites.set(path, nextHash)
          return { ok: true, hash: nextHash }
        } finally {
          await file.close()
        }
      } catch (error) {
        if (missing(error)) return { ok: false, disk: null }
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          return { ok: false, disk: await this.readNote(path) }
        }
        throw error
      }
    })
  }
}
