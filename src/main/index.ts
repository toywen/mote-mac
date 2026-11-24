import {
  app,
  shell,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  Menu,
  webContents
} from 'electron'
import { basename, join, resolve } from 'path'
import { hostname } from 'node:os'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { optimizer, is } from '@electron-toolkit/utils'
import { fileScheme } from '../core/fileUrl'
import {
  channels,
  type ContentHash,
  type FontMode,
  type SyncSaveInput,
  type SyncSaveResult,
  type SyncSettingsView,
  type SyncStatusView,
  type ThemeSource,
  type ThemeState,
  type VaultPath
} from '../core/ipc'
import { serveFile } from './fileProtocol'
import { isAllowedExternal } from '../core/linkDest'
import { Vault } from './vault'
import { getJournalHandler, openToken, readSettings, sealToken, writeSettings } from './appData'
import type { SyncSettings } from './appData'
import { SyncController } from './syncController'
import { checkServerUrl, colonFingerprint, fingerprintOf, parseCert } from './syncCert'
import { registerUpdaterIpc, Updater } from './updater'
import { buildApplicationMenu } from './menu'

app.setName('mote')

const windows = new Set<BrowserWindow>()
const vaults = new Map<string, Vault>()
const syncControllers = new Map<string, SyncController>()
const vaultDirByWebContentsId = new Map<number, string>()
const closingWindowIds = new Set<number>()
let choosingVault = false
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
  const v = vaults.get(dir)
  if (!v) throw new Error(`笔记库未打开: ${dir}`)
  return v
}

let currentFont: FontMode = 'kai'

const windowBackground = (): string => (nativeTheme.shouldUseDarkColors ? '#1c1b18' : '#fcfbf8')

async function getOrOpenVault(dir: string): Promise<Vault> {
  // The vault is keyed by its real path, as Vault.open resolves it, so every lookup agrees.
  const root = await realpath(resolve(dir)).catch(() => resolve(dir))
  const existing = vaults.get(root)
  if (existing) return existing
  const next = await Vault.open(
    root,
    (change) => {
      for (const [wcId, vDir] of vaultDirByWebContentsId.entries()) {
        if (vDir === change.dir) {
          const contents = webContents.fromId(wcId)
          if (contents && !contents.isDestroyed()) {
            contents.send(channels.vaultChanged, change)
          }
        }
      }
    },
    getJournalHandler(dir)
  )
  vaults.set(next.dir, next)
  void applySyncSettings(next.dir)
  return next
}

/**
 * One controller per open vault. Its status goes to the windows showing that vault, so a window
 * with another vault never shows this one's state.
 */
function syncControllerFor(dir: string): SyncController | null {
  const vault = vaults.get(dir)
  if (!vault) return null
  let controller = syncControllers.get(dir)
  if (!controller) {
    controller = new SyncController(vault, join(app.getPath('userData'), 'sync'), hostname(), (full) =>
      shell.trashItem(full)
    )
    controller.onStatus((status) => {
      for (const [wcId, vDir] of vaultDirByWebContentsId.entries()) {
        if (vDir !== dir) continue
        const contents = webContents.fromId(wcId)
        if (contents && !contents.isDestroyed()) {
          contents.send(channels.syncStatus, { ...status, dir })
        }
      }
    })
    syncControllers.set(dir, controller)
  }
  return controller
}

/** Starts, restarts or stops sync for one vault from what settings.json says. */
async function applySyncSettings(dir: string): Promise<SyncStatusView> {
  const controller = syncControllerFor(dir)
  if (!controller) return { state: 'unset', pending: 0 }
  const sync = (await readSettings()).sync
  if (!sync) {
    await controller.apply(null)
    return controller.status()
  }
  const token = openToken(sync.tokenCipher)
  if (!token) {
    await controller.apply(null)
    controller.fail('设备令牌无法读取，请在偏好设置里重新填写')
    return controller.status()
  }
  await controller.apply({
    serverUrl: sync.serverUrl,
    certPem: sync.certPem,
    token,
    vaultId: sync.vaultId
  })
  return controller.status()
}

function syncView(sync?: SyncSettings): SyncSettingsView {
  if (!sync) return { serverUrl: '', fingerprint: null, hasToken: false }
  let fingerprint: string | null = null
  if (sync.certPem) {
    try {
      fingerprint = colonFingerprint(fingerprintOf(sync.certPem))
    } catch {
      fingerprint = null
    }
  }
  return {
    serverUrl: sync.serverUrl,
    certPem: sync.certPem,
    fingerprint,
    vaultId: sync.vaultId,
    hasToken: true
  }
}

ipcMain.handle(channels.getVault, (event) => {
  const dir = vaultDirByWebContentsId.get(event.sender.id)
  if (dir) return vaults.get(dir)?.info() ?? null
  return null
})

