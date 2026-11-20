import { Decoration, WidgetType } from '@codemirror/view'
import { lineAt, marks, type PreviewItem, type Renderer } from './preview'

const quoteLine = Decoration.line({ class: 'mote-quote' })

// Every line of a quote, lazy continuation lines included, gets the quote's border.
const blockquote: Renderer = (node, cx) => {
  const { doc } = cx.state
  const item: PreviewItem = { reveal: { from: node.from, to: node.to }, always: [], concealed: [] }
  for (let pos = node.from; pos <= node.to; pos = doc.lineAt(pos).to + 1)
    item.always.push(quoteLine.range(doc.lineAt(pos).from))
  return [item]
}

// `>` and the space after it reveal with their line.
const quoteMark: Renderer = (node, cx) => {
  const after = /[ \t]/.test(cx.state.doc.sliceString(node.to, node.to + 1)) ? 1 : 0
  const item: PreviewItem = { reveal: lineAt(cx, node.from), always: [], concealed: [] }
  return [marks(item, [{ from: node.from, to: node.to + after }])]
}

class RuleWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'mote-hr'
    return span
  }
}

const rule = Decoration.replace({ widget: new RuleWidget() })

const horizontalRule: Renderer = (node, cx) => [
  { reveal: lineAt(cx, node.from), always: [], concealed: [rule.range(node.from, node.to)] }
]

export const quoteRenderers: Record<string, Renderer> = {
  Blockquote: blockquote,
  QuoteMark: quoteMark,
  HorizontalRule: horizontalRule
}
