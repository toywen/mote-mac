import { describe, expect, it } from 'vitest'
import { extractLinks, markdownParser } from './markdown.ts'
import { sourceText } from './text.ts'

const slice = (text: string, link: { range: { from: number; to: number } }): string =>
  text.slice(link.range.from, link.range.to)

// The source text of every node with this name, in document order.
function nodes(text: string, name: string): string[] {
  const found: string[] = []
  markdownParser.parse(text).iterate({
    enter(node) {
      if (node.name === name) found.push(text.slice(node.from, node.to))
    }
  })
  return found
}

describe('markdownParser', () => {
  it('parses tables into rows and cells', () => {
    const text = '| a | b |\n| --- | --- |\n| 一 | [[Readme]] |'
    expect(nodes(text, 'Table')).toEqual([text])
    expect(nodes(text, 'TableHeader')).toEqual(['| a | b |'])
    expect(nodes(text, 'TableRow')).toEqual(['| 一 | [[Readme]] |'])
    expect(nodes(text, 'TableCell')).toEqual(['a', 'b', '一', '[[Readme]]'])
  })

  it('parses task markers', () => {
    const text = '- [ ] 待办\n- [x] 完成\n- 普通'
    expect(nodes(text, 'Task')).toEqual(['[ ] 待办', '[x] 完成'])
    expect(nodes(text, 'TaskMarker')).toEqual(['[ ]', '[x]'])
  })

  it('parses strikethrough with its marks', () => {
    const text = '有 ~~删除~~ 的字'
    expect(nodes(text, 'Strikethrough')).toEqual(['~~删除~~'])
    expect(nodes(text, 'StrikethroughMark')).toEqual(['~~', '~~'])
  })

  it('parses highlights with their marks, and needs text right after the opening mark', () => {
    const text = '有 ==高亮== 和 ==另一处== 的字'
    expect(nodes(text, 'Highlight')).toEqual(['==高亮==', '==另一处=='])
    expect(nodes(text, 'HighlightMark')).toEqual(['==', '==', '==', '=='])
    expect(nodes('a == b == c', 'Highlight')).toEqual([])
    expect(nodes('没有结尾 ==高亮', 'Highlight')).toEqual([])
  })

  it('parses tags after whitespace, at the line start, and right after a link', () => {
    expect(nodes('#标签 和 #a/b', 'Tag')).toEqual(['#标签', '#a/b'])
    expect(nodes('[[欢迎]]#紧跟', 'Tag')).toEqual(['#紧跟'])
    expect(nodes('#1a 结尾 #标签,后面', 'Tag')).toEqual(['#1a', '#标签'])
  })

  it('does not take headings, numbers, mid-word hashes, subpaths, URLs or code as tags', () => {
    for (const text of [
      '# 标题',
      '#123',
      'a#b',
      '[[欢迎#节]]',
      '[c](https://e.com/#x)',
      '看 https://e.com/a#b',
      '`#代码`',
      '```\n#代码块\n```'
    ])
      expect(nodes(text, 'Tag'), text).toEqual([])
  })

  it('parses a bare URL as a URL node', () => {
    expect(nodes('看 https://example.com/a#b 吧', 'URL')).toEqual(['https://example.com/a#b'])
  })
})

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

  it('reads the escaped pipe that Obsidian writes for an alias inside a table', () => {
    const text = '| a | b |\n| --- | --- |\n| [[欢迎\\|别名]] | [[欢迎#标题\\|节]] |'
    const links = extractLinks(text)
    expect(links.map((l) => [l.target, l.subpath, l.alias])).toEqual([
      ['欢迎', null, '别名'],
      ['欢迎', '#标题', '节']
    ])
    expect(slice(text, links[0])).toBe('[[欢迎\\|别名]]')
  })

  it('finds links inside highlights and strikethrough, and next to tags', () => {
    const text = '==[[a]]== ~~[[b]]~~ #标签 [[c]]#紧跟'
    expect(extractLinks(text).map((l) => l.target)).toEqual(['a', 'b', 'c'])
  })

  it('takes no link from a bare URL, and still finds a wikilink after it', () => {
    const text = '看 https://example.com/a [[Readme]]，以及 https://example.com/[[不算]]'
    expect(extractLinks(text).map((l) => l.target)).toEqual(['Readme'])
  })

  it('reports ranges in normalized text for CRLF and BOM notes', () => {
    const { text } = sourceText('\uFEFFone\r\n[[two]]\r\n')
    expect(slice(text, extractLinks(text)[0])).toBe('[[two]]')
  })
})
