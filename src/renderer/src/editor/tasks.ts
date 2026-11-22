import { Facet, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { lineAt, type Renderer } from './preview'
import './tasks.css'

// True while mote is busy, for example saving a note before it opens another. A checkbox click
// then changes nothing.
export const editorLocked = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean)
})

// Writes the other state into the one character between the brackets at from. A normal change,
// so undo and autosave treat it like typing. It works in reading mode too.
function toggle(view: EditorView, from: number): void {
  const { state } = view
  if (state.facet(editorLocked) || !isMarker(state, from)) return
  const checked = state.doc.sliceString(from + 1, from + 2) !== ' '
  view.dispatch({
    changes: { from: from + 1, to: from + 2, insert: checked ? ' ' : 'x' },
    userEvent: 'input'
  })
}

const isMarker = (state: EditorState, from: number): boolean =>
  /^\[.\]$/.test(state.doc.sliceString(from, from + 3))

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly label: string
  ) {
    super()
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.label === this.label
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span')
    box.className = 'mote-task-box'
    const input = box.appendChild(document.createElement('input'))
    input.type = 'checkbox'
    input.checked = this.checked
    input.setAttribute('aria-label', this.label)
    // The editor keeps its selection and focus. The note, not the input, holds the state.
    input.addEventListener('mousedown', (event) => event.preventDefault())
    input.addEventListener('click', (event) => {
      event.preventDefault()
      toggle(view, view.posAtDOM(box))
    })
    return box
  }
}

const bulletTask = Decoration.line({ class: 'mote-task mote-task-bullet' })
const orderedTask = Decoration.line({ class: 'mote-task' })
const done = Decoration.mark({ class: 'mote-task-done' })

// `[ ]` or `[x]` and the space after it become a checkbox, which takes the bullet's place. Any
// character but a space reads as checked, and a checked task's text is struck through. Like
// the list mark before it, the marker shows its source with its line.
const taskMarker: Renderer = (node, cx) => {
  const { doc } = cx.state
  const task = node.node.parent
  const line = lineAt(cx, node.from)
  const checked = doc.sliceString(node.from + 1, node.from + 2) !== ' '
  const end = /[ \t]/.test(doc.sliceString(node.to, node.to + 1)) ? node.to + 1 : node.to
  const label = doc.sliceString(end, line.to).trim()
  const bullet = task?.parent?.parent?.name === 'BulletList'
  const widget = Decoration.replace({ widget: new CheckboxWidget(checked, label) })
  const always = [(bullet ? bulletTask : orderedTask).range(line.from)]
  if (checked && task && task.to > end) always.push(done.range(end, task.to))
  return [{ reveal: { from: -1, to: -1 }, always, concealed: [widget.range(node.from, end)] }]
}

export const taskRenderers: Record<string, Renderer> = {
  TaskMarker: taskMarker
}
