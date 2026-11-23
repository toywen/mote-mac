import { watch, type FSWatcher } from 'node:fs'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
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
import {
  createFile,
  ensureFolder,
  locate,
  move,
  openExisting,
  overwrite,
  type InVault
} from './vaultFs.ts'

export type RenameJournal = {
  dir: string
  from: VaultPath
  to: VaultPath
  kind: 'note' | 'folder'
  updateLinks: boolean
}

/** A file in the vault, with the SHA-256 and length of its bytes. */
export type VaultFile = { path: VaultPath; hash: ContentHash; size: number }

/**
 * What the file watcher saw, mote's own writes included. A path may be a file or a folder, and
 * may be gone. `rescan` means the watcher lost track, so anything may have changed.
 */
export type DiskChange = { paths: VaultPath[]; rescan: boolean }

export type FileWriteResult = { ok: true } | { ok: false; disk: ContentHash | null }

export interface JournalHandler {
  read(): Promise<RenameJournal | null>
  write(journal: RenameJournal): Promise<void>
  clear(): Promise<void>
}

async function readConfig(root: string): Promise<VaultConfig> {
  const moteSettings = join(root, '.mote', 'settings.json')
  const obsidian = join(root, '.obsidian')

  async function readJson(file: string): Promise<Record<string, unknown>> {
    try {
      if ((await realpath(file)) !== file || !(await lstat(file)).isFile()) return {}
      const value: unknown = JSON.parse(await readFile(file, 'utf8'))
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }

  const mote = await readJson(moteSettings)
  const [app, daily] = await Promise.all([
    readJson(join(obsidian, 'app.json')),
    readJson(join(obsidian, 'daily-notes.json'))
  ])

  const dailySettings =
    mote.daily && typeof mote.daily === 'object' ? (mote.daily as Record<string, unknown>) : daily

  return {
    useMarkdownLinks:
      typeof mote.useMarkdownLinks === 'boolean'
        ? mote.useMarkdownLinks
        : app.useMarkdownLinks === true,
    newLinkFormat:
      mote.newLinkFormat === 'relative' || mote.newLinkFormat === 'absolute'
        ? mote.newLinkFormat
        : app.newLinkFormat === 'relative' || app.newLinkFormat === 'absolute'
          ? app.newLinkFormat
          : 'shortest',
    alwaysUpdateLinks:
      typeof mote.alwaysUpdateLinks === 'boolean'
        ? mote.alwaysUpdateLinks
        : app.alwaysUpdateLinks !== false,
    newFileLocation:
      mote.newFileLocation === 'current' || mote.newFileLocation === 'folder'
        ? mote.newFileLocation
        : app.newFileLocation === 'current' || app.newFileLocation === 'folder'
          ? app.newFileLocation
          : 'root',
    newFileFolderPath:
      typeof mote.newFileFolderPath === 'string'
        ? mote.newFileFolderPath
        : typeof app.newFileFolderPath === 'string'
          ? app.newFileFolderPath
          : '',
    attachmentFolderPath:
      typeof mote.attachmentFolderPath === 'string'
        ? mote.attachmentFolderPath
        : typeof app.attachmentFolderPath === 'string' && app.attachmentFolderPath
          ? app.attachmentFolderPath
          : '.mote/attachments',
    daily: {
      folder: typeof dailySettings.folder === 'string' ? dailySettings.folder : '',
      format:
        typeof dailySettings.format === 'string' && dailySettings.format
          ? dailySettings.format
          : 'YYYY-MM-DD'
    }
  }
}

export class Vault {
  private entries = new Map<VaultPath, VaultEntry>()
  private readonly index = new NoteIndex()
  private readonly ownWrites = new Map<VaultPath, ContentHash>()
  private readonly pending = new Set<VaultPath>()
  private readonly listeners = new Set<(change: DiskChange) => void>()
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

  backlinks(path: VaultPath): Hit[] {
    return this.index
      .backlinks(parseVaultPath(path))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.from - b.from))
  }

  private schedule(name: string | null): void {
    if (this.closed) return
    if (name) {
      try {
        this.pending.add(parseVaultPath(name))
      } catch {
        return
      }
    } else {
      this.rescan = true
    }
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
    if (!this.closed) {
      const change: DiskChange = { paths: [...new Set([...paths, ...removed])], rescan }
      for (const listener of this.listeners) listener(change)
    }
  }

  /** Hears every refresh of the file watcher, mote's own writes included. `notify` leaves those out. */
  subscribe(listener: (change: DiskChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  filePath(path: VaultPath): Promise<InVault> {
    return locate(this.dir, path)
  }

  private async folder(folder: string): Promise<void> {
    await ensureFolder(this.dir, folder)
    let sub = ''
    for (const part of folder ? folder.split('/') : []) {
      sub = sub ? `${sub}/${part}` : part
      if (sub.startsWith('.')) continue
      const path = parseVaultPath(sub)
      if (!this.entries.has(path)) this.entries.set(path, { path, kind: 'folder' })
    }
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

      await this.folder(folder)
      await createFile(await locate(this.dir, candidatePath))

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

      await this.folder(folder)
      await createFile(await locate(this.dir, targetPath), data)

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

      await this.folder(candidatePath)

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

  /** With `baseHash`, trashes the file only while its bytes still hash to it, and says whether it did. */
  trash(
    path: VaultPath,
    moveToTrash: (full: InVault) => Promise<void>,
    baseHash?: ContentHash
  ): Promise<boolean> {
    return this.run(async () => {
      const clean = parseVaultPath(path)
      if (baseHash !== undefined) {
        const bytes = await this.readFile(clean)
        if (!bytes || hash(bytes) !== baseHash) return false
      }
      await moveToTrash(await locate(this.dir, clean))
      const entry = this.entries.get(clean)
      if (!entry) return true
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
      return true
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
        const fullFrom = await locate(this.dir, cleanFrom)
        const slash = cleanTo.lastIndexOf('/')
        await ensureFolder(this.dir, cleanTo.slice(0, Math.max(slash, 0)))
        const fullTo = await locate(this.dir, cleanTo)
        try {
          await move(fullFrom, fullTo)
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
          for (const [notePath] of this.index.mayLinkTo(oldP)) candidateNotes.add(notePath)
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
            const file = await openExisting(await this.filePath(notePath), 'readWrite')
            try {
              await overwrite(file, bytes)
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
        removed: [...renames.keys()],
        renamed: [...renames].map(([from, to]) => ({ from, to }))
      })
    })
  }

  /** Every file of the vault, hashed now. Reads every byte, so a large attachment makes it slow. */
  async listFiles(): Promise<VaultFile[]> {
    const paths = [...(await this.scan()).values()]
      .filter((entry) => entry.kind !== 'folder')
      .map((entry) => entry.path)
    const files: VaultFile[] = []
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < paths.length) {
        const path = paths[next++]
        const bytes = await this.readFile(path)
        if (bytes) files.push({ path, hash: hash(bytes), size: bytes.length })
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, paths.length) }, worker))
    return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  /** The file's bytes, or null when no file is there. */
  async readFile(path: VaultPath): Promise<Buffer | null> {
    try {
      const file = await openExisting(await locate(this.dir, path), 'read')
      try {
        return (await file.stat()).isFile() ? await file.readFile() : null
      } finally {
        await file.close()
      }
    } catch (error) {
      if (missing(error) || (error as NodeJS.ErrnoException).code === 'EISDIR') return null
      throw error
    }
  }

  /**
   * Writes any file, note or attachment, from its bytes. A null `baseHash` creates the file and its
   * folders and fails if anything is there. Otherwise the file must still hash to `baseHash`. The
   * renderer hears of it as a change on disk, so an open note reloads or goes to conflict.
   */
  writeFile(
    path: VaultPath,
    bytes: Buffer,
    baseHash: ContentHash | null
  ): Promise<FileWriteResult> {
    return this.run(async (): Promise<FileWriteResult> => {
      const clean = parseVaultPath(path)
      if (this.closed) throw new Error('笔记库已切换')
      try {
        if (baseHash === null) {
          await this.folder(clean.slice(0, Math.max(clean.lastIndexOf('/'), 0)))
          await createFile(await locate(this.dir, clean), bytes)
        } else {
          const full = await locate(this.dir, clean)
          const file = await openExisting(full, 'readWrite')
          try {
            const before = await file.stat()
            if (!before.isFile()) return { ok: false, disk: null }
            const disk = hash(await file.readFile())
            const latest = await stat(full)
            if (
              before.ino !== latest.ino ||
              before.mtimeMs !== latest.mtimeMs ||
              before.size !== latest.size
            ) {
              const now = await this.readFile(clean)
              return { ok: false, disk: now && hash(now) }
            }
            if (disk !== baseHash) return { ok: false, disk }
            await overwrite(file, bytes)
          } finally {
            await file.close()
          }
        }
      } catch (error) {
        if (missing(error)) return { ok: false, disk: null }
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const now = await this.readFile(clean)
          return { ok: false, disk: now && hash(now) }
        }
        throw error
      }
      this.ownWrites.set(clean, hash(bytes))
      const added = !this.entries.has(clean)
      if (added) {
        this.entries.set(clean, { path: clean, kind: kind(clean) })
        this.indexFiles()
      }
      const note = kind(clean) === 'note'
      if (note) {
        try {
          this.index.set(clean, noteVersion(bytes).text)
        } catch {
          this.index.delete(clean)
        }
      }
      this.notify({
        dir: this.dir,
        entries: added ? [...this.entries.values()] : undefined,
        changed: note ? [clean] : [],
        removed: []
      })
      return { ok: true }
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

  createNote(path: VaultPath): Promise<void> {
    return this.run(async () => {
      const note = parseVaultPath(path)
      if (this.closed || kind(note) !== 'note') throw new Error('笔记库已切换或路径无效')
      await ensureFolder(this.dir, note.slice(0, Math.max(note.lastIndexOf('/'), 0)))
      try {
        await createFile(await locate(this.dir, note))
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
        if (baseHash === null) {
          await createFile(full, bytes)
          this.ownWrites.set(path, nextHash)
          this.index.set(path, text)
          return { ok: true, hash: nextHash }
        }
        const file = await openExisting(full, 'readWrite')
        try {
          const before = await file.stat()
          if (!before.isFile()) return { ok: false, disk: null }
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
          await overwrite(file, bytes)
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
