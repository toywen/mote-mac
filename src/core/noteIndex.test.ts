import { describe, expect, test } from 'vitest'
import { parseVaultPath } from './ipc.ts'
import { preview } from './hits.ts'
import { NoteIndex } from './noteIndex.ts'

const p = parseVaultPath

describe('NoteIndex', () => {
  test('finds links to a note with ranges in normalized text', () => {
    const index = new NoteIndex()
    index.setFiles([p('a.md'), p('b.md'), p('c/a.md')])
    index.set(p('b.md'), '\uFEFFfirst\r\nsee [[a]] and [x](a.md)\r\n')
    const hits = index.backlinks(p('a.md'))
    expect(hits.map((h) => [h.path, h.from, h.to])).toEqual([
      ['b.md', 10, 15],
      ['b.md', 20, 29]
    ])
    expect(hits[0].preview).toEqual({ text: 'see [[a]] and [x](a.md)', from: 4, to: 9 })
    expect(index.backlinks(p('c/a.md'))).toEqual([])
  })

  test('follows edits, deletes and file list changes', () => {
    const index = new NoteIndex()
    index.setFiles([p('a.md'), p('b.md')])
    index.set(p('b.md'), '[[新]]')
    expect(index.backlinks(p('新.md'))).toEqual([])
    index.setFiles([p('a.md'), p('b.md'), p('新.md')])
    expect(index.backlinks(p('新.md'))).toHaveLength(1)
    index.set(p('b.md'), 'no links')
    expect(index.backlinks(p('新.md'))).toEqual([])
    index.set(p('b.md'), '[[新]]')
    index.delete(p('b.md'))
    expect(index.backlinks(p('新.md'))).toEqual([])
  })
})

test('preview cuts long lines around the match', () => {
  const text = 'x'.repeat(500) + '[[a]]' + 'y'.repeat(500)
  const result = preview(text, 500, 505)
  expect(result.text.length).toBe(240)
  expect(result.text.slice(result.from, result.to)).toBe('[[a]]')
})
