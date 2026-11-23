import type { VaultPath } from './ipc.ts'

export type LinkRef = {
  syntax: 'wiki' | 'markdown'
  embed: boolean
  target: string
  subpath: string | null
  alias: string | null
  range: { from: number; to: number }
}

// Same shape as Obsidian's metadataCache.resolvedLinks and unresolvedLinks.
export type ResolvedLinks = {
  resolved: Record<VaultPath, Record<VaultPath, number>>
  unresolved: Record<VaultPath, Record<string, number>>
}
