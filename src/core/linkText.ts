import type { VaultConfig, VaultPath } from './ipc.ts'
import { linkpathDest, type LinkIndex } from './resolve.ts'

// Ported from Obsidian 1.15.1 app.js: fileToLinktext, and PR, which builds the text its [[
// suggestion inserts. Helpers: tt, pe, Rt, he, Ci, pi, Qu, Vt.
export type LinkFormat = Pick<VaultConfig, 'useMarkdownLinks' | 'newLinkFormat'>

// Replaces the text from the [[ to the cursor, plus consumed characters after the cursor.
export type LinkInsert = { text: string; consumed: number }

const images = ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']

const parent = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

function extensionDot(name: string): number {
  const dot = name.lastIndexOf('.')
  return dot <= 0 || dot === name.length - 1 ? -1 : dot
}

function extension(path: string): string {
  const name = fileName(path)
  const dot = extensionDot(name)
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

function basename(path: string): string {
  const name = fileName(path)
  const dot = extensionDot(name)
  return dot < 0 ? name : name.slice(0, dot)
}

export const encode = (path: string): string =>
  // eslint-disable-next-line no-control-regex
  path.replace(/[\\\x00\x08\x0B\x0C\x0E-\x1F ]/g, encodeURIComponent)

export function fileToLinktext(
  index: LinkIndex,
  file: VaultPath,
  source: VaultPath,
  format: LinkFormat['newLinkFormat'],
  omitMd: boolean
): string {
  const short = omitMd && extension(file) === 'md'
  const full = short ? file.slice(0, -3) : file
  if (format === 'absolute') return full
  if (format === 'relative') {
    let up = ''
    let folder = parent(source)
    while (folder !== '' && !full.startsWith(folder + '/')) {
      up = '../' + up
      folder = parent(folder)
    }
    return up + (folder === '' ? full : full.slice(folder.length + 1))
  }
  const name = short ? basename(file) : fileName(file)
  const hash = name.indexOf('#')
  const dest = linkpathDest(index, hash < 0 ? name : name.slice(0, hash), source)
  return dest.length === 1 && dest[0] === file ? name : full
}

// What Obsidian inserts when you pick file from its [[ suggestions with Enter, in a note at
// source. after is the rest of the line after the cursor. A ]] there, with any text before it,
// is replaced too, and an |alias in that text is kept for a wiki link.
export function linkText(
  index: LinkIndex,
  file: VaultPath,
  source: VaultPath,
  format: LinkFormat,
  after = ''
): LinkInsert {
  const markdown = format.useMarkdownLinks
  const name = basename(file)
  let path = fileToLinktext(index, file, source, format.newLinkFormat, !markdown)
  let alias = ''
  let consumed = 0
  const close = /^(\s*)(\|)?(.*?)(]])/.exec(after)
  if (close && !close[0].includes('[[')) {
    if (close[2]) alias = close[3]
    consumed = close[0].length
  }
  if (!alias && !images.includes(extension(file)) && path.includes('/')) alias = name
  if (markdown) return { text: `[${name}](${encode(path)})`, consumed }
  if (alias) path += '|' + alias
  return { text: '[[' + path + (path.endsWith(']]') ? '' : ']]'), consumed }
}
