import { Decoration } from '@codemirror/view'
import { lineAt, marks, type PreviewItem, type Renderer } from './preview'

const lines = [1, 2, 3, 4, 5, 6].map((level) => Decoration.line({ class: `mote-h mote-h${level}` }))

// `## Title ##`: the opening #s and the space after them, and any closing #s with the space
// before them. They reveal with the heading's line.
function atx(level: number): Renderer {
  return (node, cx) => {
    const { doc } = cx.state
    const line = lineAt(cx, node.from)
    const item: PreviewItem = {
      reveal: line,
      always: [lines[level - 1].range(line.from)],
      concealed: []
    }
    const ranges = node.node.getChildren('HeaderMark').map((mark, i) => {
      if (i === 0)
        return {
          from: mark.from,
          to: /[ \t]/.test(doc.sliceString(mark.to, mark.to + 1)) ? mark.to + 1 : mark.to
        }
      let from = mark.from
      while (from > node.from && /[ \t]/.test(doc.sliceString(from - 1, from))) from--
      return { from, to: mark.to }
    })
    return [marks(item, ranges)]
  }
}

// Text over a line of = or -. The underline line and the break before it hide together.
function setext(level: number): Renderer {
  return (node, cx) => {
    const { doc } = cx.state
    const underline = node.node.getChild('HeaderMark')
    const last = doc.lineAt(underline ? underline.from : node.to)
    const item: PreviewItem = {
      reveal: { from: doc.lineAt(node.from).from, to: last.to },
      always: [],
      concealed: []
    }
    for (let pos = node.from; pos < last.from; pos = doc.lineAt(pos).to + 1)
      item.always.push(lines[level - 1].range(doc.lineAt(pos).from))
    if (!underline) return [item]
    return [marks(item, [{ from: last.from - 1, to: last.to }])]
  }
}

export const headingRenderers: Record<string, Renderer> = {
  ATXHeading1: atx(1),
  ATXHeading2: atx(2),
  ATXHeading3: atx(3),
  ATXHeading4: atx(4),
  ATXHeading5: atx(5),
  ATXHeading6: atx(6),
  SetextHeading1: setext(1),
  SetextHeading2: setext(2)
}
