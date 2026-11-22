import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import {
  type FormatTarget,
  formatKeymap,
  insertCodeBlock,
  insertQuote,
  toggleBold,
  toggleBulletList,
  toggleHighlight,
  toggleInlineCode,
  toggleItalic,
  toggleLink,
  toggleStrikethrough,
  toggleTaskList
} from './formatting'

function createTarget(
  doc: string,
  selection?: { from: number; to?: number },
  editable = true
): FormatTarget {
  const state = EditorState.create({
    doc,
    selection: selection
      ? EditorSelection.single(selection.from, selection.to ?? selection.from)
      : undefined,
    extensions: [EditorView.editable.of(editable)]
  })
  const target: FormatTarget = {
    state,
    dispatch(spec: TransactionSpec) {
      target.state = target.state.update(spec).state
    }
  }
  return target
}

describe('Markdown formatting commands', () => {
  describe('toggleBold', () => {
    it('wraps selected text with ** and keeps inner text selected', () => {
      const target = createTarget('hello world', { from: 6, to: 11 })
      toggleBold(target)
      expect(target.state.doc.toString()).toBe('hello **world**')
      expect(target.state.selection.main.from).toBe(8)
      expect(target.state.selection.main.to).toBe(13)
    })

    it('wraps selection with trailing space without wrapping the space', () => {
      const target = createTarget('hello world again', { from: 6, to: 12 })
      toggleBold(target)
      expect(target.state.doc.toString()).toBe('hello **world** again')
    })

    it('unwraps if selected text already includes ** delimiters', () => {
      const target = createTarget('hello **world**', { from: 6, to: 15 })
      toggleBold(target)
      expect(target.state.doc.toString()).toBe('hello world')
      expect(target.state.selection.main.from).toBe(6)
      expect(target.state.selection.main.to).toBe(11)
    })

    it('unwraps if selection is surrounded by ** in doc', () => {
      const target = createTarget('hello **world**', { from: 8, to: 13 })
      toggleBold(target)
      expect(target.state.doc.toString()).toBe('hello world')
      expect(target.state.selection.main.from).toBe(6)
      expect(target.state.selection.main.to).toBe(11)
    })

    it('inserts **** and centers cursor when no selection', () => {
      const target = createTarget('hello ', { from: 6 })
      toggleBold(target)
      expect(target.state.doc.toString()).toBe('hello ****')
      expect(target.state.selection.main.from).toBe(8)
      expect(target.state.selection.main.to).toBe(8)
    })

    it('cancels/deletes **** when cursor is centered inside empty marks', () => {
      const target = createTarget('hello ****', { from: 8 })
      toggleBold(target)
      expect(target.state.doc.toString()).toBe('hello ')
      expect(target.state.selection.main.from).toBe(6)
    })

    it('unwraps when cursor is inside a bold word', () => {
      const target = createTarget('hello **world**', { from: 10 })
      toggleBold(target)
      expect(target.state.doc.toString()).toBe('hello world')
    })

    it('does nothing when editor is non-editable', () => {
      const target = createTarget('hello world', { from: 0, to: 5 }, false)
      const handled = toggleBold(target)
      expect(handled).toBe(false)
      expect(target.state.doc.toString()).toBe('hello world')
    })
  })

  describe('toggleItalic', () => {
    it('wraps and unwraps with *', () => {
      const target = createTarget('note title', { from: 5, to: 10 })
      toggleItalic(target)
      expect(target.state.doc.toString()).toBe('note *title*')
      toggleItalic(target)
      expect(target.state.doc.toString()).toBe('note title')
    })

    it('inserts ** and centers cursor when empty', () => {
      const target = createTarget('', { from: 0 })
      toggleItalic(target)
      expect(target.state.doc.toString()).toBe('**')
      expect(target.state.selection.main.from).toBe(1)
    })
  })

  describe('toggleStrikethrough', () => {
    it('wraps and unwraps with ~~', () => {
      const target = createTarget('done task', { from: 0, to: 4 })
      toggleStrikethrough(target)
      expect(target.state.doc.toString()).toBe('~~done~~ task')
      toggleStrikethrough(target)
      expect(target.state.doc.toString()).toBe('done task')
    })

    it('inserts ~~~~ and centers cursor when empty', () => {
      const target = createTarget('', { from: 0 })
      toggleStrikethrough(target)
      expect(target.state.doc.toString()).toBe('~~~~')
      expect(target.state.selection.main.from).toBe(2)
    })
  })

  describe('toggleHighlight', () => {
    it('wraps and unwraps with ==', () => {
      const target = createTarget('important mark', { from: 0, to: 9 })
      toggleHighlight(target)
      expect(target.state.doc.toString()).toBe('==important== mark')
      toggleHighlight(target)
      expect(target.state.doc.toString()).toBe('important mark')
    })

    it('inserts ==== and centers cursor when empty', () => {
      const target = createTarget('', { from: 0 })
      toggleHighlight(target)
      expect(target.state.doc.toString()).toBe('====')
      expect(target.state.selection.main.from).toBe(2)
    })
  })

  describe('toggleInlineCode', () => {
    it('wraps and unwraps with backtick', () => {
      const target = createTarget('const x = 1', { from: 6, to: 11 })
      toggleInlineCode(target)
      expect(target.state.doc.toString()).toBe('const `x = 1`')
      toggleInlineCode(target)
      expect(target.state.doc.toString()).toBe('const x = 1')
    })

    it('inserts `` and centers cursor when empty', () => {
      const target = createTarget('', { from: 0 })
      toggleInlineCode(target)
      expect(target.state.doc.toString()).toBe('``')
      expect(target.state.selection.main.from).toBe(1)
    })
  })

  describe('toggleLink', () => {
    it('wraps selected text in [text]() and places cursor in ()', () => {
      const target = createTarget('visit obsidian website', { from: 6, to: 14 })
      toggleLink(target)
      expect(target.state.doc.toString()).toBe('visit [obsidian]() website')
      expect(target.state.selection.main.from).toBe(17)
    })

    it('wraps selected URL in [](url) and places cursor in []', () => {
      const target = createTarget('click https://mote.app here', { from: 6, to: 23 })
      toggleLink(target)
      expect(target.state.doc.toString()).toBe('click [](https://mote.app) here')
      expect(target.state.selection.main.from).toBe(7)
    })

    it('unwraps existing [text](url) link back to text', () => {
      const target = createTarget('visit [obsidian](https://obsidian.md) website', {
        from: 6,
        to: 37
      })
      toggleLink(target)
      expect(target.state.doc.toString()).toBe('visit obsidian website')
    })

    it('inserts []() and places cursor in [] when no selection', () => {
      const target = createTarget('note ', { from: 5 })
      toggleLink(target)
      expect(target.state.doc.toString()).toBe('note []()')
      expect(target.state.selection.main.from).toBe(6)
    })

    it('deletes empty []() when cursor is centered inside brackets', () => {
      const target = createTarget('note []()', { from: 6 })
      toggleLink(target)
      expect(target.state.doc.toString()).toBe('note ')
    })
  })

  describe('insertCodeBlock', () => {
    it('wraps selection in fenced code block', () => {
      const target = createTarget('console.log(42)', { from: 0, to: 15 })
      insertCodeBlock(target)
      expect(target.state.doc.toString()).toBe('```\nconsole.log(42)\n```')
    })

    it('inserts empty code block when no selection', () => {
      const target = createTarget('', { from: 0 })
      insertCodeBlock(target)
      expect(target.state.doc.toString()).toBe('```\n\n```')
      expect(target.state.selection.main.from).toBe(4)
    })
  })

  describe('insertQuote', () => {
    it('prepends > to the current line and toggles off on repeat', () => {
      const target = createTarget('Hello quote', { from: 4 })
      insertQuote(target)
      expect(target.state.doc.toString()).toBe('> Hello quote')
      insertQuote(target)
      expect(target.state.doc.toString()).toBe('Hello quote')
    })
  })

  describe('toggleBulletList', () => {
    it('prepends - to plain text line and toggles off on repeat', () => {
      const target = createTarget('Item one', { from: 3 })
      toggleBulletList(target)
      expect(target.state.doc.toString()).toBe('- Item one')
      toggleBulletList(target)
      expect(target.state.doc.toString()).toBe('Item one')
    })

    it('converts tasks to bullet list', () => {
      const target = createTarget('- [ ] Task item', { from: 5 })
      toggleBulletList(target)
      expect(target.state.doc.toString()).toBe('- Task item')
    })

    it('converts numbered list to bullet list', () => {
      const target = createTarget('1. Numbered item', { from: 5 })
      toggleBulletList(target)
      expect(target.state.doc.toString()).toBe('- Numbered item')
    })

    it('toggles multiple lines in selection', () => {
      const target = createTarget('First\nSecond\nThird', { from: 2, to: 15 })
      toggleBulletList(target)
      expect(target.state.doc.toString()).toBe('- First\n- Second\n- Third')
      toggleBulletList(target)
      expect(target.state.doc.toString()).toBe('First\nSecond\nThird')
    })
  })

  describe('toggleTaskList', () => {
    it('cycles: plain text -> unchecked -> checked -> plain text', () => {
      const target = createTarget('Buy milk', { from: 3 })
      // 1. Plain to unchecked task
      toggleTaskList(target)
      expect(target.state.doc.toString()).toBe('- [ ] Buy milk')

      // 2. Unchecked task to checked task
      toggleTaskList(target)
      expect(target.state.doc.toString()).toBe('- [x] Buy milk')

      // 3. Checked task back to plain text
      toggleTaskList(target)
      expect(target.state.doc.toString()).toBe('Buy milk')
    })

    it('upgrades bullet list to task list', () => {
      const target = createTarget('- Buy apples', { from: 4 })
      toggleTaskList(target)
      expect(target.state.doc.toString()).toBe('- [ ] Buy apples')
    })

    it('toggles multiple lines simultaneously', () => {
      const target = createTarget('Task 1\nTask 2', { from: 0, to: 12 })
      toggleTaskList(target)
      expect(target.state.doc.toString()).toBe('- [ ] Task 1\n- [ ] Task 2')
      toggleTaskList(target)
      expect(target.state.doc.toString()).toBe('- [x] Task 1\n- [x] Task 2')
      toggleTaskList(target)
      expect(target.state.doc.toString()).toBe('Task 1\nTask 2')
    })
  })

  describe('formatKeymap', () => {
    it('binds Mod-Enter to toggleTaskList', () => {
      const binding = formatKeymap.find((k) => k.key === 'Mod-Enter')
      expect(binding).toBeDefined()
      expect(binding?.run).toBe(toggleTaskList)
    })
  })
})
