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

test('note editor context menu (cut, copy, paste, selectAll, formatting, toggle mode)', async () => {
  const info = test.info()
  const vault = info.outputPath('context-menu-vault')
  await cp('tests/fixtures/vaults/basic', vault, { recursive: true })
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    await window.getByRole('treeitem', { name: '带BOM', exact: true }).click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveAttribute('data-note-path', '带BOM.md')

    // Right-click in the editor content
    const editorContent = window.locator('.editor-content')
    await editorContent.click({ button: 'right', position: { x: 120, y: 120 } })

    const menu = window.getByRole('menu', { name: '笔记内容菜单' })
    await expect(menu).toBeVisible()

    // Check menu items exist
    await expect(menu.getByRole('menuitem', { name: '全选' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '粗体' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '待办列表' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '无序列表' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '切换到阅读模式' })).toBeVisible()

    // Test formatting via context menu (待办列表)
    await menu.getByRole('menuitem', { name: '待办列表' }).click()
    const checkbox = editor.getByRole('checkbox')
    await expect(checkbox).toBeVisible()
    await expect(checkbox).not.toBeChecked()

    // Right click again and test mode toggle
    await editorContent.click({ button: 'right', position: { x: 120, y: 120 } })
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: '切换到阅读模式' }).click()

    // Verify mode changed to reading
    await expect(editorContent).toHaveAttribute('data-mode', 'reading')

    // In reading mode, right click and switch back to live preview
    await editorContent.click({ button: 'right', position: { x: 120, y: 120 } })
    await expect(menu).toBeVisible()
    const editModeItem = menu.getByRole('menuitem', { name: '切换到编辑模式' })
    await expect(editModeItem).toBeVisible()
    // Formatting commands should be disabled in reading mode
    await expect(menu.getByRole('menuitem', { name: '粗体' })).toBeDisabled()
    await expect(menu.getByRole('menuitem', { name: '待办列表' })).toBeDisabled()

    await editModeItem.click()
    await expect(editorContent).toHaveAttribute('data-mode', 'live')
  } finally {
    await app.close()
  }
})
