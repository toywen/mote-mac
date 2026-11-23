import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { cp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

const fixture = 'tests/fixtures/vaults/preview'

async function start(): Promise<{ app: ElectronApplication; window: Page; vault: string }> {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp(fixture, vault, { recursive: true })
  const app = await launch(info.outputPath('settings'))
  const window = await app.firstWindow()
  await openVault(app, window, vault)
  await expect(window.getByRole('treeitem', { name: '图表', exact: true })).toBeVisible()
  return { app, window, vault }
}

test('multi-tab open, switch, dirty save, shortcut close and cycle', async () => {
  const { app, window, vault } = await start()
  const errors: string[] = []
  window.on('pageerror', (error) => errors.push(error.message))
  window.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  try {
    const tabBar = window.getByRole('tablist', { name: '标签页' })
    await expect(tabBar).toBeVisible()

    // 1. Open first note: '图表'
    await window.getByRole('treeitem', { name: '图表', exact: true }).click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveAttribute('data-note-path', '图表.md')

    const tabs = tabBar.getByRole('tab')
    await expect(tabs).toHaveCount(1)
    await expect(tabs.first()).toContainText('图表')
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')

    // 2. Open second note: '表格'
    await window.getByRole('treeitem', { name: '表格', exact: true }).click()
    await expect(editor).toHaveAttribute('data-note-path', '表格.md')
    await expect(tabs).toHaveCount(2)
    await expect(tabs.nth(0)).toContainText('图表')
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false')
    await expect(tabs.nth(1)).toContainText('表格')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')

    // 3. Switch back to first tab by clicking tab
    await tabs.nth(0).click()
    await expect(editor).toHaveAttribute('data-note-path', '图表.md')
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false')

    // 4. Edit first note
    await editor.click()
    await window.keyboard.press('Meta+ArrowDown')
    await window.keyboard.insertText('新添加的一行内容')

    // 5. Switch to tab 2: should auto flush/save note 1 edits to disk
    await tabs.nth(1).click()
    await expect(editor).toHaveAttribute('data-note-path', '表格.md')
    const savedText = await readFile(join(vault, '图表.md'), 'utf8')
    expect(savedText).toContain('新添加的一行内容')

    // 6. Test tab cycling shortcuts (Ctrl+Tab)
    await window.keyboard.press('Control+Tab')
    await expect(editor).toHaveAttribute('data-note-path', '图表.md')

    // 7. Test closing active tab with Cmd+W
    await window.keyboard.press('Meta+w')
    await expect(tabs).toHaveCount(1)
    await expect(tabs.first()).toContainText('表格')
    await expect(editor).toHaveAttribute('data-note-path', '表格.md')

    // 8. The + button opens an empty panel, after saving the dirty note, and keeps the tabs.
    await editor.click()
    await window.keyboard.press('Meta+ArrowDown')
    await window.keyboard.insertText('加在表格后面的内容')
    await window.locator('.tab-add').click()
    await expect(window.locator('.empty')).toContainText('选择一篇笔记')
    await expect(tabBar.getByRole('tab')).toHaveCount(1)
    expect(await readFile(join(vault, '表格.md'), 'utf8')).toContain('加在表格后面的内容')

    // 9. Clicking a tab brings its note back.
    await tabs.first().click()
    await expect(editor).toHaveAttribute('data-note-path', '表格.md')

    // 10. Test closing tab with close button
    const closeBtn = tabs.first().getByRole('button', { name: /关闭/ })
    await closeBtn.click()
    await expect(tabBar.getByRole('tab')).toHaveCount(0)
    await expect(window.locator('.empty')).toContainText('选择一篇笔记')

    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('header blank area to the right of tabs is draggable', async () => {
  const { app, window } = await start()
  try {
    // Open a note
    await window.getByRole('treeitem', { name: '图表', exact: true }).click()

    // Find tab add button
    const tabAdd = window.locator('.tab-add')
    await expect(tabAdd).toBeVisible()
    const addBox = await tabAdd.boundingBox()
    expect(addBox).not.toBeNull()

    // Pick a point in the empty area to the right of tab-add button
    const testPoint = { x: addBox!.x + addBox!.width + 50, y: addBox!.y + addBox!.height / 2 }

    const region = await window.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return {
        tag: el?.tagName,
        className: el?.className,
        webkitAppRegion: el ? getComputedStyle(el).webkitAppRegion : null
      }
    }, testPoint)

    expect(region.webkitAppRegion).toBe('drag')
  } finally {
    await app.close()
  }
})
