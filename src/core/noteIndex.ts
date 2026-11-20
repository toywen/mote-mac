import type { Hit, VaultPath } from './ipc.ts'
import { extractLinks } from './markdown.ts'
import type { LinkRef } from './model.ts'
import { buildLinkIndex, resolveLink, type LinkIndex } from './resolve.ts'
import { sourceText } from './text.ts'

export type IndexedNote = { text: string; links: LinkRef[] }

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

// Every note's normalized text and links, plus the file list that links resolve against.
// Backlinks are not cached: each query resolves every link, so nothing goes stale.
export class NoteIndex {
  private readonly notes = new Map<VaultPath, IndexedNote>()
  private links: LinkIndex = buildLinkIndex([])

  setFiles(files: Iterable<VaultPath>): void {
    this.links = buildLinkIndex(files)
  }

  set(path: VaultPath, raw: string): void {
    const { text } = sourceText(raw)
    this.notes.set(path, { text, links: extractLinks(text) })
  }

  delete(path: VaultPath): void {
    this.notes.delete(path)
  }

  get(path: VaultPath): IndexedNote | undefined {
    return this.notes.get(path)
  }

  entries(): IterableIterator<[VaultPath, IndexedNote]> {
    return this.notes.entries()
  }

  backlinks(target: VaultPath): Hit[] {
    const hits: Hit[] = []
    for (const [path, note] of this.notes) {
      for (const link of note.links) {
        if (resolveLink(this.links, link.target, path) !== target) continue
        const { from, to } = link.range
        hits.push({ path, from, to, preview: preview(note.text, from, to) })
      }
    }
    return hits
  }
}
