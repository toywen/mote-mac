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

// The MIME type of an image path, or null when its extension is not an image type.
export function imageType(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? null : (imageTypes.get(name.slice(dot + 1).toLowerCase()) ?? null)
}

export function fileUrl(path: VaultPath): string {
  return prefix + path.split('/').map(encodeURIComponent).join('/')
}

// The vault path a mote-file URL names. Throws for another scheme or host, a query or
// fragment, bad percent-encoding, and anything parseVaultPath rejects, such as `..`.
export function parseFileUrl(url: string): VaultPath {
  if (!url.startsWith(prefix)) throw new Error('不是 mote-file 地址')
  const rest = url.slice(prefix.length)
  if (/[?#]/.test(rest)) throw new Error('mote-file 地址不能带查询或片段')
  return parseVaultPath(decodeURIComponent(rest))
}
