import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

if (process.platform === 'darwin') {
  const electronAppDir = resolve(import.meta.dirname, '../node_modules/electron/dist/Electron.app')
  const plistPath = resolve(electronAppDir, 'Contents/Info.plist')
  const resourcesIconPath = resolve(electronAppDir, 'Contents/Resources/electron.icns')
  const moteIconPath = resolve(import.meta.dirname, '../build/icon.icns')

  if (existsSync(plistPath)) {
    try {
      execFileSync('plutil', ['-replace', 'CFBundleName', '-string', 'mote', plistPath])
      execFileSync('plutil', ['-replace', 'CFBundleDisplayName', '-string', 'mote', plistPath])
      execFileSync('plutil', ['-replace', 'CFBundleVersion', '-string', '1.0.0', plistPath])
      execFileSync('plutil', [
        '-replace',
        'CFBundleShortVersionString',
        '-string',
        '1.0.0',
        plistPath
      ])
    } catch (err) {
      console.warn('Failed to patch Electron.app Info.plist:', err)
    }
  }

  if (existsSync(moteIconPath) && existsSync(resolve(electronAppDir, 'Contents/Resources'))) {
    try {
      copyFileSync(moteIconPath, resourcesIconPath)
      execFileSync('touch', [electronAppDir])
    } catch (err) {
      console.warn('Failed to copy mote icon to Electron.app:', err)
    }
  }
}
