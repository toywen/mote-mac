import type { VaultPath } from './ipc.ts'

export type LinkRef = {
  syntax: 'wiki' | 'markdown'
  embed: boolean
  // The link path. Markdown links are decoded. No #subpath and no |alias.
  target: string
  subpath: string | null
  alias: string | null
  // Offsets into the normalized text from sourceText.
  range: { from: number; to: number }
}

// Same shape as Obsidian's metadataCache.resolvedLinks and unresolvedLinks.
export type ResolvedLinks = {
  resolved: Record<VaultPath, Record<VaultPath, number>>
  unresolved: Record<VaultPath, Record<string, number>>
}
