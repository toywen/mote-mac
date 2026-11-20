import { parser as commonmark, type BlockParser, type InlineParser } from '@lezer/markdown'
import type { SyntaxNode } from '@lezer/common'
import { parse as parseYaml } from 'yaml'
import type { LinkRef } from './model.ts'

const BANG = 33
const BRACKET = 91

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
  {
    defineNodes: ['WikiLink', 'WikiEmbed', { name: 'Frontmatter', block: true }],
    parseInline: [wikiLink],
    parseBlock: [frontmatter]
  }
])

function wikiRef(inner: string, embed: boolean, from: number, to: number): LinkRef {
  const bar = inner.indexOf('|')
  const alias = bar < 0 ? null : inner.slice(bar + 1)
  const body = bar < 0 ? inner : inner.slice(0, bar)
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
