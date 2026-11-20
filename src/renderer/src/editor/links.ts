import { Decoration } from '@codemirror/view'
import { resolveLink } from '../../../core/resolve'
import { marks, type PreviewContext, type PreviewItem, type Renderer } from './preview'

type LinkKind = 'note' | 'missing' | 'external'

const kindClass: Record<LinkKind, string> = {
  note: 'mote-link',
  missing: 'mote-link mote-link-missing',
  external: 'mote-link mote-link-external'
}

// Same test as extractLinks in src/core/markdown.ts: a scheme means the link leaves the vault.
const external = /^[a-z][a-z0-9+.-]*:/i

function decode(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function noteKind(cx: PreviewContext, target: string): LinkKind {
  if (!cx.links) return 'note'
  return resolveLink(cx.links.index, target, cx.links.path) ? 'note' : 'missing'
}

// The text a link shows, keyed for later clicks by where the link node starts.
function linkText(
  item: PreviewItem,
  kind: LinkKind,
  start: number,
  from: number,
  to: number
): void {
  const attributes = { 'data-link-from': String(start) }
  item.always.push(Decoration.mark({ class: kindClass[kind], attributes }).range(from, to))
}

// [[target#subpath|alias]] shows the alias, or the target when it has none. Splitting follows
// wikiRef in src/core/markdown.ts, which drops one `\` before the `|` that tables need.
const wikiLink: Renderer = (node, cx) => {
  const inner = cx.state.doc.sliceString(node.from + 2, node.to - 2)
  const bar = inner.indexOf('|')
  const path = bar < 0 ? inner : inner.slice(0, bar)
  const body = path.endsWith('\\') ? path.slice(0, -1) : path
  const hash = body.indexOf('#')
  const kind = noteKind(cx, hash < 0 ? body : body.slice(0, hash))
  // Obsidian trims the alias it shows. With no alias it shows the inner text as written.
  let textFrom = bar < 0 ? node.from + 2 : node.from + 3 + bar
  let textTo = node.to - 2
  if (bar >= 0) {
    const alias = inner.slice(bar + 1)
    textFrom += alias.length - alias.trimStart().length
    textTo -= alias.length - alias.trimEnd().length
  }
  const item: PreviewItem = { reveal: { from: node.from, to: node.to }, always: [], concealed: [] }
  if (textFrom >= textTo) {
    linkText(item, kind, node.from, node.from, node.to)
    return [item]
  }
  linkText(item, kind, node.from, textFrom, textTo)
  return [
    marks(item, [
      { from: node.from, to: textFrom },
      { from: textTo, to: node.to }
    ])
  ]
}

// [label](destination "title") shows the label. Reference links stay as source.
const markdownLink: Renderer = (node, cx) => {
  const url = node.node.getChild('URL')
  const [open, close] = node.node.getChildren('LinkMark')
  if (!url || !close) return []
  let dest = cx.state.doc.sliceString(url.from, url.to)
  if (dest.startsWith('<') && dest.endsWith('>')) dest = dest.slice(1, -1)
  const hash = dest.indexOf('#')
  const kind = external.test(dest)
    ? 'external'
    : noteKind(cx, decode(hash < 0 ? dest : dest.slice(0, hash)))
  const item: PreviewItem = { reveal: { from: node.from, to: node.to }, always: [], concealed: [] }
  if (open.to >= close.from) {
    linkText(item, kind, node.from, node.from, node.to)
    return [item]
  }
  linkText(item, kind, node.from, open.to, close.from)
  return [
    marks(item, [
      { from: node.from, to: open.to },
      { from: close.from, to: node.to }
    ])
  ]
}

// <https://example.com> shows the address without its angle brackets.
const autolink: Renderer = (node) => {
  const url = node.node.getChild('URL')
  if (!url) return []
  const item: PreviewItem = { reveal: { from: node.from, to: node.to }, always: [], concealed: [] }
  linkText(item, 'external', node.from, url.from, url.to)
  return [
    marks(item, [
      { from: node.from, to: url.from },
      { from: url.to, to: node.to }
    ])
  ]
}

// GFM's bare addresses. A URL inside another link belongs to that link.
const bareUrl: Renderer = (node) => {
  const parent = node.node.parent?.name
  if (
    parent === 'Link' ||
    parent === 'Image' ||
    parent === 'Autolink' ||
    parent === 'LinkReference'
  )
    return []
  const item: PreviewItem = { reveal: { from: node.from, to: node.to }, always: [], concealed: [] }
  linkText(item, 'external', node.from, node.from, node.to)
  return [item]
}

export const linkRenderers: Record<string, Renderer> = {
  WikiLink: wikiLink,
  Link: markdownLink,
  Autolink: autolink,
  URL: bareUrl
}
