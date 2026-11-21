import { app, shell, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, Menu } from 'electron'
import { basename, join } from 'path'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { optimizer, is } from '@electron-toolkit/utils'
import { fileScheme } from '../core/fileUrl'
import {
  channels,
  type ContentHash,
  type FontMode,
  type ThemeSource,
  type ThemeState,
  type VaultPath
} from '../core/ipc'
import { serveFile } from './fileProtocol'
import { isAllowedExternal } from '../core/linkDest'
import { Vault, type JournalHandler, type RenameJournal } from './vault'
import { registerUpdaterIpc, Updater } from './updater'
import { buildApplicationMenu } from './menu'

app.setName('mote')

let window: BrowserWindow | undefined
let vault: Vault | undefined
let choosingVault = false
let closing = false
let quitting = false

// Standard, so a mote-file URL has a host and a path. Secure, so the window's images and videos
// from it are not mixed content. Stream and supportFetchAPI allow video playback and streaming.
protocol.registerSchemesAsPrivileged([
  {
    scheme: fileScheme,
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

function currentVault(dir: string): Vault {
  if (!vault || vault.dir !== dir) throw new Error('笔记库已切换')
  return vault
}

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')
const journalFile = (): string => join(app.getPath('userData'), 'journal.json')

type AppSettings = {
  lastVault?: string
  theme?: ThemeSource
  font?: FontMode
}

let currentFont: FontMode = 'kai'

async function readSettings(): Promise<AppSettings> {
  try {
    return JSON.parse(await readFile(settingsFile(), 'utf8')) as AppSettings
  } catch {
    return {}
  }
}

async function writeSettings(update: Partial<AppSettings>): Promise<void> {
  const current = await readSettings()
  const next = { ...current, ...update }
  await mkdir(app.getPath('userData'), { recursive: true })
  const tmp = settingsFile() + '.tmp'
  await writeFile(tmp, JSON.stringify(next))
  await rename(tmp, settingsFile())
}

const journalHandler: JournalHandler = {
  async read() {
    try {
      const raw = await readFile(journalFile(), 'utf8')
      return JSON.parse(raw) as RenameJournal
    } catch {
      return null
    }
  },
  async write(journal: RenameJournal) {
    await mkdir(app.getPath('userData'), { recursive: true })
    const tmp = journalFile() + '.tmp'
    await writeFile(tmp, JSON.stringify(journal))
    await rename(tmp, journalFile())
  },
  async clear() {
    await rm(journalFile()).catch(() => {})
  }
}

// The --background of src/renderer/src/assets/main.css, so a dark window never flashes white.
const windowBackground = (): string => (nativeTheme.shouldUseDarkColors ? '#1c1b18' : '#fcfbf8')

function openVault(dir: string): Promise<Vault> {
  return Vault.open(
    dir,
    (change) => {
      if (vault?.dir === change.dir) window?.webContents.send(channels.vaultChanged, change)
    },
    journalHandler
  )
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
      await writeSettings({ lastVault: next.dir })
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
ipcMain.handle(channels.backlinks, (_event, dir: string, path: VaultPath) =>
  currentVault(dir).backlinks(path)
)
ipcMain.handle(channels.search, (_event, dir: string, query: string, limit: number) =>
  currentVault(dir).search(query, limit)
)
ipcMain.handle(channels.openWithDefaultApp, async (_event, dir: string, path: VaultPath) => {
  const file = await currentVault(dir).filePath(path)
  if (!(await lstat(file)).isFile()) throw new Error('无法打开该文件')
  const error = await shell.openPath(file)
  if (error) throw new Error(error)
})
ipcMain.handle(
  channels.saveAttachment,
  (_event, dir: string, notePath: VaultPath, fileName: string, data: Uint8Array) =>
    currentVault(dir).saveAttachment(notePath, fileName, Buffer.from(data))
)
ipcMain.handle(channels.chooseAndSaveImage, async (_event, dir: string, notePath: VaultPath) => {
  const win = BrowserWindow.getFocusedWindow() ?? window
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    title: '插入图片',
    properties: ['openFile'],
    filters: [
      {
        name: '图片',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif']
      }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  const fileName = basename(filePath)
  const data = await readFile(filePath)
  return currentVault(dir).saveAttachment(notePath, fileName, data)
})
ipcMain.handle(channels.createNote, (_event, dir: string, path: VaultPath) =>
  currentVault(dir).createNote(path)
)
ipcMain.handle(
  channels.createNoteInVault,
  (_event, dir: string, parentFolder?: VaultPath, initialName?: string) =>
    currentVault(dir).createNoteInVault(parentFolder, initialName)
)
ipcMain.handle(
  channels.createFolder,
  (_event, dir: string, parentFolder?: VaultPath, initialName?: string) =>
    currentVault(dir).createFolder(parentFolder, initialName)
)
ipcMain.handle(channels.deleteEntry, async (_event, dir: string, path: VaultPath) => {
  const v = currentVault(dir)
  const full = await v.resolvePath(path)
  await shell.trashItem(full)
  await v.deleteEntry(path)
})
ipcMain.handle(channels.showInFolder, async (_event, dir: string, path: VaultPath) => {
  const v = currentVault(dir)
  const full = await v.resolvePath(path)
  shell.showItemInFolder(full)
})
ipcMain.handle(
  channels.renameOrMove,
  (_event, dir: string, from: VaultPath, to: VaultPath, updateLinks: boolean) =>
    currentVault(dir).renameOrMove(from, to, updateLinks, journalHandler)
)
ipcMain.handle(channels.countInboundLinks, (_event, dir: string, path: VaultPath) =>
  currentVault(dir).countInboundLinks(path)
)
// Main is the boundary, so it checks the address again before the system opens it.
ipcMain.handle(channels.openExternal, async (_event, url: string) => {
  if (typeof url !== 'string' || !isAllowedExternal(url)) throw new Error('无法打开该地址')
  await shell.openExternal(url)
})

ipcMain.handle(channels.getTheme, (): ThemeState => ({
  source: nativeTheme.themeSource,
  shouldUseDarkColors: nativeTheme.shouldUseDarkColors
}))

ipcMain.handle(channels.setTheme, async (_event, theme: ThemeSource): Promise<ThemeState> => {
  nativeTheme.themeSource = theme
  await writeSettings({ theme })
  return {
    source: nativeTheme.themeSource,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors
  }
})

ipcMain.handle(channels.toggleTheme, async (): Promise<ThemeState> => {
  const next: ThemeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark'
  nativeTheme.themeSource = next
  await writeSettings({ theme: next })
  return {
    source: nativeTheme.themeSource,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors
  }
})

ipcMain.handle(channels.getFont, (): FontMode => currentFont)

ipcMain.handle(channels.setFont, async (_event, font: FontMode): Promise<FontMode> => {
  currentFont = font
  await writeSettings({ font })
  window?.webContents.send(channels.fontChanged, currentFont)
  return currentFont
})

ipcMain.handle(channels.toggleFont, async (): Promise<FontMode> => {
  currentFont = currentFont === 'kai' ? 'hei' : 'kai'
  await writeSettings({ font: currentFont })
  window?.webContents.send(channels.fontChanged, currentFont)
  return currentFont
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
    title: 'mote',
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: windowBackground(),
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
    if (isAllowedExternal(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  // The window only ever shows mote. A page from anywhere else, such as a file dropped on the
  // window, would get window.mote and with it the vault.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== mainWindow.webContents.getURL().split('#')[0]) event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  try {
    const settings = await readSettings()
    if (typeof settings.lastVault === 'string') vault = await openVault(settings.lastVault)
    if (settings.theme === 'light' || settings.theme === 'dark' || settings.theme === 'system') {
      nativeTheme.themeSource = settings.theme
    }
    if (settings.font === 'kai' || settings.font === 'hei') {
      currentFont = settings.font
    }
  } catch {
    // An unavailable vault can be selected again in the window.
  }
  Menu.setApplicationMenu(buildApplicationMenu())
  registerUpdaterIpc()
  protocol.handle(fileScheme, (request) => serveFile(vault, request))
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  nativeTheme.on('updated', () => {
    window?.setBackgroundColor(windowBackground())
    window?.webContents.send(channels.themeChanged, {
      source: nativeTheme.themeSource,
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors
    })
  })
  createWindow()
  setTimeout(() => {
    void Updater.getInstance().checkForUpdates()
  }, 3000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
