import type { EditorState, Range } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'
import type { VaultConfig, VaultPath } from '../../../core/ipc'
import type { LinkIndex } from '../../../core/resolve'

export type EditorMode = 'live' | 'reading'

// One element the preview draws.
export type PreviewItem = {
  // The element shows its source while a selection touches this range.
  reveal: { from: number; to: number }
  // When set, the element never reveals its source (e.g. a table edited in place).
  neverReveal?: true
  // Applies whether or not the source shows, such as a font style.
  always: Range<Decoration>[]
  // Applies only while the source is hidden: hidden marks, or a widget in their place.
  concealed: Range<Decoration>[]
  // While hidden, the element replaces its whole reveal range, so items inside it are dropped.
  block?: true
}

// Links resolve against the vault's files, as seen from the open note. The config says where a
// missing note would be created.
export type LinkContext = { index: LinkIndex; path: VaultPath; config: VaultConfig }

export type PreviewContext = { state: EditorState; links: LinkContext | null }

export type Renderer = (node: SyntaxNodeRef, cx: PreviewContext) => PreviewItem[]

export const hidden = Decoration.replace({})

// Markdown syntax while its element shows source.
export const syntax = Decoration.mark({ class: 'mote-syntax' })

// The line around pos, for marks that reveal with their line.
export function lineAt(cx: PreviewContext, pos: number): { from: number; to: number } {
  const line = cx.state.doc.lineAt(pos)
  return { from: line.from, to: line.to }
}

// Hides each [from, to) and shows it as syntax while revealed.
export function marks(item: PreviewItem, ranges: { from: number; to: number }[]): PreviewItem {
  for (const { from, to } of ranges) {
    if (from >= to) continue
    item.always.push(syntax.range(from, to))
    item.concealed.push(hidden.range(from, to))
  }
  return item
}
