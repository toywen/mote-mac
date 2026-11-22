import type {
  ContentHash,
  Hit,
  NoteVersion,
  SearchResult,
  VaultChange,
  VaultInfo,
  VaultPath
} from '../../core/ipc'
import { isHtmlPath } from '../../core/fileUrl'
import type { LinkDest } from '../../core/linkDest'
import { resolveSubpath } from '../../core/subpath'
import { sourceText } from '../../core/text'
import type { EditorMode } from './editor/preview'

type Draft = { path: VaultPath; text: string; source: { text: string } }
type DirtyDoc = Draft & { kind: 'dirty'; baseHash: ContentHash }
type ConflictDoc = Draft & { kind: 'conflict'; disk: NoteVersion | null }
export type HtmlDoc = { kind: 'html'; path: VaultPath }
export type Doc =
  | (Draft & { kind: 'clean' | 'saving'; baseHash: ContentHash })
  | (Draft & { kind: 'missing' })
  | DirtyDoc
  | ConflictDoc
  | HtmlDoc

type Range = { from: number; to: number }

// Where the cursor goes in a note: a range of its normalized text, or a heading or block id.
export type Place = Range | { subpath: string }

// A range the editor selects. top puts its line at the top of the editor instead of just in view.
export type Selection = Range & { path: VaultPath; top: boolean; id: number }

// One note in the navigation history, with the cursor as it was when you left it.
type Visit = { path: VaultPath; cursor: Range | null }

type WorkspaceState = {
  vault: VaultInfo | null
  tabs: VaultPath[]
  doc: Doc | null
  busy: boolean
  error: string
  // Links to the open note, from main's index. path says which note they belong to.
  backlinks: { path: VaultPath; hits: Hit[] } | null
  // A range the editor should select, in the note's normalized text.
  selection: Selection | null
  // Goes up whenever note contents may have changed: a vault change or a save.
  revision: number
  // One mode for the window. Opening another note keeps it.
  mode: EditorMode
}

const AUTOSAVE_DEBOUNCE_MS = 150
const AUTOSAVE_MAX_WAIT_MS = 800
const RECENT_LIMIT = 50
const recentKey = (dir: string): string => `mote.recent:${dir}`

class Workspace {
  private state: WorkspaceState = {
    vault: null,
    tabs: [],
    doc: null,
    busy: true,
    error: '',
    backlinks: null,
    selection: null,
    revision: 0,
    mode: 'live'
  }
  private readonly listeners = new Set<() => void>()
  private saveTimer?: number
  private maxWaitTimer?: number
  private saving?: Promise<boolean>
  private refreshId = 0
  private backlinksId = 0
  private selectionId = 0
  // The window's navigation history and the visit the open note belongs to.
  private visits: Visit[] = []
  private visit = -1
  private cursors = new Map<VaultPath, Range>()

  snapshot = (): WorkspaceState => this.state

