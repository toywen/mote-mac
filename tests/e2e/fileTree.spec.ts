import { test, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

test('creates a new note, renames it, and updates inbound links', async () => {
  const info = test.info()
  const vault = info.outputPath('file-ops-vault')
  const obsidianDir = join(vault, '.obsidian')
  await mkdir(obsidianDir, { recursive: true })
  await writeFile(
    join(obsidianDir, 'app.json'),
    JSON.stringify({ alwaysUpdateLinks: true, newLinkFormat: 'shortest' })
  )

  await writeFile(join(vault, 'index.md'), 'Check out [[target]] here.')
  await writeFile(join(vault, 'target.md'), '# Target Note')

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)

    const tree = window.getByRole('tree', { name: '文件树' })
    const targetItem = tree.getByRole('treeitem', { name: 'target', exact: true })
    await expect(targetItem).toBeVisible()

    // 1. Rename target to renamed-target using context menu
    await targetItem.click({ button: 'right' })
    const menu = window.getByRole('menu', { name: '操作菜单' })
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: '重命名' }).click()

    const input = targetItem.locator('input.tree-input')
    await expect(input).toBeVisible()
    await input.fill('renamed-target')
    await input.press('Enter')

    await expect(tree.getByRole('treeitem', { name: 'renamed-target', exact: true })).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: 'target', exact: true })).toHaveCount(0)

    // Verify index.md was updated on disk!
    await expect
      .poll(async () => {
        return await readFile(join(vault, 'index.md'), 'utf8')
      })
      .toBe('Check out [[renamed-target]] here.')

    // 2. Create a new note via the top toolbar button
    await window.getByRole('button', { name: '新建笔记' }).click()
    const newNoteItem = tree.getByRole('treeitem', { name: '未命名', exact: true })
    await expect(newNoteItem).toBeVisible()

    const renameInput = newNoteItem.locator('input.tree-input')
    await expect(renameInput).toBeVisible()
    await renameInput.fill('my-new-note')
    await renameInput.press('Enter')

    await expect(tree.getByRole('treeitem', { name: 'my-new-note', exact: true })).toBeVisible()

    // 3. Create a new folder
    await window.getByRole('button', { name: '新建文件夹' }).click()
    const folderItem = tree.getByRole('treeitem', { name: '未命名文件夹', exact: true })
    await expect(folderItem).toBeVisible()

    const folderInput = folderItem.locator('input.tree-input')
    await expect(folderInput).toBeVisible()
    await folderInput.fill('my-folder')
    await folderInput.press('Enter')

    await expect(tree.getByRole('treeitem', { name: 'my-folder', exact: true })).toBeVisible()

    // 4. Delete my-new-note
    const myNote = tree.getByRole('treeitem', { name: 'my-new-note', exact: true })
    await myNote.click({ button: 'right' })
    await window.getByRole('menuitem', { name: '移到废纸篓' }).click()
    await expect(tree.getByRole('treeitem', { name: 'my-new-note', exact: true })).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('prompts to update links when alwaysUpdateLinks is false', async () => {
  const info = test.info()
  const vault = info.outputPath('prompt-links-vault')
  const obsidianDir = join(vault, '.obsidian')
  await mkdir(obsidianDir, { recursive: true })
  await writeFile(
    join(obsidianDir, 'app.json'),
    JSON.stringify({ alwaysUpdateLinks: false, newLinkFormat: 'shortest' })
  )

  await writeFile(join(vault, 'index.md'), 'Links to [[original]].')
  await writeFile(join(vault, 'original.md'), '# Original Note')

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)

    const tree = window.getByRole('tree', { name: '文件树' })
    const item = tree.getByRole('treeitem', { name: 'original', exact: true })
    await expect(item).toBeVisible()

    // Rename original
    await item.click({ button: 'right' })
    await window.getByRole('menuitem', { name: '重命名' }).click()

    const input = item.locator('input.tree-input')
    await input.fill('updated-original')
    await input.press('Enter')

    // Dialog should appear!
    const dialog = window.getByRole('dialog', { name: '更新内部链接' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('检测到 1 处链接引用此笔记')).toBeVisible()

    // Click "更新链接"
    await dialog.getByRole('button', { name: '更新链接' }).click()
    await expect(dialog).toHaveCount(0)

    // Verify index.md updated
    await expect
      .poll(async () => {
        return await readFile(join(vault, 'index.md'), 'utf8')
      })
      .toBe('Links to [[updated-original]].')
  } finally {
    await app.close()
  }
})

