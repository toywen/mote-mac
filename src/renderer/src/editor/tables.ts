import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { linkTarget, type LinkTarget, type ReadText } from '../../../core/markdown'
import { resolveLink } from '../../../core/resolve'
import { inlineStyles } from './inline'
import type { LinkContext, Renderer } from './preview'
import './tables.css'

// About the height of a one-line row in the real window. Rows that wrap are taller.
const rowHeight = 30

type Draw = { read: ReadText; links: LinkContext | null }

function element(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// Appends the text of [from, to) to parent with the child nodes of node in that range drawn.
// Children named skip, such as the marks of an emphasis, are left out.
function appendInline(
  parent: HTMLElement,
  node: SyntaxNode,
  from: number,
  to: number,
  draw: Draw,
  skip?: string
): void {
  let pos = from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue
    if (child.from > pos) parent.append(draw.read(pos, child.from))
    if (child.name !== skip) parent.append(inline(child, draw))
    pos = child.to
  }
  if (pos < to) parent.append(draw.read(pos, to))
}

// A link shows what it shows in the text: a wiki link its alias or its target, a Markdown link
// its label. Like the links renderer, it carries where its node starts, for clicks.
function link(node: SyntaxNode, target: LinkTarget, draw: Draw): HTMLElement {
  const { links } = draw
  const missing =
    target.kind === 'vault' && links && !resolveLink(links.index, target.ref.target, links.path)
  const span = element(
    'span',
    target.kind === 'external'
      ? 'mote-link mote-link-external'
      : missing
        ? 'mote-link mote-link-missing'
        : 'mote-link'
  )
  span.dataset.linkFrom = String(node.from)
  const [open, close] = node.getChildren('LinkMark')
  const url = node.getChild('URL')
  if (target.kind === 'vault' && node.name === 'WikiLink')
    span.append(target.ref.alias?.trim() || target.ref.target + (target.ref.subpath ?? ''))
  else if (node.name === 'Link' && close && open.to < close.from)
    appendInline(span, node, open.to, close.from, draw)
  else if (node.name === 'Autolink' && url) span.append(draw.read(url.from, url.to))
  else span.append(draw.read(node.from, node.to))
  return span
}

const linkNodes = new Set(['WikiLink', 'Link', 'Autolink', 'URL'])

// One inline node of a cell, built from the same tables as the live preview: inlineStyles for
// emphasis, strikethrough, highlight and code, the tag class, and the link classes. Any other
// node, such as an image or HTML, shows its source.
function inline(node: SyntaxNode, draw: Draw): Node {
  const style = inlineStyles[node.name]
  if (style) {
    const span = element('span', style.class)
    appendInline(span, node, node.from, node.to, draw, style.mark)
    return span
  }
  if (node.name === 'Tag') return element('span', 'mote-tag', draw.read(node.from, node.to))
  // `\|` stands for a pipe inside a cell.
  if (node.name === 'Escape') return document.createTextNode(draw.read(node.from + 1, node.to))
  const target = linkNodes.has(node.name) ? linkTarget(node, draw.read) : null
  if (target) return link(node, target, draw)
  return document.createTextNode(draw.read(node.from, node.to))
}

// The cells of a header or body row, empty ones included. at is where a click puts the cursor:
// after the cell's text, or inside an empty cell.
function rowCells(row: SyntaxNode): {
  node: SyntaxNode | null
  from: number
  to: number
  at: number
}[] {
  const cells: { node: SyntaxNode | null; from: number; to: number; at: number }[] = []
  let cell: SyntaxNode | null = null
  let after = row.from
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableCell') cell = child
    if (child.name !== 'TableDelimiter') continue
    // A leading pipe opens the first cell instead of closing one.
    if (cell || child.from > row.from)
      cells.push(
        cell
          ? { node: cell, from: cell.from, to: cell.to, at: cell.to }
          : {
              node: null,
              from: Math.min(after + 1, child.from),
              to: Math.min(after + 1, child.from),
              at: Math.min(after + 1, child.from)
            }
      )
    cell = null
    after = child.to
  }
  if (cell) cells.push({ node: cell, from: cell.from, to: cell.to, at: cell.to })
  return cells
}

// The delimiter row's alignment for each column: `:--` left, `:-:` center, `--:` right.
function alignments(delimiters: string): string[] {
  return delimiters
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((part) => {
      const left = part.trim().startsWith(':')
      const right = part.trim().endsWith(':')
      return left && right ? 'center' : right ? 'right' : left ? 'left' : ''
    })
}

class TableWidget extends WidgetType {
  constructor(
    readonly table: SyntaxNode,
    readonly from: number,
    readonly source: string,
    readonly links: LinkContext | null,
    readonly rows: number
  ) {
    super()
  }

  // Typing elsewhere in the note leaves the table's DOM alone.
  eq(other: TableWidget): boolean {
    return other.source === this.source && other.from === this.from && other.links === this.links
  }

  // Typing above the table only moves it, so its links' offsets shift.
  updateDOM(dom: HTMLElement, _view: EditorView, from: TableWidget): boolean {
    if (from.source !== this.source || from.links !== this.links) return false
    for (const link of dom.querySelectorAll<HTMLElement>('[data-link-from]'))
      link.dataset.linkFrom = String(Number(link.dataset.linkFrom) + this.from - from.from)
    return true
  }

  get estimatedHeight(): number {
    return this.rows * rowHeight
  }

