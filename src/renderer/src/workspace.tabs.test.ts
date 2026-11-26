import { beforeEach, describe, expect, it } from 'vitest'
import type { VaultInfo, VaultPath } from '../../core/ipc'
import { Workspace } from './workspace'

describe('Workspace tab batch closing', () => {
  const mockVault: VaultInfo = {
    dir: '/test-vault',
    entries: [
      { path: 'a.md' as VaultPath, kind: 'note' },
      { path: 'b.md' as VaultPath, kind: 'note' },
      { path: 'c.md' as VaultPath, kind: 'note' }
    ],
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

  let ws: Workspace

  beforeEach(async () => {
    const globals = globalThis as unknown as { window: unknown }
    globals.window = {
      mote: {
        getVault: async () => mockVault,
        onVaultChanged: () => () => {},
        onCloseRequested: () => () => {},
        readNote: async (_dir: string, path: string) => ({
          hash: `hash-${path}`,
          text: `# ${path}`
        }),
        writeNote: async () => ({ ok: true, hash: 'new-hash' }),
        showInFolder: async () => {},
        newWindow: async () => {}
      }
    }
    ws = new Workspace()
    ws.connect()
    // Wait for initial vault load
    await new Promise((r) => setTimeout(r, 10))
    // Open a, b, c in order
    await ws.open('a.md' as VaultPath)
    await ws.open('b.md' as VaultPath)
    await ws.open('c.md' as VaultPath)
  })

  it('closeOtherTabs keeps only target tab when target is currently active', async () => {
    expect(ws.snapshot().tabs).toEqual(['a.md', 'b.md', 'c.md'])
    expect(ws.snapshot().doc?.path).toBe('c.md')

    await ws.closeOtherTabs('c.md' as VaultPath)

    expect(ws.snapshot().tabs).toEqual(['c.md'])
    expect(ws.snapshot().doc?.path).toBe('c.md')
  })

  it('closeOtherTabs switches to target tab when target is not currently active', async () => {
    expect(ws.snapshot().tabs).toEqual(['a.md', 'b.md', 'c.md'])
    expect(ws.snapshot().doc?.path).toBe('c.md')

    await ws.closeOtherTabs('a.md' as VaultPath)

    expect(ws.snapshot().tabs).toEqual(['a.md'])
    expect(ws.snapshot().doc?.path).toBe('a.md')
  })

  it('closeOtherTabs ignores path not in tabs', async () => {
    await ws.closeOtherTabs('nonexistent.md' as VaultPath)
    expect(ws.snapshot().tabs).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('closeTabsToTheRight closes all tabs to the right of target', async () => {
    // Current active is c.md, close to right of a.md -> active is in closed set, should switch to a.md
    await ws.closeTabsToTheRight('a.md' as VaultPath)

    expect(ws.snapshot().tabs).toEqual(['a.md'])
    expect(ws.snapshot().doc?.path).toBe('a.md')
  })

  it('closeTabsToTheRight preserves active tab when active is in kept tabs', async () => {
    await ws.open('a.md' as VaultPath)
    expect(ws.snapshot().doc?.path).toBe('a.md')

    // Close to right of b.md -> kept are a.md, b.md; c.md is closed
    await ws.closeTabsToTheRight('b.md' as VaultPath)

    expect(ws.snapshot().tabs).toEqual(['a.md', 'b.md'])
    expect(ws.snapshot().doc?.path).toBe('a.md')
  })

  it('closeTabsToTheRight does nothing when target is already the last tab', async () => {
    await ws.closeTabsToTheRight('c.md' as VaultPath)

    expect(ws.snapshot().tabs).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('closeAllTabs closes all tabs and enters empty panel', async () => {
    expect(ws.snapshot().tabs.length).toBe(3)
    expect(ws.snapshot().doc).not.toBeNull()

    await ws.closeAllTabs()

    expect(ws.snapshot().tabs).toEqual([])
    expect(ws.snapshot().doc).toBeNull()
  })
})
