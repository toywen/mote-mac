import { test, expect, type Page } from '@playwright/test'
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileUrl } from '../../src/core/fileUrl'
import { parseVaultPath } from '../../src/core/ipc'
import { launch, openVault } from './app'

const fixture = 'tests/fixtures/vaults/preview'
const sampleVideo = '附图/短视频.mp4'

function fetchInWindow(
  window: Page,
  url: string
): Promise<{ ok: boolean; status: number; error?: string }> {
  return window.evaluate(async (src) => {
    try {
      const res = await fetch(src)
      return { ok: res.ok, status: res.status }
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
    }
  }, url)
}

test('videos and youtube embeds render in live preview and reading mode', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp(fixture, vault, { recursive: true })

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    await window.getByRole('treeitem', { name: '视频', exact: true }).click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveAttribute('data-note-path', '视频.md')

    // 1. Verify local video players in live preview
    const videos = editor.locator('.mote-video video')
    await expect(videos).toHaveCount(3)

    // Check video controls attribute
    await expect(videos.nth(0)).toHaveAttribute('controls', '')
    await expect(videos.nth(1)).toHaveAttribute('controls', '')
    await expect(videos.nth(2)).toHaveAttribute('controls', '')

    // Check dimensions on second video (|400x300)
    await expect(videos.nth(1)).toHaveAttribute('width', '400')
    await expect(videos.nth(1)).toHaveAttribute('height', '300')

    // Check width on third video (|320)
    await expect(videos.nth(2)).toHaveAttribute('width', '320')

    // 2. Verify YouTube iframes
    const iframes = editor.locator('.mote-youtube iframe')
    await expect(iframes).toHaveCount(2)

    // Check YouTube markdown embed: |480x270
    await expect(iframes.nth(0)).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
    )
    await expect(iframes.nth(0)).toHaveAttribute('width', '480')
    await expect(iframes.nth(0)).toHaveAttribute('height', '270')

    // Check HTML iframe embed: width="560" height="315"
    await expect(iframes.nth(1)).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
    )
    await expect(iframes.nth(1)).toHaveAttribute('width', '560')
    await expect(iframes.nth(1)).toHaveAttribute('height', '315')

    // 3. Switch to Reading Mode (Cmd+E)
    await window.keyboard.press('Meta+KeyE')
    await expect(editor).toHaveAttribute('aria-readonly', 'true')

    // In reading mode, both videos and iframes must still be rendered
    await expect(editor.locator('.mote-video video')).toHaveCount(3)
    await expect(editor.locator('.mote-youtube iframe')).toHaveCount(2)

    // Switch back to live preview
    await window.keyboard.press('Meta+KeyE')
    await expect(editor).not.toHaveAttribute('aria-readonly', 'true')
  } finally {
    await app.close()
  }
})

test('video files load only from vault and reject outside files', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  const outside = info.outputPath('outside')
  await cp(fixture, vault, { recursive: true })

  const videoData = await readFile(join(vault, sampleVideo))
  await mkdir(outside, { recursive: true })
  await writeFile(join(outside, 'secret.mp4'), videoData)
  await symlink(join(outside, 'secret.mp4'), join(vault, '逃逸.mp4'))

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    await expect(window.getByRole('treeitem', { name: '视频', exact: true })).toBeVisible()

    // Vault video loads successfully
    const ok = await fetchInWindow(window, fileUrl(parseVaultPath(sampleVideo)))
    expect(ok.ok).toBe(true)
    expect(ok.status).toBe(200)

    // Symlink escape is rejected with 404/403
    const escaped = await fetchInWindow(window, fileUrl(parseVaultPath('逃逸.mp4')))
    expect(escaped.ok).toBe(false)
    expect([403, 404]).toContain(escaped.status)
  } finally {
    await app.close()
  }
})
