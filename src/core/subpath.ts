import type { SyntaxNode } from '@lezer/common'
import { markdownParser } from './markdown.ts'

// Ported from Obsidian 1.15.1: resolveSubpath (app.js Gn) and its heading normalization Ka, over
// the headings and block ids the metadata cache keeps (worker.js gs and $o, the block id
// tokenizers Ao and Us). Footnote subpaths (#[^1]) are not ported: they fall through to the
// heading search, as an unknown footnote does in Obsidian.

const headingLevel: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2
}

// Ka: punctuation and line breaks become spaces, runs of space collapse.
const normalize = (text: string): string =>
  text
    .replace(/[!"#$%&()*+,.:;<=>?@^`{|}~/[\]\\\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// Where a heading's text ends: before closing #s or the setext underline.
function contentEnd(node: SyntaxNode): number {
  const marks = node.getChildren('HeaderMark')
  if (node.name.startsWith('ATX')) return marks[1]?.from ?? node.to
  if (node.name.startsWith('Setext')) return marks[0]?.from ?? node.to
  return node.to
}

// A heading's text as Obsidian's $t reads it: between the marks, trimmed.
function headingText(node: SyntaxNode, text: string): string {
  const start = node.name.startsWith('ATX')
    ? (node.getChild('HeaderMark')?.to ?? node.from)
    : node.from
  return text.slice(start, contentEnd(node)).trim()
}

const inlineBlocks = new Set(['Paragraph', 'Task', 'TableCell', ...Object.keys(headingLevel)])
const isList = (node: SyntaxNode): boolean =>
  node.name === 'BulletList' || node.name === 'OrderedList'

// Ao: `^id` that ends a paragraph, heading or table cell, where no inline element took the `^`.
function trailingId(node: SyntaxNode, text: string): string | null {
  const match = /\^([a-zA-Z0-9-]+)$/.exec(text.slice(node.from, contentEnd(node)).trimEnd())
  if (!match || node.resolveInner(node.from + match.index, 1) !== node) return null
  return match[1]
}

// Block ids under node in document order. A list item leaves out its nested lists.
function ids(node: SyntaxNode, text: string, skipLists: boolean): string[] {
  const found: string[] = []
  const visit = (current: SyntaxNode): void => {
    if (skipLists && isList(current)) return
    if (inlineBlocks.has(current.name)) {
      const id = trailingId(current, text)
      if (id) found.push(id)
      return
    }
    for (let child = current.firstChild; child; child = child.nextSibling) visit(child)
  }
  visit(node)
  return found
}

type Block = { id: string; from: number }

// Every item of a top-level list, nested ones included, with the first block id of its own text.
function listItems(list: SyntaxNode, text: string, items: Block[]): void {
  for (let item = list.firstChild; item; item = item.nextSibling) {
    if (item.name !== 'ListItem') continue
    const [id] = ids(item, text, true)
    if (id) items.push({ id, from: item.from })
    for (let child = item.firstChild; child; child = child.nextSibling)
      if (isList(child)) listItems(child, text, items)
  }
}

type Outline = {
  headings: { text: string; level: number; from: number }[]
  blocks: Map<string, number>
}

// The top-level headings and the block ids of a note, as worker.js gs puts them in the cache.
function outline(text: string): Outline {
  const headings: Outline['headings'] = []
  const sections: Block[] = []
  const items: Block[] = []
  let previous: SyntaxNode | null = null
  for (let node = markdownParser.parse(text).topNode.firstChild; node; node = node.nextSibling) {
    const level = headingLevel[node.name]
    if (level) headings.push({ text: headingText(node, text), level, from: node.from })
    // Us: a paragraph that is only `^id`, then a blank line or the end, names the block before it.
    const own = /^\^([a-zA-Z0-9-]+)$/.exec(text.slice(node.from, node.to))
    const after = text.slice(node.to, node.to + 2)
    if (node.name === 'Paragraph' && own && (after === '' || after === '\n' || after === '\n\n')) {
      if (previous) sections.push({ id: own[1], from: previous.from })
      continue
    }
    if (isList(node)) listItems(node, text, items)
    else {
      const found = ids(node, text, false)
      if (found.length) sections.push({ id: found[found.length - 1], from: node.from })
    }
    previous = node
  }
  // Items come after sections, so an item's id wins over a section's, as in gs.
  const blocks = new Map<string, number>()
  for (const { id, from } of [...sections, ...items]) blocks.set(id.toLowerCase(), from)
  return { headings, blocks }
}

// Where #heading, #parent#child or #^block lands in a note's normalized text: the offset where
// that heading or block starts. Null when the note has no such heading or block.
export function resolveSubpath(text: string, subpath: string): number | null {
  const parts = subpath.split('#').filter(Boolean)
  if (parts.length === 0) return null
  const { headings, blocks } = outline(text)
  if (parts.length === 1 && parts[0].startsWith('^')) {
    const block = blocks.get(parts[0].slice(1).toLowerCase())
    if (block !== undefined) return block
  }
  // Each part matches a later heading that is deeper than the one before it.
  let matched = 0
  let level = 0
  for (const heading of headings) {
    if (heading.level <= level) continue
    if (normalize(heading.text).toLowerCase() !== normalize(parts[matched]).toLowerCase()) continue
    matched++
    level = heading.level
    if (matched === parts.length) return heading.from
  }
  return null
}
