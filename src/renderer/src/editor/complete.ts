import {
  autocompletion,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { EditorState, Facet, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { VaultPath } from '../../../core/ipc'
import { linkText, type LinkFormat } from '../../../core/linkText'
import { suggest } from '../quickOpenMatch'
import { linkContext } from './livePreview'
import type { LinkContext } from './preview'
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

const noteName = (path: VaultPath): string => path.slice(path.lastIndexOf('/') + 1, -3)
const folder = (path: VaultPath): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))

// Replaces the [[ and the query from start to the cursor, and whatever Obsidian replaces after it.
function insert(
  view: EditorView,
  row: Row,
  links: LinkContext,
  format: LinkFormat,
  target: VaultPath,
  start: number,
  cursor: number
): void {
  const line = view.state.doc.lineAt(cursor)
  const after = line.text.slice(cursor - line.from)
  const { text, consumed } = linkText(links.index, target, links.path, format, after)
  view.dispatch({
    changes: { from: start, to: cursor + consumed, insert: text },
    selection: { anchor: start + text.length },
    annotations: pickedCompletion.of(row),
    userEvent: 'input.complete'
  })
}

// Rows come from quick open's matcher, in its order. The library's own filtering stays off.
function linkSource(context: CompletionContext): CompletionResult | null {
  const vault = context.state.facet(completeContext)
  const links = context.state.facet(linkContext)
  const query = linkQuery(context.state, context.pos)
  if (!vault || !links || query === null) return null
  const options = suggest(vault.notes, vault.recent, query).map(({ path, label, match }): Row => {
    const name = noteName(path)
    const offset = label.length - name.length
    return {
      label: name,
      detail: folder(path),
      matched: (match?.matches ?? []).flatMap(([from, to]) =>
        to > offset ? [Math.max(from, offset) - offset, to - offset] : []
      ),
      apply: (view, row, from, to) =>
        insert(view, row as Row, links, vault.format, path, from - 2, to)
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
  autocompletion({ override: [linkSource], icons: false }),
  EditorState.phrases.of({ Completions: '链接补全' })
]
