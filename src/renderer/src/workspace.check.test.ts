// Model check of the open note's save state machine. How to run it and read a failure:
// .claude/skills/verify-open-note/SKILL.md.
//
// It drives the real Workspace. window.mote is a fake that copies main's Vault (src/main/vault.ts):
// one serial queue (run) for writeNote and renameOrMove, readNote outside the queue, the watcher's
// refresh with its ownWrites filter, and one ordered channel back to the renderer. The editor is
// the part of NoteEditor that decides what the view shows. For each scenario, a breadth-first
// search tries every order of the events: your actions, the two autosave timers, main running its
// queue or a read, the watcher, and the renderer receiving the next message from main.
import { describe, expect, it } from 'vitest'
import type {
  ContentHash,
  MoteApi,
  NoteVersion,
  VaultChange,
  VaultInfo,
  VaultPath,
  WriteResult
} from '../../core/ipc'
import { Workspace, type Doc, type Place } from './workspace'

const DIR = '/vault'
const path = (text: string): VaultPath => text as VaultPath
const hashOf = (text: string): ContentHash => `#${text}` as ContentHash
const version = (text: string): NoteVersion => ({ text, hash: hashOf(text) })
const nextMacrotask = (globalThis as unknown as { setImmediate: (run: () => void) => void })
  .setImmediate
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env

type Draft = Exclude<Doc, { kind: 'html' | 'image' | 'pdf' }>
const isDraft = (doc: Doc | null): doc is Draft =>
  doc !== null && doc.kind !== 'html' && doc.kind !== 'image' && doc.kind !== 'pdf'

type CallSite = { getTypeName(): string | null; getFunctionName(): string | null }
const V8 = Error as unknown as {
  prepareStackTrace?: (error: Error, sites: CallSite[]) => unknown
  captureStackTrace(target: object): void
}

// The Workspace method that made an IPC call, read from V8's call sites. Formatting a stack
// would cost more than the rest of a step.
function caller(): string {
  const prepare = V8.prepareStackTrace
  V8.prepareStackTrace = (_error, sites) => sites
  const holder: { stack?: CallSite[] } = {}
  V8.captureStackTrace(holder)
  // V8 formats the stack when it is first read, so read it before putting prepare back.
  const sites = holder.stack
  V8.prepareStackTrace = prepare
  const site = sites?.find((s) => s.getTypeName() === 'Workspace')
  return site?.getFunctionName() ?? '?'
}

// The continuation an IPC call will resume, as far as it decides what happens next.
type Call = { caller: string; refreshId: number; doc: Doc | null }
type Reply = { resolve: (value: unknown) => void; reject: (error: Error) => void; call: Call }
type Op =
  | { kind: 'write'; path: VaultPath; text: string; baseHash: ContentHash | null; reply: Reply }
  | { kind: 'rename'; from: VaultPath; to: VaultPath; reply: Reply }
  | { kind: 'refresh'; paths: Set<VaultPath> }
type Read = { path: VaultPath; reply: Reply }
type Message =
  | { kind: 'reply'; reply: Reply; value?: unknown; error?: string; what: string }
  | { kind: 'change'; change: VaultChange }
type File = { id: number; text: string }

export type Action = {
  label: string
  enabled?: (world: World) => boolean
  run: (world: World) => Promise<unknown> | void
}

export type Scenario = {
  name: string
  notes: Record<string, string>
  open: string
  actions: Action[]
  // How many writeNote calls main may fail with an error, as a disk error would.
  writeErrors?: number
}

type Flight = { label: string; doc: Doc | null; tabs: VaultPath[]; selectionId: number }

export class World {
  readonly ws = new Workspace()
  readonly log: string[] = []
  readonly violations: string[] = []
  // A fault in the check itself, not in the code it checks.
  private broken = ''