ipcMain.handle(channels.chooseVault, async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner || choosingVault) return null
  choosingVault = true
  try {
    const currentDir = vaultDirByWebContentsId.get(event.sender.id)
    const choice = await dialog.showOpenDialog(owner, {
      title: '打开笔记库',
      defaultPath: currentDir,
      properties: ['openDirectory']
    })
    const picked = choice.filePaths[0]
    if (choice.canceled || !picked) return null
    const dir = await realpath(picked).catch(() => picked)

    for (const [wcId, vDir] of vaultDirByWebContentsId.entries()) {
      if (vDir === dir && wcId !== event.sender.id) {
        const otherWin = BrowserWindow.getAllWindows().find((w) => w.webContents.id === wcId)
        if (otherWin && !otherWin.isDestroyed()) {
          otherWin.focus()
          return null
        }
      }
    }

    const next = await getOrOpenVault(dir)
    const oldDir = vaultDirByWebContentsId.get(event.sender.id)
    vaultDirByWebContentsId.set(event.sender.id, next.dir)

    try {
      await writeSettings({ lastVault: next.dir })
    } catch {
      // ignore settings write failure
    }

    if (
      oldDir &&
      oldDir !== next.dir &&
      !Array.from(vaultDirByWebContentsId.values()).includes(oldDir)
    ) {
      const oldV = vaults.get(oldDir)
      if (oldV) {
        oldV.close()
        vaults.delete(oldDir)
        const oldSync = syncControllers.get(oldDir)
        if (oldSync) {
          syncControllers.delete(oldDir)
          void oldSync.stop()
        }
      }
    }

    return next.info()
  } finally {
    choosingVault = false
  }
})

ipcMain.handle(channels.newWindow, async (event, dir?: string) => {
  const targetDir = dir ?? vaultDirByWebContentsId.get(event.sender.id)
  await createWindow(targetDir)
})

ipcMain.handle(channels.getSyncSettings, async (): Promise<SyncSettingsView> => {
  return syncView((await readSettings()).sync)
})

ipcMain.handle(
  channels.saveSyncSettings,
  async (event, input: SyncSaveInput): Promise<SyncSaveResult> => {
    const dir = vaultDirByWebContentsId.get(event.sender.id)
    if (!dir) return { ok: false, error: '先打开一个笔记库' }
    const controller = syncControllerFor(dir)
    if (!controller) return { ok: false, error: '笔记库未打开' }

    const url = checkServerUrl(input.serverUrl)
    if (!url.ok) return { ok: false, error: url.error }
    const certPem = input.certPem?.trim() || undefined
    if (url.url.startsWith('https:') && !certPem) {
      return { ok: false, error: 'https 地址要填证书' }
    }
    if (certPem) {
      const parsed = parseCert(certPem)
      if (!parsed.ok) return { ok: false, error: parsed.error }
    }

    const current = (await readSettings()).sync
    const token = input.token?.trim() || (current ? openToken(current.tokenCipher) : null)
    if (!token) return { ok: false, error: '请填写设备令牌' }

    let tokenCipher: string
    try {
      tokenCipher = sealToken(token)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }

    const sameServer = current !== undefined && current.serverUrl === url.url
    await controller.apply({ serverUrl: url.url, certPem, token, vaultId: sameServer ? current.vaultId : undefined })
    const next: SyncSettings = {
      serverUrl: url.url,
      certPem,
      tokenCipher,
      vaultId: controller.resolvedVaultId()
    }
    await writeSettings({ sync: next })

    const status = controller.status()
    if (status.state === 'error') {
      return { ok: false, error: status.lastError ?? '连不上同步服务' }
    }
    return { ok: true, settings: syncView(next) }
  }
)

ipcMain.handle(channels.clearSyncSettings, async (): Promise<SyncSettingsView> => {
  await writeSettings({ sync: undefined })
  await Promise.all([...syncControllers.values()].map((controller) => controller.apply(null)))
  return syncView(undefined)
})

ipcMain.handle(channels.chooseSyncCert, async (event): Promise<string | null> => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
  if (!win) return null
  const choice = await dialog.showOpenDialog(win, {
    title: '选择同步服务的证书',
    properties: ['openFile'],
    filters: [{ name: '证书', extensions: ['pem', 'crt', 'cer'] }]
  })
  const file = choice.filePaths[0]
  if (choice.canceled || !file) return null
  return await readFile(file, 'utf8')
})

ipcMain.handle(
  channels.getSyncStatus,
  (_event, dir: string): SyncStatusView =>
    syncControllers.get(dir)?.status() ?? { state: 'unset', pending: 0 }
)

ipcMain.handle(channels.confirmSyncDeletions, (_event, dir: string) => {
  syncControllers.get(dir)?.confirmDeletions()
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
ipcMain.handle(channels.chooseAndSaveImage, async (event, dir: string, notePath: VaultPath) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
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
  await currentVault(dir).trash(path, (full) => shell.trashItem(full))
})
ipcMain.handle(channels.showInFolder, async (_event, dir: string, path?: VaultPath) => {
  const v = currentVault(dir)
  if (!path) {
    await shell.openPath(v.dir)
    return
  }
  shell.showItemInFolder(await v.filePath(path))
})
ipcMain.handle(
  channels.renameOrMove,
  (_event, dir: string, from: VaultPath, to: VaultPath, updateLinks: boolean) =>
    currentVault(dir).renameOrMove(from, to, updateLinks, getJournalHandler(dir))
)
ipcMain.handle(channels.countInboundLinks, (_event, dir: string, path: VaultPath) =>
  currentVault(dir).countInboundLinks(path)
)
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
  for (const win of windows) {
    if (!win.isDestroyed()) win.webContents.send(channels.fontChanged, currentFont)
  }
  return currentFont
})

