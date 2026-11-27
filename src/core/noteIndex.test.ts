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

  test('listTags and notesWithTag match exact or nested tags case-insensitively', () => {
    const index = new NoteIndex()
    index.setFiles([p('a.md'), p('b.md'), p('c.md')])
    index.set(p('a.md'), '---\ntags: [架构, AI]\n---\n正文 #AI/助手\n')
    index.set(p('b.md'), '笔记 #架构 #待办\n')
    index.set(p('c.md'), '纯文本无标签\n')
    expect(index.listTags()).toEqual([
      { tag: '#架构', count: 2 },
      { tag: '#待办', count: 1 },
      { tag: '#AI', count: 1 },
      { tag: '#AI/助手', count: 1 }
    ])
    expect(index.notesWithTag('#ai')).toEqual(['a.md'])
    expect(index.notesWithTag('#架构')).toEqual(['a.md', 'b.md'])
  })
})

test('preview cuts long lines around the match', () => {
  const text = 'x'.repeat(500) + '[[a]]' + 'y'.repeat(500)
  const result = preview(text, 500, 505)
  expect(result.text.length).toBeLessThan(300)
  expect(result.text.slice(result.from, result.to)).toBe('[[a]]')
  expect(result.text.slice(0, result.from)).toMatch(/^x+$/)
  expect(result.text.slice(result.to)).toMatch(/^y+$/)
})