  // Main: the disk, Vault's own state, its queue, reads in progress, paths the watcher reported.
  private disk = new Map<VaultPath, File>()
  private nextFile = 0
  private ownWrites = new Map<VaultPath, ContentHash>()
  private entries = new Set<VaultPath>()
  private queue: Op[] = []
  private reads: Read[] = []
  private watched = new Set<VaultPath>()
  private outbox: Message[] = []
  private writeErrors: number

  // The renderer's timers, its two IPC listeners, and the window.
  private timers = new Map<number, { ms: number; run: () => void }>()
  private nextTimer = 1
  private changeListener?: (change: VaultChange) => void
  private closeListener?: () => void
  private closed = false
  // Goes up whenever the renderer does something the check can see; settle() watches it.
  private progress = 0

  // The editor view: which note it was made for and the text it shows.
  private view: { key: string; path: VaultPath; text: string; source: object | null } | null = null

  // What the properties need to remember.
  // The text you typed last, and whether main has written it.
  private typed: { text: string; saved: boolean } | null = null
  private shown = new Set<string>()
  private flights = new Set<Flight>()
  private remaining: Action[]

  private constructor(scenario: Scenario) {
    this.remaining = [...scenario.actions]
    this.writeErrors = scenario.writeErrors ?? 0
    for (const [name, text] of Object.entries(scenario.notes)) {
      this.disk.set(path(name), { id: this.nextFile++, text })
      this.entries.add(path(name))
    }
  }

