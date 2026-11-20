export type VaultPath = string & { readonly __brand: 'VaultPath' }
export type ContentHash = string & { readonly __brand: 'ContentHash' }

export function parseVaultPath(path: string): VaultPath {
  if (
    !path ||
    path.split('/').some((part) => !part || part.startsWith('.')) ||
    path.includes('\0')
  ) {
    throw new Error('无效的笔记库路径')
  }
  return path as VaultPath
}

export type VaultEntry = { path: VaultPath; kind: 'folder' | 'note' | 'file' }

export type VaultConfig = {
  useMarkdownLinks: boolean
  newLinkFormat: 'shortest' | 'relative' | 'absolute'
  alwaysUpdateLinks: boolean
  newFileLocation: 'root' | 'current' | 'folder'
  newFileFolderPath: string
  daily: { folder: string; format: string }
}

export type VaultInfo = {
  dir: string
  config: VaultConfig
  entries: VaultEntry[]
}

export type NoteVersion = { text: string; hash: ContentHash }

export type WriteResult = { ok: true; hash: ContentHash } | { ok: false; disk: NoteVersion | null }

// A place in a note's normalized text (see sourceText), with the line around it for display.
export type Hit = {
  path: VaultPath
  from: number
  to: number
  preview: { text: string; from: number; to: number }
}

export type VaultChange = {
  dir: string
  entries?: VaultEntry[]
  changed: VaultPath[]
  removed: VaultPath[]
}

export interface MoteApi {
  getVault(): Promise<VaultInfo | null>
  chooseVault(): Promise<VaultInfo | null>
  readNote(dir: string, path: VaultPath): Promise<NoteVersion | null>
  writeNote(
    dir: string,
    path: VaultPath,
    text: string,
    baseHash: ContentHash | null
  ): Promise<WriteResult>
  openWithDefaultApp(dir: string, path: VaultPath): Promise<void>
  backlinks(dir: string, path: VaultPath): Promise<Hit[]>
  onVaultChanged(callback: (change: VaultChange) => void): () => void
  onCloseRequested(callback: () => void): () => void
  respondToClose(ready: boolean): void
}

export const channels = {
  getVault: 'mote:get-vault',
  chooseVault: 'mote:choose-vault',
  readNote: 'mote:read-note',
  writeNote: 'mote:write-note',
  openWithDefaultApp: 'mote:open-with-default-app',
  backlinks: 'mote:backlinks',
  vaultChanged: 'mote:vault-changed',
  closeRequested: 'mote:close-requested',
  respondToClose: 'mote:respond-to-close'
} as const
