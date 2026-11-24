import { describe, expect, it } from 'vitest'
import { SyncController, type SyncParts, type SyncLike } from './syncController'
import type { SyncStatus } from './sync'
import type { Remote } from './syncRemote'

function setup(
  options: { vaults?: { id: string; name: string; seq: number }[] } = {}
): ReturnType<typeof build> {
  return build(options)
}

function build(options: { vaults?: { id: string; name: string; seq: number }[] }): {
  controller: SyncController
  calls: string[]
  move(status: SyncStatus): void
} {
  const calls: string[] = []
  let listener: ((status: SyncStatus) => void) | null = null
  let current: SyncStatus = { state: 'idle', pending: 0, seq: 0 }
  const sync: SyncLike = {
    async start() {
      calls.push('start')
    },
    async stop() {
      calls.push('stop')
    },
    status: () => current,
    onStatus: (next) => {
      listener = next
      return () => {}
    },
    confirmDeletions: () => calls.push('confirm')
  }
  const remote = {
    listVaults: async () => ({
      vaults: options.vaults ?? [{ id: 'vault-1', name: 'life-os', seq: 0 }]
    })
  } as unknown as Remote
  const parts: SyncParts = {
    createSync: () => {
      calls.push('create')
      return sync
    },
    createRemote: () => remote
  }
  const controller = new SyncController(
    {} as never,
    '/tmp/mote-sync-test',
    'macbook',
    async () => {},
    parts
  )
  return {
    controller,
    calls,
    move(status: SyncStatus) {
      current = status
      listener?.(status)
    }
  }
}

const config = { serverUrl: 'http://127.0.0.1:1', token: 'token', vaultId: 'vault-1' }

describe('SyncController', () => {
  it('starts unset', () => {
    expect(setup().controller.status()).toEqual({ state: 'unset', pending: 0 })
  })

  it('starts a sync for a config and reports its status', async () => {
    const { controller, calls } = setup()
    await controller.apply(config)
    expect(calls).toEqual(['create', 'start'])
    expect(controller.status().state).toBe('idle')
    expect(controller.resolvedVaultId()).toBe('vault-1')
  })

  it('stops the old run before starting a new one', async () => {
    const { controller, calls } = setup()
    await controller.apply(config)
    calls.length = 0
    await controller.apply({ ...config, serverUrl: 'http://127.0.0.1:2' })
    expect(calls).toEqual(['stop', 'create', 'start'])
  })

  it('goes back to unset when applied with nothing', async () => {
    const { controller, calls } = setup()
    await controller.apply(config)
    await controller.apply(null)
    expect(calls).toContain('stop')
    expect(controller.status()).toEqual({ state: 'unset', pending: 0 })
    expect(controller.resolvedVaultId()).toBeUndefined()
  })

  it('asks the service for the vault when the config does not name one', async () => {
    const { controller } = setup()
    await controller.apply({ serverUrl: config.serverUrl, token: config.token })
    expect(controller.resolvedVaultId()).toBe('vault-1')
  })

  it('reports an error when the service has several vaults', async () => {
    const { controller, calls } = setup({
      vaults: [
        { id: 'a', name: 'a', seq: 0 },
        { id: 'b', name: 'b', seq: 0 }
      ]
    })
    await controller.apply({ serverUrl: config.serverUrl, token: config.token })
    expect(calls).toEqual([])
    expect(controller.status().state).toBe('error')
    expect(controller.status().lastError).toContain('多个笔记库')
  })

  it('reports an error when the service has none', async () => {
    const { controller } = setup({ vaults: [] })
    await controller.apply({ serverUrl: config.serverUrl, token: config.token })
    expect(controller.status().lastError).toBe('服务器上还没有笔记库')
  })

  it('reports an error when the service cannot be reached', async () => {
    const { controller } = setup()
    const failing: SyncParts = {
      ...({
        createSync: () => {
          throw new Error('boom')
        },
        createRemote: () => {
          throw new Error('boom')
        }
      } as unknown as SyncParts)
    }
    const other = new SyncController({} as never, '/tmp', 'mac', async () => {}, failing)
    await other.apply(config)
    expect(other.status()).toEqual({ state: 'error', pending: 0, lastError: 'boom' })
    expect(controller.status().state).toBe('unset')
  })

  it('passes sync status changes on, and remembers when a sync finished', async () => {
    const { controller, move } = setup()
    const seen: string[] = []
    controller.onStatus((status) => seen.push(status.state))
    await controller.apply(config)
    move({ state: 'syncing', pending: 3, seq: 1 })
    const status = controller.status()
    expect(status.state).toBe('syncing')
    expect(status.pending).toBe(3)
    expect(status.lastSyncAt).toBeTypeOf('number')
    move({ state: 'idle', pending: 0, seq: 2 })
    expect(controller.status().lastSyncAt).toBeTypeOf('number')
    expect(seen).toEqual(['idle', 'syncing', 'idle'])
  })

  it('passes a settings problem into the status line', () => {
    const { controller } = setup()
    controller.fail('令牌读不出来')
    expect(controller.status()).toEqual({ state: 'error', pending: 0, lastError: '令牌读不出来' })
  })

  it('forwards a confirmation of deletions', async () => {
    const { controller, calls } = setup()
    await controller.apply(config)
    controller.confirmDeletions()
    expect(calls).toContain('confirm')
  })
})