  static async start(scenario: Scenario): Promise<World> {
    const world = new World(scenario)
    const globals = globalThis as unknown as Record<string, unknown>
    globals.window = {
      mote: world.api(),
      setTimeout: (run: () => void, ms: number) => {
        world.progress++
        const id = world.nextTimer++
        world.timers.set(id, { ms, run })
        return id
      },
      clearTimeout: (id: number) => {
        world.progress++
        world.timers.delete(id)
      }
    }
    const stored = new Map<string, string>()
    globals.localStorage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value)
    }
    world.ws.subscribe(() => world.progress++)
    world.ws.connect()
    await world.settle()
    void world.ws.open(path(scenario.open))
    await world.settle()
    // Opening the first note runs to the end in one order; the search starts from there.
    while (world.systemEvents().length) {
      await world.step(world.systemEvents()[0])
    }
    const { doc } = world.ws.snapshot()
    if (doc?.kind !== 'clean' || doc.path !== path(scenario.open))
      throw new Error(`the scenario could not open ${scenario.open}: ${describeDoc(doc)}`)
    world.log.length = 0
    return world
  }

  private api(): MoteApi {
    const call = (): Call => {
      const ws = this.ws as unknown as { refreshId: number }
      const from = caller()
      if (from === '?') this.broken = 'the check cannot tell which Workspace method called main'
      return { caller: from, refreshId: ws.refreshId, doc: this.ws.snapshot().doc }
    }
    const pending = <T>(push: (reply: Reply) => void): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        this.progress++
        push({ resolve: resolve as (value: unknown) => void, reject, call: call() })
      })
    const api: Partial<MoteApi> = {
      getVault: () => Promise.resolve(this.info()),
      readNote: (_dir, path) => pending((reply) => this.reads.push({ path, reply })),
      writeNote: (_dir, path, text, baseHash) =>
        pending((reply) => this.queue.push({ kind: 'write', path, text, baseHash, reply })),
      renameOrMove: (_dir, from, to) =>
        pending((reply) => this.queue.push({ kind: 'rename', from, to, reply })),
      backlinks: () => Promise.resolve([]),
      onVaultChanged: (listener) => {
        this.changeListener = listener
        return () => {}
      },
      onCloseRequested: (listener) => {
        this.closeListener = listener
        return () => {}
      },
      respondToClose: (ready) => this.respondToClose(ready)
    }
    return api as MoteApi
  }

  private info(): VaultInfo {
    return {
      dir: DIR,
      entries: [...this.entries].sort().map((path) => ({ path, kind: 'note' as const })),
      config: {
        useMarkdownLinks: false,
        newLinkFormat: 'shortest',
        alwaysUpdateLinks: true,
        newFileLocation: 'root',
        newFileFolderPath: '',
        attachmentFolderPath: '.mote/attachments',
        daily: { folder: '', format: 'YYYY-MM-DD' }
      }
    }
  }

  // ---- main (src/main/vault.ts) ----

  private send(message: Message): void {
    this.outbox.push(message)
  }

  private reply(reply: Reply, what: string, value?: unknown): void {
    this.send({ kind: 'reply', reply, value, what })
  }

  // vault.ts writeNote: compares the disk hash with baseHash, writes only on a match.
  private runWrite(op: Extract<Op, { kind: 'write' }>, fail: boolean): void {
    const { path, text, baseHash, reply } = op
    const what = `writeNote(${path}, ${JSON.stringify(text)}, base ${baseHash ?? 'null'})`
    if (fail) {
      this.log.push(`main fails ${what} with a disk error`)
      this.send({ kind: 'reply', reply, error: 'disk error', what })
      return
    }
    const file = this.disk.get(path)
    const nextHash = hashOf(text)
    let result: WriteResult
    let written = file
    if (baseHash === null) {
      if (file) result = { ok: false, disk: version(file.text) }
      else {
        written = { id: this.nextFile++, text }
        this.disk.set(path, written)
        this.ownWrites.set(path, nextHash)
        this.watched.add(path)
        result = { ok: true, hash: nextHash }
      }
    } else if (!file) result = { ok: false, disk: null }
    else if (hashOf(file.text) !== baseHash) result = { ok: false, disk: version(file.text) }
    else if (hashOf(file.text) === nextHash) result = { ok: true, hash: nextHash }
    else {
      if (!this.shown.has(`${file.id}${baseHash}`))
        this.fail(`main overwrote ${path}, whose text the editor never showed`)
      file.text = text
      this.ownWrites.set(path, nextHash)
      this.watched.add(path)
      result = { ok: true, hash: nextHash }
    }
    // mote wrote this text itself, so it is a version the editor has seen.
    if (result.ok && written) {
      if (this.typed?.text === text) this.typed.saved = true
      this.shown.add(`${written.id}${nextHash}`)
    }
    this.log.push(
      `main runs ${what} -> ${result.ok ? 'ok' : `conflict, disk ${describeDisk(result.disk)}`}`
    )
    this.reply(reply, what, result)
  }

  // vault.ts renameOrMove for one note: moves the file and its ownWrites hash, then notifies.
  private runRename(op: Extract<Op, { kind: 'rename' }>): void {
    const { from, to, reply } = op
    const what = `renameOrMove(${from} -> ${to})`
    const answer = (error?: string): void => {
      // Another window's rename answers that window, not this one.
      if (reply.call.caller !== 'another window') this.send({ kind: 'reply', reply, error, what })
    }
    if (from === to) return answer()
    const under = (folder: VaultPath, p: VaultPath): boolean =>
      p === folder || p.startsWith(`${folder}/`)
    const fromExists = [...this.entries].some((p) => under(from, p))
    const toExists = [...this.entries].some((p) => under(to, p))
    if (fromExists === toExists) {
      this.log.push(`main refuses ${what}`)
      return answer('refused')
    }
    const renames = new Map<VaultPath, VaultPath>()
    for (const p of this.entries)
      if (under(from, p)) renames.set(p, path(to + p.slice(from.length)))
    if (!renames.has(from)) renames.set(from, to)
    for (const [oldPath, newPath] of renames) {
      const file = this.disk.get(oldPath)
      if (file) {
        this.disk.delete(oldPath)
        this.disk.set(newPath, file)
      }
      if (this.entries.delete(oldPath)) this.entries.add(newPath)
      const own = this.ownWrites.get(oldPath)
      this.ownWrites.delete(oldPath)
      if (own) this.ownWrites.set(newPath, own)
      // The watcher sees both paths; for a folder, vault.ts rescans the notes under it.
      if (file) this.watched.add(oldPath).add(newPath)
    }
    this.log.push(`main runs ${what} and sends vault-changed`)
    this.send({
      kind: 'change',
      change: {
        ...this.change(),
        changed: [...renames.values()],
        removed: [...renames.keys()],
        renamed: [...renames].map(([oldPath, newPath]) => ({ from: oldPath, to: newPath }))
      }
    })
    answer()
  }

  // Another window renames a note; only its vault change reaches this window.
  renameElsewhere(from: string, to: string): void {
    const reply: Reply = {
      resolve: () => {},
      reject: () => {},
      call: { caller: 'another window', refreshId: 0, doc: null }
    }
    this.queue.push({ kind: 'rename', from: path(from), to: path(to), reply })
  }

  // vault.ts refresh: what the watcher reported, minus mote's own writes (ownWrites).
  private runRefresh(paths: Set<VaultPath>): void {
    const removed: VaultPath[] = []
    const changed: VaultPath[] = []
    let structural = false
    for (const path of paths) if (this.entries.has(path) !== this.disk.has(path)) structural = true
    if (structural) {
      const previous = this.entries
      this.entries = new Set(this.disk.keys())
      for (const path of previous)
        if (!this.entries.has(path)) {
          this.ownWrites.delete(path)
          removed.push(path)
        }
      for (const path of this.entries) if (!previous.has(path)) paths.add(path)
    }
    for (const path of paths) {
      if (!this.entries.has(path)) continue
      const own = this.ownWrites.get(path)
      const file = this.disk.get(path)
      if (own) {
        if (file && hashOf(file.text) === own) continue
        this.ownWrites.delete(path)
      }
      changed.push(path)
    }
    if (structural || changed.length || removed.length) {
      this.log.push(`main's watcher sends vault-changed (changed ${changed}, removed ${removed})`)
      const change = this.change()
      this.send({
        kind: 'change',
        change: { ...change, entries: structural ? change.entries : undefined, changed, removed }
      })
    } else this.log.push(`main's watcher filters its own write to ${[...paths]}`)
  }

  private change(): VaultChange {
    return { dir: DIR, entries: this.info().entries, changed: [], removed: [] }
  }

  // Another program writes the note.
  externalWrite(name: string, text: string): void {
    const file = this.disk.get(path(name))
    if (file) file.text = text
    else this.disk.set(path(name), { id: this.nextFile++, text })
    this.watched.add(path(name))
  }

  // ---- renderer ----

  private respondToClose(ready: boolean): void {
    this.progress++
    this.log.push(`the window answers the close request: ${ready ? 'close' : 'stay open'}`)
    if (!ready) return
    this.closed = true
    if (this.typed && !this.typed.saved)
      this.fail(`the window closed before ${JSON.stringify(this.typed.text)} reached the disk`)
  }

  requestClose(): void {
    this.closeListener?.()
  }

  // You type c at the end of the editor's text.
  type(c: string): void {
    const view = this.view
    if (!view) return
    view.text += c
    this.typed = { text: view.text, saved: false }
    this.ws.edit(view.path, view.text)
  }

  editable(): boolean {
    return this.view !== null && !this.ws.snapshot().busy && !this.closed
  }

  conflict(): boolean {
    return this.ws.snapshot().doc?.kind === 'conflict'
  }

  // You choose the disk's version, so what you typed is given up on purpose.
  discard(): void {
    this.typed = null
  }

  // workspace.open from the file tree, quick open or a link. A note opened without a place must
  // not get a selection made before this visit (6508f41).
  async open(name: string, at?: Place): Promise<void> {
    const before = this.ws.snapshot().doc?.path
    const ws = this.ws as unknown as { selectionId: number }
    const mark = ws.selectionId
    await this.ws.open(path(name), at)
    const { doc, selection } = this.ws.snapshot()
    if (
      !at &&
      before !== path(name) &&
      doc?.path === path(name) &&
      selection?.path === path(name) &&
      selection.id <= mark
    )
      this.fail(`opening ${name} again applied the selection from an earlier visit`)
  }

  // ---- the search ----

  // Runs the microtasks the last event started: Workspace's continuations after an IPC reply
  // or a timer. It stops once 12 microtasks in a row changed nothing the check can see.
  // SETTLE=macrotask waits for a real macrotask instead, which is slower and certain.
  private async settle(): Promise<void> {
    if (env.SETTLE === 'macrotask') {
      await new Promise<void>((resolve) => nextMacrotask(resolve))
      return
    }
    for (let idle = 0; idle < 12;) {
      const before = this.progress
      await Promise.resolve()
      if (this.progress !== before) {
        const stats = globalThis as unknown as { maxIdleGap?: number }
        stats.maxIdleGap = Math.max(stats.maxIdleGap ?? 0, idle)
      }
      idle = this.progress === before ? idle + 1 : 0
    }
  }

  private systemEvents(): string[] {
    const events: string[] = []
    if (this.closed) return events
    if (this.outbox.length) events.push('deliver')
    const head = this.queue[0]
    if (head) events.push('main')
    if (head?.kind === 'write' && this.writeErrors > 0) events.push('main fails')
    this.reads.forEach((_read, i) => events.push(`read ${i}`))
    if (this.watched.size) events.push('watch')
    for (const { ms } of this.timers.values()) events.push(`timer ${ms}`)
    return events
  }

  events(): string[] {
    if (this.closed) return []
    const actions = this.remaining
      .filter((action) => action.enabled?.(this) ?? true)
      .map((action) => action.label)
    return [...this.systemEvents(), ...actions]
  }

  async step(event: string): Promise<void> {
    if (event === 'deliver') {
      const message = this.outbox.shift()!
      if (message.kind === 'change') {
        const { changed, removed } = message.change
        this.log.push(`renderer receives vault-changed (changed ${changed}, removed ${removed})`)
        this.changeListener?.(message.change)
      } else if (message.error) {
        this.log.push(`renderer receives the error from ${message.what}`)
        message.reply.reject(new Error(message.error))
      } else {
        this.log.push(`renderer receives the reply to ${message.what}`)
        message.reply.resolve(message.value)
      }
    } else if (event === 'main' || event === 'main fails') {
      const op = this.queue.shift()!
      if (op.kind === 'write') {
        if (event === 'main fails') this.writeErrors--
        this.runWrite(op, event === 'main fails')
      } else if (op.kind === 'rename') this.runRename(op)
      else this.runRefresh(op.paths)
    } else if (event.startsWith('read ')) {
      const [read] = this.reads.splice(Number(event.slice(5)), 1)
      const file = this.disk.get(read.path)
      this.log.push(
        `main runs readNote(${read.path}) -> ${file ? JSON.stringify(file.text) : 'null'}`
      )
      this.reply(read.reply, `readNote(${read.path})`, file ? version(file.text) : null)
    } else if (event === 'watch') {
      this.queue.push({ kind: 'refresh', paths: new Set(this.watched) })
      this.log.push(`main's watcher queues a refresh of ${[...this.watched]}`)
      this.watched.clear()
    } else if (event.startsWith('timer ')) {
      const ms = Number(event.slice(6))
      const [id, timer] = [...this.timers].find(([, t]) => t.ms === ms)!
      this.timers.delete(id)
      this.log.push(`the ${ms === 150 ? '150 ms autosave' : '800 ms max-wait'} timer fires`)
      timer.run()
    } else {
      const action = this.remaining.find((a) => a.label === event)!
      this.remaining = this.remaining.filter((a) => a !== action)
      this.log.push(event)
      const { doc, tabs } = this.ws.snapshot()
      const ws = this.ws as unknown as { selectionId: number }
      const flight: Flight = { label: event, doc, tabs, selectionId: ws.selectionId }
      const result = action.run(this)
      if (result) {
        this.flights.add(flight)
        result.then(
          () => this.flights.delete(flight),
          () => this.flights.delete(flight)
        )
      }
    }
    await this.settle()
    if (this.broken) throw new Error(this.broken)
    this.observe()
  }

  // After each step: what the editor view shows, then the properties.
  private observe(): void {
    const { doc, error, busy } = this.ws.snapshot()
    this.log[this.log.length - 1] += `   [${describeDoc(doc)}${error ? `, error "${error}"` : ''}]`
    if (!isDraft(doc) || doc.kind === 'missing' || this.closed) this.view = null
    else {
      // App.tsx renders <NoteEditor key={doc.session}>, and a new EditorView starts empty.
      const key = String(doc.session)
      if (this.view?.key !== key) this.view = { key, path: doc.path, text: '', source: null }
      // The view's listeners read the path from NoteEditor's shownPath ref.
      this.view.path = doc.path
      // NoteEditor's effect on [source] puts source.text in the view when it differs.
      if (this.view.source !== doc.source) {
        if (this.view.text !== doc.source.text) this.view.text = doc.source.text
        this.view.source = doc.source
      }
      if (this.view.text !== doc.text)
        this.fail(
          `the editor shows ${JSON.stringify(this.view.text)}, but the note's text is ${JSON.stringify(doc.text)}`
        )
      const file = this.disk.get(doc.path)
      if (file && doc.kind === 'clean' && hashOf(doc.text) === doc.baseHash)
        this.shown.add(`${file.id}${doc.baseHash}`)
      if (file && doc.kind === 'conflict' && doc.disk) this.shown.add(`${file.id}${doc.disk.hash}`)
    }
    if (this.closed || this.systemEvents().length) return
    // Nothing is left to happen on its own. A save must not hang.
    if (doc?.kind === 'saving') this.fail('the note stays in saving with no write in flight')
    if (doc?.kind === 'dirty' && !error)
      this.fail('the note stays dirty with no autosave timer and no write in flight')
    if (busy) this.fail('the window stays busy')
    for (const flight of this.flights) this.fail(`"${flight.label}" never finishes`)
    // What you typed last is on disk, or still in the editor where it will be saved or shows a
    // conflict.
    if (this.typed && !this.typed.saved) {
      const { text } = this.typed
      const kept =
        isDraft(doc) &&
        doc.text === text &&
        (doc.kind === 'conflict' || (doc.kind === 'dirty' && error !== ''))
      if (!kept) this.fail(`${JSON.stringify(text)}, which you typed, is lost`)
    }
  }

  private fail(message: string): void {
    if (!this.violations.includes(message)) this.violations.push(message)
  }

  get violation(): string | null {
    return this.violations[0] ?? null
  }

  // Everything that decides what can happen next. Two worlds with the same fingerprint have the
  // same futures, so the search visits each fingerprint once.
  fingerprint(): string {
    const objects = new Map<object, number>()
    const ref = (object: object | null | undefined): number =>
      object ? (objects.get(object) ?? objects.set(object, objects.size).size - 1) : -1
    const files = new Map<number, number>()
    const file = (id: number): number => files.get(id) ?? files.set(id, files.size).size - 1
    const doc = (d: Doc | null): unknown =>
      d && { ...d, source: isDraft(d) ? ref(d.source) : undefined, self: ref(d) }
    const ws = this.ws as unknown as {
      refreshId: number
      saving?: unknown
      visits: unknown
      visit: number
      cursors: Map<string, unknown>
    }
    const call = ({ caller, refreshId, doc: d }: Call): unknown => [
      caller,
      refreshId === ws.refreshId,
      doc(d)
    ]
    const s = this.ws.snapshot()
    return JSON.stringify([
      s.vault?.entries.map((e) => e.path),
      s.tabs,
      doc(s.doc),
      s.busy,
      s.error,
      s.selection && [s.selection.path, s.selection.from, s.selection.to, s.selection.top],
      s.mode,
      ws.saving !== undefined,
      ws.visits,
      ws.visit,
      [...ws.cursors],
      [...this.timers.values()].map((t) => t.ms).sort(),
      [...this.disk].map(([p, f]) => [p, file(f.id), f.text]),
      [...this.ownWrites],
      [...this.entries],
      this.queue.map((op) =>
        op.kind === 'refresh'
          ? [op.kind, [...op.paths]]
          : [op.kind, { ...op, reply: call(op.reply.call) }]
      ),
      this.reads.map((r) => [r.path, call(r.reply.call)]),
      [...this.watched],
      this.outbox.map((m) =>
        m.kind === 'change' ? m.change : [m.what, m.value, m.error, call(m.reply.call)]
      ),
      this.writeErrors,
      this.closed,
      this.view && [this.view.key, this.view.path, this.view.text, ref(this.view.source)],
      this.typed,
      [...this.shown].sort(),
      [...this.flights].map((f) => [
        f.label,
        doc(f.doc),
        f.tabs,
        f.selectionId >= (s.selection?.id ?? 0)
      ]),
      this.remaining.map((a) => a.label)
    ])
  }
}

