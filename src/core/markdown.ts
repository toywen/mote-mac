import {
  Autolink,
  parser as commonmark,
  Strikethrough,
  Table,
  TaskList,
  type BlockParser,
  type DelimiterType,
  type InlineContext,
  type InlineParser
} from '@lezer/markdown'
import type { SyntaxNode } from '@lezer/common'
import { parse as parseYaml } from 'yaml'
import type { LinkRef } from './model.ts'

const BANG = 33
const HASH = 35
const EQUALS = 61
const BRACKET = 91
const LOWER_H = 104

const wikiLink: InlineParser = {
  name: 'WikiLink',
  before: 'Escape',
  parse(cx, next, pos) {
    const embed = next === BANG
    const open = embed ? pos + 1 : pos
    if (cx.char(open) !== BRACKET || cx.char(open + 1) !== BRACKET) return -1
    const close = cx.slice(open + 2, cx.end).indexOf(']]')
    if (close < 0) return -1
    const end = open + 2 + close + 2
    if (cx.slice(open + 2, end - 2).includes('\n')) return -1
    return cx.addElement(cx.elt(embed ? 'WikiEmbed' : 'WikiLink', pos, end))
  }
}

const highlightDelimiter: DelimiterType = { resolve: 'Highlight', mark: 'HighlightMark' }

// Ported from Obsidian 1.15.1 worker.js go: a highlight opened at `open` closes at the first
// later `==` with no whitespace before it. Returns that position, or -1.
function highlightClose(cx: InlineContext, open: number): number {
  let at = cx.text.indexOf('==', open - cx.offset + 3)
  while (at >= 0 && /\s/.test(cx.text[at - 1])) at = cx.text.indexOf('==', at + 1)
  return at < 0 ? -1 : at + cx.offset
}

// `==` opens unless whitespace or `==` follows it or nothing closes it. Highlights never nest:
// an open one ends only at its own close.
const highlight: InlineParser = {
  name: 'Highlight',
  parse(cx, next, pos) {
    if (next !== EQUALS || cx.char(pos + 1) !== EQUALS) return -1
    const last = cx.findOpeningDelimiter(highlightDelimiter)
    const opener = last === null ? null : cx.getDelimiterAt(last)
    if (opener) {
      const close = highlightClose(cx, opener.from)
      if (close === pos) return cx.addDelimiter(highlightDelimiter, pos, pos + 2, false, true)
      if (close > pos) return -1
    }
    const after = cx.slice(pos + 2, pos + 4)
    if (/^\s/.test(after) || after === '==' || highlightClose(cx, pos) < 0) return -1
    return cx.addDelimiter(highlightDelimiter, pos, pos + 2, true, false)
  }
}

// Ported from Obsidian 1.15.1 worker.js: the tag tokenizer yo with its pattern ei and its
// all-digits check bo, and the inline locator Mo, which tries `#` only after whitespace or
// where the previous token ended, as in `[[a]]#b`.
const tagBody = /[^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+/y

// lezer keeps the elements and delimiters before `pos` in `parts`, which its typings leave out.
function afterToken(cx: InlineContext, pos: number): boolean {
  const parts = (cx as unknown as { parts?: readonly ({ to: number } | null)[] }).parts ?? []
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i]) return parts[i]?.to === pos
  return false
}

const tag: InlineParser = {
  name: 'Tag',
  parse(cx, next, pos) {
    if (next !== HASH) return -1
    const at = pos - cx.offset
    if (at > 0 && !/\s/.test(cx.text[at - 1]) && !afterToken(cx, pos)) return -1
    tagBody.lastIndex = at + 1
    const body = tagBody.exec(cx.text)?.[0]
    if (!body || /^\d+$/.test(body)) return -1
    return cx.addElement(cx.elt('Tag', pos, pos + 1 + body.length))
  }
}

