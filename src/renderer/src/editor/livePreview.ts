import { syntaxTree } from '@codemirror/language'
import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range
} from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { EditorMode, LinkContext, PreviewItem } from './preview'
import { renderers } from './renderers'
import './preview.css'

export const editorMode = Facet.define<EditorMode, EditorMode>({
  combine: (values) => values[0] ?? 'live'
})

export const linkContext = Facet.define<LinkContext, LinkContext | null>({
  combine: (values) => values[0] ?? null
})

const setFocused = StateEffect.define<boolean>()

const focused = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) =>
    tr.effects.reduce((last, effect) => (effect.is(setFocused) ? effect.value : last), value)
})

// items comes from one walk of the syntax tree. shown lists the indexes of items whose source
// shows, in order.
type Preview = { items: PreviewItem[]; shown: number[]; decorations: DecorationSet }

function collect(state: EditorState): PreviewItem[] {
  const cx = { state, links: state.facet(linkContext) }
  const items: PreviewItem[] = []
  syntaxTree(state).iterate({
    enter(node) {
      const render = renderers[node.name]
      if (render) items.push(...render(node, cx))
    }
  })
  return items
}

// The reveal rule: an item shows source only in live preview, while the editor has focus and a
// selection range touches the item's reveal range, boundaries included.
function reveal(state: EditorState, items: PreviewItem[]): number[] {
  if (state.facet(editorMode) === 'reading' || !state.field(focused)) return []
  const ranges = state.selection.ranges
  const shown: number[] = []
  items.forEach(({ reveal }, i) => {
    if (ranges.some((range) => range.from <= reveal.to && range.to >= reveal.from)) shown.push(i)
  })
  return shown
}

function draw(items: PreviewItem[], shown: number[]): DecorationSet {
  const ranges: Range<Decoration>[] = []
  let next = 0
  let blockEnd = -1
  items.forEach((item, i) => {
    const source = shown[next] === i
    if (source) next++
    // Items come in tree order, so those inside a hidden block follow it.
    if (item.reveal.from < blockEnd) return
    ranges.push(...item.always)
    if (source) return
    ranges.push(...item.concealed)
    if (item.block) blockEnd = item.reveal.to
  })
  return Decoration.set(ranges, true)
}

const sameList = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i])

const preview = StateField.define<Preview>({
  create(state) {
    const items = collect(state)
    const shown = reveal(state, items)
    return { items, shown, decorations: draw(items, shown) }
  },
  update(value, tr) {
    const { state, startState } = tr
    const stale =
      tr.docChanged ||
      syntaxTree(state) !== syntaxTree(startState) ||
      state.facet(linkContext) !== startState.facet(linkContext)
    const items = stale ? collect(state) : value.items
    const shown = reveal(state, items)
    if (!stale && sameList(shown, value.shown)) return value
    return { items, shown, decorations: draw(items, shown) }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
})

export const livePreview: Extension = [
  focused,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
  preview
]
