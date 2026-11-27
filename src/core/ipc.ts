import type { UpdateStatus } from './updaterTypes.js'

export type VaultPath = string & { readonly __brand: 'VaultPath' }
export type ContentHash = string & { readonly __brand: 'ContentHash' }

export function parseVaultPath(path: string): VaultPath {
  if (!path || path.includes('\0')) {
    throw new Error('无效的笔记库路径')
  }
  const parts = path.split('/')
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) throw new Error('无效的笔记库路径')
    if (part.startsWith('.')) {
      if (i === 0 && part === '.mote' && parts.length > 1 && parts[1] === 'attachments') {
        continue
      }
      if (i === 1 && parts[0] === '.mote' && part === 'attachments') {
        continue
      }
      throw new Error('无效的笔记库路径')
    }
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
  attachmentFolderPath: string
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

// One path that a rename or move changed. A folder's rename lists every entry under it.
export type Renamed = { from: VaultPath; to: VaultPath }

export type VaultChange = {
  dir: string
  entries?: VaultEntry[]
  changed: VaultPath[]
  removed: VaultPath[]
  // Set when the change is a rename or move. removed and changed also list the paths.
  renamed?: Renamed[]
}

export type ThemeSource = 'system' | 'light' | 'dark'
export type ThemeState = {
  source: ThemeSource
  shouldUseDarkColors: boolean
}

export type FontMode = 'kai' | 'song' | 'hei'

// The body font cycles in this order. Kai is the default.
export const fontModes: readonly FontMode[] = ['kai', 'song', 'hei']

export function nextFont(font: FontMode): FontMode {
  return fontModes[(fontModes.indexOf(font) + 1) % fontModes.length]
}

// Sync settings as the window sees them. The device token stays in main, encrypted at rest.
export type SyncSettingsView = {
  /** From settings.json or the built-in default. Empty when the configured one is not valid. */
  serverUrl: string
  /** The signed-in account's username. Absent before the first sign-in. */
  account?: string
  vaultId?: string
  hasToken: boolean
}

export type SyncStatusView = {
  state: 'unset' | 'idle' | 'syncing' | 'offline' | 'error' | 'blocked'
  pending: number
  lastSyncAt?: number
  lastError?: string
}

// Which vault a status is about. A window only shows the status of its own vault.
export type SyncStatusEvent = SyncStatusView & { dir: string }

// A sign-in, a sign-up or a password reset. The window never sees the device token.
export type SyncAuthInput = {
  username: string
  password: string
  /** Only for a reset. */
  recoveryCode?: string
}

export type SyncAuthResult =
  | {
      ok: true
      settings: SyncSettingsView
      /** Returned once by a registration or a reset; the user has to write it down. */
      recoveryCode?: string
    }
  | { ok: false; error: string }

// What the assistant reads. A note is sent with the editor's text, since the disk may be behind.
// Daily notes are picked by main from the dates, both ends included, as YYYY-MM-DD.
export type AiScope =
  { kind: 'note'; path: VaultPath; text: string } | { kind: 'daily'; from: string; to: string }

export type AiMessage = { role: 'user' | 'assistant'; content: string }

export type AiAskInput = {
  /** Chosen by the window. Every event of this answer carries it. */
  id: string
  dir: string
  scope: AiScope
  /** The conversation so far, ending with the new question. */
  messages: AiMessage[]
}

// One answer streams as sources, then deltas, then done or error.
export type AiEvent =
  | { id: string; kind: 'sources'; sources: { path: VaultPath; chars: number }[] }
  | { id: string; kind: 'delta'; text: string }
  | { id: string; kind: 'done' }
  | { id: string; kind: 'error'; message: string }

// The API key stays in main, encrypted at rest. The window only learns whether one is set.
export type AiSettingsView = { hasKey: boolean }

export type SavedAttachment = {
  path: VaultPath
  embedText: string
}

