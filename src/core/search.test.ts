import { expect, test } from 'vitest'
import { parseVaultPath, type VaultPath } from './ipc.ts'
import { NoteIndex } from './noteIndex.ts'
import { parseQuery, search } from './search.ts'

function vault(notes: Record<string, string>): NoteIndex {
  const index = new NoteIndex()
  for (const [path, text] of Object.entries(notes)) index.set(parseVaultPath(path), text)
  return index
}
const run = (index: NoteIndex, query: string): ReturnType<typeof search> =>
  search(index.entries(), query)
const paths = (result: ReturnType<typeof search>): VaultPath[] => result.groups.map((g) => g.path)

test('splits on spaces and keeps quoted phrases together', () => {
  expect(parseQuery('  学习  "两个 词" 计划 "未闭合 引号')).toEqual([
    '学习',
    '两个 词',
    '计划',
    '未闭合 引号'
  ])
  expect(parseQuery('   ')).toEqual([])
})

test('every term must appear in the same note, in the body or the file name', () => {
  const index = vault({
    'a/学习计划.md': '今天读书',
    'b.md': '学习 和 读书',
    'c.md': '只有学习'
  })
  expect(paths(run(index, '学习 读书'))).toEqual(['b.md', 'a/学习计划.md'])
  expect(paths(run(index, '.md 只有'))).toEqual(['c.md'])
  const result = run(index, '学习 读书')
  expect(result.groups[1]).toMatchObject({ count: 1, hits: [{ from: 2, to: 4 }] })
  expect(result.total).toBe(3)
})

test('ignores case, matches phrases literally, and gives exact ranges', () => {
  const index = vault({ 'x.md': '﻿line\r\nHello World (a.b) hello' })
  const result = run(index, 'hello')
  expect(result.groups[0].hits.map((h) => [h.from, h.to])).toEqual([
    [5, 10],
    [23, 28]
  ])
  expect(result.groups[0].hits[0].preview).toEqual({
    text: 'Hello World (a.b) hello',
    from: 0,
    to: 5
  })
  expect(run(index, '"world (a.b)"').total).toBe(1)
  expect(run(index, '"world  (a.b)"').total).toBe(0)
  expect(run(index, 'a?b').total).toBe(0)
})

test('sorts by file name and limits groups that carry hits', () => {
  const index = vault({ 'z/b.md': 'k', 'a.md': 'k', 'y/c.md': 'k k' })
  const result = search(index.entries(), 'k', 2)
  expect(result.groups.map((g) => g.path)).toEqual(['a.md', 'z/b.md'])
  expect(result).toMatchObject({ total: 4, notes: 3 })
})
