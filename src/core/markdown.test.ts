import { describe, expect, it } from 'vitest'
import {
  calloutHeader,
  extractLinks,
  linkTarget,
  markdownParser,
  type CalloutHeader,
  type LinkTarget
} from './markdown.ts'
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
  it('parses inline and block math formulas', () => {
    expect(nodes('质能方程 $E = mc^2$ 在这里', 'InlineMath')).toEqual(['$E = mc^2$'])
    expect(nodes('普通 $ 价格 $100 元', 'InlineMath')).toEqual([])
    expect(nodes('$$x^2 + y^2 = z^2$$', 'BlockMath')).toEqual(['$$x^2 + y^2 = z^2$$'])
    const multiline = '$$\n\\frac{a}{b} = c\n$$'
    expect(nodes(multiline, 'BlockMath')).toEqual([multiline])
  })

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

  it('parses a bare http or https URL as a URL node, and no other bare address', () => {
    expect(nodes('看 https://example.com/a#b 吧', 'URL')).toEqual(['https://example.com/a#b'])
    expect(nodes('看http://e.com。', 'URL')).toEqual(['http://e.com'])
    expect(nodes('www.example.com 和 a@example.com', 'URL')).toEqual([])
  })
})

// Notes written to probe edge cases, with what Obsidian 1.15.1 reports for them in
// metadataCache.getFileCache: tags, and each link's path and display text.
describe('agreement with Obsidian on edge cases', () => {
  const boundary =
    "# 边界\n\n| 列 | 值 |\n| --- | --- |\n| 转义 | [[欢迎\\|别名]] |\n| 普通 | [[欢迎]] |\n| 未转义 | [[欢迎|别名二]] |\n| 标题 | [[欢迎#标题\\|节]] |\n\n==[[欢迎]]== ~~[[欢迎]]~~\n\n#标签 [[欢迎]] [[欢迎]]#紧跟 **粗**#粗后 ==高==#高后 a#b #123 #1a #a/b/c #中文，后面 x\n\n#行首\n\n- [ ] 任务 #待办\n> 引用 #引用中\n\nhttps://example.com/a [[欢迎]] https://example.com/[[欢迎]] https://e.com/#frag\n\n`#code` [x](#h) \\#esc #a-b_c #emoji🎉 #a.b #a'b #x—y\n## 标题里 #头\n#尾\n"
  const escapes =
    '正文 [[欢迎\\|别名]] 和 [[欢迎\\\\|双]] 和 [[a\\b]] 和 [[欢迎\\]]\n\n| 列 | 值 |\n| --- | --- |\n| 双反斜杠 | [[欢迎\\\\|双表]] |\n| 尾 | [[欢迎\\]] |\n'

  it('finds the same tags', () => {
    expect(nodes(boundary, 'Tag')).toEqual([
      '#标签',
      '#紧跟',
      '#粗后',
      '#高后',
      '#1a',
      '#a/b/c',
      '#中文，后面',
      '#行首',
      '#待办',
      '#引用中',
      '#a-b_c',
      '#emoji🎉',
      '#a',
      '#a',
      '#x',
      '#头',
      '#尾'
    ])
    expect(nodes(escapes, 'Tag')).toEqual([])
  })

  it('finds the same link paths', () => {
    const paths = (text: string): string[] =>
      extractLinks(text).map((l) => l.target + (l.subpath ?? ''))
    expect(paths(boundary)).toEqual([
      '欢迎',
      '欢迎',
      '欢迎#标题',
      '欢迎',
      '欢迎',
      '欢迎',
      '欢迎',
      '欢迎',
      '#h'
    ])
    expect(paths(escapes)).toEqual(['欢迎', '欢迎\\', 'a\\b', '欢迎', '欢迎'])
  })

  // Known difference. Obsidian lets a URL run to the next space, as the GFM spec says, so the
  // wikilink below is part of the URL. @lezer/markdown ends a URL with no path at its domain.
  it.fails('takes no link from a wikilink glued to a URL that has no path', () => {
    expect(extractLinks('https://example.com[[欢迎]]')).toEqual([])
  })

  it('finds the same aliases', () => {
    const aliases = (text: string): string[] =>
      extractLinks(text).flatMap((l) => (l.alias === null ? [] : [l.alias]))
    expect(aliases(boundary)).toEqual(['别名', '节', 'x'])
    expect(aliases(escapes)).toEqual(['别名', '双'])
  })
})

// linkTarget of the first node with this name.
function targetOf(text: string, name: string): LinkTarget | null {
  let found: LinkTarget | null = null
  markdownParser.parse(text).iterate({
    enter(node) {
      if (node.name !== name) return undefined
      found = linkTarget(node.node, (from, to) => text.slice(from, to))
      return false
    }
  })
  return found
}