export type MenuAction =
  | 'new-note'
  | 'quick-open'
  | 'save'
  | 'close-tab'
  | 'next-tab'
  | 'prev-tab'
  | 'search'
  | 'reveal-active-file'
  | 'choose-vault'
  | 'show-in-folder'
  | 'open-with-default-app'
  | 'insert-image'
  | 'toggle-mode'
  | 'toggle-sidebar'
  | 'toggle-theme'
  | 'toggle-font'
  | 'open-settings'
  | 'format-bold'
  | 'format-italic'
  | 'format-strike'
  | 'format-highlight'
  | 'format-code'
  | 'format-link'
  | 'format-codeblock'
  | 'format-quote'
  | 'format-task'
  | 'format-bullet'
  | 'toggle-assistant'

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
  saveAttachment(
    dir: string,
    notePath: VaultPath,
    fileName: string,
    data: Uint8Array
  ): Promise<SavedAttachment>
  chooseAndSaveImage(dir: string, notePath: VaultPath): Promise<SavedAttachment | null>
  // Creates an empty note, and any folders it needs, for a link to a missing note. A note that
  // exists by then is left as it is. Resolves after the vault change is sent.
  createNote(dir: string, path: VaultPath): Promise<void>
  // Hands an http, https or mailto address to the system.
  openExternal(url: string): Promise<void>
  createNoteInVault(dir: string, parentFolder?: VaultPath, initialName?: string): Promise<VaultPath>
  createFolder(dir: string, parentFolder?: VaultPath, initialName?: string): Promise<VaultPath>
  deleteEntry(dir: string, path: VaultPath): Promise<void>
  showInFolder(dir: string, path?: VaultPath): Promise<void>
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
  onMenuAction(callback: (action: MenuAction) => void): () => void
  newWindow(dir?: string): Promise<void>
  getSyncSettings(): Promise<SyncSettingsView>
  syncLogin(input: SyncAuthInput): Promise<SyncAuthResult>
  syncRegister(input: SyncAuthInput): Promise<SyncAuthResult>
  syncRecover(input: SyncAuthInput): Promise<SyncAuthResult>
  clearSyncSettings(): Promise<SyncSettingsView>
  getSyncStatus(dir: string): Promise<SyncStatusView>
  confirmSyncDeletions(dir: string): Promise<void>
  onSyncStatus(callback: (status: SyncStatusEvent) => void): () => void
  getAiSettings(): Promise<AiSettingsView>
  setAiKey(key: string): Promise<AiSettingsView>
  clearAiKey(): Promise<AiSettingsView>
  // Resolves once the answer has started; the answer itself arrives through onAiEvent.
  aiAsk(input: AiAskInput): Promise<void>
  aiCancel(id: string): void
  onAiEvent(callback: (event: AiEvent) => void): () => void
}

export const channels = {
  getVault: 'mote:get-vault',
  chooseVault: 'mote:choose-vault',
  newWindow: 'mote:new-window',
  readNote: 'mote:read-note',
  writeNote: 'mote:write-note',
  openWithDefaultApp: 'mote:open-with-default-app',
  saveAttachment: 'mote:save-attachment',
  chooseAndSaveImage: 'mote:choose-and-save-image',
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
  updateStatus: 'mote:update-status',
  menuAction: 'mote:menu-action',
  getSyncSettings: 'mote:get-sync-settings',
  syncLogin: 'mote:sync-login',
  syncRegister: 'mote:sync-register',
  syncRecover: 'mote:sync-recover',
  clearSyncSettings: 'mote:clear-sync-settings',
  getSyncStatus: 'mote:get-sync-status',
  confirmSyncDeletions: 'mote:confirm-sync-deletions',
  syncStatus: 'mote:sync-status',
  getAiSettings: 'mote:get-ai-settings',
  setAiKey: 'mote:set-ai-key',
  clearAiKey: 'mote:clear-ai-key',
  aiAsk: 'mote:ai-ask',
  aiCancel: 'mote:ai-cancel',
  aiEvent: 'mote:ai-event'
} as const
