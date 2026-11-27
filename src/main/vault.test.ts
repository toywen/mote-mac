import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContentHash, VaultPath } from '../core/ipc.ts'
import { Vault } from './vault.ts'

const p = (path: string): VaultPath => path as VaultPath

let base: string
let outside: string
let root: string
let vault: Vault

async function makeVault(dir: string, appJson?: string): Promise<Vault> {
  await mkdir(join(dir, '.obsidian'), { recursive: true })
  await writeFile(join(dir, 'a.md'), 'see [[b]]')
  await writeFile(join(dir, 'b.md'), 'b')
  if (appJson) await writeFile(join(dir, '.obsidian', 'app.json'), appJson)
  await symlink(outside, join(dir, 'link'))
  return Vault.open(dir, () => {})
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'mote-vault-')))
  outside = join(base, 'outside')
  root = join(base, 'vault')
  await mkdir(outside)
  await writeFile(join(outside, 'secret.md'), 'secret')
  vault = await makeVault(root)
})

afterEach(async () => {
  vault.close()
  await rm(base, { recursive: true, force: true })
})

type DiskCall = (v: Vault) => Promise<unknown>

// The compiler asks for an entry per public Vault member. A member that reaches the disk at a
// path its caller chooses gets a call aimed at `link`, a folder of the vault that is a symlink
// to a folder outside it.
const throughSymlink: Record<keyof Vault, DiskCall | 'takes no path to the disk'> = {
  dir: 'takes no path to the disk',
  info: 'takes no path to the disk',
  close: 'takes no path to the disk',
  search: 'takes no path to the disk',
  backlinks: 'takes no path to the disk',
  noteTexts: 'takes no path to the disk',
  countInboundLinks: 'takes no path to the disk',
  subscribe: 'takes no path to the disk',
  listFiles: 'takes no path to the disk',
  filePath: (v) => v.filePath(p('link/secret.md')),
  readFile: (v) => v.readFile(p('link/secret.md')),
  writeFile: (v) => v.writeFile(p('link/new.png'), Buffer.from('x'), null),
  readNote: (v) => v.readNote(p('link/secret.md')),
  writeNote: (v) => v.writeNote(p('link/new.md'), 'x', null),
  createNote: (v) => v.createNote(p('link/new.md')),
  createNoteInVault: (v) => v.createNoteInVault(p('link'), 'new'),
  createFolder: (v) => v.createFolder(p('link'), 'new'),
  renameOrMove: (v) => v.renameOrMove(p('b.md'), p('link/b.md'), false),
  trash: (v) => v.trash(p('link/secret.md'), () => Promise.reject(new Error('reached the trash'))),
  saveAttachment: async () => {
    const configured = await makeVault(
      join(base, 'configured'),
      '{"attachmentFolderPath":"link/files"}'
    )
    try {
      return await configured.saveAttachment(p('a.md'), 'new.png', Buffer.from('x'))
    } finally {
      configured.close()
    }
  }
}

describe('a folder of the vault that is a symlink to a folder outside it', () => {
  for (const [name, call] of Object.entries(throughSymlink)) {
    if (typeof call === 'string') continue
    it(`${name} refuses to pass through it`, async () => {
      await expect(call(vault)).rejects.toThrow()
      expect(await readdir(outside)).toEqual(['secret.md'])
      expect(await readdir(root)).toContain('b.md')
    })
  }
})

describe('folders that do not exist yet', () => {
  it('are made on disk and listed, for a new note and for a new folder', async () => {
    let listed: string[] = []
    vault.close()
    vault = await Vault.open(root, (change) => {
      if (change.entries) listed = change.entries.map((entry) => entry.path)
    })
    expect(await vault.createNoteInVault(p('x/y'), 'n')).toBe('x/y/n.md')
    expect(await vault.createFolder(p('x'), 'z')).toBe('x/z')
    expect((await readdir(join(root, 'x'))).sort()).toEqual(['y', 'z'])
    expect(await readdir(join(root, 'x', 'y'))).toEqual(['n.md'])
    expect(listed).toEqual(expect.arrayContaining(['x', 'x/y', 'x/y/n.md', 'x/z']))
  })
})

