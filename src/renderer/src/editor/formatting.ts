import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { EditorView, type KeyBinding } from '@codemirror/view'

export type FormatTarget = {
  state: EditorState
  dispatch: (spec: TransactionSpec) => void
}

export type FormatCommand = (target: FormatTarget) => boolean

/**
 * Toggles symmetrical delimiter formatting (bold, italic, strikethrough, highlight, code).
 * Supports smart selection wrapping, cursor centering when empty, and unwrapping/cancelling.
 * Trims selection whitespace to ensure clean Markdown syntax (e.g. "**word** " instead of "**word **").
 */
export function toggleWrap(
  target: FormatTarget,
  prefix: string,
  suffix: string = prefix,
  placeholder: string = ''
): boolean {
  if (target.state.facet(EditorView.editable) === false || target.state.readOnly) {
    return false
  }

  const { state } = target
  const changes = state.changeByRange((range) => {
    const { from, to } = range
    const doc = state.doc

    // Case 1: Non-empty selection
    if (from < to) {
      const rawSelected = doc.sliceString(from, to)
      const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(rawSelected)
      const leading = match ? match[1] : ''
      const selected = match ? match[2] : rawSelected

      if (!selected) {
        // Selection is only whitespace
        return { range }
      }

      const coreFrom = from + leading.length
      const coreTo = coreFrom + selected.length

      // Sub-case 1a: The selected text itself is wrapped in prefix & suffix
      if (
        selected.length >= prefix.length + suffix.length &&
        selected.startsWith(prefix) &&
        selected.endsWith(suffix)
      ) {
        const unwrapped = selected.slice(prefix.length, selected.length - suffix.length)
        return {
          range: EditorSelection.range(coreFrom, coreFrom + unwrapped.length),
          changes: { from: coreFrom, to: coreTo, insert: unwrapped }
        }
      }

      // Sub-case 1b: The selection is surrounded by prefix & suffix in the document
      const before = doc.sliceString(Math.max(0, coreFrom - prefix.length), coreFrom)
      const after = doc.sliceString(coreTo, Math.min(doc.length, coreTo + suffix.length))
      if (before === prefix && after === suffix) {
        return {
          range: EditorSelection.range(
            coreFrom - prefix.length,
            coreFrom - prefix.length + selected.length
          ),
          changes: {
            from: coreFrom - prefix.length,
            to: coreTo + suffix.length,
            insert: selected
          }
        }
      }

      // Sub-case 1c: Wrap the selection
      const wrapped = prefix + selected + suffix
      return {
        range: EditorSelection.range(coreFrom + prefix.length, coreTo + prefix.length),
        changes: { from: coreFrom, to: coreTo, insert: wrapped }
      }
    }

    // Case 2: Empty selection (collapsed cursor at from)
    const pos = from

    // Sub-case 2a: Cursor is directly between prefix and suffix (e.g. **|**)
    const before = doc.sliceString(Math.max(0, pos - prefix.length), pos)
    const after = doc.sliceString(pos, Math.min(doc.length, pos + suffix.length))
    if (before === prefix && after === suffix) {
      return {
        range: EditorSelection.cursor(pos - prefix.length),
        changes: {
          from: pos - prefix.length,
          to: pos + suffix.length,
          insert: ''
        }
      }
    }

    // Sub-case 2b: Cursor is inside a formatted token on the current line (e.g. **foo|bar**)
    const line = doc.lineAt(pos)
    const lineText = line.text
    const offset = pos - line.from

    const lastPrefixIndex = lineText.lastIndexOf(prefix, offset - 1)
    if (lastPrefixIndex !== -1) {
      const suffixIndex = lineText.indexOf(suffix, lastPrefixIndex + prefix.length)
      if (
        suffixIndex !== -1 &&
        offset >= lastPrefixIndex + prefix.length &&
        offset <= suffixIndex
      ) {
        const startPos = line.from + lastPrefixIndex
        const endPos = line.from + suffixIndex + suffix.length
        const innerText = doc.sliceString(startPos + prefix.length, endPos - suffix.length)
        const newCursorPos = Math.min(
          startPos + innerText.length,
          Math.max(startPos, pos - prefix.length)
        )
        return {
          range: EditorSelection.cursor(newCursorPos),
          changes: {
            from: startPos,
            to: endPos,
            insert: innerText
          }
        }
      }
    }

    // Sub-case 2c: Empty cursor not inside formatted text: insert prefix + placeholder + suffix, cursor in center
    const insertText = prefix + placeholder + suffix
    const cursorPos = pos + prefix.length
    return {
      range: EditorSelection.cursor(cursorPos),
      changes: {
        from: pos,
        to: pos,
        insert: insertText
      }
    }
  })

  target.dispatch({ ...changes, scrollIntoView: true })
  return true
}

