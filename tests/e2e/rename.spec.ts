import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

// Renames a note from the file tree's context menu. Resolves once the input is gone, which is
// before main has finished the rename.
async function rename(window: Page, from: string, to: string): Promise<void> {
  const tree = window.getByRole('tree', { name: '文件树' })
  const item = tree.getByRole('treeitem', { name: from, exact: true })
  await item.click({ button: 'right' })
  await window
    .getByRole('menu', { name: '操作菜单' })
    .getByRole('menuitem', { name: '重命名' })
    .click()
  const input = item.locator('input.tree-input')
  await input.fill(to)
  await input.press('Enter')
}

async function typeAtEnd(window: Page, text: string): Promise<void> {
  await window.getByRole('textbox', { name: '编辑器' }).click()
  await window.keyboard.press('Meta+ArrowDown')
  await window.keyboard.insertText(text)
}

async function openNote(
  app: ElectronApplication,
  window: Page,
  vault: string,
  name: string
): Promise<void> {
  await openVault(app, window, vault)
  await window.getByRole('treeitem', { name, exact: true }).click()
}

// A window whose note cannot save refuses to close, so a failing test would hang here.
async function close(app: ElectronApplication): Promise<void> {
  const closed = app.close().then(() => true)
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000))
  if (!(await Promise.race([closed, timeout]))) app.process().kill()
}

test('renaming the open note keeps what you typed in the editor', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await mkdir(vault, { recursive: true })
  await writeFile(join(vault, '草稿.md'), '原文')
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openNote(app, window, vault, '草稿')
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveText('原文')
    await typeAtEnd(window, '，第一句')
    await expect.poll(() => readFile(join(vault, '草稿.md'), 'utf8')).toBe('原文，第一句')

    await rename(window, '草稿', '定稿')
    await expect(window.getByRole('treeitem', { name: '定稿', exact: true })).toBeVisible()
    await expect(editor).toHaveText('原文，第一句')
    await typeAtEnd(window, '，第二句')
    await expect.poll(() => readFile(join(vault, '定稿.md'), 'utf8')).toBe('原文，第一句，第二句')
  } finally {
    await close(app)
  }
})

test('what you type while the open note is being renamed is saved to the new name', async () => {
  test.setTimeout(120_000)
  const info = test.info()
  const vault = info.outputPath('vault')
  await mkdir(vault, { recursive: true })
  await writeFile(join(vault, '主题.md'), '原文')
  // Main rewrites every link to the note, so the rename takes a few seconds. The notes sit in a
  // folder, so the file tree stays short.
  const links = '见 [[主题]]\n'.repeat(20)
  await mkdir(join(vault, '引用'))
  await Promise.all(
    Array.from({ length: 10_000 }, (_, i) => writeFile(join(vault, '引用', `${i}.md`), links))
  )
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    const tree = window.getByRole('tree', { name: '文件树' })
    await openNote(app, window, vault, '主题')
    await expect(window.getByRole('textbox', { name: '编辑器' })).toHaveText('原文')

    await rename(window, '主题', '新主题')
    await typeAtEnd(window, '，新写的')
    // The 150 ms autosave timer fires while main is still rewriting links, so the write waits in
    // main's queue behind the rename. The tree changes only when the rename is done.
    await window.waitForTimeout(300)
    await expect(tree.getByRole('treeitem', { name: '主题', exact: true })).toBeVisible({
      timeout: 1
    })

    await expect(tree.getByRole('treeitem', { name: '新主题', exact: true })).toBeVisible({
      timeout: 60_000
    })
    await expect.poll(() => readFile(join(vault, '新主题.md'), 'utf8')).toBe('原文，新写的')
    await expect(window.getByRole('textbox', { name: '编辑器' })).toHaveText('原文，新写的')
  } finally {
    await close(app)
  }
})
