import type { UpdateStatus } from './updaterTypes.js'

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

// Hits in one note. count can exceed hits.length when hits were left out.
export type HitGroup = { path: VaultPath; count: number; hits: Hit[] }

// Notes that match a search. Only the first groups carry hits; count is that note's body
// matches, total and notes cover every matching note.
export type SearchResult = {
  groups: HitGroup[]
  total: number
  notes: number
}

export type VaultChange = {
  dir: string
  entries?: VaultEntry[]
  changed: VaultPath[]
  removed: VaultPath[]
}

export type ThemeSource = 'system' | 'light' | 'dark'

export type ThemeState = {
  source: ThemeSource
  shouldUseDarkColors: boolean
}

export type FontMode = 'kai' | 'hei'

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
  // Creates an empty note, and any folders it needs, for a link to a missing note. A note that
  // exists by then is left as it is. Resolves after the vault change is sent.
  createNote(dir: string, path: VaultPath): Promise<void>
  // Hands an http, https or mailto address to the system.
  openExternal(url: string): Promise<void>
  createNoteInVault(dir: string, parentFolder?: VaultPath, initialName?: string): Promise<VaultPath>
  createFolder(dir: string, parentFolder?: VaultPath, initialName?: string): Promise<VaultPath>
  deleteEntry(dir: string, path: VaultPath): Promise<void>
  showInFolder(dir: string, path: VaultPath): Promise<void>
  renameOrMove(dir: string, from: VaultPath, to: VaultPath, updateLinks: boolean): Promise<void>
  countInboundLinks(dir: string, path: VaultPath): Promise<number>
  backlinks(dir: string, path: VaultPath): Promise<Hit[]>
  search(dir: string, query: string, limit: number): Promise<SearchResult>
  onVaultChanged(callback: (change: VaultChange) => void): () => void
  onCloseRequested(callback: () => void): () => void
  respondToClose(ready: boolean): void
  getTheme(): Promise<ThemeState>
  setTheme(theme: ThemeSource): Promise<ThemeState>
  toggleTheme(): Promise<ThemeState>
  onThemeChanged(callback: (state: ThemeState) => void): () => void
  getFont(): Promise<FontMode>
  setFont(font: FontMode): Promise<FontMode>
  toggleFont(): Promise<FontMode>
  onFontChanged(callback: (font: FontMode) => void): () => void
  checkForUpdates(): Promise<UpdateStatus>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  getAppVersion(): Promise<string>
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void
}

export const channels = {
  getVault: 'mote:get-vault',
  chooseVault: 'mote:choose-vault',
  readNote: 'mote:read-note',
  writeNote: 'mote:write-note',
  openWithDefaultApp: 'mote:open-with-default-app',
  createNote: 'mote:create-note',
  openExternal: 'mote:open-external',
  createNoteInVault: 'mote:create-note-in-vault',
  createFolder: 'mote:create-folder',
  deleteEntry: 'mote:delete-entry',
  showInFolder: 'mote:show-in-folder',
  renameOrMove: 'mote:rename-or-move',
  countInboundLinks: 'mote:count-inbound-links',
  backlinks: 'mote:backlinks',
  search: 'mote:search',
  vaultChanged: 'mote:vault-changed',
  closeRequested: 'mote:close-requested',
  respondToClose: 'mote:respond-to-close',
  getTheme: 'mote:get-theme',
  setTheme: 'mote:set-theme',
  toggleTheme: 'mote:toggle-theme',
  themeChanged: 'mote:theme-changed',
  getFont: 'mote:get-font',
  setFont: 'mote:set-font',
  toggleFont: 'mote:toggle-font',
  fontChanged: 'mote:font-changed',
  checkForUpdates: 'mote:check-for-updates',
  downloadUpdate: 'mote:download-update',
  installUpdate: 'mote:install-update',
  getAppVersion: 'mote:get-app-version',
  updateStatus: 'mote:update-status'
} as const