function describeDisk(disk: NoteVersion | null): string {
  return disk ? JSON.stringify(disk.text) : 'deleted'
}

function describeDoc(doc: Doc | null): string {
  if (!doc) return 'no note open'
  if (!isDraft(doc) || doc.kind === 'missing') return `${doc.kind} ${doc.path}`
  return `${doc.kind} ${doc.path} ${JSON.stringify(doc.text)}`
}

export type Result = { states: number; runs: number; violation: string | null; trace: string[] }
export type Survey = { states: number; runs: number; violations: Map<string, string[]> }

// Breadth-first, so a counterexample is a shortest one. A world cannot be copied, so each state
// is reached by replaying its events from the start.
export async function check(scenario: Scenario, limit = 200_000): Promise<Result> {
  const seen = new Set<string>()
  let queue: string[][] = [[]]
  let runs = 0
  while (queue.length) {
    const next: string[][] = []
    for (const events of queue) {
      const world = await World.start(scenario)
      runs++
      for (const event of events) await world.step(event)
      if (world.violation)
        return { states: seen.size, runs, violation: world.violation, trace: world.log }
      const key = world.fingerprint()
      if (seen.has(key)) continue
      seen.add(key)
      if (seen.size > limit) throw new Error(`${scenario.name}: more than ${limit} states`)
      for (const event of world.events()) next.push([...events, event])
    }
    queue = next
  }
  return { states: seen.size, runs, violation: null, trace: [] }
}

