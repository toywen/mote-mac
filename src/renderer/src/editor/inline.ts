import { Decoration } from '@codemirror/view'
import { marks, type PreviewItem, type Renderer } from './preview'

// Inline styles: the node, the class its text gets, and the child node of its Markdown marks.
// Table cells render their text from this table too, so it stays data.
export const inlineStyles: Record<string, { class: string; mark: string }> = {
  StrongEmphasis: { class: 'mote-strong', mark: 'EmphasisMark' },
  Emphasis: { class: 'mote-em', mark: 'EmphasisMark' },
  Strikethrough: { class: 'mote-strike', mark: 'StrikethroughMark' },
  Highlight: { class: 'mote-highlight', mark: 'HighlightMark' },
  InlineCode: { class: 'mote-code', mark: 'CodeMark' }
}

function inlineStyle(style: { class: string; mark: string }): Renderer {
  const text = Decoration.mark({ class: style.class })
  return (node) => {
    const ranges: { from: number; to: number }[] = []
    for (let child = node.node.firstChild; child; child = child.nextSibling)
      if (child.name === style.mark) ranges.push(child)
    const item: PreviewItem = {
      reveal: { from: node.from, to: node.to },
      always: [text.range(node.from, node.to)],
      concealed: []
    }
    return [marks(item, ranges)]
  }
}

const tag = Decoration.mark({ class: 'mote-tag' })

export const inlineRenderers: Record<string, Renderer> = {
  ...Object.fromEntries(
    Object.entries(inlineStyles).map(([name, style]) => [name, inlineStyle(style)])
  ),
  Tag: (node) => [
    {
      reveal: { from: node.from, to: node.to },
      always: [tag.range(node.from, node.to)],
      concealed: []
    }
  ]
}
