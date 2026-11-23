import type { Hit, VaultPath } from './ipc.ts'
import { extractLinks } from './markdown.ts'
import type { LinkRef } from './model.ts'
import { buildLinkIndex, resolveLink, type LinkIndex } from './resolve.ts'
import { preview } from './hits.ts'
import { sourceText } from './text.ts'

export type IndexedNote = { readonly text: string; readonly links: LinkRef[] }

export class NoteIndex {
  private readonly notes = new Map<VaultPath, IndexedNote>()
  private links: LinkIndex = buildLinkIndex([])

  setFiles(files: Iterable<VaultPath>): void {
    this.links = buildLinkIndex(files)
  }

  getLinkIndex(): LinkIndex {
    return this.links
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

  // Notes whose text could hold a link to a file of this name. A percent sign may encode any part of the name.
  *mayLinkTo(path: VaultPath): IterableIterator<[VaultPath, IndexedNote]> {
    const name = path
      .slice(path.lastIndexOf('/') + 1)
      .replace(/\.md$/i, '')
      .toLowerCase()
    for (const entry of this.notes) {
      const text = entry[1].text
      if (text.includes('%') || text.toLowerCase().includes(name)) yield entry
    }
  }

  backlinks(target: VaultPath): Hit[] {
    const hits: Hit[] = []
    for (const [path, note] of this.mayLinkTo(target)) {
      for (const link of note.links) {
        if (resolveLink(this.links, link.target, path) !== target) continue
        const { from, to } = link.range
        hits.push({ path, from, to, preview: preview(note.text, from, to) })
      }
    }
    return hits
  }
}
