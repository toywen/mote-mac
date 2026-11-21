import { spawn } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import https from 'node:https'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { channels } from '../core/ipc.js'
import {
  isNewerVersion,
  pickBestAsset,
  type ReleaseAsset,
  type ReleaseInfo,
  type UpdateStatus
} from '../core/updaterTypes.js'

interface GitHubAsset {
  name: string
  browser_download_url: string
  size: number
  content_type: string
}

interface GitHubReleaseResponse {
  tag_name: string
  name?: string
  body?: string
  published_at?: string
  html_url?: string
  assets?: GitHubAsset[]
}

export class Updater {
  private static instance: Updater | null = null

  private status: UpdateStatus = {
    state: 'idle',
    currentVersion: app.isPackaged ? app.getVersion() : '1.0.0'
  }

  private repo = 'toywen/mote-mac'
  private updateDir: string

  private constructor() {
    this.updateDir = path.join(homedir(), 'Library/Caches/mote/updates')
    if (!existsSync(this.updateDir)) {
      try {
        mkdirSync(this.updateDir, { recursive: true })
      } catch {
        this.updateDir = path.join(tmpdir(), 'mote-updates')
        mkdirSync(this.updateDir, { recursive: true })
      }
    }
  }

  public static getInstance(): Updater {
    if (!Updater.instance) {
      Updater.instance = new Updater()
    }
    return Updater.instance
  }

  public getStatus(): UpdateStatus {
    return { ...this.status }
  }

