import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Text
} from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { useLayoutEffect, useRef } from 'react'
import type { VaultPath } from '../../core/ipc'
import { workspace } from './workspace'

function sourceText(raw: string): { text: string; format: LineFormat } {
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
  const breaks: string[] = []
  const text = raw.slice(bom.length).replace(/\r\n?|\n/g, (separator) => {
    breaks.push(separator)
    return '\n'
  })
  return { text, format: { bom, breaks, preferred: breaks[0] ?? '\n' } }
}

type LineFormat = { bom: string; breaks: string[]; preferred: string }
const replaceFormat = StateEffect.define<LineFormat>()

const lineFormat = StateField.define<LineFormat>({
  create: () => ({ bom: '', breaks: [], preferred: '\n' }),
  update(format, transaction) {
    const explicit = transaction.effects.find((effect) => effect.is(replaceFormat))
    if (explicit?.is(replaceFormat)) return explicit.value
    if (!transaction.docChanged) return format
    const old = transaction.startState.doc
    const breaks: string[] = []
    let cursor = 0
    transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      const lastUnchanged = old.lineAt(from).number - 1
      for (; cursor < lastUnchanged; cursor++) breaks.push(format.breaks[cursor])
      for (let line = 1; line < inserted.lines; line++) breaks.push(format.preferred)
      cursor = old.lineAt(to).number - 1
    })
    for (; cursor < format.breaks.length; cursor++) breaks.push(format.breaks[cursor])
    return { ...format, breaks }
  }
})

function serialize(doc: Text, format: LineFormat): string {
  let index = 0
  return (
    format.bom + doc.toString().replace(/\n/g, () => format.breaks[index++] ?? format.preferred)
  )
}

export function NoteEditor({
  path,
  source,
  locked
}: {
  path: VaultPath
  source: { text: string }
  locked: boolean
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView>(null)
  const readOnly = useRef(new Compartment())

  useLayoutEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      extensions: [
        lineFormat,
        readOnly.current.of(EditorState.readOnly.of(false)),
        history(),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              void workspace.save()
              return true
            }
          },
          ...defaultKeymap,
          ...historyKeymap
        ]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          'aria-label': '编辑器',
          'data-note-path': path,
          spellcheck: 'false'
        }),
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged &&
            !update.transactions.some((transaction) =>
              transaction.effects.some((effect) => effect.is(replaceFormat))
            )
          ) {
            workspace.edit(path, serialize(update.state.doc, update.state.field(lineFormat)))
          }
        })
      ]
    })
    editor.current = view
    return () => {
      view.destroy()
      editor.current = null
    }
  }, [path])

  useLayoutEffect(() => {
    const view = editor.current
    if (!view || serialize(view.state.doc, view.state.field(lineFormat)) === source.text) return
    const { text, format } = sourceText(source.text)
    const old = view.state.doc.toString()
    let from = 0
    while (from < old.length && from < text.length && old[from] === text[from]) from++
    let endOld = old.length
    let endNew = text.length
    while (endOld > from && endNew > from && old[endOld - 1] === text[endNew - 1]) {
      endOld--
      endNew--
    }
    view.dispatch({
      changes: { from, to: endOld, insert: text.slice(from, endNew) },
      effects: replaceFormat.of(format),
      annotations: Transaction.addToHistory.of(false)
    })
  }, [path, source])

  useLayoutEffect(() => {
    editor.current?.dispatch({
      effects: readOnly.current.reconfigure(EditorState.readOnly.of(locked))
    })
  }, [path, locked])

  return <div className="editor-content" ref={host} />
}