// Like check, but goes on past a violation and keeps the first trace of each kind.
export async function survey(scenario: Scenario, limit = 200_000): Promise<Survey> {
  const seen = new Set<string>()
  const violations = new Map<string, string[]>()
  let queue: string[][] = [[]]
  let runs = 0
  while (queue.length) {
    const next: string[][] = []
    for (const events of queue) {
      const world = await World.start(scenario)
      runs++
      for (const event of events) await world.step(event)
      for (const violation of world.violations) {
        const kind = violation.replace(/"[^"]*"/g, '…')
        if (!violations.has(kind)) violations.set(kind, [violation, ...world.log])
      }
      const key = world.fingerprint()
      if (seen.has(key)) continue
      seen.add(key)
      if (seen.size > limit) throw new Error(`${scenario.name}: more than ${limit} states`)
      for (const event of world.events()) next.push([...events, event])
    }
    queue = next
  }
  return { states: seen.size, runs, violations }
}

// ---- scenarios ----

const type = (c: string): Action => ({
  label: `you type "${c}"`,
  enabled: (w) => w.editable(),
  run: (w) => w.type(c)
})
const rename = (from: string, to: string): Action => ({
  label: `you rename ${from} to ${to} in the file tree`,
  run: (w) => w.ws.rename(path(from), path(to), true)
})
const renameElsewhere = (from: string, to: string): Action => ({
  label: `another window renames ${from} to ${to}`,
  run: (w) => w.renameElsewhere(from, to)
})
const external = (name: string, text: string): Action => ({
  label: `another program writes ${JSON.stringify(text)} to ${name}`,
  run: (w) => w.externalWrite(name, text)
})
const keepMine: Action = {
  label: 'you choose 保留我的修改',
  enabled: (w) => w.conflict(),
  run: (w) => w.ws.save(true)
}
const useDisk: Action = {
  label: 'you choose 使用磁盘版本',
  enabled: (w) => w.conflict(),
  run: (w) => {
    w.discard()
    return w.ws.useDisk()
  }
}
const open = (name: string, at?: Place): Action => ({
  label: `you open ${name}${at ? ` at ${JSON.stringify(at)}` : ''}`,
  run: (w) => w.open(name, at)
})
const close: Action = { label: 'you close the window', run: (w) => w.requestClose() }