// GFM Autolink tests a regex at every character and also links `www.` hosts and email
// addresses. mote links only http and https URLs, so GFM's parser runs only where one starts.
const gfmAutolink = (Autolink.parseInline ?? [])[0]
const bareUrl: InlineParser = {
  name: 'Autolink',
  parse(cx, next, pos) {
    if (next !== LOWER_H || !/^https?:\/\//.test(cx.slice(pos, pos + 8))) return -1
    return gfmAutolink.parse(cx, next, pos)
  }
}

const frontmatter: BlockParser = {
  name: 'Frontmatter',
  before: 'HorizontalRule',
  parse(cx, line) {
    if (cx.lineStart !== 0 || line.text !== '---') return false
    const start = cx.lineStart
    while (cx.nextLine()) {
      if (line.text === '---') {
        const end = cx.lineStart + line.text.length
        cx.nextLine()
        cx.addElement(cx.elt('Frontmatter', start, end))
        return true
      }
    }
    return false
  }
}

export const markdownParser = commonmark.configure([
  Table,
  TaskList,
  Strikethrough,
  {
    defineNodes: [
      'WikiLink',
      'WikiEmbed',
      'Highlight',
      'HighlightMark',
      'Tag',
      { name: 'Frontmatter', block: true }
    ],
    parseInline: [wikiLink, highlight, tag, bareUrl],
    parseBlock: [frontmatter]
  }
])

// Obsidian 1.15.1 worker.js It drops one `\` at the end of the link path, so the
// `[[note\|alias]]` that Obsidian writes inside a table links to `note`.
function wikiRef(inner: string, embed: boolean, from: number, to: number): LinkRef {
  const bar = inner.indexOf('|')
  const alias = bar < 0 ? null : inner.slice(bar + 1)
  const path = bar < 0 ? inner : inner.slice(0, bar)
  const body = path.endsWith('\\') ? path.slice(0, -1) : path
  const hash = body.indexOf('#')
  return {
    syntax: 'wiki',
    embed,
    target: hash < 0 ? body : body.slice(0, hash),
    subpath: hash < 0 ? null : body.slice(hash),
    alias,
    range: { from, to }
  }
}

function decode(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function markdownRef(node: SyntaxNode, text: string): LinkRef | null {
  const url = node.getChild('URL')
  if (!url) return null
  let dest = text.slice(url.from, url.to)
  if (dest.startsWith('<') && dest.endsWith('>')) dest = dest.slice(1, -1)
  if (external.test(dest)) return null
  const hash = dest.indexOf('#')
  const marks = node.getChildren('LinkMark')
  const label = marks.length >= 2 ? text.slice(marks[0].to, marks[1].from) : ''
  return {
    syntax: 'markdown',
    embed: node.name === 'Image',
    target: decode(hash < 0 ? dest : dest.slice(0, hash)),
    subpath: hash < 0 ? null : decode(dest.slice(hash)),
    alias: label || null,
    range: { from: node.from, to: node.to }
  }
}

const external = /^[a-z][a-z0-9+.-]*:/i
const markdownValue = /^\[([^\]]*)\]\((.*)\)$/

// Ported from Obsidian 1.15.1 QK: a property value is a link only when the whole string is one.
// Frontmatter that the yaml package rejects yields no links, as in Obsidian.
function frontmatterLinks(block: string, offset: number): LinkRef[] {
  const body = block.slice(block.indexOf('\n') + 1, block.lastIndexOf('\n'))
  let data: unknown
  try {
    data = parseYaml(body)
  } catch {
    return []
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const links: LinkRef[] = []
  let cursor = 0
  const place = (value: string): { from: number; to: number } => {
    const at = block.indexOf(value, cursor)
    if (at < 0) return { from: offset, to: offset }
    cursor = at + value.length
    return { from: offset + at, to: offset + at + value.length }
  }
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.startsWith('[[') && value.endsWith(']]')) {
        const range = place(value)
        links.push(wikiRef(value.slice(2, -2), false, range.from, range.to))
      }
      const match = value.match(markdownValue)
      if (match) {
        let dest = match[2]
        if (dest.startsWith('<') && dest.endsWith('>')) dest = dest.slice(1, -1).trim()
        if (!external.test(dest)) {
          const range = place(value)
          const hash = dest.indexOf('#')
          links.push({
            syntax: 'markdown',
            embed: false,
            target: decode(hash < 0 ? dest : dest.slice(0, hash)),
            subpath: hash < 0 ? null : dest.slice(hash),
            alias: match[1] || null,
            range
          })
        }
      }
    } else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(data)
  return links
}

export function extractLinks(text: string): LinkRef[] {
  const links: LinkRef[] = []
  markdownParser.parse(text).iterate({
    enter(node) {
      switch (node.name) {
        case 'WikiLink':
        case 'WikiEmbed': {
          const embed = node.name === 'WikiEmbed'
          const inner = text.slice(node.from + (embed ? 3 : 2), node.to - 2)
          links.push(wikiRef(inner, embed, node.from, node.to))
          return false
        }
        case 'Link':
        case 'Image': {
          const ref = markdownRef(node.node, text)
          if (ref) links.push(ref)
          return false
        }
        case 'Frontmatter': {
          links.push(...frontmatterLinks(text.slice(node.from, node.to), node.from))
          return false
        }
        default:
          return undefined
      }
    }
  })
  return links
}
