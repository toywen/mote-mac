import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VaultPath } from '../core/ipc.ts'
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
  countInboundLinks: 'takes no path to the disk',
  filePath: (v) => v.filePath(p('link/secret.md')),
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
