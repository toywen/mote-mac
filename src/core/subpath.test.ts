import { describe, expect, it } from 'vitest'
import { resolveSubpath, subpathRange } from './subpath.ts'

// The 0-based line where a subpath lands, as Obsidian reports start.line, or null.
function line(text: string, subpath: string): number | null {
  const at = resolveSubpath(text, subpath)
  return at === null ? null : text.slice(0, at).split('\n').length - 1
}

const note = [
  '---', // 0
  'title: 目标', // 1
  '---', // 2
  '# 一级', // 3
  '', // 4
  '## 二级：带标点', // 5
  '', // 6
  '段落 ^p1', // 7
  '', // 8
  '### 三级', // 9
  '', // 10
  '- 第一项', // 11
  '  - 嵌套项 ^li', // 12
  '- 第二项', // 13
  '', // 14
  '> 引用里的段落 ^q1', // 15
  '>', // 16
  '> # 引用里的标题', // 17
  '', // 18
  '表格前的段落', // 19
  '', // 20
  '^after', // 21
  '', // 22
  '# Setext 标题', // 23
  '另一个', // 24
  '======', // 25
  '', // 26
  '## 二级：带标点 ##', // 27
  '## Title ^h2', // 28
  ''
].join('\n')

describe('resolveSubpath', () => {
  it('finds a heading by its text, ignoring case and punctuation', () => {
    expect(line(note, '#一级')).toBe(3)
    expect(line(note, '#二级：带标点')).toBe(5)
    expect(line(note, '#二级：带标点  ')).toBe(5)
    expect(line(note, '#title ^h2')).toBe(28)
    expect(line(note, '#TITLE h2')).toBe(28)
  })

  it('takes the first heading with that text, and setext headings by their text', () => {
    expect(line(note, '#Setext 标题')).toBe(23)
    expect(line(note, '#另一个')).toBe(24)
  })

  it('follows #parent#child to a deeper heading after the parent', () => {
    expect(line(note, '#一级#三级')).toBe(9)
    expect(line(note, '#二级：带标点#三级')).toBe(9)
    expect(line(note, '#三级#一级')).toBe(null)
    expect(line(note, '#一级#一级')).toBe(null)
  })

  it('skips headings inside quotes and lists, like the metadata cache', () => {
    expect(line(note, '#引用里的标题')).toBe(null)
  })

  it('finds block ids on paragraphs, list items, quotes and the block before a lone id', () => {
    expect(line(note, '#^p1')).toBe(7)
    expect(line(note, '#^P1')).toBe(7)
    expect(line(note, '#^li')).toBe(12)
    expect(line(note, '#^q1')).toBe(15)
    expect(line(note, '#^after')).toBe(19)
    expect(line(note, '#^h2')).toBe(28)
  })

  it('gives null for a heading or block that does not exist, and for an empty subpath', () => {
    expect(line(note, '#不存在')).toBe(null)
    expect(line(note, '#^nope')).toBe(null)
    expect(line(note, '#')).toBe(null)
    expect(line(note, '')).toBe(null)
  })

  it('needs whitespace before a block id, as Obsidian does', () => {
    expect(line('紧贴的段落^p2\n\n公式 x^2\n', '#^p2')).toBe(null)
    expect(line('紧贴的段落^p2\n\n公式 x^2\n', '#^2')).toBe(null)
    expect(line('段落\n^p3\n', '#^p3')).toBe(0)
  })
})

// The 0-based lines a subpath's range starts and ends on.
function lines(text: string, subpath: string): [number, number] | null {
  const range = subpathRange(text, subpath)
  if (!range) return null
  const lineOf = (at: number): number => text.slice(0, at).split('\n').length - 1
  return [lineOf(range.from), lineOf(range.to)]
}

// The text of a subpath's range.
function part(text: string, subpath: string): string | null {
  const range = subpathRange(text, subpath)
  return range && text.slice(range.from, range.to)
}

describe('subpathRange', () => {
  it('runs a heading to the next heading of the same or a higher level', () => {
    expect(lines(note, '#一级')).toEqual([3, 21])
    expect(lines(note, '#二级：带标点')).toEqual([5, 21])
    expect(lines(note, '#一级#三级')).toEqual([9, 21])
    expect(lines(note, '#Setext 标题')).toEqual([23, 23])
    expect(lines(note, '#另一个')).toEqual([24, 28])
    expect(lines(note, '#title ^h2')).toEqual([28, 28])
  })

  it('leaves out the blank lines before the next heading', () => {
    expect(part(note, '#二级：带标点')?.endsWith('\n^after')).toBe(true)
    expect(part(note, '#Setext 标题')).toBe('# Setext 标题')
  })

  it('covers just the block of a block id', () => {
    expect(part(note, '#^p1')).toBe('段落 ^p1')
    expect(part(note, '#^li')).toBe('- 嵌套项 ^li')
    expect(part(note, '#^after')).toBe('表格前的段落')
    expect(lines(note, '#^q1')).toEqual([15, 17])
  })

  it('gives null where resolveSubpath does', () => {
    expect(subpathRange(note, '#不存在')).toBe(null)
    expect(subpathRange(note, '#^nope')).toBe(null)
    expect(subpathRange(note, '')).toBe(null)
  })
})
