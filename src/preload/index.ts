import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  channels,
  type AiEvent,
  type FontMode,
  type MenuAction,
  type MoteApi,
  type SyncStatusEvent,
  type ThemeSource,
  type ThemeState,
  type VaultChange
} from '../core/ipc'
import type { UpdateStatus } from '../core/updaterTypes'

const mote: MoteApi = {
  getVault: () => ipcRenderer.invoke(channels.getVault),
  chooseVault: () => ipcRenderer.invoke(channels.chooseVault),
  readNote: (dir, path) => ipcRenderer.invoke(channels.readNote, dir, path),
  writeNote: (dir, path, text, baseHash) =>
    ipcRenderer.invoke(channels.writeNote, dir, path, text, baseHash),
  openWithDefaultApp: (dir, path) => ipcRenderer.invoke(channels.openWithDefaultApp, dir, path),
  saveAttachment: (dir, notePath, fileName, data) =>
    ipcRenderer.invoke(channels.saveAttachment, dir, notePath, fileName, data),
  chooseAndSaveImage: (dir, notePath) =>
    ipcRenderer.invoke(channels.chooseAndSaveImage, dir, notePath),
  createNote: (dir, path) => ipcRenderer.invoke(channels.createNote, dir, path),
  openExternal: (url) => ipcRenderer.invoke(channels.openExternal, url),
  createNoteInVault: (dir, folder, name) =>
    ipcRenderer.invoke(channels.createNoteInVault, dir, folder, name),
  createFolder: (dir, parent, name) => ipcRenderer.invoke(channels.createFolder, dir, parent, name),
  deleteEntry: (dir, path) => ipcRenderer.invoke(channels.deleteEntry, dir, path),
  showInFolder: (dir, path) => ipcRenderer.invoke(channels.showInFolder, dir, path),
  renameOrMove: (dir, from, to, updateLinks) =>
    ipcRenderer.invoke(channels.renameOrMove, dir, from, to, updateLinks),
  countInboundLinks: (dir, path) => ipcRenderer.invoke(channels.countInboundLinks, dir, path),
  backlinks: (dir, path) => ipcRenderer.invoke(channels.backlinks, dir, path),
  search: (dir, query, limit) => ipcRenderer.invoke(channels.search, dir, query, limit),
  onVaultChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, change: VaultChange): void => callback(change)
    ipcRenderer.on(channels.vaultChanged, listener)
    return () => ipcRenderer.off(channels.vaultChanged, listener)
  },
  onCloseRequested: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(channels.closeRequested, listener)
    return () => ipcRenderer.off(channels.closeRequested, listener)
  },
  respondToClose: (ready) => ipcRenderer.send(channels.respondToClose, ready),
  getTheme: () => ipcRenderer.invoke(channels.getTheme),
  setTheme: (theme: ThemeSource) => ipcRenderer.invoke(channels.setTheme, theme),
  toggleTheme: () => ipcRenderer.invoke(channels.toggleTheme),
  onThemeChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, state: ThemeState): void => callback(state)
    ipcRenderer.on(channels.themeChanged, listener)
    return () => ipcRenderer.off(channels.themeChanged, listener)
  },
  getFont: () => ipcRenderer.invoke(channels.getFont),
  setFont: (font: FontMode) => ipcRenderer.invoke(channels.setFont, font),
  toggleFont: () => ipcRenderer.invoke(channels.toggleFont),
  onFontChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, font: FontMode): void => callback(font)
    ipcRenderer.on(channels.fontChanged, listener)
    return () => ipcRenderer.off(channels.fontChanged, listener)
  },
  checkForUpdates: () => ipcRenderer.invoke(channels.checkForUpdates),
  downloadUpdate: () => ipcRenderer.invoke(channels.downloadUpdate),
  installUpdate: () => ipcRenderer.invoke(channels.installUpdate),
  getAppVersion: () => ipcRenderer.invoke(channels.getAppVersion),
  onUpdateStatus: (callback) => {
    const listener = (_event: IpcRendererEvent, status: UpdateStatus): void => callback(status)
    ipcRenderer.on(channels.updateStatus, listener)
    return () => ipcRenderer.off(channels.updateStatus, listener)
  },
  onMenuAction: (callback) => {
    const listener = (_event: IpcRendererEvent, action: MenuAction): void => callback(action)
    ipcRenderer.on(channels.menuAction, listener)
    return () => ipcRenderer.off(channels.menuAction, listener)
  },
  newWindow: (dir?: string) => ipcRenderer.invoke(channels.newWindow, dir),
  getSyncSettings: () => ipcRenderer.invoke(channels.getSyncSettings),
  syncLogin: (input) => ipcRenderer.invoke(channels.syncLogin, input),
  syncRegister: (input) => ipcRenderer.invoke(channels.syncRegister, input),
  syncRecover: (input) => ipcRenderer.invoke(channels.syncRecover, input),
  clearSyncSettings: () => ipcRenderer.invoke(channels.clearSyncSettings),
  getSyncStatus: (dir) => ipcRenderer.invoke(channels.getSyncStatus, dir),
  confirmSyncDeletions: (dir) => ipcRenderer.invoke(channels.confirmSyncDeletions, dir),
  onSyncStatus: (callback) => {
    const listener = (_event: IpcRendererEvent, status: SyncStatusEvent): void => callback(status)
    ipcRenderer.on(channels.syncStatus, listener)
    return () => ipcRenderer.off(channels.syncStatus, listener)
  },
  getAiSettings: () => ipcRenderer.invoke(channels.getAiSettings),
  setAiKey: (key) => ipcRenderer.invoke(channels.setAiKey, key),
  clearAiKey: () => ipcRenderer.invoke(channels.clearAiKey),
  listTags: (dir) => ipcRenderer.invoke(channels.listTags, dir),
  aiAsk: (input) => ipcRenderer.invoke(channels.aiAsk, input),
  aiCancel: (id) => ipcRenderer.send(channels.aiCancel, id),
  onAiEvent: (callback) => {
    const listener = (_event: IpcRendererEvent, event: AiEvent): void => callback(event)
    ipcRenderer.on(channels.aiEvent, listener)
    return () => ipcRenderer.off(channels.aiEvent, listener)
  }
}

contextBridge.exposeInMainWorld('mote', mote)
