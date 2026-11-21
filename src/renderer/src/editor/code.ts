import { Decoration } from '@codemirror/view'
import type { Range } from '@codemirror/state'
import { frontmatterRenderer } from './frontmatter'
import { marks, type PreviewContext, type PreviewItem, type Renderer } from './preview'

function lineClasses(extra: string): Record<'only' | 'first' | 'middle' | 'last', Decoration> {
  const line = (edge: string): Decoration =>
    Decoration.line({ class: `mote-codeblock ${extra} ${edge}`.replace(/\s+/g, ' ').trim() })
  return {
    only: line('mote-codeblock-first mote-codeblock-last'),
    first: line('mote-codeblock-first'),
    middle: line(''),
    last: line('mote-codeblock-last')
  }
}

const codeLines = lineClasses('')
const propertyLines = lineClasses('mote-properties')

// A background and a monospace font on every line from the line at from to the line at to.
function block(
  cx: PreviewContext,
  from: number,
  to: number,
  classes: typeof codeLines
): Range<Decoration>[] {
  const { doc } = cx.state
  const first = doc.lineAt(from)
  const last = doc.lineAt(to)
  const ranges: Range<Decoration>[] = []
  for (let n = first.number; n <= last.number; n++) {
    const edge =
      first.number === last.number
        ? 'only'
        : n === first.number
          ? 'first'
          : n === last.number
            ? 'last'
            : 'middle'
    ranges.push(classes[edge].range(doc.line(n).from))
  }
  return ranges
}

// Fences hide while the selection is outside the block. Code is not highlighted.
const fencedCode: Renderer = (node, cx) => {
  const { doc } = cx.state
  const item: PreviewItem = {
    reveal: { from: node.from, to: node.to },
    always: block(cx, node.from, node.to, codeLines),
    concealed: []
  }
  // The opening fence with its info string, and the closing fence when there is one.
  const fences = node.node.getChildren('CodeMark')
  return [
    marks(
      item,
      fences.map((mark) => ({ from: mark.from, to: doc.lineAt(mark.from).to }))
    )
  ]
}

const indentedCode: Renderer = (node, cx) => [
  {
    reveal: { from: node.from, to: node.to },
    always: block(cx, node.from, node.to, codeLines),
    concealed: []
  }
]

// Properties stay plain YAML text that can be edited. Only the --- lines hide.
const properties: Renderer = (node, cx) => {
  const { doc } = cx.state
  const first = doc.lineAt(node.from)
  const last = doc.lineAt(node.to)
  const item: PreviewItem = {
    reveal: { from: node.from, to: node.to },
    always: block(cx, node.from, node.to, propertyLines),
    concealed: []
  }
  return [
    marks(item, [
      { from: first.from, to: first.to },
      { from: last.from, to: last.to }
    ])
  ]
}

const frontmatter: Renderer = (node, cx) => {
  const card = frontmatterRenderer(node, cx)
  if (card.length > 0) return card
  return properties(node, cx)
}

export const codeRenderers: Record<string, Renderer> = {
  FencedCode: fencedCode,
  CodeBlock: indentedCode,
  Frontmatter: frontmatter
}
