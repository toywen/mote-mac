import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Change, CommitItem, ContentHash, Seq, ServerMessage } from 'mote-sync-protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VaultPath } from '../core/ipc.ts'
import { conflictPath, deletionNeedsConfirm, Sync } from './sync.ts'
import { RemoteError, type Remote, type SocketEvents } from './syncRemote.ts'
import { loadState, saveState, stateFile, type SyncState } from './syncState.ts'
import { Vault } from './vault.ts'

const sha = (bytes: Buffer | string): ContentHash =>
  createHash('sha256').update(bytes).digest('hex') as ContentHash
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** The sync service's commit, change and blob rules in memory, for any number of devices. */
class FakeServer {
  online = true
  private seq = 0
  readonly files = new Map<string, Change>()
  readonly blobs = new Map<string, Buffer>()
  readonly commits: { device: string; item: CommitItem }[] = []
  /** Every commit request, refused ones included. */
  readonly attempts: { device: string; item: CommitItem }[] = []
  private readonly sockets = new Map<SocketEvents, string>()

  setOnline(online: boolean): void {
    this.online = online
    if (!online) for (const events of [...this.sockets.keys()]) this.drop(events)
  }

  private drop(events: SocketEvents): void {
    this.sockets.delete(events)
    events.onClose()
  }

  remote(device: string): Remote {
    const up = (): void => {
      if (!this.online) throw new RemoteError(null, 'offline')
    }
    return {
      listVaults: async () => {
        up()
        return { vaults: [{ id: 'v', name: 'v', seq: this.seq }] } as never
      },
      changes: async (since) => {
        up()
        const changes = [...this.files.values()]
          .filter((c) => c.seq > since)
          .sort((a, b) => a.seq - b.seq)
        return { changes, next: this.seq as Seq, complete: true }
      },
      commit: async (item) => {
        up()
        this.attempts.push({ device, item })
        const current = this.files.get(item.path)
        const currentSeq = current?.seq ?? 0
        if (item.baseSeq !== currentSeq) {
          return { ok: false, conflict: { hash: current?.hash ?? null, seq: currentSeq as Seq } }
        }
        this.commits.push({ device, item })
        const seq = ++this.seq as Seq
        this.files.set(
          item.path,
          item.deleted
            ? { path: item.path, seq, deleted: true, hash: null, size: 0 }
            : {
                path: item.path,
                seq,
                deleted: false,
                hash: item.hash,
                size: this.blobs.get(item.hash)!.length
              }
        )
        const message: ServerMessage = { type: 'change', vault: 'v' as never, seq }
        for (const [events, owner] of this.sockets)
          if (owner !== device) setImmediate(() => events.onMessage(message))
        return { ok: true, seq }
      },
      head: async (hash) => {
        up()
        return this.blobs.has(hash)
      },
      putBlob: async (hash, bytes) => {
        up()
        this.blobs.set(hash, bytes)
      },
      getBlob: async (hash) => {
        up()
        return this.blobs.get(hash) ?? null
      },
      openSocket: async (events) => {
        up()
        this.sockets.set(events, device)
        return { close: () => this.sockets.delete(events) }
      }
    }
  }
}

let base: string
let server: FakeServer
const devices: { vault: Vault; sync: Sync }[] = []

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'mote-sync-test-')))
  server = new FakeServer()
})

afterEach(async () => {
  for (const { vault, sync } of devices.splice(0)) {
    await sync.stop()
    vault.close()
  }
  await rm(base, { recursive: true, force: true })
})

async function device(
  name: string,
  files: Record<string, string> = {}
): Promise<{ dir: string; vault: Vault; sync: Sync }> {
  const dir = join(base, name)
  await mkdir(dir, { recursive: true })
  for (const [path, text] of Object.entries(files)) await writeFile(join(dir, path), text)
  const vault = await Vault.open(dir, () => {})
  const sync = new Sync({
    vault,
    config: { serverUrl: 'http://fake', token: name, vaultId: 'v', deviceName: name },
    stateDir: join(base, `${name}-state`),
    trash: (full) => rm(full),
    remote: server.remote(name),
    debounceMs: 30,
    now: () => new Date(2026, 10, 23, 9, 5).getTime()
  })
  devices.push({ vault, sync })
  await sync.start()
  return { dir, vault, sync }
}