export const toggleBold: FormatCommand = (target) => toggleWrap(target, '**')
export const toggleItalic: FormatCommand = (target) => toggleWrap(target, '*')
export const toggleStrikethrough: FormatCommand = (target) => toggleWrap(target, '~~')
export const toggleHighlight: FormatCommand = (target) => toggleWrap(target, '==')
export const toggleInlineCode: FormatCommand = (target) => toggleWrap(target, '`')

/**
 * Toggles Markdown links [text](url).
 * - Selection: wraps in [text]() with cursor in (), or [text](url) unwrap to text.
 *   If selected text is an HTTP(S) URL, turns into [](url) with cursor in [].
 * - No selection: inserts []() with cursor in [], or unwraps if inside [text](url).
 */
export const toggleLink: FormatCommand = (target) => {
  if (target.state.facet(EditorView.editable) === false || target.state.readOnly) {
    return false
  }

  const { state } = target
  const changes = state.changeByRange((range) => {
    const { from, to } = range
    const doc = state.doc

    if (from < to) {
      const rawSelected = doc.sliceString(from, to)
      const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(rawSelected)
      const leading = match ? match[1] : ''
      const selected = match ? match[2] : rawSelected

      if (!selected) return { range }

      const coreFrom = from + leading.length
      const coreTo = coreFrom + selected.length

      // Sub-case: already a markdown link [text](url) or [text]()
      const linkMatch = /^\[(.*?)\](?:\((.*?)\))?$/.exec(selected)
      if (linkMatch) {
        const text = linkMatch[1] ?? ''
        return {
          range: EditorSelection.range(coreFrom, coreFrom + text.length),
          changes: { from: coreFrom, to: coreTo, insert: text }
        }
      }

      // Sub-case: selection is surrounded by [ and ](url)
      const line = doc.lineAt(coreFrom)
      const lineText = line.text
      const relFrom = coreFrom - line.from
      const relTo = coreTo - line.from
      if (
        relFrom > 0 &&
        lineText[relFrom - 1] === '[' &&
        lineText.slice(relTo, relTo + 2) === ']('
      ) {
        const closeParen = lineText.indexOf(')', relTo + 2)
        if (closeParen !== -1) {
          const fullStart = line.from + relFrom - 1
          const fullEnd = line.from + closeParen + 1
          return {
            range: EditorSelection.range(fullStart, fullStart + selected.length),
            changes: { from: fullStart, to: fullEnd, insert: selected }
          }
        }
      }

      // If selected is a URL
      if (/^https?:\/\//i.test(selected)) {
        const insert = `[](${selected})`
        return {
          range: EditorSelection.cursor(coreFrom + 1),
          changes: { from: coreFrom, to: coreTo, insert }
        }
      }

      // Normal selection -> [selected]()
      const insert = `[${selected}]()`
      return {
        range: EditorSelection.cursor(coreFrom + selected.length + 3),
        changes: { from: coreFrom, to: coreTo, insert }
      }
    }

    // No selection: collapsed cursor
    const pos = from

    // If cursor is directly inside []() -> cancel/delete it
    const before2 = doc.sliceString(Math.max(0, pos - 1), pos)
    const after3 = doc.sliceString(pos, Math.min(doc.length, pos + 3))
    if (before2 === '[' && after3 === ']()') {
      return {
        range: EditorSelection.cursor(pos - 1),
        changes: { from: pos - 1, to: pos + 3, insert: '' }
      }
    }

    // If cursor is inside [text](url) on the same line -> unwrap to text
    const line = doc.lineAt(pos)
    const lineText = line.text
    const offset = pos - line.from
    const openBracket = lineText.lastIndexOf('[', offset)
    if (openBracket !== -1) {
      const closeBracket = lineText.indexOf('](', openBracket + 1)
      if (closeBracket !== -1) {
        const closeParen = lineText.indexOf(')', closeBracket + 2)
        if (closeParen !== -1 && offset <= closeParen + 1) {
          const text = lineText.slice(openBracket + 1, closeBracket)
          const start = line.from + openBracket
          const end = line.from + closeParen + 1
          return {
            range: EditorSelection.cursor(start + Math.min(text.length, offset - openBracket - 1)),
            changes: { from: start, to: end, insert: text }
          }
        }
      }
    }

    // Default: insert []() and put cursor inside brackets
    return {
      range: EditorSelection.cursor(pos + 1),
      changes: { from: pos, to: pos, insert: '[]()' }
    }
  })

  target.dispatch({ ...changes, scrollIntoView: true })
  return true
}

