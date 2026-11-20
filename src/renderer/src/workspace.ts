import type { ContentHash, NoteVersion, VaultChange, VaultInfo, VaultPath } from '../../core/ipc'

type Draft = { path: VaultPath; text: string; source: { text: string } }
type DirtyDoc = Draft & { kind: 'dirty'; baseHash: ContentHash }
type ConflictDoc = Draft & { kind: 'conflict'; disk: NoteVersion | null }
type Doc =
  | (Draft & { kind: 'clean' | 'saving'; baseHash: ContentHash })
  | (Draft & { kind: 'missing' })
  | DirtyDoc
  | ConflictDoc

type WorkspaceState = { vault: VaultInfo | null; doc: Doc | null; busy: boolean; error: string }

const AUTOSAVE_MS = 750

class Workspace {
  private state: WorkspaceState = { vault: null, doc: null, busy: true, error: '' }
  private readonly listeners = new Set<() => void>()
  private timer?: number
  private saving?: Promise<boolean>
  private refreshId = 0

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

  async chooseVault(): Promise<void> {
    if (this.state.busy) return
    this.set({ busy: true, error: '' })
    try {
      if (!(await this.flush())) return
      const vault = await window.mote.chooseVault()
      if (vault) this.set({ vault, doc: null })
    } catch (error) {
      this.fail(error)
    } finally {
      this.set({ busy: false })
    }
  }

  async open(path: VaultPath): Promise<void> {
    const { vault, busy, doc } = this.state
    if (!vault || busy || path === doc?.path) return
    this.set({ busy: true, error: '' })
    try {
      if (!(await this.flush())) return
      const version = await window.mote.readNote(vault.dir, path)
      this.load(path, version)
      void this.refresh()
    } catch (error) {
      this.fail(error)
    } finally {
      this.set({ busy: false })
    }
  }

  async openFile(path: VaultPath): Promise<void> {
    const { vault } = this.state
    if (vault)
      await window.mote
        .openWithDefaultApp(vault.dir, path)
        .catch((error: unknown) => this.fail(error))
  }

  private load(path: VaultPath, disk: NoteVersion | null): void {
    this.refreshId++
    const text = disk?.text ?? ''
    this.set({
      doc: disk
        ? { kind: 'clean', path, text, source: { text }, baseHash: disk.hash }
        : { kind: 'missing', path, text, source: { text } },
      error: ''
    })
  }

  edit(path: VaultPath, text: string): void {
    const { doc } = this.state
    if (doc?.path !== path || doc.kind === 'missing' || doc.text === text) return
    if (doc.kind === 'conflict' || doc.kind === 'saving') {
      this.set({ doc: { ...doc, text } })
    } else {
      this.set({ doc: { ...doc, kind: 'dirty', text }, error: '' })
      this.scheduleSave()
    }
  }

  private scheduleSave(): void {
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      void this.save()
    }, AUTOSAVE_MS)
  }

  async flush(): Promise<boolean> {
    while (await this.save()) {
      if (this.state.doc?.kind !== 'dirty') return this.state.doc?.kind !== 'conflict'
    }
    return false
  }

  save(keepMine = false): Promise<boolean> {
    clearTimeout(this.timer)
    if (this.saving) return this.saving
    const { doc, vault } = this.state
    if (!doc || !vault || doc.kind === 'clean' || doc.kind === 'missing')
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
      if (current?.path !== doc.path) return false
      if (!result.ok) {
        this.receiveConflict(current, result.disk)
        return this.state.doc?.kind === 'clean'
      }
      const kind = current.text === doc.text ? 'clean' : 'dirty'
      this.set({ doc: { ...current, kind, baseHash: result.hash }, error: '' })
      if (kind === 'dirty') this.scheduleSave()
      return this.refresh()
    } catch (error) {
      const current = this.state.doc
      if (current?.path === doc.path) this.set({ doc: { ...doc, text: current.text } })
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

  private receiveConflict(doc: Doc, disk: NoteVersion | null): void {
    clearTimeout(this.timer)
    if (disk?.text === doc.text) this.load(doc.path, disk)
    else this.set({ doc: { ...doc, kind: 'conflict', disk }, error: '' })
  }

  private onChange(change: VaultChange): void {
    const { vault, doc } = this.state
    if (vault?.dir !== change.dir) return
    if (change.entries) this.set({ vault: { ...vault, entries: change.entries } })
    if (doc && (change.changed.includes(doc.path) || change.removed.includes(doc.path))) {
      void this.refresh()
    }
  }

  private async refresh(): Promise<boolean> {
    const { doc, vault } = this.state
    if (!doc || !vault || doc.kind === 'saving') return true
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
          : current.kind === 'missing'
            ? undefined
            : current.baseHash
      if (disk?.hash !== knownHash) {
        if (current.kind === 'clean' || current.kind === 'missing') this.load(current.path, disk)
        else this.receiveConflict(current, disk)
      }
      return this.state.doc?.kind !== 'conflict'
    } catch (error) {
      if (refreshId === this.refreshId) this.fail(error)
      return false
    }
  }
}

export const workspace = new Workspace()
