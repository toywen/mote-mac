import { cp } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launch, openVault } from './app'

// A click anywhere outside an open menu closes it. The clicks go to raw coordinates, because a
// locator click waits for its target to be hit, and here the question is what the point hits.
async function outsidePoints(window: Page): Promise<Record<string, { x: number; y: number }>> {
  const center = async (locator: Locator): Promise<{ x: number; y: number }> => {
    const box = (await locator.boundingBox())!
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const editor = (await window.locator('.editor-content').boundingBox())!
  const sidebar = (await window.getByRole('navigation', { name: '笔记库' }).boundingBox())!
  return {
    'editor text': await center(window.locator('.cm-line').first()),
    'editor blank': { x: editor.x + editor.width - 40, y: editor.y + editor.height - 40 },
    'tab bar': await center(window.locator('.tab-bar')),
    'sidebar blank': { x: sidebar.x + 40, y: sidebar.y + sidebar.height - 20 }
  }
}

// Closes a menu the test left open, without the paths under test.
async function close(menu: Locator): Promise<void> {
  if ((await menu.count()) === 0) return
  await menu.page().locator('.context-menu-backdrop').dispatchEvent('click')
  await expect(menu).toHaveCount(0)
}

test('a click outside or Escape closes every menu and dialog', async () => {
  const info = test.info()
  const vault = info.outputPath('dismiss-vault')
  await cp('tests/fixtures/vaults/basic', vault, { recursive: true })
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    await window.getByRole('treeitem', { name: '带BOM', exact: true }).click()
    await expect(window.getByRole('textbox', { name: '编辑器' })).toHaveAttribute(
      'data-note-path',
      '带BOM.md'
    )
    const points = await outsidePoints(window)

    const menus: { name: string; open: () => Promise<void> }[] = [
      {
        name: '排序选项',
        open: () => window.getByRole('button', { name: '更改排序方式' }).click()
      },
      {
        name: '操作菜单',
        open: () =>
          window.getByRole('treeitem', { name: '带BOM', exact: true }).click({ button: 'right' })
      },
      {
        name: '笔记内容菜单',
        open: () =>
          window.locator('.editor-content').click({ button: 'right', position: { x: 120, y: 120 } })
      }
    ]

    const stuck: string[] = []
    for (const { name, open } of menus) {
      const menu = window.getByRole('menu', { name })
      for (const [where, point] of Object.entries(points)) {
        await open()
        await expect(menu).toBeVisible()
        const box = (await menu.boundingBox())!
        const inside =
          point.x >= box.x &&
          point.x <= box.x + box.width &&
          point.y >= box.y &&
          point.y <= box.y + box.height
        if (!inside) {
          await window.mouse.click(point.x, point.y)
          if ((await menu.count()) > 0) {
            stuck.push(`${name} stays open after a click on ${where}`)
          }
        }
        await close(menu)
      }
      await open()
      await expect(menu).toBeVisible()
      await window.keyboard.press('Escape')
      if ((await menu.count()) > 0) stuck.push(`${name} stays open after Escape`)
      await close(menu)
    }
    // The two dialogs with a dimmed backdrop close on a press outside as well.
    const dialogs: { name: string; open: () => Promise<void> }[] = [
      { name: '快速打开', open: () => window.keyboard.press('Meta+o') },
      {
        name: '同步设置',
        open: () => window.getByRole('button', { name: /打开同步设置/ }).click()
      }
    ]
    for (const { name, open } of dialogs) {
      const dialog = window.getByRole('dialog', { name })
      for (const [where, point] of Object.entries(points)) {
        await open()
        await expect(dialog).toBeVisible()
        const box = (await dialog.boundingBox())!
        const inside =
          point.x >= box.x &&
          point.x <= box.x + box.width &&
          point.y >= box.y &&
          point.y <= box.y + box.height
        if (!inside) {
          await window.mouse.click(point.x, point.y)
          if ((await dialog.count()) > 0) {
            stuck.push(`${name} stays open after a click on ${where}`)
          }
        }
        await window.keyboard.press('Escape')
        await expect(dialog, `${name} closes on Escape`).toHaveCount(0)
      }
    }
    expect(stuck).toEqual([])
  } finally {
    await app.close()
  }
})