async function until(
  what: string,
  test: () => boolean | Promise<boolean>,
  ms = 8000
): Promise<void> {
  const end = Date.now() + ms
  while (!(await test())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`)
    await sleep(10)
  }
}

/** Idle and nothing pending for 300 ms, ten times the test's upload delay. */
async function settled(...syncs: Sync[]): Promise<void> {
  let since = Date.now()
  await until('idle', () => {
    if (!syncs.every((s) => s.status().state === 'idle' && s.status().pending === 0))
      since = Date.now()
    return Date.now() - since > 300
  })
}

const text = (dir: string, path: string): Promise<string | null> =>
  readFile(join(dir, path), 'utf8').catch(() => null)

async function save(vault: Vault, path: string, change: (text: string) => string): Promise<void> {
  const before = (await vault.readNote(path as VaultPath))!
  expect(await vault.writeNote(path as VaultPath, change(before.text), before.hash)).toMatchObject({
    ok: true
  })
}

describe('the state table', () => {
  const state: SyncState = {
    serverUrl: 'https://s',
    seq: 7 as Seq,
    files: { 'a.md': { hash: sha('a'), seq: 7 as Seq }, 'gone.md': { hash: null, seq: 3 as Seq } }
  }

  it('reads back what was written, and a crash mid-write leaves the old table', async () => {
    const file = stateFile(join(base, 'state'), 'v')
    await saveState(file, state)
    await writeFile(`${file}.tmp`, '{"serverUrl":"https://s","seq":9,"fi')
    expect(await loadState(file, 'https://s')).toEqual(state)
    expect((await readdir(join(base, 'state'))).sort()).toEqual(['v.json', 'v.json.tmp'])
    await saveState(file, { ...state, seq: 8 as Seq })
    expect((await loadState(file, 'https://s')).seq).toBe(8)
    expect(await readdir(join(base, 'state'))).toEqual(['v.json'])
  })

  it('starts over when the table is unreadable or belongs to another server', async () => {
    const file = stateFile(join(base, 'state'), 'v')
    const empty = (url: string): SyncState => ({ serverUrl: url, seq: 0 as Seq, files: {} })
    expect(await loadState(file, 'https://s')).toEqual(empty('https://s'))
    await saveState(file, state)
    expect(await loadState(file, 'https://other')).toEqual(empty('https://other'))
    await writeFile(file, 'not json')
    expect(await loadState(file, 'https://s')).toEqual(empty('https://s'))
  })

  it('lets a restarted device go on without uploading again', async () => {
    const a = await device('a', { 'x.md': 'x\n' })
    await settled(a.sync)
    await a.sync.stop()
    const table = await loadState(stateFile(join(base, 'a-state'), 'v'), 'http://fake')
    expect(table.files['x.md']).toEqual({ hash: sha('x\n'), seq: 1 })
    const commits = server.commits.length
    await a.sync.start()
    await settled(a.sync)
    expect(server.commits.length).toBe(commits)
  })
})

describe('conflict file names', () => {
  const at = new Date(2026, 10, 23, 9, 5)
  it('put device and minute in the name, next to the file', () => {
    expect(conflictPath('日记/今天.md', 'MacBook', at)).toBe(
      '日记/今天 (冲突 MacBook 202611230905).md'
    )
    expect(conflictPath('a.md', 'Mac', at, 2)).toBe('a (冲突 Mac 202611230905)-2.md')
    expect(conflictPath('.mote/attachments/图.png', 'a/b', at)).toBe(
      '.mote/attachments/图 (冲突 a-b 202611230905).png'
    )
    expect(conflictPath('README', ' ', at)).toBe('README (冲突 设备 202611230905)')
  })
})

describe('deletion protection', () => {
  it('needs more than 20 files and more than half of them', () => {
    expect(deletionNeedsConfirm(21, 40)).toBe(true)
    expect(deletionNeedsConfirm(20, 20)).toBe(false)
    expect(deletionNeedsConfirm(21, 42)).toBe(false)
    expect(deletionNeedsConfirm(25, 25)).toBe(true)
  })

  it('stops sync when the vault is emptied, and commits the deletions once confirmed', async () => {
    const files = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`n${i}.md`, `${i}\n`]))
    const a = await device('a', files)
    await settled(a.sync)
    for (const name of Object.keys(files)) await rm(join(a.dir, name))
    await until('blocked', () => a.sync.status().state === 'blocked')
    await sleep(200)
    expect(server.commits.filter((c) => c.item.deleted)).toEqual([])
    a.sync.confirmDeletions()
    await settled(a.sync)
    expect(server.commits.filter((c) => c.item.deleted)).toHaveLength(25)
  })

  it('lets a few deletions through without asking', async () => {
    const a = await device('a', { 'a.md': 'a', 'b.md': 'b' })
    await settled(a.sync)
    await rm(join(a.dir, 'a.md'))
    await until('deleted', () => server.files.get('a.md')?.deleted === true)
    expect(a.sync.status().state).not.toBe('blocked')
  })
})

describe('own writes', () => {
  it('are not uploaded again by the device that downloaded them', async () => {
    const a = await device('a', { 'x.md': 'one\n' })
    await settled(a.sync)
    const b = await device('b')
    await until('b has x', async () => (await text(b.dir, 'x.md')) === 'one\n')
    await save(a.vault, 'x.md', () => 'two\n')
    await until('b has two', async () => (await text(b.dir, 'x.md')) === 'two\n')
    await settled(a.sync, b.sync)
    expect(server.attempts.filter((c) => c.device === 'b')).toEqual([])
  })
})

describe('merging', () => {
  /** Both devices hold `files`, go offline, change things, and come back one after the other. */
  async function offline(
    files: Record<string, string>,
    changeA: (dir: string, vault: Vault) => Promise<void>,
    changeB: (dir: string, vault: Vault) => Promise<void>
  ): Promise<{ a: string; b: string }> {
    const a = await device('a', files)
    await settled(a.sync)
    const b = await device('b')
    await settled(a.sync, b.sync)
    server.setOnline(false)
    await until(
      'offline',
      () => a.sync.status().state === 'offline' && b.sync.status().state === 'offline'
    )
    await changeA(a.dir, a.vault)
    await changeB(b.dir, b.vault)
    await sleep(100)
    server.setOnline(true)
    await until(
      'online',
      () => a.sync.status().state !== 'offline' && b.sync.status().state !== 'offline',
      10_000
    )
    await settled(a.sync, b.sync)
    return { a: a.dir, b: b.dir }
  }

  it('merges changes to different lines, keeping the line breaks', async () => {
    const { a, b } = await offline(
      { 'n.md': 'one\r\ntwo\r\nthree\r\n' },
      (_, vault) => save(vault, 'n.md', (t) => t.replace('one', 'ONE')),
      (_, vault) => save(vault, 'n.md', (t) => t.replace('three', 'THREE'))
    )
    expect(await text(a, 'n.md')).toBe('ONE\r\ntwo\r\nTHREE\r\n')
    expect(await text(b, 'n.md')).toBe('ONE\r\ntwo\r\nTHREE\r\n')
  })

  it('keeps both versions of the same line', async () => {
    const { a, b } = await offline(
      { 'n.md': 'one\ntwo\n' },
      (_, vault) => save(vault, 'n.md', (t) => t.replace('two', 'A')),
      (_, vault) => save(vault, 'n.md', (t) => t.replace('two', 'B'))
    )
    const merged = await text(a, 'n.md')
    expect(merged).toBe(await text(b, 'n.md'))
    expect(['one\nA\nB\n', 'one\nB\nA\n']).toContain(merged)
  })

  it('makes a conflict file for a note that is not UTF-8', async () => {
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])
    const { a, b } = await offline(
      { 'n.md': 'plain\n' },
      (dir) => writeFile(join(dir, 'n.md'), latin1),
      (dir) => writeFile(join(dir, 'n.md'), 'from b\n')
    )
    for (const dir of [a, b]) {
      const names = (await readdir(dir)).filter((name) => name !== 'n.md')
      expect(names).toHaveLength(1)
      expect(names[0]).toMatch(/^n \(冲突 [ab] 202611230905\)\.md$/)
    }
    expect(await readFile(join(a, 'n.md'))).toEqual(await readFile(join(b, 'n.md')))
  })

  it('makes a conflict file on a first sync when both have the path with other bytes', async () => {
    const a = await device('a', { 'n.md': 'from a\n' })
    await settled(a.sync)
    const b = await device('b', { 'n.md': 'from b\n' })
    await settled(a.sync, b.sync)
    for (const dir of [join(base, 'a'), join(base, 'b')]) {
      expect(await text(dir, 'n.md')).toBe('from a\n')
      expect(await text(dir, 'n (冲突 b 202611230905).md')).toBe('from b\n')
    }
  })

  it('lets the later commit of an attachment win and keeps the change over a deletion', async () => {
    const { a, b } = await offline(
      { 'p.png': 'old', 'keep.md': 'keep\n' },
      async (dir, vault) => {
        await writeFile(join(dir, 'p.png'), 'from a')
        await vault.trash('keep.md' as VaultPath, (full) => rm(full))
      },
      async (dir, vault) => {
        await writeFile(join(dir, 'p.png'), 'from b')
        await save(vault, 'keep.md', (t) => t + 'more\n')
      }
    )
    expect(await text(a, 'p.png')).toBe(await text(b, 'p.png'))
    expect(await text(a, 'keep.md')).toBe('keep\nmore\n')
    expect(await text(b, 'keep.md')).toBe('keep\nmore\n')
  })
})
