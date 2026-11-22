import { test, expect } from '@playwright/test'
import { cp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

test('multi-window opens different vaults simultaneously with isolated state and lifecycle', async () => {
  const info = test.info()
  const vault1 = info.outputPath('vault1')
  const vault2 = info.outputPath('vault2')

  await cp('tests/fixtures/vaults/basic', vault1, { recursive: true })
  await cp('tests/fixtures/vaults/preview', vault2, { recursive: true })

  const app = await launch(info.outputPath('settings'))
  try {
    // 1. Window 1 opens Vault 1
    const window1 = await app.firstWindow()
    await openVault(app, window1, vault1)
    await expect(window1.getByRole('treeitem', { name: '欢迎', exact: true })).toBeVisible()

    // 2. Open Vault 2 in a new window via window.mote.newWindow
    const [window2] = await Promise.all([
      app.waitForEvent('window'),
      window1.evaluate((dir) => window.mote.newWindow(dir), vault2)
    ])

    // Wait for window 2 to load and display Vault 2 entries
    await expect(window2.getByRole('treeitem', { name: '表格', exact: true })).toBeVisible()
    await expect(window2.getByRole('treeitem', { name: '任务', exact: true })).toBeVisible()

    // Window 1 still shows Vault 1 entries and does not have Vault 2 entries
    await expect(window1.getByRole('treeitem', { name: '欢迎', exact: true })).toBeVisible()
    await expect(window1.getByRole('treeitem', { name: '表格', exact: true })).toHaveCount(0)

    // Window 2 does not have Vault 1 entries
    await expect(window2.getByRole('treeitem', { name: '带BOM', exact: true })).toHaveCount(0)

    // 3. Edit in Window 1 only modifies Vault 1
    await window1.getByRole('treeitem', { name: '欢迎', exact: true }).click()
    const editor1 = window1.getByRole('textbox', { name: '编辑器' })
    await expect(editor1).toHaveAttribute('data-note-path', '欢迎.md')
    await editor1.click()
    await window1.keyboard.insertText('窗口一独享修改内容。\n')
    await window1.keyboard.press('Meta+S')
    await expect
      .poll(() => readFile(join(vault1, '欢迎.md'), 'utf8'))
      .toContain('窗口一独享修改内容。')

    // 4. Edit in Window 2 only modifies Vault 2
    await window2.getByRole('treeitem', { name: '任务', exact: true }).click()
    const editor2 = window2.getByRole('textbox', { name: '编辑器' })
    await expect(editor2).toHaveAttribute('data-note-path', '任务.md')
    const todo = editor2.getByRole('checkbox', { name: '待办任务' })
    await expect(todo).not.toBeChecked()
    await todo.click()
    await expect(todo).toBeChecked()
    await expect.poll(() => readFile(join(vault2, '任务.md'), 'utf8')).toContain('[x] 待办任务')

    // 5. Close Window 1: Window 2 stays active and interactive
    await window1.close()
    await expect(window2.getByRole('treeitem', { name: '任务', exact: true })).toBeVisible()
    await todo.click()
    await expect(todo).not.toBeChecked()
  } finally {
    await app.close()
  }
})