/**
 * Inserts or wraps in a fenced code block ```.
 */
export const insertCodeBlock: FormatCommand = (target) => {
  if (target.state.facet(EditorView.editable) === false || target.state.readOnly) {
    return false
  }

  const { state } = target
  const changes = state.changeByRange((range) => {
    const { from, to } = range
    const doc = state.doc

    if (from < to) {
      const selected = doc.sliceString(from, to)
      const insert = `\`\`\`\n${selected}\n\`\`\``
      return {
        range: EditorSelection.range(from + 4, from + 4 + selected.length),
        changes: { from, to, insert }
      }
    }

    const insert = '```\n\n```'
    return {
      range: EditorSelection.cursor(from + 4),
      changes: { from, to, insert }
    }
  })

  target.dispatch({ ...changes, scrollIntoView: true })
  return true
}

/**
 * Inserts or toggles quote (> ) on the current line or selection.
 */
export const insertQuote: FormatCommand = (target) => {
  if (target.state.facet(EditorView.editable) === false || target.state.readOnly) {
    return false
  }

  const { state } = target
  const line = state.doc.lineAt(state.selection.main.from)
  if (line.text.startsWith('> ')) {
    target.dispatch({
      changes: { from: line.from, to: line.from + 2, insert: '' },
      selection: EditorSelection.cursor(Math.max(line.from, state.selection.main.from - 2)),
      scrollIntoView: true
    })
  } else {
    target.dispatch({
      changes: { from: line.from, to: line.from, insert: '> ' },
      selection: EditorSelection.cursor(state.selection.main.from + 2),
      scrollIntoView: true
    })
  }
  return true
}

/**
 * Toggles bullet list marker (- ) for all lines covered by the selection.
 * - If all lines are bullet lists, removes the bullet marker.
 * - If a line is a task (- [ ] or - [x]), converts it to a bullet list (- ).
 * - If a line is a numbered list (1. ), converts it to a bullet list (- ).
 * - If a line is plain text, prepends "- " (preserving indentation).
 */
export const toggleBulletList: FormatCommand = (target) => {
  if (target.state.facet(EditorView.editable) === false || target.state.readOnly) {
    return false
  }

  const { state } = target
  const { from, to } = state.selection.main
  const startLine = state.doc.lineAt(from)
  const endLine = state.doc.lineAt(to)

  const lineNumbers: number[] = []
  for (let l = startLine.number; l <= endLine.number; l++) {
    lineNumbers.push(l)
  }

  const lines = lineNumbers.map((num) => state.doc.line(num))
  const allBullets = lines.every((l) => /^\s*[-*+]\s+(?!\[[ xX]\]\s)/.test(l.text))

  const changes: { from: number; to: number; insert: string }[] = []

  for (const line of lines) {
    const text = line.text
    const taskMatch = /^(\s*)-\s*\[[ xX]\]\s+(.*)$/.exec(text)
    const bulletMatch = /^(\s*)[-*+]\s+(?!\[[ xX]\]\s)(.*)$/.exec(text)
    const numberedMatch = /^(\s*)\d+\.\s+(.*)$/.exec(text)

    if (allBullets) {
      if (bulletMatch) {
        changes.push({
          from: line.from,
          to: line.to,
          insert: `${bulletMatch[1]}${bulletMatch[2]}`
        })
      }
    } else {
      if (taskMatch) {
        changes.push({
          from: line.from,
          to: line.to,
          insert: `${taskMatch[1]}- ${taskMatch[2]}`
        })
      } else if (bulletMatch) {
        changes.push({
          from: line.from,
          to: line.to,
          insert: `${bulletMatch[1]}- ${bulletMatch[2]}`
        })
      } else if (numberedMatch) {
        changes.push({
          from: line.from,
          to: line.to,
          insert: `${numberedMatch[1]}- ${numberedMatch[2]}`
        })
      } else {
        const indentMatch = /^(\s*)(.*)$/.exec(text)
        const indent = indentMatch ? indentMatch[1] : ''
        const rest = indentMatch ? indentMatch[2] : text
        changes.push({
          from: line.from,
          to: line.to,
          insert: `${indent}- ${rest}`
        })
      }
    }
  }

  target.dispatch({ changes, scrollIntoView: true })
  return true
}

