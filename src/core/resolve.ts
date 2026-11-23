import type { VaultPath } from './ipc.ts'
import type { LinkRef, ResolvedLinks } from './model.ts'

// Ported from Obsidian 1.15.1 app.js: getLinkpathDest, getFirstLinkpathDest, uniqueFileLookup, aJ,
// pi, wR.
export type LinkIndex = {
  paths: Set<VaultPath>
  byName: Map<string, VaultPath[]>
  folders: Set<VaultPath>
  byLowerPath: Map<string, VaultPath>
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const parent = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const byLength = (a: VaultPath, b: VaultPath): number => a.length - b.length

export function buildLinkIndex(
  files: Iterable<VaultPath>,
  folderPaths: Iterable<VaultPath> = []
): LinkIndex {
  const paths = new Set<VaultPath>()
  const byName = new Map<string, VaultPath[]>()
  const folders = new Set(folderPaths)
  const byLowerPath = new Map<string, VaultPath>()
  for (const path of folders)
    if (!byLowerPath.has(path.toLowerCase())) byLowerPath.set(path.toLowerCase(), path)
  for (const path of files) {
    paths.add(path)
    const name = baseName(path).toLowerCase()
    const list = byName.get(name)
    if (list) list.push(path)
    else byName.set(name, [path])
    if (!byLowerPath.has(path.toLowerCase())) byLowerPath.set(path.toLowerCase(), path)
  }
  return { paths, byName, folders, byLowerPath }
}

export function linkpathDest(index: LinkIndex, linkpath: string, source: VaultPath): VaultPath[] {
  if (linkpath === '') return index.paths.has(source) ? [source] : []
  let path = linkpath.toLowerCase()
  let name = baseName(path)
  let candidates = name.includes('.') ? index.byName.get(name) : undefined
  if (!candidates) {
    path = (linkpath + '.md').toLowerCase()
    name = baseName(path)
    candidates = index.byName.get(name)
  }
  if (!candidates) return []
  if (name === path && candidates.length === 1) return [candidates[0]]
  let folder = parent(source).toLowerCase()
  if (path.startsWith('./') || path.startsWith('../')) {
    if (path.startsWith('./../')) path = path.slice(2)
    if (path.startsWith('./')) {
      if (folder !== '') folder += '/'
      path = folder + path.slice(2)
    } else {
      while (path.startsWith('../')) {
        path = path.slice(3)
        folder = parent(folder)
      }
      if (folder !== '') folder += '/'
      path = folder + path
    }
    for (const file of candidates) if (file.toLowerCase() === path) return [file]
  }
  if (path.startsWith('/')) path = path.slice(1)
  for (const file of candidates) if (file.toLowerCase() === path) return [file]
  if (linkpath.startsWith('/')) return []
  const near: VaultPath[] = []
  const far: VaultPath[] = []
  for (const file of candidates) {
    const lower = file.toLowerCase()
    if (lower.endsWith(path)) (lower.startsWith(folder) ? near : far).push(file)
  }
  return near.sort(byLength).concat(far.sort(byLength))
}

export function resolveLink(
  index: LinkIndex,
  linkpath: string,
  source: VaultPath
): VaultPath | null {
  return linkpathDest(index, linkpath, source)[0] ?? null
}

const unresolvedKey = (linkpath: string): string =>
  baseName(linkpath).toLowerCase().endsWith('.md') && baseName(linkpath).lastIndexOf('.') > 0
    ? linkpath.slice(0, -3)
    : linkpath

export function resolveNotes(
  notes: Iterable<{ path: VaultPath; links: LinkRef[] }>,
  index: LinkIndex
): ResolvedLinks {
  const result: ResolvedLinks = { resolved: {}, unresolved: {} }
  for (const { path, links } of notes) {
    const resolved: Record<VaultPath, number> = {}
    const unresolved: Record<string, number> = {}
    for (const link of links) {
      const dest = resolveLink(index, link.target, path)
      if (dest) resolved[dest] = (resolved[dest] ?? 0) + 1
      else {
        const key = unresolvedKey(link.target)
        unresolved[key] = (unresolved[key] ?? 0) + 1
      }
    }
    result.resolved[path] = resolved
    result.unresolved[path] = unresolved
  }
  return result
}
