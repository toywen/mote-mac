import { describe, expect, it } from 'vitest'
import { parseVaultPath, type VaultEntry } from '../../core/ipc'
import { buildTree } from './tree'

describe('buildTree', () => {
  const entries: VaultEntry[] = [
    { path: parseVaultPath('b-folder'), kind: 'folder' },
    { path: parseVaultPath('b-folder/sub-2.md'), kind: 'note' },
    { path: parseVaultPath('b-folder/sub-1.md'), kind: 'note' },
    { path: parseVaultPath('a-folder'), kind: 'folder' },
    { path: parseVaultPath('z-note.md'), kind: 'note' },
    { path: parseVaultPath('a-note.md'), kind: 'note' },
    { path: parseVaultPath('m-note.md'), kind: 'note' }
  ]

  it('sorts folders first and items ascending by name with name-asc', () => {
    const tree = buildTree(entries, 'name-asc')
    expect(tree.map((n) => n.name)).toEqual(['a-folder', 'b-folder', 'a-note', 'm-note', 'z-note'])
    const bFolder = tree.find((n) => n.name === 'b-folder')
    expect(bFolder?.children.map((c) => c.name)).toEqual(['sub-1', 'sub-2'])
  })

  it('sorts folders first and items descending by name with name-desc', () => {
    const tree = buildTree(entries, 'name-desc')
    expect(tree.map((n) => n.name)).toEqual(['b-folder', 'a-folder', 'z-note', 'm-note', 'a-note'])
    const bFolder = tree.find((n) => n.name === 'b-folder')
    expect(bFolder?.children.map((c) => c.name)).toEqual(['sub-2', 'sub-1'])
  })

  it('supports Chinese collation order', () => {
    const chineseEntries: VaultEntry[] = [
      { path: parseVaultPath('北京.md'), kind: 'note' },
      { path: parseVaultPath('上海.md'), kind: 'note' },
      { path: parseVaultPath('广州.md'), kind: 'note' }
    ]
    const asc = buildTree(chineseEntries, 'name-asc')
    const desc = buildTree(chineseEntries, 'name-desc')
    expect(asc.map((n) => n.name)).toEqual([...desc.map((n) => n.name)].reverse())
  })
})
