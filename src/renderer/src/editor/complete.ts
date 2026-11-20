import {
  autocompletion,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { EditorState, Facet, type Extension } from '@codemirror/state'
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

type Row = Completion & { matched: number[] }

// Rows come from quick open's matcher, in its order. The library's own filtering stays off.
// Picking a row replaces the [[ and the query, and whatever Obsidian replaces after the cursor.
function linkSource(context: CompletionContext): CompletionResult | null {
  const vault = context.state.facet(completeContext)
  const links = context.state.facet(linkContext)
  const query = linkQuery(context.state, context.pos)
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
  return {
    from: context.pos - query.length,
    options,
    filter: false,
    getMatch: (row) => (row as Row).matched
  }
}

export const linkCompletion: Extension = [
  // CodeMirror waits 100 ms after a key before it asks for rows, and ignores Enter for 75 ms
  // after the list opens. Enter in either gap would break the line instead of picking the note.
  // Obsidian's [[ list has no such gaps, and here the rows cost about a millisecond.
  autocompletion({
    override: [linkSource],
    icons: false,
    activateOnTypingDelay: 0,
    interactionDelay: 0
  }),
  EditorState.phrases.of({ Completions: '链接补全' })
]
