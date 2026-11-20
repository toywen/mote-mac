import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { channels, type MoteApi, type VaultChange } from '../core/ipc'

const mote: MoteApi = {
  getVault: () => ipcRenderer.invoke(channels.getVault),
  chooseVault: () => ipcRenderer.invoke(channels.chooseVault),
  readNote: (dir, path) => ipcRenderer.invoke(channels.readNote, dir, path),
  writeNote: (dir, path, text, baseHash) =>
    ipcRenderer.invoke(channels.writeNote, dir, path, text, baseHash),
  openWithDefaultApp: (dir, path) => ipcRenderer.invoke(channels.openWithDefaultApp, dir, path),
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
  respondToClose: (ready) => ipcRenderer.send(channels.respondToClose, ready)
}

contextBridge.exposeInMainWorld('mote', mote)
