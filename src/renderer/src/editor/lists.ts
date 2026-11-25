import { Decoration, WidgetType } from '@codemirror/view'
import { lineAt, type Renderer } from './preview'

class MarkerWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly kind: 'bullet' | 'ordered' = 'bullet'
  ) {
    super()
  }

  eq(other: MarkerWidget): boolean {
    return other.text === this.text && other.kind === this.kind
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = `mote-list-marker mote-list-marker-${this.kind}`
    span.textContent = this.text
    return span
  }
}

const bullet = Decoration.replace({ widget: new MarkerWidget('•', 'bullet') })
const prefix = Decoration.mark({ class: 'mote-list-prefix' })
const depthLines: Decoration[] = []

// The line of a list item at this depth. Its wrapped lines start where its text starts.
function depthLine(depth: number): Decoration {
  return (depthLines[depth] ??= Decoration.line({
    class: 'mote-list',
    attributes: { style: `--mote-list-depth: ${depth}` }
  }))
}

// A list item's marker with the indentation before it and the space after it. Hidden, the
// marker becomes a bullet or the item's number, indented by depth instead of by spaces. In a
// quote, the indentation starts after the `>` marks, which the quote hides itself.
const listMark: Renderer = (node, cx) => {
  const { doc } = cx.state
  const line = lineAt(cx, node.from)
  let depth = 0
  for (let parent = node.node.parent; parent; parent = parent.parent)
    if (parent.name === 'BulletList' || parent.name === 'OrderedList') depth++
  const before = doc.sliceString(line.from, node.from)
  const quoted = /^(?:[ \t]*>[ \t]?)*/.exec(before)![0].length
  const from = /^[ \t]*$/.test(before.slice(quoted)) ? line.from + quoted : node.from
  const to = /[ \t]/.test(doc.sliceString(node.to, node.to + 1)) ? node.to + 1 : node.to
  const ordered = node.node.parent?.parent?.name === 'OrderedList'
  const marker = ordered
    ? Decoration.replace({
        widget: new MarkerWidget(doc.sliceString(node.from, node.to), 'ordered')
      })
    : bullet
  return [
    {
      reveal: { from: -1, to: -1 },
      always: [depthLine(depth).range(line.from), prefix.range(from, to)],
      concealed: [marker.range(from, to)]
    }
  ]
}

export const listRenderers: Record<string, Renderer> = {
  ListMark: listMark
}