export const scenarios: Scenario[] = [
  {
    name: 'rename the open note while you type',
    notes: { 'A.md': 'a' },
    open: 'A.md',
    actions: [type('1'), rename('A.md', 'B.md'), type('2')]
  },
  {
    name: 'rename the folder of the open note while you type',
    notes: { 'F/A.md': 'a' },
    open: 'F/A.md',
    actions: [type('1'), rename('F', 'G'), type('2')]
  },
  {
    name: 'another window renames the open note while you type',
    notes: { 'A.md': 'a' },
    open: 'A.md',
    actions: [type('1'), renameElsewhere('A.md', 'B.md'), type('2')]
  },
  {
    name: 'another program writes the note while you type',
    notes: { 'A.md': 'a' },
    open: 'A.md',
    actions: [type('1'), type('2'), external('A.md', 'x'), keepMine, useDisk]
  },
  {
    name: 'switch notes and close the window while you type',
    notes: { 'A.md': 'a', 'C.md': 'c' },
    open: 'A.md',
    actions: [type('1'), open('C.md'), type('2'), close]
  },
  {
    name: 'open a note again after a link put the cursor in it',
    notes: { 'A.md': 'a', 'C.md': 'c' },
    open: 'C.md',
    actions: [open('A.md', { from: 0, to: 1 }), open('C.md'), open('A.md')]
  },
  {
    name: 'a write fails with a disk error',
    notes: { 'A.md': 'a' },
    open: 'A.md',
    actions: [type('1'), type('2')],
    writeErrors: 1
  }
]

// SURVEY=1 lists every kind of violation in every scenario instead of failing on the first.
// SURVEY=<text> does it for the scenarios whose name contains text.
it.runIf(env.SURVEY)('survey', { timeout: 600_000 }, async () => {
  const filter = env.SURVEY === '1' ? '' : (env.SURVEY ?? '')
  for (const scenario of scenarios.filter((s) => s.name.includes(filter))) {
    const started = Date.now()
    const result = await survey(scenario)
    const lines = [`${scenario.name}: ${result.states} states, ${Date.now() - started} ms`]
    for (const [violation, ...trace] of result.violations.values())
      lines.push(`* ${violation}`, ...trace.map((line, i) => `  ${i + 1}. ${line}`))
    console.log(lines.join('\n'))
  }
})

describe('open note save state machine, every order of events', () => {
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const result = await check(scenario)
      const story = result.trace.map((line, i) => `${i + 1}. ${line}`).join('\n')
      expect(result.violation ? `${result.violation}\n${story}` : null).toBeNull()
    })
  }
})