  // Clicks on links reach the editor, which follows them. The widget handles the rest.
  ignoreEvent(event: Event): boolean {
    if (event.target instanceof Element && event.target.closest('[contenteditable="true"]')) {
      return true
    }
    return !(event.target instanceof Element && event.target.closest('.mote-link'))
  }

  toDOM(view: EditorView): HTMLElement {
    const draw: Draw = {
      read: (from, to) => this.source.slice(from - this.from, to - this.from),
      links: this.links
    }
    const isEditable = view.state.facet(EditorView.editable)
    const delimiters = this.table.getChild('TableDelimiter')
    const align = delimiters ? alignments(draw.read(delimiters.from, delimiters.to)) : []
    const wrap = element('div', 'mote-table-wrap')
    const table = wrap.appendChild(element('table', 'mote-table'))

    const commitCell = (cell: HTMLElement): void => {
      if (!isEditable) return
      const currentVal = (cell.textContent ?? '').replace(/\r?\n/g, ' ').trim()
      const origVal = (cell.dataset.original ?? '').trim()
      if (currentVal === origVal) return
      const sanitized = currentVal.replace(/\|/g, '\\|')
      const cellFrom = Number(cell.dataset.cellFrom)
      const cellTo = Number(cell.dataset.cellTo)
      const docFrom = this.from + cellFrom
      const docTo = this.from + cellTo
      cell.dataset.original = sanitized
      view.dispatch({
        changes: { from: docFrom, to: docTo, insert: sanitized },
        userEvent: 'input'
      })
    }

    let columns = 0
    let body: HTMLElement | null = null
    for (let row = this.table.firstChild; row; row = row.nextSibling) {
      const header = row.name === 'TableHeader'
      if (!header && row.name !== 'TableRow') continue
      const cells = rowCells(row)
      if (header) columns = cells.length
      const parent = header
        ? table.appendChild(element('thead'))
        : (body ??= table.appendChild(element('tbody')))
      const tr = parent.appendChild(element('tr'))
      // Like GFM, a body row has as many cells as the header.
      for (let i = 0; i < columns; i++) {
        const cell = tr.appendChild(element(header ? 'th' : 'td'))
        if (align[i]) cell.style.textAlign = align[i]
        const { node, from, to, at } = cells[i] ?? {
          node: null,
          from: row.to,
          to: row.to,
          at: row.to
        }
        if (node) appendInline(cell, node, node.from, node.to, draw)
        cell.dataset.at = String(at - this.from)
        cell.dataset.cellFrom = String(from - this.from)
        cell.dataset.cellTo = String(to - this.from)
        cell.dataset.original = node ? draw.read(from, to) : ''

        if (isEditable) {
          cell.contentEditable = 'true'
          cell.spellcheck = false
          cell.tabIndex = 0

          cell.addEventListener('focus', () => {
            const raw = cell.dataset.original ?? ''
            if (cell.textContent !== raw) {
              cell.textContent = raw
            }
            const range = document.createRange()
            range.selectNodeContents(cell)
            range.collapse(false)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
          })

          cell.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
              e.preventDefault()
              commitCell(cell)
              const allCells = Array.from(
                wrap.querySelectorAll<HTMLElement>('[contenteditable="true"]')
              )
              const idx = allCells.indexOf(cell)
              const nextIdx = e.shiftKey ? idx - 1 : idx + 1
              if (nextIdx >= 0 && nextIdx < allCells.length) {
                allCells[nextIdx].focus()
              }
            } else if (e.key === 'Enter') {
              e.preventDefault()
              commitCell(cell)
              const currentRow = cell.closest('tr')
              const targetRow = e.shiftKey
                ? (currentRow?.previousElementSibling as HTMLTableRowElement | null)
                : (currentRow?.nextElementSibling as HTMLTableRowElement | null)
              if (targetRow) {
                const colIndex = Array.from(currentRow?.children ?? []).indexOf(cell)
                const targetCell = targetRow.children[colIndex] as HTMLElement | undefined
                if (targetCell?.isContentEditable) targetCell.focus()
                else cell.blur()
              } else {
                cell.blur()
              }
            }
          })

          cell.addEventListener('blur', () => {
            commitCell(cell)
          })
        }
      }
    }
    wrap.addEventListener('mousedown', (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.mote-link')) return
      if (target?.closest('[contenteditable="true"]')) {
        return
      }
      if (event.button !== 0) return
      if (!view.state.facet(EditorView.editable)) return
    })
    return wrap
  }
}

// A table is one widget in both editor modes. It shows its source while the selection is in it.
// A table that starts its line is drawn between lines. One inside a quote or a list item stays
// in its line, after the marks that line starts with.
const table: Renderer = (node, cx) => {
  const { doc } = cx.state
  const first = doc.lineAt(node.from)
  const block = /^[ \t]*$/.test(doc.sliceString(first.from, node.from))
  const from = block ? first.from : node.from
  const to = block ? doc.lineAt(node.to).to : node.to
  const rows = node.node.getChildren('TableRow').length + 1
  const widget = new TableWidget(node.node, from, doc.sliceString(from, to), cx.links, rows)
  return [
    {
      reveal: { from: 0, to: 0 },
      always: [],
      concealed: [Decoration.replace({ widget, block }).range(from, to)],
      block: true
    }
  ]
}

export const tableRenderers: Record<string, Renderer> = {
  Table: table
}