describe('linkTarget', () => {
  it('reads a wikilink and an embed as vault links', () => {
    expect(targetOf('看 [[欢迎#标题|别名]]', 'WikiLink')).toEqual({
      kind: 'vault',
      ref: {
        syntax: 'wiki',
        embed: false,
        target: '欢迎',
        subpath: '#标题',
        alias: '别名',
        range: { from: 2, to: 14 }
      }
    })
    expect(targetOf('![[图片.png|300]]', 'WikiEmbed')).toMatchObject({
      kind: 'vault',
      ref: { embed: true, target: '图片.png', alias: '300' }
    })
  })

  it('reads a Markdown link and image as vault links, with the label as alias', () => {
    expect(targetOf('[计划](项目/计划.md#目标)', 'Link')).toMatchObject({
      kind: 'vault',
      ref: {
        syntax: 'markdown',
        embed: false,
        target: '项目/计划.md',
        subpath: '#目标',
        alias: '计划'
      }
    })
    expect(targetOf('![图|300](附件/图片.png)', 'Image')).toMatchObject({
      kind: 'vault',
      ref: { embed: true, target: '附件/图片.png', alias: '图|300' }
    })
  })

  it('reads addresses outside the vault as external', () => {
    expect(targetOf('[c](https://e.com/#x)', 'Link')).toEqual({
      kind: 'external',
      url: 'https://e.com/#x'
    })
    expect(targetOf('![d](https://e.com/p.png)', 'Image')).toEqual({
      kind: 'external',
      url: 'https://e.com/p.png'
    })
    expect(targetOf('<https://e.com/y>', 'Autolink')).toEqual({
      kind: 'external',
      url: 'https://e.com/y'
    })
    expect(targetOf('<a@example.com>', 'Autolink')).toEqual({
      kind: 'external',
      url: 'mailto:a@example.com'
    })
    expect(targetOf('看 https://example.com/a 吧', 'URL')).toEqual({
      kind: 'external',
      url: 'https://example.com/a'
    })
  })

  it('gives null for a URL inside another link, a reference link and other nodes', () => {
    expect(targetOf('[c](https://e.com)', 'URL')).toBeNull()
    expect(targetOf('[引用][r]\n\n[r]: https://e.com', 'Link')).toBeNull()
    expect(targetOf('**粗**', 'StrongEmphasis')).toBeNull()
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

// The header of each blockquote, read from its first line as the editor reads it.
function callouts(text: string): (CalloutHeader | null)[] {
  const found: (CalloutHeader | null)[] = []
  markdownParser.parse(text).iterate({
    enter(node) {
      if (node.name !== 'Blockquote') return
      const end = text.indexOf('\n', node.from)
      found.push(calloutHeader(text.slice(node.from, end < 0 ? text.length : end)))
    }
  })
  return found
}

describe('calloutHeader', () => {
  it('reads the type, the title, and where the marks before the title sit', () => {
    const line = '> [!warning] 注意 **粗体**'
    expect(calloutHeader(line)).toEqual({
      type: 'warning',
      title: '注意 **粗体**',
      marks: { from: 2, to: line.indexOf('注意') }
    })
    expect(calloutHeader('>[!tip]   提示  ')).toEqual({
      type: 'tip',
      title: '提示',
      marks: { from: 1, to: 10 }
    })
  })

  it('makes the title from the type when the line has none, as Obsidian shows it', () => {
    const note = { from: 2, to: 9 }
    expect(calloutHeader('> [!note]')).toEqual({ type: 'note', title: 'Note', marks: note })
    expect(calloutHeader('> [!NOTE]  ')?.marks).toEqual({ from: 2, to: 11 })
    expect(calloutHeader('> [!My Own  type]')).toEqual({
      type: 'my-own-type',
      title: 'My own type',
      marks: { from: 2, to: 17 }
    })
  })

  it('takes a fold mark, and metadata after a bar', () => {
    expect(calloutHeader('> [!tip]- 折叠')).toEqual({
      type: 'tip',
      title: '折叠',
      marks: { from: 2, to: 10 }
    })
    expect(calloutHeader('> [!tip]+')).toEqual({
      type: 'tip',
      title: 'Tip',
      marks: { from: 2, to: 9 }
    })
    expect(calloutHeader('> [!info|wide] 宽')?.type).toBe('info')
  })

  it('keeps an alias or an unknown type as written, for the editor to look up', () => {
    expect(calloutHeader('> [!tldr]')).toMatchObject({ type: 'tldr', title: 'Tldr' })
    expect(calloutHeader('> [!未知类型] 未知')).toMatchObject({ type: '未知类型', title: '未知' })
  })

  it('gives null for a plain quote and for marks Obsidian does not read as a callout', () => {
    expect(calloutHeader('> 普通引用')).toBeNull()
    expect(calloutHeader('> [!note]没有空格')).toBeNull()
    expect(calloutHeader('>  [!note] 两个空格')).toBeNull()
    expect(calloutHeader('> [note] 少了感叹号')).toBeNull()
    expect(calloutHeader('[!note] 不是引用')).toBeNull()
  })

  it('reads only the first line of a blockquote, and the innermost quote of a nested one', () => {
    expect(callouts('> 第一行\n> [!note] 第二行')).toEqual([null])
    const nested = callouts('> [!tip] 外层\n> > [!warning] 内层\n> > 正文')
    expect(nested.map((h) => h?.type)).toEqual(['tip', 'warning'])
    expect(callouts('> > [!note] 只在内层').map((h) => h?.type ?? null)).toEqual([null, 'note'])
  })
})
