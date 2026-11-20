import { parseVaultPath, type VaultConfig, type VaultPath } from './ipc.ts'
import type { LinkTarget } from './markdown.ts'
import { resolveLink, type LinkIndex } from './resolve.ts'

// Where a click on a link goes. Link color and following both read this.
export type LinkDest =
  | { kind: 'note'; path: VaultPath; subpath: string | null }
  // Opens in the macOS default app.
  | { kind: 'file'; path: VaultPath }
  // The note a click creates.
  | { kind: 'missing'; path: VaultPath }
  | { kind: 'external'; url: string }

const externalSchemes = new Set(['http:', 'https:', 'mailto:'])

// The only addresses mote hands to the system. Main checks again before it opens one.
export function isAllowedExternal(url: string): boolean {
  try {
    return externalSchemes.has(new URL(url).protocol)
  } catch {
    return false
  }
}

const isNote = (path: string): boolean => /\.md$/i.test(path)

// Null when the link can go nowhere: an address mote does not open, or a missing note whose path
// Obsidian or mote would refuse to create.
export function linkDest(
  target: LinkTarget,
  source: VaultPath,
  index: LinkIndex,
  config: VaultConfig
): LinkDest | null {
  if (target.kind === 'external')
    return isAllowedExternal(target.url) ? { kind: 'external', url: target.url } : null
  const { target: linkpath, subpath } = target.ref
  const path = resolveLink(index, linkpath, source)
  if (path) return isNote(path) ? { kind: 'note', path, subpath } : { kind: 'file', path }
  const created = newNotePath(linkpath, source, index, config)
  return created ? { kind: 'missing', path: created } : null
}

// The path helpers behind Obsidian 1.15.1's file creation, by their names in app.js.
const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/'))) // tt
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1) // pe
function extensionOf(path: string): string {
  // he
  const dot = path.lastIndexOf('.')
  return dot <= 0 || dot === path.length - 1 ? '' : path.slice(dot + 1).toLowerCase()
}
function withoutExtension(path: string): string {
  // Ci
  const dot = path.lastIndexOf('.')
  return dot <= 0 || dot === path.length - 1 ? path : path.slice(0, dot)
}
function normalizePath(path: string): string {
  // ye, with qo and Yl
  let result = path.replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, '')
  if (result === '') result = '/'
  return result.replace(/\u00A0|\u202F/g, ' ').normalize('NFC')
}

// The folder a new note goes in when its link text names no folder (getMarkdownNewFileParent).
// '' is the vault root.
function newNoteFolder(source: VaultPath, index: LinkIndex, config: VaultConfig): string {
  const folder =
    config.newFileLocation === 'folder'
      ? config.newFileFolderPath
      : config.newFileLocation === 'current'
        ? parentOf(source)
        : ''
  return index.folders.has(folder as VaultPath) ? folder : ''
}

// The vault path of an existing file or folder, matched without case
// (getAbstractFileByPathInsensitive).
function existing(index: LinkIndex, path: string): VaultPath | undefined {
  if (index.paths.has(path as VaultPath) || index.folders.has(path as VaultPath))
    return path as VaultPath
  return index.byLowerPath.get(path.toLowerCase())
}

// Ported from Obsidian 1.15.1 app.js: the branch of WorkspaceLeaf.openLinkText for a link whose
// path resolves to no file, with FileManager.getNewFileParent, getMarkdownNewFileParent,
// createNewFile and getOrCreateFolder, Vault.getAvailablePath and Vault.create's checkPath (Ik).
// Obsidian creates `.canvas` and `.base` files through their own core plugins; mote creates
// notes only, so those links go nowhere.
export function newNotePath(
  linkpath: string,
  source: VaultPath,
  index: LinkIndex,
  config: VaultConfig
): VaultPath | null {
  if (!linkpath || linkpath.startsWith('file:')) return null
  const folder = linkpath.includes('/') ? '' : newNoteFolder(source, index, config)
  const extension = extensionOf(linkpath)
  if (extension === 'canvas' || extension === 'base') return null
  let name = linkpath.trim()
  if (extensionOf(name) === 'md') name = withoutExtension(name)
  const stem = (folder ? folder + '/' : '') + normalizePath(name)
  let path = stem + '.md'
  for (let n = 1; existing(index, path); n++) path = `${stem} ${n}.md`
  // getOrCreateFolder reuses a folder whose path differs only in case.
  let parent = parentOf(path)
  if (parent && parent !== '/') {
    const found = existing(index, parent)
    if (found && !index.folders.has(found)) return null
    parent = found ?? parent
  }
  const full = normalizePath((parent && parent !== '/' ? parent + '/' : '') + nameOf(path))
  if (full.split('/').some((part) => /[\\:]/.test(part))) return null
  try {
    return parseVaultPath(full)
  } catch {
    return null
  }
}
