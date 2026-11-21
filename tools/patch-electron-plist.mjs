import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

if (process.platform === 'darwin') {
  const plistPath = resolve(
    import.meta.dirname,
    '../node_modules/electron/dist/Electron.app/Contents/Info.plist'
  )
  if (existsSync(plistPath)) {
    try {
      execFileSync('plutil', ['-replace', 'CFBundleName', '-string', 'mote', plistPath])
      execFileSync('plutil', ['-replace', 'CFBundleDisplayName', '-string', 'mote', plistPath])
    } catch (err) {
      console.warn('Failed to patch Electron.app Info.plist:', err)
    }
  }
}
