import { describe, expect, it } from 'vitest'
import { extractLinks } from './markdown.ts'
import { sourceText } from './text.ts'

const slice = (text: string, link: { range: { from: number; to: number } }): string =>
  text.slice(link.range.from, link.range.to)

describe('extractLinks', () => {
  it('splits wikilinks into target, subpath and alias, with exact ranges', () => {
    const text = '看 [[欢迎#标题|别名]] 和 ![[图片.png]]'
    const [wiki, embed] = extractLinks(text)
    expect(wiki).toMatchObject({
      syntax: 'wiki',
      embed: false,
      target: '欢迎',
      subpath: '#标题',
      alias: '别名'
    })
    expect(slice(text, wiki)).toBe('[[欢迎#标题|别名]]')
    expect(embed).toMatchObject({ syntax: 'wiki', embed: true, target: '图片.png' })
    expect(slice(text, embed)).toBe('![[图片.png]]')
  })

  it('decodes Markdown links and skips external ones', () => {
    const text = '[a](../带%20空格.md#节) [b](<x y.md>) [c](https://e.com) ![d](p.png)'
    expect(extractLinks(text).map((l) => [l.target, l.subpath, l.embed])).toEqual([
      ['../带 空格.md', '#节', false],
      ['x y.md', null, false],
      ['p.png', null, true]
    ])
  })

  it('ignores links in inline code and code blocks', () => {
    const text = '`[[a]]`\n\n```\n[[b]]\n```\n\n[[c]]'
    expect(extractLinks(text).map((l) => l.target)).toEqual(['c'])
  })

  it('takes property links only from whole string values of valid YAML', () => {
    const text = '---\nq: "[[A]]"\nl:\n  - [[B]]\nm: "[x](C.md)"\n---\n[[D]]'
    const links = extractLinks(text)
    expect(links.map((l) => l.target)).toEqual(['A', 'C.md', 'D'])
    expect(slice(text, links[0])).toBe('[[A]]')
    expect(extractLinks('---\nq: "[[A]]"\nbad: [x\n---\n[[D]]').map((l) => l.target)).toEqual(['D'])
  })

  it('reports ranges in normalized text for CRLF and BOM notes', () => {
    const { text } = sourceText('\uFEFFone\r\n[[two]]\r\n')
    expect(slice(text, extractLinks(text)[0])).toBe('[[two]]')
  })
})
