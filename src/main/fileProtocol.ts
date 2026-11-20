import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { imageType, parseFileUrl } from '../core/fileUrl'
import type { Vault } from './vault'

const refuse = (status: number): Response => new Response(null, { status })

// An SVG is a document. Shown in an <img> its scripts never run; these headers keep it inert
// if one is ever loaded as a page.
const inert = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'X-Content-Type-Options': 'nosniff'
}

// The mote-file:// handler. It serves an image file of the open vault and nothing else: no
// note, no dot path, no symlink, nothing outside the vault. Every refusal carries no bytes.
export async function serveFile(vault: Vault | undefined, request: Request): Promise<Response> {
  if (request.method !== 'GET') return refuse(405)
  let path
  try {
    path = parseFileUrl(request.url)
  } catch {
    return refuse(400)
  }
  const type = imageType(path)
  if (!type) return refuse(403)
  if (!vault) return refuse(404)
  try {
    // filePath refuses a folder on the way that is a symlink; O_NOFOLLOW refuses the file itself.
    const file = await open(
      await vault.filePath(path),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    try {
      if (!(await file.stat()).isFile()) return refuse(404)
      return new Response(await file.readFile(), { headers: { ...inert, 'Content-Type': type } })
    } finally {
      await file.close()
    }
  } catch {
    return refuse(404)
  }
}
