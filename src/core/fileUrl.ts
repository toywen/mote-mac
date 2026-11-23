import { parseVaultPath, type VaultPath } from './ipc.ts'

// The renderer loads the open vault's images from mote-file://vault/<path>. See ADR 0007.
export const fileScheme = 'mote-file'
const prefix = `${fileScheme}://vault/`

// The image types Obsidian shows inline, by extension, with the type main serves each as.
const imageTypes = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['svg', 'image/svg+xml'],
  ['webp', 'image/webp'],
  ['bmp', 'image/bmp'],
  ['avif', 'image/avif']
])

const videoTypes = new Map([
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
  ['mov', 'video/quicktime'],
  ['m4v', 'video/mp4'],
  ['ogv', 'video/ogg']
])

const htmlTypes = new Map([
  ['html', 'text/html; charset=utf-8'],
  ['htm', 'text/html; charset=utf-8']
])

const pdfTypes = new Map([['pdf', 'application/pdf']])

export function imageType(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? null : (imageTypes.get(name.slice(dot + 1).toLowerCase()) ?? null)
}

export function videoType(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? null : (videoTypes.get(name.slice(dot + 1).toLowerCase()) ?? null)
}

export function htmlType(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? null : (htmlTypes.get(name.slice(dot + 1).toLowerCase()) ?? null)
}

export function pdfType(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? null : (pdfTypes.get(name.slice(dot + 1).toLowerCase()) ?? null)
}

export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path)
}

export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path)
}

export function isImagePath(path: string): boolean {
  return imageType(path) !== null
}

export function isViewableFilePath(path: string): boolean {
  return path.endsWith('.md') || isHtmlPath(path) || isPdfPath(path) || isImagePath(path)
}

export function mediaType(path: string): string | null {
  return imageType(path) ?? videoType(path) ?? htmlType(path) ?? pdfType(path)
}

export function fileUrl(path: VaultPath): string {
  return prefix + path.split('/').map(encodeURIComponent).join('/')
}

export function parseFileUrl(url: string): VaultPath {
  if (!url.startsWith(prefix)) throw new Error('不是 mote-file 地址')
  const rest = url.slice(prefix.length)
  if (/[?#]/.test(rest)) throw new Error('mote-file 地址不能带查询或片段')
  return parseVaultPath(decodeURIComponent(rest))
}
