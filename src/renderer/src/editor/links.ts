import { Decoration } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { linkDest, type LinkDest } from '../../../core/linkDest'
import { linkTarget } from '../../../core/markdown'
import {
  hidden,
  marks,
  syntax,
  type PreviewContext,
  type PreviewItem,
  type Renderer
} from './preview'

const kindClass: Record<LinkDest['kind'], string> = {
  note: 'mote-link',
  file: 'mote-link',
  missing: 'mote-link mote-link-missing',
  external: 'mote-link mote-link-external'
}

// The class of a link node, from where a click on it goes. A link that can go nowhere keeps the
// look of its kind: missing inside the vault, external outside it. Null for a node that is not
// a link, such as a reference link.
export function linkClass(node: SyntaxNode, cx: PreviewContext): string | null {
  const target = linkTarget(node, (from, to) => cx.state.doc.sliceString(from, to))
  if (!target) return null
  const dest = cx.links && linkDest(target, cx.links.path, cx.links.index, cx.links.config)
  if (dest) return kindClass[dest.kind]
  return kindClass[target.kind === 'external' ? 'external' : cx.links ? 'missing' : 'note']
}

// The text a link shows, keyed for clicks by where the link node starts.
export function linkMark(
  item: PreviewItem,
  className: string,
  start: number,
  from: number,
  to: number
): void {
  const attributes = { 'data-link-from': String(start) }
  item.always.push(Decoration.mark({ class: className, attributes }).range(from, to))
}

// [[target#subpath|alias]] shows the alias, or the target when it has none.
const wikiLink: Renderer = (node, cx) => {
  const className = linkClass(node.node, cx)
  if (!className) return []
  const inner = cx.state.doc.sliceString(node.from + 2, node.to - 2)
  const bar = inner.indexOf('|')
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
    linkMark(item, className, node.from, node.from, node.to)
    return [item]
  }
  linkMark(item, className, node.from, textFrom, textTo)
  if (bar >= 0) {
    const targetFrom = node.from + 2
    const targetTo = node.from + 2 + bar
    if (targetFrom < targetTo) {
      linkMark(item, className, node.from, targetFrom, targetTo)
    }
  }
  return [
    marks(item, [
      { from: node.from, to: textFrom },
      { from: textTo, to: node.to }
    ])
  ]
}

// [label](destination "title") shows the label. Reference links stay as source.
const markdownLink: Renderer = (node, cx) => {
  const className = linkClass(node.node, cx)
  const [open, close] = node.node.getChildren('LinkMark')
  if (!className || !close) return []
  const item: PreviewItem = { reveal: { from: node.from, to: node.to }, always: [], concealed: [] }
  const url = node.node.getChild('URL')

  if (open.to >= close.from) {
    if (url) {
      if (node.from < url.from) item.always.push(syntax.range(node.from, url.from))
      linkMark(item, className, node.from, url.from, url.to)
      if (url.to < node.to) item.always.push(syntax.range(url.to, node.to))
      return [item]
    }
    linkMark(item, className, node.from, node.from, node.to)
    return [item]
  }

  linkMark(item, className, node.from, open.to, close.from)
  if (url) {
    item.concealed.push(hidden.range(node.from, open.to))
    item.concealed.push(hidden.range(close.from, node.to))
    item.always.push(syntax.range(node.from, open.to))
    if (close.from < url.from) item.always.push(syntax.range(close.from, url.from))
    linkMark(item, className, node.from, url.from, url.to)
    if (url.to < node.to) item.always.push(syntax.range(url.to, node.to))
    return [item]
  }

  return [
    marks(item, [
      { from: node.from, to: open.to },
      { from: close.from, to: node.to }
    ])
  ]
}

// <https://example.com> shows the address without its angle brackets.
const autolink: Renderer = (node, cx) => {
  const className = linkClass(node.node, cx)
  const url = node.node.getChild('URL')
  if (!className || !url) return []
  const item: PreviewItem = { reveal: { from: node.from, to: node.to }, always: [], concealed: [] }
  linkMark(item, className, node.from, url.from, url.to)
  return [
    marks(item, [
      { from: node.from, to: url.from },
      { from: url.to, to: node.to }
    ])
  ]
}

// GFM's bare addresses. linkTarget leaves a URL inside another link to that link.
const bareUrl: Renderer = (node, cx) => {
  const className = linkClass(node.node, cx)
  if (!className) return []
  const item: PreviewItem = { reveal: { from: node.from, to: node.to }, always: [], concealed: [] }
  linkMark(item, className, node.from, node.from, node.to)
  return [item]
}

export const linkRenderers: Record<string, Renderer> = {
  WikiLink: wikiLink,
  Link: markdownLink,
  Autolink: autolink,
  URL: bareUrl
}
