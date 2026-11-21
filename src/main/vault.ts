import { constants, watch, type FSWatcher } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath, rename as fsRename, stat } from 'node:fs/promises'
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
  type WriteResult,
  type SavedAttachment
} from '../core/ipc.ts'
import {
  formatImageEmbed,
  nextAvailableAttachmentPath,
  resolveAttachmentFolder
} from '../core/attachments.ts'
import { NoteIndex } from '../core/noteIndex.ts'
import { search } from '../core/search.ts'
import { buildRenameMapping, rewriteNoteLinks } from '../core/rename.ts'
import { extractLinks } from '../core/markdown.ts'
import {
  hash,
  kind,
  missing,
  noteVersion,
  readNoteFile,
  readNoteFiles,
  scanVault
} from './notes.ts'

export type RenameJournal = {
  dir: string
  from: VaultPath
  to: VaultPath
  kind: 'note' | 'folder'
  updateLinks: boolean
}

export interface JournalHandler {
  read(): Promise<RenameJournal | null>
  write(journal: RenameJournal): Promise<void>
  clear(): Promise<void>
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
    attachmentFolderPath:
      typeof app.attachmentFolderPath === 'string' ? app.attachmentFolderPath : '',
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

  readonly dir: string
  private readonly config: VaultConfig
  private readonly notify: (event: VaultChange) => void

  private constructor(dir: string, config: VaultConfig, notify: (event: VaultChange) => void) {
    this.dir = dir
    this.config = config
    this.notify = notify
  }