describe('a Markdown link whose path is percent-encoded', () => {
  beforeEach(async () => {
    vault.close()
    await writeFile(join(root, 'my note.md'), 'target')
    await writeFile(join(root, 'c.md'), 'see [x](my%20note.md)')
    vault = await Vault.open(root, () => {})
  })

  it('counts as a backlink', () => {
    expect(vault.backlinks(p('my note.md')).map((hit) => hit.path)).toEqual(['c.md'])
  })

  it('follows the note when it is renamed', async () => {
    await vault.renameOrMove(p('my note.md'), p('new name.md'), true)
    expect((await vault.readNote(p('c.md')))?.text).toBe('see [x](new%20name.md)')
  })
})

describe('a change made outside mote', () => {
  it('is in the index by the time the renderer hears of it', async () => {
    vault.close()
    const seen = new Promise<string[]>((done) => {
      void Vault.open(root, (change) => {
        if (change.changed.includes(p('b.md'))) {
          done(vault.backlinks(p('a.md')).map((hit) => hit.path))
        }
      }).then((opened) => {
        vault = opened
        return writeFile(join(root, 'b.md'), 'now links to [[a]]')
      })
    })
    expect(await seen).toEqual(['b.md'])
  })
})

describe('what the sync module uses', () => {
  const sha = (text: string): ContentHash =>
    createHash('sha256').update(text).digest('hex') as ContentHash

  it('lists every file with its hash and size, attachments included', async () => {
    await mkdir(join(root, '.mote', 'attachments'), { recursive: true })
    await writeFile(join(root, '.mote', 'attachments', 'x.png'), 'png')
    expect(await vault.listFiles()).toEqual([
      { path: '.mote/attachments/x.png', hash: sha('png'), size: 3 },
      { path: 'a.md', hash: sha('see [[b]]'), size: 9 },
      { path: 'b.md', hash: sha('b'), size: 1 }
    ])
  })

  it('writes bytes only over the base it was given', async () => {
    expect(await vault.writeFile(p('b.md'), Buffer.from('new'), sha('other'))).toEqual({
      ok: false,
      disk: sha('b')
    })
    expect(await vault.writeFile(p('b.md'), Buffer.from('new'), sha('b'))).toEqual({ ok: true })
    expect((await vault.readNote(p('b.md')))?.text).toBe('new')
    expect(await vault.writeFile(p('b.md'), Buffer.from('again'), null)).toEqual({
      ok: false,
      disk: sha('new')
    })
    expect(await vault.writeFile(p('n/new.md'), Buffer.from('n'), null)).toEqual({ ok: true })
    expect(vault.info().entries.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['n', 'n/new.md'])
    )
  })

  it('trashes a file only while it still has the base hash', async () => {
    const trashed: string[] = []
    const toTrash = async (full: string): Promise<void> => {
      trashed.push(full)
      await rm(full)
    }
    expect(await vault.trash(p('b.md'), toTrash, sha('other'))).toBe(false)
    expect(trashed).toEqual([])
    expect(await vault.trash(p('b.md'), toTrash, sha('b'))).toBe(true)
    expect(trashed).toEqual([join(root, 'b.md')])
  })

  it('tells a subscriber about mote saving a note, which notify leaves out', async () => {
    const notified: VaultPath[] = []
    vault.close()
    vault = await Vault.open(root, (change) => notified.push(...change.changed))
    const heard = new Promise<VaultPath[]>((done) => {
      const stop = vault.subscribe((change) => {
        if (change.paths.includes(p('b.md'))) {
          stop()
          done(change.paths)
        }
      })
    })
    expect(await vault.writeNote(p('b.md'), 'saved', sha('b'))).toEqual({
      ok: true,
      hash: sha('saved')
    })
    expect(await heard).toContain('b.md')
    expect(notified).not.toContain('b.md')
  })
})