  subscribe = (callback: () => void): (() => void) => {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  private set(update: Partial<WorkspaceState>): void {
    this.state = { ...this.state, ...update }
    for (const callback of this.listeners) callback()
  }

  private fail(error: unknown): void {
    const message =
      error instanceof Error
        ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
        : String(error)
    this.set({ error: message })
  }

  connect(): () => void {
    let connected = true
    const offChange = window.mote.onVaultChanged((change) => this.onChange(change))
    const offClose = window.mote.onCloseRequested(() => {
      if (this.state.busy) {
        window.mote.respondToClose(false)
        return
      }
      this.set({ busy: true })
      void this.flush().then((ready) => {
        window.mote.respondToClose(ready)
        if (!ready) this.set({ busy: false })
      })
    })
    void window.mote.getVault().then(
      (vault) => {
        if (connected) this.set({ vault, busy: false })
      },
      (error: unknown) => {
        if (connected) {
          this.fail(error)
          this.set({ busy: false })
        }
      }
    )
    return () => {
      connected = false
      offChange()
      offClose()
    }
  }

  toggleMode(): void {
    this.set({ mode: this.state.mode === 'live' ? 'reading' : 'live' })
  }

  async chooseVault(): Promise<void> {
    if (this.state.busy) return
    this.set({ busy: true, error: '' })
    try {
      if (!(await this.flush())) return
      const vault = await window.mote.chooseVault()
      if (vault) {
        this.set({ vault, doc: null, tabs: [], backlinks: null, selection: null })
        this.visits = []
        this.visit = -1
        this.cursors.clear()
      }
    } catch (error) {
      this.fail(error)
    } finally {
      this.set({ busy: false })
    }
  }

  // Opens a note. With at, also puts the cursor there. Opening another note adds a visit to the
  // history.
  open(path: VaultPath, at?: Place): Promise<void> {
    return this.show(path, at, null)
  }

  // Goes where a link points: opens a note at its heading or block, hands a file or an address
  // to the system, or creates a missing note and opens it.
  async follow(dest: LinkDest): Promise<void> {
    const { vault } = this.state
    if (!vault) return
    try {
      switch (dest.kind) {
        case 'note':
          return await this.open(dest.path, dest.subpath ? { subpath: dest.subpath } : undefined)
        case 'file':
          if (isHtmlPath(dest.path)) return await this.open(dest.path)
          return await this.openFile(dest.path)
        case 'missing':
          await window.mote.createNote(vault.dir, dest.path)
          return await this.open(dest.path)
        case 'external':
          return await window.mote.openExternal(dest.url)
      }
    } catch (error) {
      this.fail(error)
    }
  }

  back(): Promise<void> {
    return this.travel(-1)
  }

  forward(): Promise<void> {
    return this.travel(1)
  }

  // The editor reports the cursor, so going back to this note puts it there again.
  cursor(path: VaultPath, at: Range): void {
    this.cursors.set(path, at)
    const visit = this.visits[this.visit]
    if (visit?.path === path) visit.cursor = at
  }

  // Moves through the history by step, skipping notes that no longer exist.
  private async travel(step: -1 | 1): Promise<void> {
    const notes = new Set(this.state.vault?.entries.map((entry) => entry.path))
    let index = this.visit + step
    while (this.visits[index] && !notes.has(this.visits[index].path)) index += step
    const visit = this.visits[index]
    if (visit) await this.show(visit.path, visit.cursor ?? undefined, index)
  }

  // visit is the history index being returned to, or null to add a visit.
  private async show(
    path: VaultPath,
    at: Place | undefined,
    visit: number | null,
    overrideTabs?: VaultPath[]
  ): Promise<void> {
    const { vault, busy, doc } = this.state
    if (!vault || busy) return
    const currentTabs = overrideTabs ?? this.state.tabs
    const tabs = currentTabs.includes(path) ? currentTabs : [...currentTabs, path]
    if (path === doc?.path) {
      if (this.state.tabs !== tabs) this.set({ tabs })
      if (visit !== null) this.visit = visit
      if (at) this.place(path, at)
      return
    }
    this.set({ busy: true, error: '' })
    try {
      if (!(await this.flush())) return
      if (isHtmlPath(path)) {
        this.refreshId++
        const exists = vault.entries.some((e) => e.path === path)
        if (!exists) {
          this.set({
            tabs,
            doc: { kind: 'missing', path, text: '', source: { text: '' } },
            selection: null,
            backlinks: null
          })
          return
        }
        this.set({ tabs, doc: { kind: 'html', path }, selection: null, backlinks: null })
        this.remember(vault.dir, path)
        if (visit === null) {
          this.visits = [...this.visits.slice(0, this.visit + 1), { path, cursor: null }]
          this.visit = this.visits.length - 1
        } else this.visit = visit
        return
      }
      const version = await window.mote.readNote(vault.dir, path)
      this.load(path, version, tabs)
      if (version) {
        this.remember(vault.dir, path)
        if (visit === null) {
          this.visits = [...this.visits.slice(0, this.visit + 1), { path, cursor: null }]
          this.visit = this.visits.length - 1
        } else this.visit = visit
        if (at) this.place(path, at)
      }
      void this.loadBacklinks()
      void this.refresh()
    } catch (error) {
      this.fail(error)
    } finally {
      this.set({ busy: false })
    }
  }

  async closeTab(path: VaultPath): Promise<void> {
    const { tabs, doc, busy, vault } = this.state
    if (!tabs.includes(path) || busy) return
    if (doc?.path !== path) {
      this.cursors.delete(path)
      this.set({ tabs: tabs.filter((t) => t !== path) })
      return
    }
    this.set({ busy: true, error: '' })
    try {
      if (!(await this.flush())) return
      const index = tabs.indexOf(path)
      const nextTabs = tabs.filter((t) => t !== path)
      this.cursors.delete(path)
      if (nextTabs.length === 0) {
        this.set({ tabs: [], doc: null, backlinks: null, selection: null })
        return
      }
      const nextPath = nextTabs[Math.min(index, nextTabs.length - 1)]
      if (!vault) {
        this.set({ tabs: nextTabs, doc: null })
        return
      }
      if (isHtmlPath(nextPath)) {
        const exists = vault.entries.some((e) => e.path === nextPath)
        if (!exists) {
          this.set({
            tabs: nextTabs,
            doc: { kind: 'missing', path: nextPath, text: '', source: { text: '' } },
            selection: null,
            backlinks: null
          })
        } else {
          this.set({
            tabs: nextTabs,
            doc: { kind: 'html', path: nextPath },
            selection: null,
            backlinks: null
          })
          this.remember(vault.dir, nextPath)
        }
      } else {
        const version = await window.mote.readNote(vault.dir, nextPath)
        this.load(nextPath, version, nextTabs)
        if (version) {
          this.remember(vault.dir, nextPath)
          const at = this.cursors.get(nextPath)
          if (at) this.place(nextPath, at)
        }
        void this.loadBacklinks()
        void this.refresh()
      }
    } catch (error) {
      this.fail(error)
    } finally {
      this.set({ busy: false })
    }
  }

  closeActiveTab(): Promise<void> {
    if (this.state.doc) return this.closeTab(this.state.doc.path)
    return Promise.resolve()
  }

  cycleTab(step: -1 | 1): void {
    const { tabs, doc } = this.state
    if (tabs.length <= 1) return
    const index = doc ? tabs.indexOf(doc.path) : -1
    if (index === -1) {
      void this.open(tabs[0])
      return
    }
    const nextIndex = (index + step + tabs.length) % tabs.length
    void this.open(tabs[nextIndex])
  }

  renameTab(from: VaultPath, to: VaultPath): void {
    const { tabs, doc } = this.state
    if (!tabs.includes(from)) return
    const nextTabs = tabs.map((t) => (t === from ? to : t))
    const cursor = this.cursors.get(from)
    if (cursor) {
      this.cursors.delete(from)
      this.cursors.set(to, cursor)
    }
    if (doc?.path === from) {
      this.set({ tabs: nextTabs, doc: { ...doc, path: to } })
    } else {
      this.set({ tabs: nextTabs })
    }
  }

  // A subpath that names no heading or block leaves the cursor where it is.
  private place(path: VaultPath, at: Place): void {
    const { doc } = this.state
    if (!('subpath' in at)) {
      this.select(path, at, false)
      return
    }
    const from =
      doc?.path === path && doc.kind !== 'html'
        ? resolveSubpath(sourceText(doc.text).text, at.subpath)
        : null
    if (from !== null) this.select(path, { from, to: from }, true)
  }

  private select(path: VaultPath, at: Range, top: boolean): void {
    this.set({ selection: { path, from: at.from, to: at.to, top, id: ++this.selectionId } })
  }

  private async loadBacklinks(): Promise<void> {
    const { vault, doc } = this.state
    const id = ++this.backlinksId
    if (!vault || !doc) return
    try {
      const hits = await window.mote.backlinks(vault.dir, doc.path)
      if (id === this.backlinksId && this.state.doc?.path === doc.path)
        this.set({ backlinks: { path: doc.path, hits } })
    } catch (error) {
      if (id === this.backlinksId) this.fail(error)
    }
  }

  search(query: string, limit: number): Promise<SearchResult> | null {
    const { vault } = this.state
    return vault ? window.mote.search(vault.dir, query, limit) : null
  }

  // A note's text for an embed, read without opening the note: the editor's text for the open
  // note, the disk's for any other. Null when the note is gone. Like the backlinks, the result
  // is a read-only query; ask again when revision goes up.
  async noteText(path: VaultPath): Promise<string | null> {
    const { vault, doc } = this.state
    if (!vault) return null
    if (doc?.path === path && doc.kind !== 'missing' && doc.kind !== 'html') return doc.text
    return (await window.mote.readNote(vault.dir, path))?.text ?? null
  }

  recent(): VaultPath[] {
    const { vault } = this.state
    if (!vault) return []
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(recentKey(vault.dir)) ?? '[]')
      return Array.isArray(saved)
        ? saved.filter((path): path is VaultPath => typeof path === 'string')
        : []
    } catch {
      return []
    }
  }

  private remember(dir: string, path: VaultPath): void {
    const recent = [path, ...this.recent().filter((item) => item !== path)]
    localStorage.setItem(recentKey(dir), JSON.stringify(recent.slice(0, RECENT_LIMIT)))
  }

  async openFile(path: VaultPath): Promise<void> {
    const { vault } = this.state
    if (vault)
      await window.mote
        .openWithDefaultApp(vault.dir, path)
        .catch((error: unknown) => this.fail(error))
  }

  private load(path: VaultPath, disk: NoteVersion | null, tabs?: VaultPath[]): void {
    this.refreshId++
    const text = disk?.text ?? ''
    // A selection made for an earlier visit to this note must not apply when it opens again.
    const selection = path === this.state.doc?.path ? this.state.selection : null
    const currentTabs = tabs ?? this.state.tabs
    const nextTabs = currentTabs.includes(path) ? currentTabs : [...currentTabs, path]
    this.set({
      tabs: nextTabs,
      doc: disk
        ? { kind: 'clean', path, text, source: { text }, baseHash: disk.hash }
        : { kind: 'missing', path, text, source: { text } },
      selection,
      error: ''
    })
  }

  edit(path: VaultPath, text: string): void {
    const { doc } = this.state
    if (doc?.path !== path || doc.kind === 'missing' || doc.kind === 'html' || doc.text === text)
      return
    if (doc.kind === 'conflict' || doc.kind === 'saving') {
      this.set({ doc: { ...doc, text } })
    } else {
      this.set({ doc: { ...doc, kind: 'dirty', text }, error: '' })
      this.scheduleSave()
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = window.setTimeout(() => {
      this.clearSaveTimers()
      void this.save()
    }, AUTOSAVE_DEBOUNCE_MS)

    if (!this.maxWaitTimer) {
      this.maxWaitTimer = window.setTimeout(() => {
        this.clearSaveTimers()
        void this.save()
      }, AUTOSAVE_MAX_WAIT_MS)
    }
  }

  private clearSaveTimers(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer)
      this.maxWaitTimer = undefined
    }
  }

  async flush(): Promise<boolean> {
    while (await this.save()) {
      if (this.state.doc?.kind !== 'dirty') return this.state.doc?.kind !== 'conflict'
    }
    return false
  }

  save(keepMine = false): Promise<boolean> {
    this.clearSaveTimers()
    if (this.saving) return this.saving
    const { doc, vault } = this.state
    if (!doc || !vault || doc.kind === 'clean' || doc.kind === 'missing' || doc.kind === 'html')
      return Promise.resolve(true)
    if (doc.kind !== 'dirty' && (doc.kind !== 'conflict' || !keepMine))
      return Promise.resolve(false)
    this.saving = this.write(vault.dir, doc).finally(() => {
      this.saving = undefined
    })
    return this.saving
  }

  private async write(dir: string, doc: DirtyDoc | ConflictDoc): Promise<boolean> {
    const baseHash = doc.kind === 'conflict' ? (doc.disk?.hash ?? null) : doc.baseHash
    if (baseHash) this.set({ doc: { ...doc, kind: 'saving', baseHash }, error: '' })
    try {
      const result = await window.mote.writeNote(dir, doc.path, doc.text, baseHash)
      const current = this.state.doc
      if (
        !current ||
        current.path !== doc.path ||
        current.kind === 'html' ||
        current.kind === 'missing'
      )
        return false
      if (!result.ok) {
        this.receiveConflict(current, result.disk)
        return this.state.doc?.kind === 'clean'
      }
      const isClean = current.text === doc.text
      this.set({
        doc: isClean
          ? { ...current, kind: 'clean', baseHash: result.hash }
          : { ...current, kind: 'dirty', baseHash: result.hash },
        error: ''
      })
      if (!isClean) this.scheduleSave()
      this.set({ revision: this.state.revision + 1 })
      void this.loadBacklinks()
      return this.refresh()
    } catch (error) {
      const current = this.state.doc
      if (current?.path === doc.path && current.kind !== 'html')
        this.set({ doc: { ...doc, text: current.text } })
      this.fail(error)
      return false
    }
  }

  async useDisk(): Promise<void> {
    const { vault, doc } = this.state
    if (!vault || doc?.kind !== 'conflict' || this.saving) return
    try {
      const disk = await window.mote.readNote(vault.dir, doc.path)
      if (this.state.doc !== doc) return
      if (disk?.hash !== doc.disk?.hash) this.receiveConflict(doc, disk)
      else this.load(doc.path, disk)
    } catch (error) {
      this.fail(error)
    }
  }

  private receiveConflict(doc: Exclude<Doc, HtmlDoc>, disk: NoteVersion | null): void {
    this.clearSaveTimers()
    if (disk?.text === doc.text) this.load(doc.path, disk)
    else this.set({ doc: { ...doc, kind: 'conflict', disk }, error: '' })
  }

  private onChange(change: VaultChange): void {
    const { vault, doc } = this.state
    if (vault?.dir !== change.dir) return
    if (change.entries) this.set({ vault: { ...vault, entries: change.entries } })
    this.set({ revision: this.state.revision + 1 })
    void this.loadBacklinks()
    if (doc && (change.changed.includes(doc.path) || change.removed.includes(doc.path))) {
      if (doc.kind === 'html') {
        if (change.removed.includes(doc.path)) {
          this.set({ doc: { kind: 'missing', path: doc.path, text: '', source: { text: '' } } })
        }
      } else {
        void this.refresh()
      }
    }
  }

  private async refresh(): Promise<boolean> {
    const { doc, vault } = this.state
    if (!doc || !vault || doc.kind === 'saving' || doc.kind === 'html') return true
    const refreshId = ++this.refreshId
    try {
      const disk = await window.mote.readNote(vault.dir, doc.path)
      const current = this.state.doc
      if (
        refreshId !== this.refreshId ||
        current?.path !== doc.path ||
        this.state.vault?.dir !== vault.dir ||
        current.kind === 'saving'
      )
        return true
      const knownHash =
        current.kind === 'conflict'
          ? current.disk?.hash
          : current.kind === 'missing' || current.kind === 'html'
            ? undefined
            : current.baseHash
      if (disk?.hash !== knownHash) {
        if (current.kind === 'clean' || current.kind === 'missing') this.load(current.path, disk)
        else if (current.kind !== 'html') this.receiveConflict(current, disk)
      }
      return this.state.doc?.kind !== 'conflict'
    } catch (error) {
      if (refreshId === this.refreshId) this.fail(error)
      return false
    }
  }
}

export const workspace = new Workspace()
