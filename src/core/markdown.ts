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

const DOLLAR = 36

const inlineMath: InlineParser = {
  name: 'InlineMath',
  before: 'Escape',
  parse(cx, next, pos) {
    if (next !== DOLLAR || cx.char(pos + 1) === DOLLAR) return -1
    if (pos > cx.offset && cx.char(pos - 1) === 92) return -1
    const nextChar = cx.slice(pos + 1, pos + 2)
    if (!nextChar || /^\s/.test(nextChar) || nextChar === '$') return -1
    const rest = cx.slice(pos + 1, cx.end)
    const newline = rest.indexOf('\n')
    const limit = newline >= 0 ? newline : rest.length
    let close = -1
    for (let i = 0; i < limit; i++) {
      if (rest.charCodeAt(i) === DOLLAR && (i === 0 || rest.charCodeAt(i - 1) !== 92)) {
        if (!/\s/.test(rest[i - 1])) {
          close = i
          break
        }
      }
    }
    if (close < 0) return -1
    return cx.addElement(cx.elt('InlineMath', pos, pos + 1 + close + 1))
  }
}

const blockMath: BlockParser = {
  name: 'BlockMath',
  before: 'HorizontalRule',
  parse(cx, line) {
    const trimmed = line.text.trim()
    if (!trimmed.startsWith('$$')) return false
    const start = cx.lineStart
    if (
      trimmed.length > 2 &&
      trimmed.endsWith('$$') &&
      trimmed.indexOf('$$', 2) === trimmed.length - 2
    ) {
      const end = cx.lineStart + line.text.length
      cx.nextLine()
      cx.addElement(cx.elt('BlockMath', start, end))
      return true
    }
    while (cx.nextLine()) {
      if (line.text.trim().endsWith('$$')) {
        const end = cx.lineStart + line.text.length
        cx.nextLine()
        cx.addElement(cx.elt('BlockMath', start, end))
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
      'InlineMath',
      { name: 'BlockMath', block: true },
      { name: 'Frontmatter', block: true }
    ],
    parseInline: [wikiLink, highlight, tag, bareUrl, inlineMath],
    parseBlock: [frontmatter, blockMath]
  }
])

// A callout's first line. type is lowercased with runs of whitespace as `-`. title is the title
// Obsidian shows. marks is where `[!type]`, its fold mark and the spaces after them sit in the
// line; it runs to the line's end when the line has no title of its own.
export type CalloutHeader = { type: string; title: string; marks: { from: number; to: number } }

// Ported from Obsidian 1.15.1 app.js: the blockquote tokenizer $ue reads the first line after
// `>` and one space with the pattern Kue, and rfe makes the title from the type when the line
// has none. line is a blockquote's first line from its `>`. Returns null for a plain quote.
export function calloutHeader(line: string): CalloutHeader | null {
  const from = /^[ \t]*> ?/.exec(line)?.[0].length
  if (from === undefined) return null
  const marks = /^\[!([^\]]+)\]([+-]?)(?:\s|$)/.exec(line.slice(from))
  if (!marks) return null
  const type = marks[1].split('|')[0].trim().toLowerCase().replace(/\s+/g, '-')
  const rest = line.slice(from + marks[0].length)
  const title = rest.trim()
  if (title) return { type, title, marks: { from, to: line.length - rest.trimStart().length } }
  const name = type.replace(/-/g, ' ')
  const shown = name.charAt(0).toUpperCase() + name.slice(1)
  return { type, title: shown, marks: { from, to: line.length } }
}

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

// What one link node points at: a file in the vault, or an address outside it.
export type LinkTarget = { kind: 'vault'; ref: LinkRef } | { kind: 'external'; url: string }

// Reads [from, to) of the text the node was parsed from.
export type ReadText = (from: number, to: number) => string

function markdownTarget(node: SyntaxNode, read: ReadText): LinkTarget | null {
  const url = node.getChild('URL')
  if (!url) return null
  let dest = read(url.from, url.to)
  if (dest.startsWith('<') && dest.endsWith('>')) dest = dest.slice(1, -1)
  if (external.test(dest)) return { kind: 'external', url: dest }
  const hash = dest.indexOf('#')
  const marks = node.getChildren('LinkMark')
  const label = marks.length >= 2 ? read(marks[0].to, marks[1].from) : ''
  return {
    kind: 'vault',
    ref: {
      syntax: 'markdown',
      embed: node.name === 'Image',
      target: decode(hash < 0 ? dest : dest.slice(0, hash)),
      subpath: hash < 0 ? null : decode(dest.slice(hash)),
      alias: label || null,
      range: { from: node.from, to: node.to }
    }
  }
}

const insideLink = new Set(['Link', 'Image', 'Autolink', 'LinkReference'])

// The target of a WikiLink, WikiEmbed, Link, Image, Autolink or bare URL node. Null for any
// other node, for a URL that is part of another link, and for a Link or Image with no
// destination, such as a reference link. The editor and extractLinks both read links here.
export function linkTarget(node: SyntaxNode, read: ReadText): LinkTarget | null {
  switch (node.name) {
    case 'WikiLink':
    case 'WikiEmbed': {
      const embed = node.name === 'WikiEmbed'
      const inner = read(node.from + (embed ? 3 : 2), node.to - 2)
      return { kind: 'vault', ref: wikiRef(inner, embed, node.from, node.to) }
    }
    case 'Link':
    case 'Image':
      return markdownTarget(node, read)
    case 'Autolink': {
      const url = node.getChild('URL')
      if (!url) return null
      const address = read(url.from, url.to)
      // CommonMark lets <name@example.com> stand for a mailto address.
      return { kind: 'external', url: external.test(address) ? address : 'mailto:' + address }
    }
    case 'URL':
      if (insideLink.has(node.parent?.name ?? '')) return null
      return { kind: 'external', url: read(node.from, node.to) }
    default:
      return null
  }
}

const external = /^[a-z][a-z0-9+.-]*:/i
const markdownValue = /^\[([^\]]*)\]\((.*)\)$/

// Ported from Obsidian 1.15.1 QK: a property value is a link only when the whole string is one.
// Frontmatter that the yaml package rejects yields no links, as in Obsidian. block is the text of
// a Frontmatter node that starts at offset.
export function frontmatterLinks(block: string, offset: number): LinkRef[] {
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
  const read: ReadText = (from, to) => text.slice(from, to)
  markdownParser.parse(text).iterate({
    enter(node) {
      switch (node.name) {
        case 'WikiLink':
        case 'WikiEmbed':
        case 'Link':
        case 'Image': {
          const target = linkTarget(node.node, read)
          if (target?.kind === 'vault') links.push(target.ref)
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
