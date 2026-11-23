import { mediaType, parseFileUrl } from '../core/fileUrl'
import type { Vault } from './vault'
import { openExisting } from './vaultFs'

const refuse = (status: number): Response => new Response(null, { status })

// An SVG is a document. Shown in an <img> its scripts never run; these headers keep it inert
// if one is ever loaded as a page.
const inert = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'X-Content-Type-Options': 'nosniff'
}

// The mote-file:// handler. It serves an image or video file of the open vault and nothing else:
// no note, no dot path, no symlink, nothing outside the vault. Every refusal carries no bytes.
export async function serveFile(
  vaultOrVaults: Vault | Vault[] | Iterable<Vault> | undefined,
  request: Request
): Promise<Response> {
  if (request.method !== 'GET') return refuse(405)
  let path
  try {
    path = parseFileUrl(request.url)
  } catch {
    return refuse(400)
  }
  const type = mediaType(path)
  if (!type) return refuse(403)
  if (!vaultOrVaults) return refuse(404)

  const vaults = Array.isArray(vaultOrVaults)
    ? vaultOrVaults
    : 'dir' in vaultOrVaults
      ? [vaultOrVaults]
      : Array.from(vaultOrVaults)
  if (vaults.length === 0) return refuse(404)

  for (const vault of vaults) {
    try {
      // filePath refuses a folder on the way that is a symlink; O_NOFOLLOW refuses the file itself.
      const file = await openExisting(await vault.filePath(path), 'read')
      try {
        const stats = await file.stat()
        if (!stats.isFile()) {
          await file.close()
          continue
        }
        const total = stats.size

        const isHtml = type.startsWith('text/html')
        const isPdf = type === 'application/pdf'
        const securityHeaders = isHtml
          ? {
              'Content-Security-Policy':
                "default-src 'self' mote-file: data: blob: https: 'unsafe-inline' 'unsafe-eval'; style-src 'self' mote-file: data: https: 'unsafe-inline'; img-src 'self' mote-file: data: blob: https:; media-src 'self' mote-file: data: blob: https:;",
              'X-Content-Type-Options': 'nosniff'
            }
          : isPdf
            ? {
                'Content-Disposition': 'inline',
                'X-Content-Type-Options': 'nosniff'
              }
            : inert

        const rangeHeader = request.headers.get('range')
        if (rangeHeader && rangeHeader.startsWith('bytes=')) {
          const parts = rangeHeader.slice(6).split('-')
          const start = parseInt(parts[0], 10)
          const end = parts[1] ? parseInt(parts[1], 10) : total - 1
          if (isNaN(start) || start >= total || end >= total || start > end) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${total}` }
            })
          }
          const length = end - start + 1
          const buffer = Buffer.alloc(length)
          await file.read(buffer, 0, length, start)
          return new Response(buffer, {
            status: 206,
            headers: {
              ...securityHeaders,
              'Content-Type': type,
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Content-Length': String(length),
              'Accept-Ranges': 'bytes'
            }
          })
        }

        return new Response(await file.readFile(), {
          headers: {
            ...securityHeaders,
            'Content-Type': type,
            'Content-Length': String(total),
            'Accept-Ranges': 'bytes'
          }
        })
      } finally {
        await file.close()
      }
    } catch {
      continue
    }
  }

  return refuse(404)
}
