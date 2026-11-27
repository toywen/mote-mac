import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { FontMode, ThemeSource } from '../core/ipc'
import type { JournalHandler, RenameJournal } from './vault'

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

/** The signed-in session. The server address is not part of it; see `syncServerUrl`. */
export type SyncSettings = {
  /** The device token, encrypted by the system keychain. Never stored in clear. */
  tokenCipher: string
  /** The signed-in account, for the panel to show who is connected. */
  account?: string
  vaultId?: string
}

export type AppSettings = {
  lastVault?: string
  theme?: ThemeSource
  font?: FontMode
  /** The sync service to use instead of the deployed one. Set by hand in settings.json. */
  syncServerUrl?: string
  sync?: SyncSettings
  /** The assistant's API address instead of DeepSeek's. Set by hand in settings.json. */
  aiBaseUrl?: string
  /** The DeepSeek API key, encrypted by the system keychain like the device token. */
  ai?: { keyCipher: string }
}

/** The token is readable by no one but this user's login. */
export function sealToken(token: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统钥匙串不可用，无法安全保存设备令牌')
  }
  return safeStorage.encryptString(token).toString('base64')
}

export function openToken(cipher: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  } catch {
    return null
  }
}

export async function readSettings(): Promise<AppSettings> {
  try {
    return JSON.parse(await readFile(settingsFile(), 'utf8')) as AppSettings
  } catch {
    return {}
  }
}

export async function writeSettings(update: Partial<AppSettings>): Promise<void> {
  const current = await readSettings()
  const next = { ...current, ...update }
  await mkdir(app.getPath('userData'), { recursive: true })
  const tmp = settingsFile() + '.tmp'
  await writeFile(tmp, JSON.stringify(next))
  await rename(tmp, settingsFile())
}

export function getJournalHandler(dir: string): JournalHandler {
  const hash = Buffer.from(dir).toString('hex').slice(0, 16)
  const file = join(app.getPath('userData'), `journal-${hash}.json`)
  return {
    async read() {
      try {
        const raw = await readFile(file, 'utf8')
        return JSON.parse(raw) as RenameJournal
      } catch {
        return null
      }
    },
    async write(journal: RenameJournal) {
      await mkdir(app.getPath('userData'), { recursive: true })
      const tmp = file + '.tmp'
      await writeFile(tmp, JSON.stringify(journal))
      await rename(tmp, file)
    },
    async clear() {
      await rm(file).catch(() => {})
    }
  }
}
