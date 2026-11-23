import type { Hit, SearchResult, VaultPath } from './ipc.ts'
import { preview } from './hits.ts'
import type { IndexedNote } from './noteIndex.ts'

export function parseQuery(query: string): string[] {
  const terms: string[] = []
  const pattern = /"([^"]*)"?|(\S+)/g
  for (const match of query.matchAll(pattern)) {
    const term = match[1] ?? match[2]
    if (term) terms.push(term)
  }
  return terms
}

const escape = (term: string): string => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
// Obsidian 1.15.1 sorts file lists by basename with this collator (app.js `ve`).
const collator = new Intl.Collator(undefined, { usage: 'sort', sensitivity: 'base', numeric: true })
const baseName = (path: string): string => fileName(path).replace(/\.[^.]*$/, '')

export function search(
  notes: Iterable<[VaultPath, IndexedNote]>,
  query: string,
  limit = 50
): SearchResult {
  const terms = parseQuery(query)
  if (terms.length === 0) return { groups: [], total: 0, notes: 0 }
  const patterns = terms.map((term) => new RegExp(escape(term), 'giu'))
  const found: { path: VaultPath; note: IndexedNote; count: number }[] = []
  let total = 0
  for (const [path, note] of notes) {
    const name = fileName(path)
    let count = 0
    let every = true
    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let inBody = 0
      while (pattern.exec(note.text)) inBody++
      pattern.lastIndex = 0
      if (!inBody && !pattern.test(name)) {
        every = false
        break
      }
      count += inBody
    }
    if (!every) continue
    total += count
    found.push({ path, note, count })
  }
  found.sort(
    (a, b) => collator.compare(baseName(a.path), baseName(b.path)) || (a.path < b.path ? -1 : 1)
  )
  const groups = found.slice(0, limit).map(({ path, note, count }) => ({
    path,
    count,
    hits: bodyHits(path, note.text, patterns)
  }))
  return { groups, total, notes: found.length }
}

function bodyHits(path: VaultPath, text: string, patterns: RegExp[]): Hit[] {
  const ranges: [number, number][] = []
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    for (let m = pattern.exec(text); m; m = pattern.exec(text))
      ranges.push([m.index, m.index + m[0].length])
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const hits: Hit[] = []
  let end = -1
  for (const [from, to] of ranges) {
    if (from < end) continue
    end = to
    hits.push({ path, from, to, preview: preview(text, from, to) })
  }
  return hits
}
