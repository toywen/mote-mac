import type { AiTagSummary, Hit, VaultPath } from './ipc.ts'
import { extractLinks, extractTags } from './markdown.ts'
import type { LinkRef } from './model.ts'
import { buildLinkIndex, resolveLink, type LinkIndex } from './resolve.ts'
import { preview } from './hits.ts'
import { sourceText } from './text.ts'

export type IndexedNote = {
  readonly text: string
  readonly links: LinkRef[]
  readonly tags: string[]
}

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
    let cachedLinks: LinkRef[] | null = links ?? null
    let cachedTags: string[] | null = null
    this.notes.set(path, {
      text,
      get links(): LinkRef[] {
        if (!cachedLinks) cachedLinks = extractLinks(text)
        return cachedLinks
      },
      get tags(): string[] {
        if (!cachedTags) {
          cachedTags = text.includes('#') || text.startsWith('---\n') ? extractTags(text) : []
        }
        return cachedTags
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

  // Unique tags across the vault with the number of notes carrying each, most used first.
  listTags(): AiTagSummary[] {
    const counts = new Map<string, { tag: string; count: number }>()
    for (const [, note] of this.notes) {
      for (const tag of note.tags) {
        const key = tag.toLowerCase()
        const entry = counts.get(key)
        if (entry) entry.count += 1
        else counts.set(key, { tag, count: 1 })
      }
    }
    return [...counts.values()].sort(
      (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN')
    )
  }

  // Notes carrying `tag` or a nested subtag (`#tag/...`), matched case-insensitively.
  notesWithTag(tag: string): VaultPath[] {
    const needle = tag.trim().toLowerCase()
    const prefix = `${needle}/`
    const matched: VaultPath[] = []
    for (const [path, note] of this.notes) {
      if (
        note.tags.some((t) => {
          const lower = t.toLowerCase()
          return lower === needle || lower.startsWith(prefix)
        })
      ) {
        matched.push(path)
      }
    }
    return matched.sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }
}
