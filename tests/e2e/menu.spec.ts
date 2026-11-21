import { test, expect } from '@playwright/test'
import { cp } from 'node:fs/promises'
import { launch, openVault } from './app'

test('markdown formatting shortcuts in editor (Cmd+B, Cmd+I, Cmd+K, unwrapping)', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp('tests/fixtures/vaults/basic', vault, { recursive: true })
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    await window.getByRole('treeitem', { name: '带BOM', exact: true }).click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveAttribute('data-note-path', '带BOM.md')

    // Click into editor
    await editor.click()

    // Select text in the first line
    await window.evaluate(() => {
      const cmEl = document.querySelector('.cm-content')
      if (!cmEl) return
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(cmEl.firstChild || cmEl)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })

    // Press Cmd+B to toggle bold
    await window.keyboard.press('Meta+KeyB')
    await expect(editor).toContainText('**')

    // Press Cmd+B again to unwrap / cancel format
    await window.keyboard.press('Meta+KeyB')
    await expect(editor).not.toContainText('****')

    // Test Cmd+\ toggles sidebar
    const sidebar = window.getByRole('complementary', { name: '侧栏' })
    await expect(sidebar).toBeVisible()
    await window.keyboard.press('Meta+Backslash')
    await expect(sidebar).toBeHidden()
    await window.keyboard.press('Meta+Backslash')
    await expect(sidebar).toBeVisible()
  } finally {
    await app.close()
  }
})
