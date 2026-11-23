import type { LinkIndex } from './resolve.ts'
import type { VaultPath } from './ipc.ts'
import { linkText, type LinkFormat } from './linkText.ts'

export function resolveAttachmentFolder(
  attachmentFolderPath: string | undefined,
  notePath: string
): string {
  const trimmed = (attachmentFolderPath ?? '').trim()
  const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : ''

  if (!trimmed) {
    return '.mote/attachments'
  }
  if (trimmed === '/' || trimmed === '.') {
    return ''
  }
  if (trimmed === './') {
    return noteDir
  }
  if (trimmed === './.mote/attachments' || trimmed === '.mote/attachments') {
    return '.mote/attachments'
  }
  if (trimmed.startsWith('./')) {
    const sub = trimmed.slice(2).replace(/^\/+|\/+$/g, '')
    if (!sub) return noteDir
    return noteDir ? `${noteDir}/${sub}` : sub
  }
  return trimmed.replace(/^\/+|\/+$/g, '')
}

export function formatPastedImageName(now: Date = new Date(), ext: string = 'png'): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const YYYY = now.getFullYear()
  const MM = pad(now.getMonth() + 1)
  const DD = pad(now.getDate())
  const HH = pad(now.getHours())
  const mm = pad(now.getMinutes())
  const ss = pad(now.getSeconds())
  const cleanExt = ext.replace(/^\./, '') || 'png'
  return `Pasted image ${YYYY}${MM}${DD}${HH}${mm}${ss}.${cleanExt}`
}

export function nextAvailableAttachmentPath(
  folder: string,
  fileName: string,
  exists: (path: VaultPath) => boolean
): VaultPath {
  const baseName = fileName.slice(
    Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1
  )
  const cleanName =
    baseName
      .replace(/^[.\s]+/, '')
      .replace(/[\0]/g, '')
      .trim() || 'image.png'
  const dot = cleanName.lastIndexOf('.')
  const base = dot > 0 ? cleanName.slice(0, dot) : cleanName
  const ext = dot > 0 ? cleanName.slice(dot) : ''

  let candidateName = cleanName
  let candidatePath = (folder ? `${folder}/${candidateName}` : candidateName) as VaultPath
  let count = 1
  while (exists(candidatePath)) {
    candidateName = `${base} ${count++}${ext}`
    candidatePath = (folder ? `${folder}/${candidateName}` : candidateName) as VaultPath
  }
  return candidatePath
}

export function formatImageEmbed(
  index: LinkIndex,
  attachmentPath: VaultPath,
  sourceNotePath: VaultPath,
  format: LinkFormat
): string {
  const link = linkText(index, attachmentPath, sourceNotePath, format)
  return '!' + link.text
}
