import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  parseVaultPath,
  type ContentHash,
  type NoteVersion,
  type VaultEntry,
  type VaultPath
} from '../core/ipc.ts'

// Node-only helpers shared by the main process and tools/*.mjs. No Electron imports.

export function missing(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
}

export function hash(bytes: Buffer): ContentHash {
  return createHash('sha256').update(bytes).digest('hex') as ContentHash
}

export function noteVersion(bytes: Buffer): NoteVersion {
  return {
    text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
    hash: hash(bytes)
  }
}

export function kind(name: string): 'note' | 'file' {
  return extname(name).toLowerCase() === '.md' ? 'note' : 'file'
}

// Depth first in readdir order. Skips every entry whose name starts with a dot, except .mote/attachments.
export async function scanVault(root: string): Promise<Map<VaultPath, VaultEntry>> {
  const result = new Map<VaultPath, VaultEntry>()
  async function visit(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
      if (!prefix || !missing(error)) throw error
      return []
    })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const path = parseVaultPath(prefix + entry.name)
      if (entry.isDirectory()) {
        result.set(path, { path, kind: 'folder' })
        await visit(join(dir, entry.name), path + '/')
      } else if (entry.isFile()) {
        result.set(path, { path, kind: kind(path) })
      }
    }
  }
  await visit(root, '')

  const moteAttachments = join(root, '.mote', 'attachments')
  async function visitAttachments(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      try {
        const path = parseVaultPath(prefix + entry.name)
        if (entry.isDirectory()) {
          result.set(path, { path, kind: 'folder' })
          await visitAttachments(join(dir, entry.name), path + '/')
        } else if (entry.isFile()) {
          result.set(path, { path, kind: 'file' })
        }
      } catch {
        // ignore invalid entries
      }
    }
  }
  await visitAttachments(moteAttachments, '.mote/attachments/')

  return result
}

// Reads a note without following a symlink at the last component. Null when it is gone.
export async function readNoteFile(full: string): Promise<NoteVersion | null> {
  try {
    const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const data = await file.readFile()
      return noteVersion(data)
    } finally {
      await file.close()
    }
  } catch (error) {
    if (missing(error) || (error as NodeJS.ErrnoException).code === 'EISDIR') return null
    throw error
  }
}

// Reads many notes with a bounded number of open files. Order follows paths.
// A note that is gone or cannot be read or decoded gives null, so one bad file cannot stop the rest.
export async function readNoteFiles(
  root: string,
  paths: VaultPath[],
  concurrency = 32
): Promise<(NoteVersion | null)[]> {
  const result: (NoteVersion | null)[] = new Array(paths.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < paths.length) {
      const index = next++
      result[index] = await readNoteFile(join(root, paths[index])).catch(() => null)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker))
  return result
}