test('confirms before deleting non-empty folder', async () => {
  const info = test.info()
  const vault = info.outputPath('folder-delete-vault')
  const subDir = join(vault, 'parent-folder')
  await mkdir(subDir, { recursive: true })
  await writeFile(join(subDir, 'child.md'), '# Child')

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)

    const tree = window.getByRole('tree', { name: '文件树' })
    const folder = tree.getByRole('treeitem', { name: 'parent-folder', exact: true })
    await expect(folder).toBeVisible()

    // Delete folder
    await folder.click({ button: 'right' })
    await window.getByRole('menuitem', { name: '移到废纸篓' }).click()

    // Dialog should appear
    const dialog = window.getByRole('dialog', { name: '删除文件夹' })
    await expect(dialog).toBeVisible()

    // Click cancel
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(folder).toBeVisible()

    // Delete again and confirm
    await folder.click({ button: 'right' })
    await window.getByRole('menuitem', { name: '移到废纸篓' }).click()
    await window.getByRole('button', { name: '移到废纸篓' }).click()

    await expect(folder).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('sidebar header supports search and sort actions', async () => {
  const info = test.info()
  const vault = info.outputPath('search-sort-vault')
  await mkdir(vault, { recursive: true })
  await writeFile(join(vault, 'a-note.md'), '# A Note')
  await writeFile(join(vault, 'z-note.md'), '# Z Note')
  await writeFile(join(vault, 'm-note.md'), '# M Note')

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)

    const searchBtn = window.getByRole('button', { name: '搜索' })
    const sortBtn = window.getByRole('button', { name: '更改排序方式' })
    await expect(searchBtn).toBeVisible()
    await expect(sortBtn).toBeVisible()

    await searchBtn.click()
    const searchBox = window.getByRole('searchbox', { name: '搜索' })
    await expect(searchBox).toBeVisible()
    await expect(searchBox).toBeFocused()

    await window.getByRole('button', { name: '文件', exact: true }).click()
    const tree = window.getByRole('tree', { name: '文件树' })
    await expect(tree).toBeVisible()

    const getItems = async (): Promise<string[]> => {
      const items = tree.getByRole('treeitem')
      return await items.evaluateAll((nodes) => nodes.map((n) => n.textContent?.trim() ?? ''))
    }

    expect(await getItems()).toEqual(['a-note', 'm-note', 'z-note'])

    await sortBtn.click()
    const sortMenu = window.getByRole('menu', { name: '排序选项' })
    await expect(sortMenu).toBeVisible()

    await sortMenu.getByRole('menuitemradio', { name: '文件名（从 Z 到 A）' }).click()
    await expect(sortMenu).toHaveCount(0)
    expect(await getItems()).toEqual(['z-note', 'm-note', 'a-note'])

    await sortBtn.click()
    await expect(sortMenu).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(sortMenu).toHaveCount(0)

    await sortBtn.click()
    await sortMenu.getByRole('menuitemradio', { name: '文件名（从 A 到 Z）' }).click()
    expect(await getItems()).toEqual(['a-note', 'm-note', 'z-note'])
  } finally {
    await app.close()
  }
})

test('sidebar blank area context menu creates notes and folders at root', async () => {
  const info = test.info()
  const vault = info.outputPath('blank-context-menu-vault')
  await mkdir(vault, { recursive: true })
  await writeFile(join(vault, 'existing.md'), '# Existing')

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)

    const tree = window.getByRole('tree', { name: '文件树' })
    await expect(tree.getByRole('treeitem', { name: 'existing' })).toBeVisible()

    // Right click on the blank area in tree-scroll
    const treeScroll = window.getByRole('navigation', { name: '笔记库' })
    await treeScroll.click({ button: 'right', position: { x: 50, y: 250 } })

    const menu = window.getByRole('menu', { name: '操作菜单' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '新建笔记' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '新建文件夹' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '在访达中显示' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '重命名' })).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: '移到废纸篓' })).toHaveCount(0)

    // Click '新建笔记' from root context menu
    await menu.getByRole('menuitem', { name: '新建笔记' }).click()
    const newNote = tree.getByRole('treeitem', { name: '未命名', exact: true })
    await expect(newNote).toBeVisible()

    const input = newNote.locator('input.tree-input')
    await expect(input).toBeVisible()
    await input.fill('root-created-note')
    await input.press('Enter')

    await expect(
      tree.getByRole('treeitem', { name: 'root-created-note', exact: true })
    ).toBeVisible()
  } finally {
    await app.close()
  }
})
