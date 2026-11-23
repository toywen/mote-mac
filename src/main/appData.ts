import { app } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { FontMode, ThemeSource } from '../core/ipc'
import type { JournalHandler, RenameJournal } from './vault'

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

export type AppSettings = {
  lastVault?: string
  theme?: ThemeSource
  font?: FontMode
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
