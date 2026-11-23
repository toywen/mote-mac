import {
  autocompletion,
  completionStatus,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { EditorState, Facet, Prec, type Extension } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { VaultPath } from '../../../core/ipc'
import { linkText, type LinkFormat } from '../../../core/linkText'
import { suggest } from '../quickOpenMatch'
import { linkContext } from './livePreview'
import './complete.css'

// What [[ completion offers and how it writes the link: the vault's notes, the notes opened last,
// and the vault's link format.
export type CompleteContext = { notes: VaultPath[]; recent: VaultPath[]; format: LinkFormat }

export const completeContext = Facet.define<CompleteContext, CompleteContext | null>({
  combine: (values) => values[0] ?? null
})

const code = new Set(['FencedCode', 'CodeBlock', 'InlineCode'])

// The query after the last [[ before the cursor on its line, as Obsidian's onTrigger finds it.
// With ], |, # or ^ in it, Obsidian completes an alias, heading or block, which mote does not.
function linkQuery(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  const open = before.lastIndexOf('[[')
  if (open < 0) return null
  const query = before.slice(open + 2)
  if (/[\]|#^]/.test(query)) return null
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent
  )
    if (code.has(node.name)) return null
  return query
}

type Row = Completion & {
  matched: number[]
  apply: (view: EditorView, row: Completion, from: number, to: number) => void
}

// Rows come from quick open's matcher, in its order. The library's own filtering stays off.
// Picking a row replaces the [[ and the query, and whatever Obsidian replaces after the cursor.
function linkRows(state: EditorState, pos: number): { from: number; options: Row[] } | null {
  const vault = state.facet(completeContext)
  const links = state.facet(linkContext)
  const query = linkQuery(state, pos)
  if (!vault || !links || query === null) return null
  const options = suggest(vault.notes, vault.recent, query).map(({ path, label, match }): Row => {
    const name = label.lastIndexOf('/') + 1
    return {
      label: label.slice(name),
      detail: label.slice(0, Math.max(0, name - 1)),
      matched: (match?.matches ?? []).flatMap(([from, to]) =>
        to > name ? [Math.max(from, name) - name, to - name] : []
      ),
      apply: (view, row, from, to) => {
        const line = view.state.doc.lineAt(to)
        const after = line.text.slice(to - line.from)
        const { text, consumed } = linkText(links.index, path, links.path, vault.format, after)
        view.dispatch({
          changes: { from: from - 2, to: to + consumed, insert: text },
          selection: { anchor: from - 2 + text.length },
          annotations: pickedCompletion.of(row),
          userEvent: 'input.complete'
        })
      }
    }
  })
  return { from: pos - query.length, options }
}

function linkSource(context: CompletionContext): CompletionResult | null {
  const rows = linkRows(context.state, context.pos)
  return rows && { ...rows, filter: false, getMatch: (row) => (row as Row).matched }
}

// The library fills the list a task after each key, and until then its own Enter does nothing.
// Enter in that gap picks the first row the list is about to show.
function pickPending(view: EditorView): boolean {
  const { state } = view
  const { head, empty } = state.selection.main
  if (!empty || state.readOnly || view.composing || completionStatus(state) !== 'pending')
    return false
  const rows = linkRows(state, head)
  const first = rows?.options[0]
  if (!rows || !first) return false
  first.apply(view, first, rows.from, head)
  return true
}

export const linkCompletion: Extension = [
  Prec.highest(keymap.of([{ key: 'Enter', run: pickPending }])),
  autocompletion({
    override: [linkSource],
    icons: false,
    activateOnTypingDelay: 0,
    interactionDelay: 0
  }),
  EditorState.phrases.of({ Completions: '链接补全' })
]
