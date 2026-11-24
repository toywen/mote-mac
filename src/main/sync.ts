import { createHash } from 'node:crypto'
import {
  asVaultPath,
  isVaultPath,
  mergeText,
  ProtocolError,
  type Change,
  type CommitResult,
  type ContentHash,
  type Seq,
  type ServerMessage,
  type VaultPath
} from 'mote-sync-protocol'
import type { ContentHash as DiskHash, VaultPath as DiskPath } from '../core/ipc.ts'
import { sourceText } from '../core/text.ts'
import { kind } from './notes.ts'
import { createRemote, RemoteError, type Remote, type RemoteSocket } from './syncRemote.ts'
import { emptyState, loadState, saveState, stateFile, type SyncState } from './syncState.ts'
import type { DiskChange, Vault } from './vault.ts'
import type { InVault } from './vaultFs.ts'

export type SyncConfig = {
  serverUrl: string
  certPem?: string
  token: string
  vaultId: string
  deviceName: string
}

export type SyncStatus = {
  state: 'idle' | 'syncing' | 'offline' | 'error' | 'blocked'
  /** Files waiting to be compared, uploaded or downloaded. */
  pending: number
  seq: number
  lastError?: string
}

export type SyncVault = Pick<Vault, 'listFiles' | 'readFile' | 'writeFile' | 'trash' | 'subscribe'>

export interface SyncOptions {
  vault: SyncVault
  config: SyncConfig
  /** mote's own folder for sync state tables, never inside the vault. */
  stateDir: string
  /** Where a file deleted on another device goes. Electron passes `shell.trashItem`. */
  trash: (full: InVault) => Promise<void>
  remote?: Remote
  /** Clock for conflict file names. */
  now?: () => number
  /** How long a file must stay unchanged before it is uploaded. */
  debounceMs?: number
}

/** Files in flight per lane. Notes are small and many; attachments are big and few. */
export const NOTE_CONCURRENCY = Number(process.env.MOTE_SYNC_NOTE_CONCURRENCY ?? 8)
export const ATTACHMENT_CONCURRENCY = 2

export const DEBOUNCE_MS = 1500
export const SAVE_EVERY_MS = 2000
export const RETRY_FIRST_MS = 1000
export const RETRY_LAST_MS = 60_000

/** Deletion protection: one scan that finds more than 20 known files gone, and more than half. */
export function deletionNeedsConfirm(gone: number, known: number): boolean {
  return gone > 20 && gone > known / 2
}

