import { constants, watch, type FSWatcher } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  parseVaultPath,
  type ContentHash,
  type Hit,
  type SearchResult,
  type NoteVersion,
  type VaultChange,
  type VaultConfig,
  type VaultEntry,
  type VaultInfo,
  type VaultPath,
  type WriteResult
} from '../core/ipc'
import { NoteIndex } from '../core/noteIndex'
import { search } from '../core/search'
import { hash, kind, missing, noteVersion, readNoteFile, readNoteFiles, scanVault } from './notes'

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
  private readonly index = new NoteIndex()
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
        vault.indexFiles()
        await vault.indexNotes([...vault.entries.values()].filter((e) => e.kind === 'note'))
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

  private scan(): Promise<Map<VaultPath, VaultEntry>> {
    return scanVault(this.dir)
  }

  private indexFiles(): void {
    const files = [...this.entries.values()].filter((entry) => entry.kind !== 'folder')
    this.index.setFiles(files.map((entry) => entry.path))
  }

  // Reads the notes from disk into the index. A note that is gone leaves the index.
  private async indexNotes(notes: VaultEntry[]): Promise<void> {
    const paths = notes.map((entry) => entry.path)
    const versions = await readNoteFiles(this.dir, paths)
    paths.forEach((path, i) => {
      const version = versions[i]
      if (version) this.index.set(path, version.text)
      else this.index.delete(path)
    })
  }

  search(query: string, limit: number): SearchResult {
    return search(this.index.entries(), String(query), Math.max(1, Math.floor(Number(limit) || 50)))
  }

  // Every link in the vault that resolves to path, ordered by source note and position.
  backlinks(path: VaultPath): Hit[] {
    return this.index
      .backlinks(parseVaultPath(path))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.from - b.from))
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
          this.index.delete(path)
          removed.push(path)
        }
      }
      this.indexFiles()
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
    // The index is updated before the renderer hears about the change, so a backlinks
    // request sent on the notification already sees it.
    await this.indexNotes(
      [...paths].flatMap((path) => {
        const entry = this.entries.get(path)
        return entry?.kind === 'note' ? [entry] : []
      })
    )
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
      return await readNoteFile(await this.filePath(path))
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
  }

  // Creates an empty note for a link to a missing one. Missing folders are made one at a time
  // from the vault root, and an existing one must be a real folder, so nothing passes through a
  // symlink. A note that exists by then is left as it is. The entries and the index update before
  // the renderer is told.
  createNote(path: VaultPath): Promise<void> {
    return this.run(async () => {
      const note = parseVaultPath(path)
      if (this.closed || kind(note) !== 'note') throw new Error('笔记库已切换或路径无效')
      let dir = this.dir
      for (const part of note.split('/').slice(0, -1)) {
        dir = join(dir, part)
        await mkdir(dir).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        })
        if (!(await lstat(dir)).isDirectory()) throw new Error('无法在这里新建笔记')
      }
      try {
        const flags =
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
        await (await open(join(this.dir, note), flags)).close()
        this.ownWrites.set(note, hash(Buffer.alloc(0)))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      await this.refresh(new Set([note]), false)
    })
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
          this.index.set(path, text)
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
