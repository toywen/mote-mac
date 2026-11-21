import type { Hit, VaultPath } from './ipc.ts'
import { extractLinks } from './markdown.ts'
import type { LinkRef } from './model.ts'
import { buildLinkIndex, resolveLink, type LinkIndex } from './resolve.ts'
import { preview } from './hits.ts'
import { sourceText } from './text.ts'

export type IndexedNote = { readonly text: string; readonly links: LinkRef[] }

// Every note's normalized text and links, plus the file list that links resolve against.
// Links are parsed on demand when accessed. Backlinks use a substring quick-filter before
// link resolution so cold queries on large vaults remain fast.
export class NoteIndex {
  private readonly notes = new Map<VaultPath, IndexedNote>()
  private links: LinkIndex = buildLinkIndex([])

  setFiles(files: Iterable<VaultPath>): void {
    this.links = buildLinkIndex(files)
  }

  set(path: VaultPath, raw: string, links?: LinkRef[]): void {
    const { text } = sourceText(raw)
    let cached: LinkRef[] | null = links ?? null
    this.notes.set(path, {
      text,
      get links(): LinkRef[] {
        if (!cached) cached = extractLinks(text)
        return cached
      }
    })
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
    const targetName = target.slice(target.lastIndexOf('/') + 1).replace(/\.md$/i, '')
    const targetLower = targetName.toLowerCase()
    for (const [path, note] of this.notes) {
      if (!note.text.toLowerCase().includes(targetLower)) continue
      for (const link of note.links) {
        if (resolveLink(this.links, link.target, path) !== target) continue
        const { from, to } = link.range
        hits.push({ path, from, to, preview: preview(note.text, from, to) })
      }
    }
    return hits
  }
}