  static async open(
    dir: string,
    notify: (event: VaultChange) => void,
    journal?: JournalHandler
  ): Promise<Vault> {
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
      if (journal) {
        const saved = await journal.read()
        if (saved && saved.dir === vault.dir) {
          try {
            await vault.renameOrMove(saved.from, saved.to, saved.updateLinks, journal)
          } catch (err) {
            console.error('Failed to replay journal:', err)
          }
        }
      }
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

  async resolvePath(path: VaultPath): Promise<string> {
    const clean = parseVaultPath(path)
    const full = resolve(join(this.dir, clean))
    if (!full.startsWith(this.dir + '/') && full !== this.dir) {
      throw new Error('无法访问路径')
    }
    return full
  }

  countInboundLinks(path: VaultPath): number {
    const clean = parseVaultPath(path)
    const entry = this.entries.get(clean)
    if (!entry) return 0
    if (entry.kind === 'note') {
      return this.backlinks(clean).length
    }
    let total = 0
    const prefix = clean + '/'
    for (const [p, e] of this.entries) {
      if (e.kind === 'note' && p.startsWith(prefix)) {
        total += this.backlinks(p).length
      }
    }
    return total
  }

  createNoteInVault(parentFolder?: VaultPath, initialName?: string): Promise<VaultPath> {
    return this.run(async () => {
      let folder = parentFolder ? parseVaultPath(parentFolder) : ''
      if (!folder) {
        if (this.config.newFileLocation === 'folder' && this.config.newFileFolderPath) {
          folder = parseVaultPath(this.config.newFileFolderPath.replace(/^\/+|\/+$/g, ''))
        }
      }
      const base = initialName ? initialName.replace(/\.md$/i, '') : '未命名'
      let candidateName = `${base}.md`
      let candidatePath = parseVaultPath(folder ? `${folder}/${candidateName}` : candidateName)
      let count = 1
      while (this.entries.has(candidatePath)) {
        candidateName = `${base} ${count++}.md`
        candidatePath = parseVaultPath(folder ? `${folder}/${candidateName}` : candidateName)
      }

      if (folder) {
        let sub = ''
        for (const part of folder.split('/')) {
          sub = sub ? `${sub}/${part}` : part
          const vp = parseVaultPath(sub)
          const dir = join(this.dir, sub)
          await mkdir(dir).catch((err: unknown) => {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
          })
          if (!this.entries.has(vp)) {
            this.entries.set(vp, { path: vp, kind: 'folder' })
          }
        }
      }

      const full = join(this.dir, candidatePath)
      const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
      const handle = await open(full, flags, 0o666)
      await handle.close()

      this.ownWrites.set(candidatePath, hash(Buffer.alloc(0)))
      this.entries.set(candidatePath, { path: candidatePath, kind: 'note' })
      this.indexFiles()
      this.index.set(candidatePath, '')
      this.notify({
        dir: this.dir,
        entries: [...this.entries.values()],
        changed: [candidatePath],
        removed: []
      })
      return candidatePath
    })
  }

  saveAttachment(notePath: VaultPath, fileName: string, data: Buffer): Promise<SavedAttachment> {
    return this.run(async () => {
      const folder = resolveAttachmentFolder(this.config.attachmentFolderPath, notePath)
      const targetPath = nextAvailableAttachmentPath(folder, fileName, (p) => this.entries.has(p))

      if (folder) {
        let sub = ''
        for (const part of folder.split('/')) {
          sub = sub ? `${sub}/${part}` : part
          const vp = parseVaultPath(sub)
          const dir = join(this.dir, sub)
          await mkdir(dir).catch((err: unknown) => {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
          })
          if (!this.entries.has(vp)) {
            this.entries.set(vp, { path: vp, kind: 'folder' })
          }
        }
      }

      const full = join(this.dir, targetPath)
      const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
      const handle = await open(full, flags, 0o666)
      try {
        await handle.writeFile(data)
      } finally {
        await handle.close()
      }

      this.ownWrites.set(targetPath, hash(data))
      this.entries.set(targetPath, { path: targetPath, kind: 'file' })
      this.indexFiles()

      this.notify({
        dir: this.dir,
        entries: [...this.entries.values()],
        changed: [targetPath],
        removed: []
      })

      const embedText = formatImageEmbed(
        this.index.getLinkIndex(),
        targetPath,
        notePath,
        this.config
      )

      return { path: targetPath, embedText }
    })
  }

  createFolder(parentFolder?: VaultPath, initialName?: string): Promise<VaultPath> {
    return this.run(async () => {
      const folder = parentFolder ? parseVaultPath(parentFolder) : ''
      const base = initialName ? initialName.trim() : '未命名文件夹'
      let candidateName = base
      let candidatePath = parseVaultPath(folder ? `${folder}/${candidateName}` : candidateName)
      let count = 1
      while (this.entries.has(candidatePath)) {
        candidateName = `${base} ${count++}`
        candidatePath = parseVaultPath(folder ? `${folder}/${candidateName}` : candidateName)
      }

      const full = join(this.dir, candidatePath)
      await mkdir(full, { recursive: true })

      let sub = ''
      for (const part of candidatePath.split('/')) {
        sub = sub ? `${sub}/${part}` : part
        const vp = parseVaultPath(sub)
        if (!this.entries.has(vp)) {
          this.entries.set(vp, { path: vp, kind: 'folder' })
        }
      }

      this.indexFiles()
      this.notify({
        dir: this.dir,
        entries: [...this.entries.values()],
        changed: [],
        removed: []
      })
      return candidatePath
    })
  }

  deleteEntry(path: VaultPath): Promise<void> {
    return this.run(async () => {
      const clean = parseVaultPath(path)
      const entry = this.entries.get(clean)
      if (!entry) return
      const removed: VaultPath[] = []
      if (entry.kind === 'folder') {
        const prefix = clean + '/'
        for (const [p, e] of this.entries) {
          if (p === clean || p.startsWith(prefix)) {
            this.entries.delete(p)
            if (e.kind === 'note') {
              this.index.delete(p)
              this.ownWrites.delete(p)
            }
            removed.push(p)
          }
        }
      } else {
        this.entries.delete(clean)
        this.index.delete(clean)
        this.ownWrites.delete(clean)
        removed.push(clean)
      }
      this.indexFiles()
      this.notify({
        dir: this.dir,
        entries: [...this.entries.values()],
        changed: [],
        removed
      })
    })
  }

  renameOrMove(
    from: VaultPath,
    to: VaultPath,
    updateLinks: boolean,
    journal?: JournalHandler
  ): Promise<void> {
    return this.run(async () => {
      const cleanFrom = parseVaultPath(from)
      const cleanTo = parseVaultPath(to)
      if (cleanFrom === cleanTo) return

      const fromExists = this.entries.has(cleanFrom)
      const toExists = this.entries.has(cleanTo)

      if (toExists && fromExists) {
        throw new Error('目标文件或文件夹已存在')
      }
      if (!toExists && !fromExists) {
        throw new Error('源文件或文件夹不存在')
      }

      const entry = this.entries.get(cleanFrom) ?? this.entries.get(cleanTo)
      const isFolder = entry?.kind === 'folder' || (!entry && !cleanFrom.endsWith('.md'))

      if (journal) {
        await journal.write({
          dir: this.dir,
          from: cleanFrom,
          to: cleanTo,
          kind: isFolder ? 'folder' : 'note',
          updateLinks
        })
      }

      if (fromExists) {
        const fullFrom = join(this.dir, cleanFrom)
        const fullTo = join(this.dir, cleanTo)
        await mkdir(dirname(fullTo), { recursive: true })
        try {
          await fsRename(fullFrom, fullTo)
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'ENOENT') {
            const destStat = await stat(fullTo).catch(() => null)
            if (!destStat) throw error
          } else {
            throw error
          }
        }
      }

      const renames = new Map<VaultPath, VaultPath>()
      if (isFolder) {
        const fromPrefix = cleanFrom + '/'
        for (const [p] of this.entries) {
          if (p === cleanFrom || p.startsWith(fromPrefix)) {
            const suffix = p.slice(cleanFrom.length)
            renames.set(p, parseVaultPath(cleanTo + suffix))
          }
        }
        if (!renames.has(cleanFrom)) {
          renames.set(cleanFrom, cleanTo)
        }
      } else {
        renames.set(cleanFrom, cleanTo)
      }

      for (const [oldP, newP] of renames) {
        const oldEntry = this.entries.get(oldP)
        this.entries.delete(oldP)
        if (oldEntry) {
          this.entries.set(newP, { path: newP, kind: oldEntry.kind })
          if (oldEntry.kind === 'note') {
            const noteData = this.index.get(oldP)
            this.index.delete(oldP)
            if (noteData) {
              this.index.set(newP, noteData.text)
            }
            const ownHash = this.ownWrites.get(oldP)
            this.ownWrites.delete(oldP)
            if (ownHash) this.ownWrites.set(newP, ownHash)
          }
        } else {
          this.entries.set(newP, { path: newP, kind: kind(newP) })
        }
      }
      this.indexFiles()

      const changedNotes: VaultPath[] = []
      if (updateLinks) {
        const currentFiles = [...this.entries.values()]
          .filter((e) => e.kind !== 'folder')
          .map((e) => e.path)
        const mapping = buildRenameMapping(renames, currentFiles)

        const reverseMap = new Map<VaultPath, VaultPath>()
        for (const [f, t] of renames) {
          reverseMap.set(t, f)
        }

        const candidateNotes = new Set<VaultPath>()
        for (const newP of renames.values()) {
          if (this.entries.get(newP)?.kind === 'note') candidateNotes.add(newP)
        }
        for (const [oldP] of renames) {
          const oldName = oldP.slice(oldP.lastIndexOf('/') + 1).replace(/\.md$/i, '')
          const oldLower = oldName.toLowerCase()
          for (const [notePath, indexed] of this.index.entries()) {
            if (indexed.text.toLowerCase().includes(oldLower)) {
              candidateNotes.add(notePath)
            }
          }
        }

        for (const notePath of candidateNotes) {
          const ent = this.entries.get(notePath)
          if (!ent || ent.kind !== 'note') continue
          const oldSourcePath = reverseMap.get(notePath) ?? notePath
          const currentVersion = await this.readNote(notePath)
          if (!currentVersion) continue

          const links = extractLinks(currentVersion.text)
          const newText = rewriteNoteLinks(
            notePath,
            oldSourcePath,
            currentVersion.text,
            links,
            mapping,
            this.config
          )
          if (newText !== null && newText !== currentVersion.text) {
            const bytes = Buffer.from(newText, 'utf8')
            const nextHash = hash(bytes)
            const full = await this.filePath(notePath)
            const file = await open(
              full,
              constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK
            )
            try {
              for (let offset = 0; offset < bytes.length;) {
                const { bytesWritten } = await file.write(
                  bytes,
                  offset,
                  bytes.length - offset,
                  offset
                )
                if (!bytesWritten) throw new Error('无法写入笔记')
                offset += bytesWritten
              }
              await file.truncate(bytes.length)
              this.ownWrites.set(notePath, nextHash)
              this.index.set(notePath, newText)
              changedNotes.push(notePath)
            } finally {
              await file.close()
            }
          }
        }
      }

      if (journal) {
        await journal.clear()
      }

      this.notify({
        dir: this.dir,
        entries: [...this.entries.values()],
        changed: [...changedNotes, ...renames.values()],
        removed: [...renames.keys()]
      })
    })
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
