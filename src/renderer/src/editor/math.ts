import { Decoration, WidgetType } from '@codemirror/view'
import katex from 'katex'
import type { Renderer } from './preview'
import './math.css'

class InlineMathWidget extends WidgetType {
  constructor(readonly math: string) {
    super()
  }

  eq(other: InlineMathWidget): boolean {
    return other.math === this.math
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'mote-math-inline'
    try {
      katex.render(this.math, span, { displayMode: false, throwOnError: false })
    } catch {
      span.textContent = `$${this.math}$`
    }
    return span
  }

  ignoreEvent(): boolean {
    return false
  }
}

class BlockMathWidget extends WidgetType {
  constructor(readonly math: string) {
    super()
  }

  eq(other: BlockMathWidget): boolean {
    return other.math === this.math
  }

  toDOM(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'mote-math-block'
    try {
      katex.render(this.math, div, { displayMode: true, throwOnError: false })
    } catch {
      div.textContent = `$$${this.math}$$`
    }
    return div
  }

  ignoreEvent(): boolean {
    return false
  }
}

const inlineMathRenderer: Renderer = (node, cx) => {
  const raw = cx.state.doc.sliceString(node.from, node.to)
  const formula = raw.slice(1, -1)
  const widget = new InlineMathWidget(formula)
  return [
    {
      reveal: { from: node.from, to: node.to },
      always: [],
      concealed: [Decoration.replace({ widget }).range(node.from, node.to)]
    }
  ]
}

const blockMathRenderer: Renderer = (node, cx) => {
  const { doc } = cx.state
  const first = doc.lineAt(node.from)
  const block = /^[ \t]*$/.test(doc.sliceString(first.from, node.from))
  const from = block ? first.from : node.from
  const to = block ? doc.lineAt(node.to).to : node.to
  let raw = doc.sliceString(from, to).trim()
  if (raw.startsWith('$$')) raw = raw.slice(2)
  if (raw.endsWith('$$')) raw = raw.slice(0, -2)
  const widget = new BlockMathWidget(raw.trim())
  return [
    {
      reveal: { from, to },
      always: [],
      concealed: [Decoration.replace({ widget, block }).range(from, to)],
      block: true
    }
  ]
}

export const mathRenderers: Record<string, Renderer> = {
  InlineMath: inlineMathRenderer,
  BlockMath: blockMathRenderer
}
