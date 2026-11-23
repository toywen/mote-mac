import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, type FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseVaultPath } from '../core/ipc.ts'

// An absolute path inside the vault whose folders on the way are real folders, not symlinks.
// Only locate and ensureFolder make one, and every function that changes the vault takes one.
export type InVault = string & { readonly __brand: 'InVault' }

const refuse = (): Error => new Error('路径经过符号链接，无法访问')

// root must already be a real path, as Vault.open makes it.
export async function locate(root: string, path: string): Promise<InVault> {
  const full = join(root, parseVaultPath(path))
  if ((await realpath(dirname(full))) !== dirname(full)) throw refuse()
  return full as InVault
}

// Makes the missing folders of a vault folder one at a time from the root. '' is the root.
export async function ensureFolder(root: string, folder: string): Promise<InVault> {
  let dir = root
  for (const part of folder ? parseVaultPath(folder).split('/') : []) {
    dir = join(dir, part)
    await mkdir(dir).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
    if (!(await lstat(dir)).isDirectory()) throw refuse()
  }
  return dir as InVault
}

// Fails with EEXIST when anything is already there, a symlink included.
export async function createFile(full: InVault, data?: Buffer): Promise<void> {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
  const file = await open(full, flags, 0o666)
  try {
    if (data) await file.writeFile(data)
  } finally {
    await file.close()
  }
}

export function openExisting(full: InVault, access: 'read' | 'readWrite'): Promise<FileHandle> {
  const mode = access === 'read' ? constants.O_RDONLY : constants.O_RDWR
  return open(full, mode | constants.O_NOFOLLOW | constants.O_NONBLOCK)
}

// Writes over the file in place. A temp file and a rename would change the creation time.
export async function overwrite(file: FileHandle, bytes: Buffer): Promise<void> {
  for (let offset = 0; offset < bytes.length;) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, offset)
    if (!bytesWritten) throw new Error('无法写入笔记')
    offset += bytesWritten
  }
  await file.truncate(bytes.length)
}

export function move(from: InVault, to: InVault): Promise<void> {
  return rename(from, to)
}
