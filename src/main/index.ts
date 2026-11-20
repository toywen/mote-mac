import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { optimizer, is } from '@electron-toolkit/utils'
import { channels, type ContentHash, type VaultPath } from '../core/ipc'
import { Vault } from './vault'

let window: BrowserWindow | undefined
let vault: Vault | undefined
let choosingVault = false
let closing = false
let quitting = false

function currentVault(dir: string): Vault {
  if (!vault || vault.dir !== dir) throw new Error('笔记库已切换')
  return vault
}

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

function openVault(dir: string): Promise<Vault> {
  return Vault.open(dir, (change) => {
    if (vault?.dir === change.dir) window?.webContents.send(channels.vaultChanged, change)
  })
}

ipcMain.handle(channels.getVault, () => vault?.info() ?? null)
ipcMain.handle(channels.chooseVault, async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner || choosingVault) return null
  choosingVault = true
  try {
    const choice = await dialog.showOpenDialog(owner, {
      title: '打开笔记库',
      defaultPath: vault?.dir,
      properties: ['openDirectory']
    })
    const dir = choice.filePaths[0]
    if (choice.canceled || !dir) return null
    const next = await openVault(dir)
    try {
      await mkdir(app.getPath('userData'), { recursive: true })
      await writeFile(settingsFile() + '.tmp', JSON.stringify({ lastVault: next.dir }))
      await rename(settingsFile() + '.tmp', settingsFile())
    } catch (error) {
      next.close()
      throw error
    }
    vault?.close()
    vault = next
    return vault.info()
  } finally {
    choosingVault = false
  }
})

ipcMain.handle(channels.readNote, (_event, dir: string, path: VaultPath) =>
  currentVault(dir).readNote(path)
)
ipcMain.handle(
  channels.writeNote,
  (_event, dir: string, path: VaultPath, text: string, baseHash: ContentHash | null) =>
    currentVault(dir).writeNote(path, text, baseHash)
)
ipcMain.handle(channels.openWithDefaultApp, async (_event, dir: string, path: VaultPath) => {
  const file = await currentVault(dir).filePath(path)
  if (!(await lstat(file)).isFile()) throw new Error('无法打开该文件')
  const error = await shell.openPath(file)
  if (error) throw new Error(error)
})

ipcMain.on(channels.respondToClose, (event, ready: boolean) => {
  if (!closing || window?.webContents !== event.sender) return
  closing = false
  if (ready) {
    window.destroy()
  } else {
    quitting = false
  }
})

app.on('before-quit', (event) => {
  quitting = true
  if (!window) return
  event.preventDefault()
  window.close()
})

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window = mainWindow

  mainWindow.on('close', (event) => {
    if (mainWindow.webContents.isCrashed() || mainWindow.webContents.isLoadingMainFrame()) return
    event.preventDefault()
    if (closing) return
    closing = true
    mainWindow.webContents.send(channels.closeRequested)
  })
  mainWindow.on('closed', () => {
    window = undefined
    closing = false
    if (quitting) app.quit()
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  try {
    const { lastVault } = JSON.parse(await readFile(settingsFile(), 'utf8'))
    if (typeof lastVault === 'string') vault = await openVault(lastVault)
  } catch {
    // An unavailable vault can be selected again in the window.
  }
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
