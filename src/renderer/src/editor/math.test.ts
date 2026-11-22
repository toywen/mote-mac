import { describe, expect, it } from 'vitest'
import katex from 'katex'
import { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { markdownParser } from '../../../core/markdown'
import { mathRenderers } from './math'

describe('KaTeX math rendering', () => {
  it('renders inline math into KaTeX HTML', () => {
    const html = katex.renderToString('E = mc^2', { displayMode: false, throwOnError: false })
    expect(html).toContain('katex')
    expect(html).toContain('class="katex-html"')
  })

  it('renders block math into KaTeX display HTML', () => {
    const html = katex.renderToString('\\frac{a}{b} = c', {
      displayMode: true,
      throwOnError: false
    })
    expect(html).toContain('katex-display')
  })

  it('provides renderers for InlineMath and BlockMath', () => {
    expect(mathRenderers['InlineMath']).toBeDefined()
    expect(mathRenderers['BlockMath']).toBeDefined()

    const state = EditorState.create({ doc: '公式 $x + y$\n\n$$\n\\alpha\n$$' })
    const tree = markdownParser.parse(state.doc.toString())

    let inlineNode: SyntaxNode | null = null
    let blockNode: SyntaxNode | null = null
    tree.iterate({
      enter(node) {
        if (node.name === 'InlineMath') inlineNode = node.node
        if (node.name === 'BlockMath') blockNode = node.node
      }
    })

    expect(inlineNode).not.toBeNull()
    expect(blockNode).not.toBeNull()

    const inNode = inlineNode as unknown as SyntaxNode
    const blkNode = blockNode as unknown as SyntaxNode

    const inlineItems = mathRenderers['InlineMath'](inNode, { state, links: null })
    expect(inlineItems).toHaveLength(1)
    expect(inlineItems[0].reveal).toEqual({ from: inNode.from, to: inNode.to })

    const blockItems = mathRenderers['BlockMath'](blkNode, { state, links: null })
    expect(blockItems).toHaveLength(1)
    expect(blockItems[0].block).toBe(true)
  })
})