  private broadcastStatus(): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channels.updateStatus, this.getStatus())
      }
    }
  }

  private setStatus(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    this.broadcastStatus()
  }

  public async checkForUpdates(): Promise<UpdateStatus> {
    if (this.status.state === 'checking' || this.status.state === 'downloading') {
      return this.getStatus()
    }

    this.setStatus({ state: 'checking', error: undefined })

    try {
      const releaseData = await this.fetchLatestRelease()
      const remoteTag = releaseData.tag_name || ''
      const currentVer = app.isPackaged ? app.getVersion() : '1.0.0'

      if (!isNewerVersion(remoteTag, currentVer)) {
        this.setStatus({
          state: 'not-available',
          currentVersion: currentVer,
          release: undefined
        })
        return this.getStatus()
      }

      const rawAssets: ReleaseAsset[] = (releaseData.assets || []).map((a) => ({
        name: a.name,
        browserDownloadUrl: a.browser_download_url,
        size: a.size || 0,
        contentType: a.content_type || ''
      }))

      const bestAsset = pickBestAsset(rawAssets, process.arch)
      if (!bestAsset) {
        this.setStatus({
          state: 'error',
          error: `发现新版本 ${remoteTag}，但未找到适用于 macOS (${process.arch}) 的安装包。`
        })
        return this.getStatus()
      }

      const release: ReleaseInfo = {
        version: remoteTag.replace(/^v/i, ''),
        tagName: remoteTag,
        name: releaseData.name || remoteTag,
        body: releaseData.body || '',
        publishedAt: releaseData.published_at || new Date().toISOString(),
        htmlUrl:
          releaseData.html_url || `https://github.com/${this.repo}/releases/tag/${remoteTag}`,
        asset: bestAsset
      }

      this.setStatus({
        state: 'available',
        currentVersion: currentVer,
        release
      })

      return this.getStatus()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      this.setStatus({
        state: 'error',
        error: `检查更新失败: ${message}`
      })
      return this.getStatus()
    }
  }

  public async downloadUpdate(): Promise<void> {
    if (this.status.state !== 'available' || !this.status.release) {
      throw new Error('没有可下载的更新')
    }

    const { asset, tagName } = this.status.release
    const downloadUrl = asset.browserDownloadUrl
    const targetFile = path.join(this.updateDir, `${tagName}-${asset.name}`)

    this.setStatus({
      state: 'downloading',
      progress: {
        percent: 0,
        bytesDownloaded: 0,
        totalBytes: asset.size
      }
    })

    try {
      await this.downloadFile(downloadUrl, targetFile, (bytesDownloaded, totalBytes) => {
        const percent =
          totalBytes > 0 ? Math.min(100, Math.round((bytesDownloaded / totalBytes) * 100)) : 0
        this.setStatus({
          progress: {
            percent,
            bytesDownloaded,
            totalBytes
          }
        })
      })

      this.setStatus({
        state: 'downloaded',
        downloadedFilePath: targetFile,
        progress: {
          percent: 100,
          bytesDownloaded: asset.size,
          totalBytes: asset.size
        }
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      this.setStatus({
        state: 'error',
        error: `下载更新失败: ${message}`
      })
      throw err
    }
  }

  public async installUpdate(): Promise<void> {
    if (this.status.state !== 'downloaded' || !this.status.downloadedFilePath) {
      throw new Error('更新文件未就绪')
    }

    const filePath = this.status.downloadedFilePath
    if (!existsSync(filePath)) {
      this.setStatus({
        state: 'error',
        error: '更新文件在磁盘上丢失，请重新检查更新'
      })
      throw new Error('更新文件不存在')
    }

    this.setStatus({ state: 'installing' })

    // Development mode safety check
    if (!app.isPackaged) {
      console.log('[Updater] Development mode: Simulated install for', filePath)
      this.setStatus({
        state: 'error',
        error: '当前处于开发模式，已跳过覆盖本地应用。安装包位于: ' + filePath
      })
      return
    }

    const currentAppPath = path.resolve(process.execPath, '../../..')
    const currentPid = process.pid

    try {
      let stagedAppPath: string

      if (filePath.endsWith('.zip')) {
        const extractDir = path.join(this.updateDir, `extracted-${Date.now()}`)
        mkdirSync(extractDir, { recursive: true })
        await this.runCommand('/usr/bin/unzip', ['-q', '-o', filePath, '-d', extractDir])

        const entries = readdirSync(extractDir)
        const appName = entries.find((e) => e.endsWith('.app'))
        if (!appName) {
          throw new Error('更新压缩包中未找到 .app 应用程序')
        }
        stagedAppPath = path.join(extractDir, appName)
      } else if (filePath.endsWith('.dmg')) {
        // Mount DMG, copy .app, unmount DMG
        const mountPoint = path.join(tmpdir(), `mote-mount-${Date.now()}`)
        mkdirSync(mountPoint, { recursive: true })
        await this.runCommand('/usr/bin/hdiutil', [
          'attach',
          '-nobrowse',
          '-readonly',
          '-mountpoint',
          mountPoint,
          filePath
        ])

        try {
          const entries = readdirSync(mountPoint)
          const appName = entries.find((e) => e.endsWith('.app'))
          if (!appName) {
            throw new Error('DMG 中未找到 .app 应用程序')
          }
          const extractDir = path.join(this.updateDir, `dmg-extracted-${Date.now()}`)
          mkdirSync(extractDir, { recursive: true })
          stagedAppPath = path.join(extractDir, appName)
          await this.runCommand('/bin/cp', ['-R', path.join(mountPoint, appName), stagedAppPath])
        } finally {
          await this.runCommand('/usr/bin/hdiutil', ['detach', mountPoint, '-force']).catch(
            () => {}
          )
        }
      } else {
        throw new Error('不支持的更新文件格式: ' + path.extname(filePath))
      }

      // Generate replacement launcher script
      const scriptPath = path.join(this.updateDir, 'apply-update.sh')
      const scriptContent = `#!/bin/bash
while kill -0 ${currentPid} 2>/dev/null; do
  sleep 0.2
done
rm -rf "${currentAppPath}"
cp -R "${stagedAppPath}" "${currentAppPath}"
open "${currentAppPath}"
`
      writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

      const child = spawn('/bin/bash', [scriptPath], {
        detached: true,
        stdio: 'ignore'
      })
      child.unref()

      app.quit()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      this.setStatus({
        state: 'error',
        error: `安装更新失败: ${message}。您可以前往 GitHub 手动下载最新版本。`
      })
      if (this.status.release?.htmlUrl) {
        shell.openExternal(this.status.release.htmlUrl).catch(() => {})
      }
      throw err
    }
  }

  private fetchLatestRelease(): Promise<GitHubReleaseResponse> {
    const url = `https://api.github.com/repos/${this.repo}/releases/latest`
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'mote-desktop-app',
          Accept: 'application/vnd.github.v3+json'
        }
      }

      https
        .get(url, options, (res) => {
          if (res.statusCode === 404) {
            reject(new Error('当前仓库暂无发布的 Release 版本'))
            return
          }
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            reject(new Error(`GitHub API 响应异常 HTTP ${res.statusCode}`))
            return
          }

          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => {
            try {
              resolve(JSON.parse(data) as GitHubReleaseResponse)
            } catch {
              reject(new Error('解析 GitHub Release 数据失败'))
            }
          })
        })
        .on('error', reject)
    })
  }

  private downloadFile(
    url: string,
    dest: string,
    onProgress: (downloaded: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestWithRedirect = (currentUrl: string, maxRedirects = 5): void => {
        if (maxRedirects <= 0) {
          reject(new Error('下载重定向次数过多'))
          return
        }

        const options = {
          headers: {
            'User-Agent': 'mote-desktop-app',
            Accept: 'application/octet-stream'
          }
        }

        https
          .get(currentUrl, options, (res) => {
            if (
              res.statusCode &&
              [301, 302, 303, 307, 308].includes(res.statusCode) &&
              res.headers.location
            ) {
              requestWithRedirect(res.headers.location, maxRedirects - 1)
              return
            }

            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
              reject(new Error(`下载响应失败 HTTP ${res.statusCode}`))
              return
            }

            const totalBytes = Number.parseInt(res.headers['content-length'] || '0', 10)
            let downloadedBytes = 0

            const fileStream = createWriteStream(dest)
            let lastUpdate = 0

            res.on('data', (chunk) => {
              downloadedBytes += chunk.length
              const now = Date.now()
              if (now - lastUpdate > 100 || downloadedBytes === totalBytes) {
                lastUpdate = now
                onProgress(downloadedBytes, totalBytes)
              }
            })

            res.pipe(fileStream)

            fileStream.on('finish', () => {
              fileStream.close(() => resolve())
            })

            fileStream.on('error', (err) => {
              rmSync(dest, { force: true })
              reject(err)
            })
          })
          .on('error', reject)
      }

      requestWithRedirect(url)
    })
  }

  private runCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args)
      let stdout = ''
      let stderr = ''
      p.stdout.on('data', (d) => (stdout += d))
      p.stderr.on('data', (d) => (stderr += d))
      p.on('close', (code) => {
        if (code === 0) resolve(stdout)
        else reject(new Error(`${cmd} exited with code ${code}: ${stderr || stdout}`))
      })
      p.on('error', reject)
    })
  }
}

export function registerUpdaterIpc(): void {
  const updater = Updater.getInstance()

  ipcMain.handle(channels.checkForUpdates, async () => {
    return updater.checkForUpdates()
  })

  ipcMain.handle(channels.downloadUpdate, async () => {
    await updater.downloadUpdate()
  })

  ipcMain.handle(channels.installUpdate, async () => {
    await updater.installUpdate()
  })

  ipcMain.handle(channels.getAppVersion, () => {
    return app.isPackaged ? app.getVersion() : '1.0.0'
  })
}
