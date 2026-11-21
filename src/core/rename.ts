import type { LinkFormat } from './linkText.ts'
import { fileToLinktext } from './linkText.ts'
import type { LinkRef } from './model.ts'
import { buildLinkIndex, resolveLink, type LinkIndex } from './resolve.ts'
import type { VaultPath } from './ipc.ts'

// Encodes characters that are forbidden in Markdown link URLs, matching linkText.ts
const encode = (path: string): string =>
  // eslint-disable-next-line no-control-regex
  path.replace(/[\\\x00\x08\x0B\x0C\x0E-\x1F ]/g, encodeURIComponent)

export type RenameMapping = {
  // Map of old VaultPath to new VaultPath for every moved file
  renames: Map<VaultPath, VaultPath>
  // Link index representing the state before renaming
  oldIndex: LinkIndex
  // Link index representing the state after renaming
  newIndex: LinkIndex
}

export function buildRenameMapping(
  renames: Map<VaultPath, VaultPath>,
  currentFiles: Iterable<VaultPath>
): RenameMapping {
  const currentSet = new Set(currentFiles)
  // Reconstruct old files by reverting the renames
  const oldFiles = new Set<VaultPath>()
  const newFiles = new Set<VaultPath>(currentSet)

  for (const file of currentSet) {
    oldFiles.add(file)
  }

  for (const [from, to] of renames) {
    oldFiles.add(from)
    oldFiles.delete(to)
    newFiles.delete(from)
    newFiles.add(to)
  }

  return {
    renames,
    oldIndex: buildLinkIndex(oldFiles),
    newIndex: buildLinkIndex(newFiles)
  }
}

// Rewrites links in a single note after a rename/move operation.
// Returns the updated text, or null if no links were changed.
export function rewriteNoteLinks(
  currentSourcePath: VaultPath,
  oldSourcePath: VaultPath,
  text: string,
  links: LinkRef[],
  mapping: RenameMapping,
  format: LinkFormat
): string | null {
  const { renames, oldIndex, newIndex } = mapping
  const sourceMoved = currentSourcePath !== oldSourcePath
  const replacements: { from: number; to: number; text: string }[] = []

  for (const link of links) {
    const isWiki = link.syntax === 'wiki'
    const isMd = link.syntax === 'markdown'

    // First check what this link resolved to before the move
    const oldResolved = resolveLink(oldIndex, link.target, oldSourcePath)
    if (!oldResolved) continue

    const wasRenamed = renames.has(oldResolved)
    const newTarget = wasRenamed ? renames.get(oldResolved)! : oldResolved

    // Check if the link needs to be rewritten:
    // 1. If target was renamed, check if it's already updated to newTarget
    // 2. If source note itself moved and link was relative (Markdown or relative wiki)
    if (wasRenamed) {
      // Check if it already resolves to newTarget in newIndex from currentSourcePath
      const currentResolved = resolveLink(newIndex, link.target, currentSourcePath)
      if (currentResolved === newTarget) {
        // Already updated (e.g. idempotent re-run)
        continue
      }
    } else if (!sourceMoved) {
      // Neither target nor source moved
      continue
    }

    // Now format the new link target text
    if (isWiki) {
      const newTargetText = fileToLinktext(
        newIndex,
        newTarget,
        currentSourcePath,
        format.newLinkFormat,
        true
      )
      const subpath = link.subpath ?? ''
      const alias = link.alias ? `|${link.alias}` : ''
      const newInner = `${newTargetText}${subpath}${alias}`
      const newFull = `${link.embed ? '!' : ''}[[${newInner}]]`

      const currentSlice = text.slice(link.range.from, link.range.to)
      if (currentSlice !== newFull) {
        replacements.push({ from: link.range.from, to: link.range.to, text: newFull })
      }
    } else if (isMd) {
      const newTargetText = fileToLinktext(
        newIndex,
        newTarget,
        currentSourcePath,
        format.newLinkFormat,
        false
      )
      const subpath = link.subpath ?? ''
      const url = encode(newTargetText + subpath)
      const label = link.alias ?? ''
      const newFull = `${link.embed ? '!' : ''}[${label}](${url})`

      const currentSlice = text.slice(link.range.from, link.range.to)
      if (currentSlice !== newFull) {
        replacements.push({ from: link.range.from, to: link.range.to, text: newFull })
      }
    }
  }

  if (replacements.length === 0) return null

  // Sort descending by range.from to apply replacements backwards
  replacements.sort((a, b) => b.from - a.from)

  let result = text
  for (const { from, to, text: repText } of replacements) {
    result = result.slice(0, from) + repText + result.slice(to)
  }

  return result
}