/**
 * Toggles task list marker (- [ ] / - [x]) for all lines covered by the selection.
 * Cycling:
 * - If all lines are unchecked (- [ ] ), marks them checked (- [x] ).
 * - If all lines are checked (- [x] ), clears task marker to plain text.
 * - Otherwise (plain text, bullet, or mixed), sets them to unchecked (- [ ] ).
 */
export const toggleTaskList: FormatCommand = (target) => {
  if (target.state.facet(EditorView.editable) === false || target.state.readOnly) {
    return false
  }

  const { state } = target
  const { from, to } = state.selection.main
  const startLine = state.doc.lineAt(from)
  const endLine = state.doc.lineAt(to)

  const lineNumbers: number[] = []
  for (let l = startLine.number; l <= endLine.number; l++) {
    lineNumbers.push(l)
  }

  const lines = lineNumbers.map((num) => state.doc.line(num))
  const allUnchecked = lines.every((l) => /^\s*-\s*\[ \]\s+/.test(l.text))
  const allChecked = lines.every((l) => /^\s*-\s*\[[xX]\]\s+/.test(l.text))

  const changes: { from: number; to: number; insert: string }[] = []

  for (const line of lines) {
    const text = line.text
    const taskMatch = /^(\s*)-\s*\[([ xX])\]\s+(.*)$/.exec(text)
    const bulletMatch = /^(\s*)[-*+]\s+(.*)$/.exec(text)
    const numberedMatch = /^(\s*)\d+\.\s+(.*)$/.exec(text)

    if (allUnchecked) {
      if (taskMatch) {
        changes.push({
          from: line.from,
          to: line.to,
          insert: `${taskMatch[1]}- [x] ${taskMatch[3]}`
        })
      }
    } else if (allChecked) {
      if (taskMatch) {
        changes.push({
          from: line.from,
          to: line.to,
          insert: `${taskMatch[1]}${taskMatch[3]}`
        })
      }
    } else {
      if (taskMatch) {
        changes.push({
          from: line.from,
          to: line.to,
          insert: `${taskMatch[1]}- [ ] ${taskMatch[3]}`
        })
      } else if (bulletMatch) {
        changes.push({
          from: line.from,
          to: line.to,
          insert: `${bulletMatch[1]}- [ ] ${bulletMatch[2]}`
        })
      } else if (numberedMatch) {
        changes.push({
          from: line.from,
          to: line.to,
          insert: `${numberedMatch[1]}- [ ] ${numberedMatch[2]}`
        })
      } else {
        const indentMatch = /^(\s*)(.*)$/.exec(text)
        const indent = indentMatch ? indentMatch[1] : ''
        const rest = indentMatch ? indentMatch[2] : text
        changes.push({
          from: line.from,
          to: line.to,
          insert: `${indent}- [ ] ${rest}`
        })
      }
    }
  }

  target.dispatch({ changes, scrollIntoView: true })
  return true
}

export const formatKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-k', run: toggleLink },
  { key: 'Mod-Shift-x', run: toggleStrikethrough },
  { key: 'Mod-Shift-s', run: toggleStrikethrough },
  { key: 'Mod-Shift-h', run: toggleHighlight },
  { key: 'Mod-`', run: toggleInlineCode },
  { key: 'Mod-Shift-c', run: toggleInlineCode },
  { key: 'Mod-Alt-c', run: insertCodeBlock },
  { key: 'Mod-Shift-.', run: insertQuote },
  { key: 'Mod-Enter', run: toggleTaskList }
]

export type FormatAction =
  | 'format-bold'
  | 'format-italic'
  | 'format-strike'
  | 'format-highlight'
  | 'format-code'
  | 'format-link'
  | 'format-codeblock'
  | 'format-quote'
  | 'format-task'
  | 'format-bullet'

export function executeFormatting(action: FormatAction): boolean {
  const cmEl = document.querySelector('.cm-editor')
  if (!cmEl) return false
  const view = EditorView.findFromDOM(cmEl as HTMLElement)
  if (!view) return false

  switch (action) {
    case 'format-bold':
      return toggleBold(view)
    case 'format-italic':
      return toggleItalic(view)
    case 'format-strike':
      return toggleStrikethrough(view)
    case 'format-highlight':
      return toggleHighlight(view)
    case 'format-code':
      return toggleInlineCode(view)
    case 'format-link':
      return toggleLink(view)
    case 'format-codeblock':
      return insertCodeBlock(view)
    case 'format-quote':
      return insertQuote(view)
    case 'format-task':
      return toggleTaskList(view)
    case 'format-bullet':
      return toggleBulletList(view)
    default:
      return false
  }
}
