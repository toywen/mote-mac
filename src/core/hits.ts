import type { Hit, HitGroup } from './ipc.ts'

const PREVIEW_BEFORE = 60
const PREVIEW_MAX = 240

// The line around [from, to), cut to PREVIEW_MAX characters, with the match offsets inside it.
export function preview(text: string, from: number, to: number): Hit['preview'] {
  let start = text.lastIndexOf('\n', from - 1) + 1
  let end = text.indexOf('\n', to)
  if (end < 0) end = text.length
  if (end - start > PREVIEW_MAX) {
    start = Math.max(start, from - PREVIEW_BEFORE)
    end = Math.min(end, Math.max(to, start + PREVIEW_MAX))
  }
  return { text: text.slice(start, end), from: from - start, to: to - start }
}

// Groups hits that are already ordered by note.
export function groupHits(hits: Hit[]): HitGroup[] {
  const groups: HitGroup[] = []
  for (const hit of hits) {
    const last = groups.at(-1)
    if (last?.path === hit.path) {
      last.hits.push(hit)
      last.count++
    } else groups.push({ path: hit.path, count: 1, hits: [hit] })
  }
  return groups
}
