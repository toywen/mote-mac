import type { SyncStatusView } from '../core/ipc'
import { Sync, type SyncOptions, type SyncStatus } from './sync'
import { createRemote, type Remote } from './syncRemote'
import type { Vault } from './vault'
import type { InVault } from './vaultFs'

export type RuntimeSync = {
  serverUrl: string
  certPem?: string
  token: string
  /** Left out on the first save; the controller asks the service which vault to use. */
  vaultId?: string
}

/** The part of `Sync` the controller drives, so tests can hand it a stand-in. */
export type SyncLike = Pick<Sync, 'start' | 'stop' | 'status' | 'onStatus' | 'confirmDeletions'>
export type SyncParts = {
  createSync: (options: SyncOptions) => SyncLike
  createRemote: (config: { serverUrl: string; certPem?: string; token: string; vaultId: string }) => Remote
}

const parts: SyncParts = {
  createSync: (options) => new Sync(options),
  createRemote: (config) => createRemote(config)
}

export type ResolveResult = { ok: true; vaultId: string } | { ok: false; error: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Owns the one `Sync` of one open vault. Applying settings stops the old run before it starts a
 * new one, so two runs never write the same vault or state table.
 */
export class SyncController {
  private sync: SyncLike | null = null
  private current: SyncStatusView = { state: 'unset', pending: 0 }
  private lastSyncAt: number | undefined
  private vaultId: string | undefined
  private unlisten: (() => void) | null = null
  private readonly listeners = new Set<(status: SyncStatusView) => void>()

  constructor(
    private readonly vault: Pick<Vault, 'listFiles' | 'readFile' | 'writeFile' | 'trash' | 'subscribe'>,
    private readonly stateDir: string,
    private readonly deviceName: string,
    private readonly trash: (full: InVault) => Promise<void>,
    private readonly injected: SyncParts = parts
  ) {}

  status(): SyncStatusView {
    return this.current
  }

  /** The vault the service picked, once an apply succeeded. */
  resolvedVaultId(): string | undefined {
    return this.vaultId
  }

  onStatus(listener: (status: SyncStatusView) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Finds the vault to sync when the settings do not name one. */
  async resolveVault(config: Omit<RuntimeSync, 'vaultId'>): Promise<ResolveResult> {    try {
      const remote = this.injected.createRemote({ ...config, vaultId: '' })
      const list = await remote.listVaults()
      if (list.vaults.length === 1) return { ok: true, vaultId: list.vaults[0].id }
      if (list.vaults.length === 0) return { ok: false, error: '服务器上还没有笔记库' }
      return { ok: false, error: '服务器上有多个笔记库，这个版本还不支持选择' }
    } catch (error) {
      return { ok: false, error: messageOf(error) }
    }
  }

  async apply(config: RuntimeSync | null): Promise<void> {
    await this.stop()
    if (!config) {
      this.lastSyncAt = undefined
      this.vaultId = undefined
      this.current = { state: 'unset', pending: 0 }
      this.emit()
      return
    }
    let vaultId = config.vaultId
    if (!vaultId) {
      const resolved = await this.resolveVault(config)
      if (!resolved.ok) {
        this.current = { state: 'error', pending: 0, lastError: resolved.error }
        this.emit()
        return
      }
      vaultId = resolved.vaultId
    }
    try {
      const sync = this.injected.createSync({
        vault: this.vault,
        config: { ...config, vaultId, deviceName: this.deviceName },
        stateDir: this.stateDir,
        trash: this.trash
      })
      this.sync = sync
      this.vaultId = vaultId
      this.unlisten = sync.onStatus((status) => this.moved(status))
      this.moved(sync.status())
      await sync.start()
    } catch (error) {
      this.sync = null
      this.vaultId = undefined
      this.current = { state: 'error', pending: 0, lastError: messageOf(error) }
      this.emit()
    }
  }

  /** Shows a settings problem in the status line without starting anything. */
  fail(message: string): void {
    this.current = { state: 'error', pending: 0, lastError: message }
    this.emit()
  }

  confirmDeletions(): void {
    this.sync?.confirmDeletions()
  }

  async stop(): Promise<void> {
    this.unlisten?.()
    this.unlisten = null
    const running = this.sync
    this.sync = null
    if (running) await running.stop()
  }

  private moved(status: SyncStatus): void {
    if (status.state === 'idle') this.lastSyncAt = Date.now()
    this.current = {
      state: status.state,
      pending: status.pending,
      lastSyncAt: this.lastSyncAt,
      lastError: status.lastError
    }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current)
  }
}
