import { Decoration, WidgetType } from '@codemirror/view'
import {
  Bug,
  Check,
  CircleCheck,
  CircleQuestionMark,
  ClipboardList,
  createElement,
  Flame,
  Info,
  List,
  Pencil,
  Quote,
  TriangleExclamationPoint,
  X,
  Zap,
  type IconNode
} from 'lucide'
import { calloutHeader } from '../../../core/markdown'
import { lineAt, type PreviewItem, type Renderer } from './preview'
import { quoteRenderers } from './quotes'
import './callouts.css'

// Every kind uses the accent color, as ink on paper does. Only the icon tells kinds apart.
type CalloutKind = { icon: IconNode }

// Ported from Obsidian 1.15.1 app.css: one .callout[data-callout=...] rule per kind, with its
// --callout-icon. A rule's other names are aliases of its kind.
const kinds: [string[], CalloutKind][] = [
  [['note'], { icon: Pencil }],
  [['abstract', 'summary', 'tldr'], { icon: ClipboardList }],
  [['info'], { icon: Info }],
  [['todo'], { icon: CircleCheck }],
  [['tip', 'hint', 'important'], { icon: Flame }],
  [['success', 'check', 'done'], { icon: Check }],
  [['question', 'help', 'faq'], { icon: CircleQuestionMark }],
  [['warning', 'caution', 'attention'], { icon: TriangleExclamationPoint }],
  [['failure', 'fail', 'missing'], { icon: X }],
  [['danger', 'error'], { icon: Zap }],
  [['bug'], { icon: Bug }],
  [['example'], { icon: List }],
  [['quote', 'cite'], { icon: Quote }]
]

const kindOf = new Map(kinds.flatMap(([names, kind]) => names.map((name) => [name, kind] as const)))
// Obsidian draws an unknown type as a note.
const note = kinds[0][1]

// The `[!type]` marks become the kind's icon, followed by the title when the line has none.
class HeaderWidget extends WidgetType {
  constructor(
    readonly kind: CalloutKind,
    readonly title: string | null
  ) {
    super()
  }

  eq(other: HeaderWidget): boolean {
    return other.kind === this.kind && other.title === this.title
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'mote-callout-header'
    span.append(
      createElement(this.kind.icon, { class: 'mote-callout-icon', 'aria-hidden': 'true' })
    )
    if (this.title !== null) span.append(this.title)
    return span
  }
}

const lines = new Map<string, Decoration>()

function calloutLine(edge: string): Decoration {
  let line = lines.get(edge)
  if (!line) {
    line = Decoration.line({ class: `mote-callout ${edge}`.trim() })
    lines.set(edge, line)
  }
  return line
}

const quote = quoteRenderers.Blockquote

// A blockquote whose first line is `> [!type] title` is a callout; any other goes to the quote
// renderer. Every line keeps its text, so the body stays editable and its inline elements
// render. On the first line only the `[!type]` marks hide, and they show while the selection
// touches that line. The `>` marks follow the quote rule.
const blockquote: Renderer = (node, cx) => {
  const { doc } = cx.state
  const first = lineAt(cx, node.from)
  const header = calloutHeader(doc.sliceString(node.from, first.to))
  if (!header) return quote(node, cx)
  const kind = kindOf.get(header.type) ?? note
  const start = doc.lineAt(node.from).number
  const end = doc.lineAt(node.to).number
  const item: PreviewItem = { reveal: first, always: [], concealed: [] }
  for (let n = start; n <= end; n++) {
    const edge = [n === start && 'mote-callout-title', n === end && 'mote-callout-last']
    item.always.push(calloutLine(edge.filter(Boolean).join(' ')).range(doc.line(n).from))
  }
  const titled = header.marks.to < first.to - node.from
  const widget = new HeaderWidget(kind, titled ? null : header.title)
  item.concealed.push(
    Decoration.replace({ widget }).range(node.from + header.marks.from, node.from + header.marks.to)
  )
  return [item]
}

export const calloutRenderers: Record<string, Renderer> = {
  Blockquote: blockquote
}
