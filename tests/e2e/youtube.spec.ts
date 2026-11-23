import { test, expect } from '@playwright/test'
import { cp } from 'node:fs/promises'
import { launch, openVault } from './app'

// Quitting waits up to 30 s for the update check that starts 3 s after launch, when
// api.github.com does not resolve. Leave room for that.
test.describe.configure({ timeout: 60_000 })

test('YouTube short links, start times and sizes become players, and other addresses do not', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp('tests/fixtures/vaults/youtube', vault, { recursive: true })
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    await window.getByRole('treeitem', { name: 'YouTube', exact: true }).click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveAttribute('data-note-path', 'YouTube.md')

    const embed = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
    // One player per YouTube address in the note, in order: [src, width, height].
    const players = [
      [embed, '560', '315'],
      [`${embed}?start=45`, '560', '315'],
      [`${embed}?start=120`, '640', '360'],
      [embed, '400', '315'],
      [embed, '560', '315']
    ]
    // The Vimeo link and the example.com iframe add no player.
    const iframes = editor.locator('iframe')
    await expect(iframes).toHaveCount(players.length)
    for (const [i, [src, width, height]] of players.entries()) {
      await expect(iframes.nth(i)).toHaveAttribute('src', src)
      await expect(iframes.nth(i)).toHaveAttribute('width', width)
      await expect(iframes.nth(i)).toHaveAttribute('height', height)
    }
    await expect(
      editor.locator('.cm-line').filter({ hasText: '<iframe src="https://example.com/"></iframe>' })
    ).toHaveCount(1)
  } finally {
    await app.close()
  }
})
