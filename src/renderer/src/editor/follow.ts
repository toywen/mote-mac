import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { linkDest, type LinkDest } from '../../../core/linkDest'
import { frontmatterLinks, linkTarget, type LinkTarget } from '../../../core/markdown'
import { linkContext, showsSource } from './livePreview'
import './follow.css'

type Found = { from: number; to: number; target: LinkTarget }

// The link node that starts at from, read with linkTarget.
function linkAt(state: EditorState, from: number): Found | null {
  const read = (a: number, b: number): string => state.doc.sliceString(a, b)
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1);
    node;
    node = node.parent
  ) {
    if (node.from !== from) continue
    const target = linkTarget(node, read)
    if (target) return { from: node.from, to: node.to, target }
  }
  return null
}

// The link that covers pos: a link node, or a link in the properties block.
function linkCovering(state: EditorState, pos: number): Found | null {
  const read = (a: number, b: number): string => state.doc.sliceString(a, b)
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    if (node.name === 'Frontmatter') {
      const ref = frontmatterLinks(read(node.from, node.to), node.from).find(
        ({ range }) => range.from <= pos && pos < range.to
      )
      return ref ? { ...ref.range, target: { kind: 'vault', ref } } : null
    }
    const target = linkTarget(node, read)
    if (target) return { from: node.from, to: node.to, target }
  }
  return null
}

// The link under a mouse event. A plain click takes a rendered link that is not showing its
// source. Cmd+click takes any link under the pointer.
function linkUnder(view: EditorView, event: MouseEvent): Found | null {
  const element = event.target instanceof Element ? event.target.closest('[data-link-from]') : null
  const rendered =
    element && view.dom.contains(element)
      ? linkAt(view.state, Number(element.getAttribute('data-link-from')))
      : null
  if (!event.metaKey)
    return rendered && !showsSource(view.state, rendered.from, rendered.to) ? rendered : null
  if (rendered) return rendered
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
  return pos === null ? null : linkCovering(view.state, pos)
}

// Clicking a link follows it. The mousedown is taken before CodeMirror sees it, so the selection
// does not move into the link, and the link follows when the click ends on it. Listening on the
// editor's own element also reaches links that widgets draw.
export function followLinks(follow: (dest: LinkDest) => void): Extension {
  return ViewPlugin.define((view) => {
    let pressed: Found | null = null
    const plain = (event: MouseEvent): boolean =>
      event.button === 0 && !event.shiftKey && !event.altKey && !event.ctrlKey
    const mousedown = (event: MouseEvent): void => {
      pressed = plain(event) ? linkUnder(view, event) : null
      if (pressed) event.preventDefault()
    }
    const click = (event: MouseEvent): void => {
      const link = pressed
      pressed = null
      if (!link || !plain(event) || linkUnder(view, event)?.from !== link.from) return
      event.preventDefault()
      const context = view.state.facet(linkContext)
      const dest = context && linkDest(link.target, context.path, context.index, context.config)
      if (dest) follow(dest)
    }
    view.dom.addEventListener('mousedown', mousedown, true)
    view.dom.addEventListener('click', click, true)
    return {
      destroy() {
        view.dom.removeEventListener('mousedown', mousedown, true)
        view.dom.removeEventListener('click', click, true)
      }
    }
  })
}