ipcMain.handle(channels.toggleFont, async (): Promise<FontMode> => {
  currentFont = currentFont === 'kai' ? 'hei' : 'kai'
  await writeSettings({ font: currentFont })
  for (const win of windows) {
    if (!win.isDestroyed()) win.webContents.send(channels.fontChanged, currentFont)
  }
  return currentFont
})

ipcMain.on(channels.respondToClose, (event, ready: boolean) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || !closingWindowIds.has(win.id)) return
  closingWindowIds.delete(win.id)
  if (ready) {
    win.destroy()
  } else {
    quitting = false
  }
})

app.on('before-quit', (event) => {
  quitting = true
  for (const controller of syncControllers.values()) void controller.stop()
  if (windows.size === 0) return
  event.preventDefault()
  for (const win of windows) {
    if (!win.isDestroyed()) win.close()
  }
})

async function createWindow(targetVaultDir?: string): Promise<BrowserWindow> {
  let initialVaultDir = targetVaultDir
  if (!initialVaultDir && vaults.size === 0) {
    try {
      const settings = await readSettings()
      if (typeof settings.lastVault === 'string') {
        initialVaultDir = settings.lastVault
      }
    } catch {
      // ignore
    }
  }

  if (initialVaultDir) {
    try {
      await getOrOpenVault(initialVaultDir)
    } catch {
      initialVaultDir = undefined
    }
  }

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
      sandbox: true,
      plugins: true
    }
  })

  const windowId = mainWindow.id
  const webContentsId = mainWindow.webContents.id

  windows.add(mainWindow)
  if (initialVaultDir) {
    vaultDirByWebContentsId.set(webContentsId, initialVaultDir)
  }

  mainWindow.on('close', (event) => {
    if (
      mainWindow.isDestroyed() ||
      mainWindow.webContents.isCrashed() ||
      mainWindow.webContents.isLoadingMainFrame()
    )
      return
    if (closingWindowIds.has(windowId)) return
    event.preventDefault()
    closingWindowIds.add(windowId)
    mainWindow.webContents.send(channels.closeRequested)
  })

  mainWindow.on('closed', () => {
    closingWindowIds.delete(windowId)
    windows.delete(mainWindow)
    const dir = vaultDirByWebContentsId.get(webContentsId)
    vaultDirByWebContentsId.delete(webContentsId)
    if (dir && !Array.from(vaultDirByWebContentsId.values()).includes(dir)) {
      const v = vaults.get(dir)
      if (v) {
        v.close()
        vaults.delete(dir)
      }
    }
    if (quitting && windows.size === 0) app.quit()
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternal(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return
    const url = event.url
    if (url.startsWith('mote-file:')) return
    if (isAllowedExternal(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== mainWindow.webContents.getURL().split('#')[0]) event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  let defaultDir: string | undefined
  try {
    const settings = await readSettings()
    if (typeof settings.lastVault === 'string') defaultDir = settings.lastVault
    if (settings.theme === 'light' || settings.theme === 'dark' || settings.theme === 'system') {
      nativeTheme.themeSource = settings.theme
    }
    if (settings.font === 'kai' || settings.font === 'hei') {
      currentFont = settings.font
    }
  } catch {
    // An unavailable vault can be selected again in the window.
  }
  Menu.setApplicationMenu(
    buildApplicationMenu((targetWin) => {
      const win =
        (targetWin instanceof BrowserWindow ? targetWin : null) ?? BrowserWindow.getFocusedWindow()
      const targetDir = win ? vaultDirByWebContentsId.get(win.webContents.id) : undefined
      void createWindow(targetDir)
    })
  )
  registerUpdaterIpc()
  protocol.handle(fileScheme, (request) => {
    const focused = BrowserWindow.getFocusedWindow()
    const focusedVaultDir = focused
      ? vaultDirByWebContentsId.get(focused.webContents.id)
      : undefined
    const focusedVault = focusedVaultDir ? vaults.get(focusedVaultDir) : undefined
    const list: Vault[] = []
    if (focusedVault) list.push(focusedVault)
    for (const v of vaults.values()) {
      if (v !== focusedVault) list.push(v)
    }
    return serveFile(list, request)
  })
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  nativeTheme.on('updated', () => {
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.setBackgroundColor(windowBackground())
        win.webContents.send(channels.themeChanged, {
          source: nativeTheme.themeSource,
          shouldUseDarkColors: nativeTheme.shouldUseDarkColors
        })
      }
    }
  })
  await createWindow(defaultDir)
  // Only a packaged app can install an update. Dev and e2e builds must not reach the network.
  if (app.isPackaged)
    setTimeout(() => {
      void Updater.getInstance().checkForUpdates()
    }, 3000)
  app.on('activate', () => {
    if (windows.size === 0) void createWindow()
  })
})
