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
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { VaultInfo, VaultPath } from '../../core/ipc'
import { sourceText, type LineFormat } from '../../core/text'
import { completeContext, linkCompletion } from './editor/complete'
import { editorMode, linkContext } from './editor/livePreview'
import { noteView } from './editor/noteView'
import type { EditorMode, LinkContext } from './editor/preview'
import { editorLocked } from './editor/tasks'
import { formatKeymap } from './editor/formatting'
import { attachmentContext, imagePasteAndDrop } from './editor/attachments'
import { workspace, type Selection } from './workspace'

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
  locked,
  selection,
  mode,
  links,
  vault
}: {
  path: VaultPath
  source: { text: string }
  locked: boolean
  selection: Selection | null
  mode: EditorMode
  links: Omit<LinkContext, 'path'> | null
  vault: VaultInfo | null
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView>(null)
  const access = useRef(new Compartment())
  const resolve = useRef(new Compartment())
  const complete = useRef(new Compartment())
  const attachment = useRef(new Compartment())
  const shownMode = useRef(mode)
  const entries = vault?.entries
  const notes = useMemo(
    () => (entries ?? []).filter((entry) => entry.kind === 'note').map((entry) => entry.path),
    [entries]
  )
  const format = vault?.config

  useLayoutEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      extensions: [
        lineFormat,
        access.current.of([]),
        resolve.current.of([]),
        noteView(),
        linkCompletion,
        complete.current.of([]),
        attachment.current.of([]),
        imagePasteAndDrop,
        history(),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              void workspace.save()
              return true
            }
          },
          ...formatKeymap,
          ...defaultKeymap,
          ...historyKeymap
        ]),
        EditorView.contentAttributes.of({
          'aria-label': '编辑器',
          'data-note-path': path,
          spellcheck: 'false'
        }),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            const { anchor, head } = update.state.selection.main
            workspace.cursor(path, { from: anchor, to: head })
          }
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

  // Runs before the text arrives, so the first preview already has the mode and the links.
  useLayoutEffect(() => {
    const view = editor.current
    if (!view) return
    view.dispatch({
      effects: access.current.reconfigure([
        editorMode.of(mode),
        EditorView.editable.of(mode === 'live'),
        EditorState.readOnly.of(locked || mode === 'reading'),
        editorLocked.of(locked),
        // Reading mode cannot be typed in, but it takes focus, so a jump from search or the
        // backlinks pane shows its selection and the text can be selected and copied by key.
        mode === 'reading' ? EditorView.contentAttributes.of({ tabindex: '0' }) : []
      ])
    })
    // Back in live preview, typing goes on where it stopped, unless another control has focus.
    const active = document.activeElement
    if (shownMode.current === 'reading' && mode === 'live' && (active === document.body || !active))
      view.focus()
    shownMode.current = mode
  }, [path, locked, mode])

  useLayoutEffect(() => {
    editor.current?.dispatch({
      effects: resolve.current.reconfigure(links ? linkContext.of({ ...links, path }) : [])
    })
  }, [path, links])

  useLayoutEffect(() => {
    editor.current?.dispatch({
      effects: complete.current.reconfigure(
        format ? completeContext.of({ notes, recent: workspace.recent(), format }) : []
      )
    })
  }, [notes, format])

  useLayoutEffect(() => {
    editor.current?.dispatch({
      effects: attachment.current.reconfigure(
        vault && mode === 'live' && !locked
          ? attachmentContext.of({ dir: vault.dir, notePath: path })
          : []
      )
    })
  }, [vault, path, mode, locked])

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
    const view = editor.current
    if (!view || selection?.path !== path) return
    const length = view.state.doc.length
    const anchor = Math.min(selection.from, length)
    view.dispatch({
      selection: { anchor, head: Math.min(selection.to, length) },
      // A heading or block a link points at goes to the top of the editor.
      effects: EditorView.scrollIntoView(anchor, { y: selection.top ? 'start' : 'nearest' })
    })
    view.focus()
  }, [path, selection])

  return <div className="editor-content" ref={host} />
}