/** `名字 (冲突 设备名 YYYYMMDDHHmm).md`, with `-2`, `-3` and on when `n` says the name is taken. */
export function conflictPath(path: string, device: string, date: Date, n = 1): VaultPath {
  const slash = path.lastIndexOf('/')
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const two = (value: number): string => String(value).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}` +
    `${two(date.getHours())}${two(date.getMinutes())}`
  const who = device.replace(/[/\\\0]/g, '-').trim() || '设备'
  const suffix = n > 1 ? `-${n}` : ''
  return asVaultPath(`${path.slice(0, slash + 1)}${stem} (冲突 ${who} ${stamp})${suffix}${ext}`)
}

/**
 * Where the connection is. `blocked` waits for `confirmDeletions`. `stopped` is before `start`
 * and after `stop`. Every move to a new connection bumps `gen`, so work from an old one stops.
 */
type Link = 'stopped' | 'connecting' | 'online' | 'offline' | 'error' | 'blocked'

/** One file at a time, in order. Notes and attachments each get one, so a large upload does not hold up notes. */
class Lane {
  private readonly limit: number
  private active = 0
  private readonly waiting: (() => void)[] = []
  private readonly tails = new Map<string, Promise<unknown>>()
  private outstanding = 0
  private idleWaiters: (() => void)[] = []
  size = 0

  constructor(limit: number) {
    this.limit = limit
  }

  /**
   * Runs `op` for one file. Two files never wait on each other, and up to `limit` run at once;
   * the same file still goes one at a time, which is what the commits and the state table assume.
   * A first sync of a large vault is why: each file costs three round trips.
   */
  run(key: string, op: () => Promise<boolean>): Promise<boolean> {
    this.size++
    this.outstanding++
    const previous = this.tails.get(key) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(() => this.slot(op))
    this.tails.set(key, result)
    const settle = (): void => {
      this.size--
      this.outstanding--
      if (this.tails.get(key) === result) this.tails.delete(key)
      if (this.outstanding === 0) for (const done of this.idleWaiters.splice(0)) done()
    }
    void result.then(settle, settle)
    return result
  }

  idle(): Promise<unknown> {
    if (this.outstanding === 0) return Promise.resolve()
    return new Promise((done) => this.idleWaiters.push(() => done(undefined)))
  }

  private slot(op: () => Promise<boolean>): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const start = (): void => {
        this.active++
        void op()
          .then(resolve, reject)
          .finally(() => {
            this.active--
            this.waiting.shift()?.()
          })
      }
      if (this.active < this.limit) start()
      else this.waiting.push(start)
    })
  }
}

/** The `waiting` key for "scan the whole vault". Not a vault path, so it cannot clash with one. */
const RESCAN = ''

const sha256 = (bytes: Buffer): ContentHash =>
  createHash('sha256').update(bytes).digest('hex') as ContentHash
const disk = (path: VaultPath): DiskPath => path as string as DiskPath
const diskHash = (hash: ContentHash): DiskHash => hash as string as DiskHash
const isNote = (path: string): boolean => kind(path) === 'note'

function decode(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return null
  }
}

/** Network, TLS, a 5xx or a malformed answer: the service, not this file, is the problem. */
function remoteFailure(error: unknown): boolean {
  return error instanceof RemoteError || error instanceof ProtocolError
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Keeps one vault in step with the sync service. Talks to the disk only through `Vault`, so every
 * write waits in its queue behind saves and renames, and checks a base hash first.
 */
export class Sync {
  private readonly vault: SyncVault
  private readonly config: SyncConfig
  private readonly remote: Remote
  private readonly trashFile: (full: InVault) => Promise<void>
  private readonly now: () => number
  private readonly debounceMs: number
  private readonly file: string

  private state: SyncState
  private link: Link = 'stopped'
  private gen = 0
  private lastError: string | undefined
  private socket: RemoteSocket | undefined
  private retryMs = RETRY_FIRST_MS
  private retryTimer: NodeJS.Timeout | undefined
  private unsubscribe: (() => void) | undefined

  private readonly waiting = new Map<VaultPath | typeof RESCAN, NodeJS.Timeout>()
  private readonly ready = new Set<VaultPath>()
  private readyRescan = false
  private flushTimer: NodeJS.Immediate | undefined
  private flushing: Promise<void> = Promise.resolve()
  private readonly lanes = {
    note: new Lane(NOTE_CONCURRENCY),
    attachment: new Lane(ATTACHMENT_CONCURRENCY)
  }
  private allowDeletions = false

  /** The highest seq fetched. `state.seq` trails it until those changes are on disk. */
  private cursor = 0 as Seq
  private pulling = false
  private pullAgain = false
  private readonly pulls: { target: Seq; done: boolean }[] = []

  private dirty = false
  private lastSave = 0
  private saveTimer: NodeJS.Timeout | undefined
  private saving: Promise<void> = Promise.resolve()

  private readonly listeners = new Set<(status: SyncStatus) => void>()
  private shown = ''

  constructor(options: SyncOptions) {
    this.vault = options.vault
    this.config = options.config
    this.remote = options.remote ?? createRemote(options.config)
    this.trashFile = options.trash
    this.now = options.now ?? Date.now
    this.debounceMs = options.debounceMs ?? DEBOUNCE_MS
    this.file = stateFile(options.stateDir, options.config.vaultId)
    this.state = emptyState(options.config.serverUrl)
  }

  /** Loads the state table, starts listening to the vault and connects. Does not wait for the connection. */
  async start(): Promise<void> {
    if (this.link !== 'stopped') return
    this.state = await loadState(this.file, this.config.serverUrl)
    this.unsubscribe = this.vault.subscribe((change) => this.heard(change))
    this.link = 'offline'
    void this.connect()
  }

  /** Disconnects, lets the file in hand finish, and writes the state table. */
  async stop(): Promise<void> {
    if (this.link === 'stopped') return
    this.link = 'stopped'
    this.gen++
    this.unsubscribe?.()
    clearTimeout(this.retryTimer)
    if (this.flushTimer) clearImmediate(this.flushTimer)
    this.flushTimer = undefined
    for (const timer of this.waiting.values()) clearTimeout(timer)
    this.waiting.clear()
    this.ready.clear()
    this.socket?.close()
    this.socket = undefined
    await Promise.all([this.flushing, this.lanes.note.idle(), this.lanes.attachment.idle()])
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    await this.save()
    this.emit()
  }

  status(): SyncStatus {
    const pending =
      this.waiting.size + this.ready.size + this.lanes.note.size + this.lanes.attachment.size
    const state: SyncStatus['state'] =
      this.link === 'blocked' || this.link === 'error'
        ? this.link
        : this.link !== 'online'
          ? 'offline'
          : pending > 0 || this.pulling
            ? 'syncing'
            : 'idle'
    return {
      state,
      pending,
      seq: this.state.seq,
      ...(this.lastError && { lastError: this.lastError })
    }
  }

  onStatus(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** After deletion protection stopped sync: commit the deletions it held back, then go on. */
  confirmDeletions(): void {
    if (this.link !== 'blocked') return
    this.allowDeletions = true
    this.lastError = undefined
    this.link = 'offline'
    void this.connect()
  }

  /** Downloads first, then compares every file and uploads. */
  private async connect(): Promise<void> {
    const gen = ++this.gen
    this.link = 'connecting'
    this.cursor = this.state.seq
    this.pulls.length = 0
    this.emit()
    try {
      const { vaults } = await this.remote.listVaults()
      if (!vaults.some((vault) => vault.id === this.config.vaultId)) {
        throw new RemoteError(403, `同步服务上没有笔记库 ${this.config.vaultId}`, 'forbidden')
      }
      const socket = await this.remote.openSocket({
        onMessage: (message) => {
          if (gen === this.gen) this.heardServer(gen, message)
        },
        onClose: () => this.fail(gen, new RemoteError(null, '和同步服务的连接断了'))
      })
      if (gen !== this.gen) return socket.close()
      this.socket = socket
      this.link = 'online'
      this.retryMs = RETRY_FIRST_MS
      this.lastError = undefined
      this.emit()
      await this.pull(gen)
      this.queueFlush(true)
    } catch (error) {
      this.fail(gen, error)
    }
  }

  /** Drops the connection and tries again after 1 s, 2 s, 4 s and so on up to 60 s. */
  private fail(gen: number, error: unknown): void {
    if (gen !== this.gen || this.link === 'stopped' || this.link === 'blocked') return
    this.gen++
    this.socket?.close()
    this.socket = undefined
    const status = error instanceof RemoteError ? error.status : 0
    this.link = status === null || status >= 500 ? 'offline' : 'error'
    this.lastError = message(error)
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.connect()
    }, this.retryMs)
    this.retryMs = Math.min(this.retryMs * 2, RETRY_LAST_MS)
    this.emit()
  }

  private block(gone: number): void {
    this.gen++
    this.socket?.close()
    this.socket = undefined
    this.link = 'blocked'
    this.lastError = `${gone} 个文件不见了，确认删除后才会同步`
    this.emit()
  }

  /** The service only pushes a seq. A newer one means "pull"; it never makes this device upload. */
  private heardServer(gen: number, message: ServerMessage): void {
    const seq =
      message.type === 'hello'
        ? message.vaults.find((vault) => vault.id === this.config.vaultId)?.seq
        : message.vault === this.config.vaultId
          ? message.seq
          : undefined
    if (this.link === 'online' && seq !== undefined && seq > this.cursor) void this.pull(gen)
  }

  /**
   * Fetches every change after the cursor and queues each on its lane. `state.seq` moves up to a
   * pull's end only once all its changes, and every earlier pull's, are applied.
   */
  private async pull(gen: number): Promise<void> {
    if (this.pulling) {
      this.pullAgain = true
      return
    }
    this.pulling = true
    this.emit()
    try {
      do {
        this.pullAgain = false
        const applied: Promise<boolean>[] = []
        let since = this.cursor
        for (;;) {
          const page = await this.remote.changes(since)
          if (gen !== this.gen) return
          for (const change of page.changes) {
            applied.push(this.enqueue(gen, change.path, () => this.apply(change)))
          }
          since = page.next
          if (page.complete) break
        }
        this.cursor = since
        const entry = { target: since, done: false }
        this.pulls.push(entry)
        void Promise.all(applied).then((oks) => {
          if (gen !== this.gen || !oks.every(Boolean)) return
          entry.done = true
          while (this.pulls[0]?.done) {
            this.state.seq = this.pulls.shift()!.target
            this.changed()
          }
          this.emit()
        })
      } while (this.pullAgain && gen === this.gen)
    } catch (error) {
      this.fail(gen, error)
    } finally {
      this.pulling = false
      this.emit()
    }
  }

  /**
   * Runs one file's work on its lane. Resolves false when the connection it was meant for is gone
   * or the service failed; the next connection starts over from the state table. An error that is
   * about this file only is shown and skipped, and the next scan tries the file again.
   */
  private enqueue(gen: number, path: VaultPath, op: () => Promise<void>): Promise<boolean> {
    const lane = this.lanes[isNote(path) ? 'note' : 'attachment']
    const result = lane.run(path, async () => {
      if (gen !== this.gen || this.link !== 'online') return false
      try {
        await op()
        return true
      } catch (error) {
        if (remoteFailure(error)) {
          this.fail(gen, error)
          return false
        }
        this.lastError = `${path}：${message(error)}`
        console.error(`mote sync: ${path}`, error)
        return true
      }
    })
    this.emit()
    void result.then(() => this.emit())
    return result
  }

  /** A path the watcher saw waits until it has been quiet for `debounceMs`. */
  private heard(change: DiskChange): void {
    for (const path of change.paths) {
      // The attachment folder itself is not a vault path, so its events ask for a scan.
      if (path === '.mote' || path === '.mote/attachments') this.wait(RESCAN)
      else if (isVaultPath(path)) this.wait(path)
    }
    if (change.rescan) this.wait(RESCAN)
    this.emit()
  }

  private wait(path: VaultPath | typeof RESCAN): void {
    clearTimeout(this.waiting.get(path))
    this.waiting.set(
      path,
      setTimeout(() => {
        this.waiting.delete(path)
        if (path === RESCAN) this.queueFlush(true)
        else {
          this.ready.add(path)
          this.queueFlush(false)
        }
      }, this.debounceMs)
    )
  }

  /** Paths whose timers fire in the same turn go out together. */
  private queueFlush(rescan: boolean): void {
    if (rescan) this.readyRescan = true
    this.flushTimer ??= setImmediate(() => {
      this.flushTimer = undefined
      const paths = [...this.ready]
      const all = this.readyRescan
      this.ready.clear()
      this.readyRescan = false
      const gen = this.gen
      this.flushing = this.flushing
        .then(() => this.flush(gen, paths, all))
        .catch((error: unknown) => {
          this.lastError = message(error)
          console.error('mote sync: scan failed', error)
        })
      this.emit()
    })
  }

  /**
   * A path that is a file now goes straight to its lane. Anything else (gone, a folder, a watcher
   * that lost track) needs a scan of the whole vault, and only a scan commits deletions, after
   * deletion protection. While offline nothing is queued: the next connection scans anyway.
   */
  private async flush(gen: number, paths: VaultPath[], rescan: boolean): Promise<void> {
    if (gen !== this.gen || this.link !== 'online') return
    let scan = rescan
    for (const path of paths) {
      if (await this.vault.readFile(disk(path))) this.enqueue(gen, path, () => this.push(path))
      else scan = true
    }
    if (!scan) return
    // Throws when the vault folder is gone, so an unmounted vault never looks deleted.
    const files = await this.vault.listFiles()
    if (gen !== this.gen || this.link !== 'online') return
    const present = new Set<string>()
    for (const file of files) {
      present.add(file.path)
      const path = file.path as string
      if (isVaultPath(path) && (file.hash as string) !== this.state.files[path]?.hash) {
        this.enqueue(gen, path, () => this.push(path))
      }
    }
    const known = Object.entries(this.state.files).filter(([, file]) => file.hash !== null)
    const gone = known.filter(([path]) => !present.has(path)).map(([path]) => asVaultPath(path))
    if (gone.length === 0) return
    if (!this.allowDeletions && deletionNeedsConfirm(gone.length, known.length)) {
      return this.block(gone.length)
    }
    this.allowDeletions = false
    for (const path of gone) this.enqueue(gen, path, () => this.push(path, true))
  }

  /**
   * Uploads the file if it differs from the state table. Content goes up first, unless the
   * service can already use it, then the commit. A deletion is committed only when a scan
   * approved it (`mayDelete`); otherwise a missing file asks for that scan.
   */
  private async push(path: VaultPath, mayDelete = false, attempt = 0): Promise<void> {
    const bytes = await this.vault.readFile(disk(path))
    const local = bytes && sha256(bytes)
    const known = this.state.files[path]
    if (local === (known?.hash ?? null)) return
    let result: CommitResult
    if (bytes === null || local === null) {
      if (!mayDelete) return this.queueFlush(true)
      result = await this.remote.commit({ path, baseSeq: known!.seq, deleted: true, hash: null })
    } else {
      if (!(await this.remote.head(local))) await this.remote.putBlob(local, bytes)
      const baseSeq = known?.seq ?? (0 as Seq)
      result = await this.remote.commit({ path, baseSeq, deleted: false, hash: local })
    }
    if (result.ok) return this.record(path, local, result.seq)
    // The protocol's retry rule: the service already has exactly this, an earlier answer was lost.
    if (result.conflict.hash === local) return this.record(path, local, result.conflict.seq)
    if (attempt >= 3) throw new Error(`提交了 ${attempt + 1} 次都和别的设备冲突`)
    await this.merge(path, result.conflict, attempt + 1)
  }

  /** One change from the service. Unchanged here since the last sync: take theirs. Else merge. */
  private async apply(change: Change): Promise<void> {
    const { path } = change
    const known = this.state.files[path]
    if (known && known.seq >= change.seq) return
    const bytes = await this.vault.readFile(disk(path))
    const local = bytes && sha256(bytes)
    if (local === change.hash) return this.record(path, change.hash, change.seq)
    if (local !== (known?.hash ?? null)) return this.merge(path, change)
    if (change.deleted) {
      const trashed = await this.vault.trash(disk(path), this.trashFile, diskHash(local!))
      return trashed ? this.record(path, null, change.seq) : this.merge(path, change)
    }
    const theirs = await this.download(change.hash)
    const written = await this.vault.writeFile(disk(path), theirs, local && diskHash(local))
    return written.ok ? this.record(path, change.hash, change.seq) : this.merge(path, change)
  }

  /**
   * Both sides changed the file since the state table's base. A change beats a deletion on either
   * side. Notes merge three ways; without a base, or for text that is not UTF-8, the local bytes
   * move to a conflict file. An attachment keeps the local bytes and commits them on top.
   */
  private async merge(
    path: VaultPath,
    remote: { hash: ContentHash | null; seq: Seq },
    attempt = 0
  ): Promise<void> {
    const bytes = await this.vault.readFile(disk(path))
    const local = bytes && sha256(bytes)
    const base = this.state.files[path]?.hash ?? null
    if (local === remote.hash) return this.record(path, local, remote.seq)
    if (bytes === null) {
      const theirs = await this.download(remote.hash!)
      const written = await this.vault.writeFile(disk(path), theirs, null)
      // Not written: a file appeared here meanwhile, and its own event brings it back.
      if (written.ok) this.record(path, remote.hash, remote.seq)
      return
    }
    if (remote.hash !== null && base === null)
      return this.conflictCopy(path, bytes, remote.hash, remote.seq)
    if (remote.hash !== null && isNote(path)) {
      const merged = await this.mergeNote(base!, bytes, remote.hash)
      if (merged === null) return this.conflictCopy(path, bytes, remote.hash, remote.seq)
      if (!merged.equals(bytes)) {
        const written = await this.vault.writeFile(disk(path), merged, diskHash(local!))
        if (!written.ok) return
      }
    }
    // The remote state becomes the base, so the push commits what is on disk on top of it.
    this.record(path, remote.hash, remote.seq)
    await this.push(path, false, attempt)
  }

  /** Null when the base is no longer kept or a version is not UTF-8. Keeps the local BOM and line breaks. */
  private async mergeNote(
    base: ContentHash,
    local: Buffer,
    remote: ContentHash
  ): Promise<Buffer | null> {
    const [baseBytes, remoteBytes] = await Promise.all([
      this.remote.getBlob(base),
      this.remote.getBlob(remote)
    ])
    if (!baseBytes || !remoteBytes) return null
    const [baseText, localText, remoteText] = [baseBytes, local, remoteBytes].map(decode)
    if (baseText === null || localText === null || remoteText === null) return null
    const mine = sourceText(localText)
    const text = mergeText(sourceText(baseText).text, mine.text, sourceText(remoteText).text)
    return Buffer.from(mine.format.bom + text.replaceAll('\n', mine.format.preferred), 'utf8')
  }

  /** Saves the local bytes under a new name, puts the remote bytes in place, and uploads the copy. */
  private async conflictCopy(
    path: VaultPath,
    local: Buffer,
    remote: ContentHash,
    seq: Seq
  ): Promise<void> {
    const theirs = await this.download(remote)
    const date = new Date(this.now())
    let copy: VaultPath | undefined
    for (let n = 1; !copy && n <= 100; n++) {
      const name = conflictPath(path, this.config.deviceName, date, n)
      if (this.state.files[name]?.hash) continue
      if ((await this.vault.writeFile(disk(name), local, null)).ok) copy = name
    }
    if (!copy) throw new Error('找不到空的冲突文件名')
    const written = await this.vault.writeFile(disk(path), theirs, diskHash(sha256(local)))
    if (!written.ok) return
    this.record(path, remote, seq)
    await this.push(copy)
  }

  private async download(hash: ContentHash): Promise<Buffer> {
    const bytes = await this.remote.getBlob(hash)
    if (!bytes) throw new RemoteError(404, '同步服务上找不到这份内容', 'not_found')
    if (sha256(bytes) !== hash) throw new RemoteError(null, '下载的内容和哈希不符')
    return bytes
  }

  private record(path: VaultPath, hash: ContentHash | null, seq: Seq): void {
    this.state.files[path] = { hash, seq }
    this.changed()
  }

  /** Writes the table at most every 2 s. */
  private changed(): void {
    this.dirty = true
    this.saveTimer ??= setTimeout(
      () => {
        this.saveTimer = undefined
        void this.save()
      },
      Math.max(0, this.lastSave + SAVE_EVERY_MS - Date.now())
    )
  }

  private save(): Promise<void> {
    if (this.dirty) {
      this.dirty = false
      this.lastSave = Date.now()
      this.saving = this.saving
        .then(() => saveState(this.file, this.state))
        .catch((error: unknown) => {
          this.dirty = true
          this.lastError = `同步状态表写不进去：${message(error)}`
          this.emit()
        })
    }
    return this.saving
  }

  private emit(): void {
    const status = this.status()
    const shown = JSON.stringify(status)
    if (shown === this.shown) return
    this.shown = shown
    for (const listener of this.listeners) listener(status)
  }
}
