import { EditorSelection, EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { describe, expect, it } from 'vitest'
import { markdownParser } from '../../../core/markdown'
import { listRenderers } from './lists'
import { taskRenderers } from './tasks'

function getSyntaxNode(doc: string, nodeName: string): { node: SyntaxNode; state: EditorState } {
  const state = EditorState.create({ doc })
  const tree = markdownParser.parse(doc)
  let found: SyntaxNode | null = null
  tree.iterate({
    enter(node) {
      if (node.name === nodeName && !found) {
        found = node.node
      }
    }
  })
  if (!found) throw new Error(`Node ${nodeName} not found in doc`)
  return { node: found, state }
}

describe('List and task marker reveal rules', () => {
  it('does not reveal bullet mark when cursor is editing the item text or at line start', () => {
    const doc = '- 王地方'
    const { node, state } = getSyntaxNode(doc, 'ListMark')
    const items = listRenderers['ListMark'](node, { state, links: null })
    expect(items).toHaveLength(1)

    const item = items[0]
    // Cursor at pos 5 (editing "王地方")
    const cursorEnd = EditorSelection.cursor(5)
    expect(cursorEnd.from <= item.reveal.to && cursorEnd.to >= item.reveal.from).toBe(false)

    // Cursor at pos 0 (beginning of line)
    const cursorStart = EditorSelection.cursor(0)
    expect(cursorStart.from <= item.reveal.to && cursorStart.to >= item.reveal.from).toBe(false)

    // Cursor right after "- " at pos 2
    const cursorAfterMark = EditorSelection.cursor(2)
    expect(cursorAfterMark.from <= item.reveal.to && cursorAfterMark.to >= item.reveal.from).toBe(
      false
    )
  })

  it('does not reveal ordered list mark when cursor is on the line', () => {
    const doc = '1. 有序列表项'
    const { node, state } = getSyntaxNode(doc, 'ListMark')
    const items = listRenderers['ListMark'](node, { state, links: null })
    expect(items).toHaveLength(1)

    const item = items[0]
    const cursor = EditorSelection.cursor(5)
    expect(cursor.from <= item.reveal.to && cursor.to >= item.reveal.from).toBe(false)
  })

  it('does not reveal task checkbox when cursor is editing the task text or at start', () => {
    const doc = '- [ ] 待办任务'
    const { node, state } = getSyntaxNode(doc, 'TaskMarker')
    const items = taskRenderers['TaskMarker'](node, { state, links: null })
    expect(items).toHaveLength(1)

    const item = items[0]
    // Cursor at pos 8 (editing "待办任务")
    const cursorEnd = EditorSelection.cursor(8)
    expect(cursorEnd.from <= item.reveal.to && cursorEnd.to >= item.reveal.from).toBe(false)

    // Cursor at pos 0
    const cursorStart = EditorSelection.cursor(0)
    expect(cursorStart.from <= item.reveal.to && cursorStart.to >= item.reveal.from).toBe(false)

    // Cursor right after checkbox at pos 6
    const cursorAfterBox = EditorSelection.cursor(6)
    expect(cursorAfterBox.from <= item.reveal.to && cursorAfterBox.to >= item.reveal.from).toBe(
      false
    )
  })

  it('does not reveal checked task marker', () => {
    const doc = '- [x] 已完成任务'
    const { node, state } = getSyntaxNode(doc, 'TaskMarker')
    const items = taskRenderers['TaskMarker'](node, { state, links: null })
    expect(items).toHaveLength(1)

    const item = items[0]
    const cursor = EditorSelection.cursor(7)
    expect(cursor.from <= item.reveal.to && cursor.to >= item.reveal.from).toBe(false)
  })
})
