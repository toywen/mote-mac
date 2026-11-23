import type { LinkFormat } from './linkText.ts'
import { encode, fileToLinktext } from './linkText.ts'
import type { LinkRef } from './model.ts'
import { buildLinkIndex, resolveLink, type LinkIndex } from './resolve.ts'
import type { VaultPath } from './ipc.ts'

export type RenameMapping = {
  renames: Map<VaultPath, VaultPath>
  oldIndex: LinkIndex
  newIndex: LinkIndex
}

export function buildRenameMapping(
  renames: Map<VaultPath, VaultPath>,
  currentFiles: Iterable<VaultPath>
): RenameMapping {
  const currentSet = new Set(currentFiles)
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

    const oldResolved = resolveLink(oldIndex, link.target, oldSourcePath)
    if (!oldResolved) continue

    const wasRenamed = renames.has(oldResolved)
    const newTarget = wasRenamed ? renames.get(oldResolved)! : oldResolved

    if (wasRenamed) {
      const currentResolved = resolveLink(newIndex, link.target, currentSourcePath)
      if (currentResolved === newTarget) {
        continue
      }
    } else if (!sourceMoved) {
      continue
    }

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

  replacements.sort((a, b) => b.from - a.from)

  let result = text
  for (const { from, to, text: repText } of replacements) {
    result = result.slice(0, from) + repText + result.slice(to)
  }

  return result
}
