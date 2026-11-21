import { test, expect, type Locator } from '@playwright/test'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

test('the main window shows the panes', async () => {
  const info = test.info()
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('complementary', { name: '侧栏' })).toBeVisible()
    await expect(window.getByRole('main', { name: '编辑器' })).toBeVisible()
    await expect(window.getByRole('button', { name: '打开笔记库' })).toBeVisible()
    await window.screenshot({ path: info.outputPath('smoke.png') })
  } finally {
    await app.close()
  }
})

test('long file trees preserve the vault name and can be collapsed', async () => {
  const info = test.info()
  const vault = info.outputPath('large-vault')
  const folder = join(vault, 'build')
  await mkdir(folder, { recursive: true })
  await Promise.all(
    Array.from({ length: 65 }, (_, i) => writeFile(join(folder, `file-${i}.md`), 'note'))
  )
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    const tree = window.getByRole('tree', { name: '文件树' })
    const build = tree.getByRole('treeitem', { name: 'build', exact: true })
    const first = tree.getByRole('treeitem', { name: 'file-0', exact: true })
    await expect(build).toHaveAttribute('aria-expanded', 'false')
    await build.click()
    await expect
      .poll(() =>
        window.getByText('large-vault', { exact: true }).evaluate((label) => {
          const text = document.createRange()
          text.selectNodeContents(label)
          return text.getBoundingClientRect().bottom <= label.getBoundingClientRect().bottom
        })
      )
      .toBe(true)
    await build.click()
    await expect(first).toHaveCount(0)
    await build.click()
    await first.click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveText('note')
    await window.getByRole('button', { name: '收起文件树' }).click()
    await expect(tree).toBeHidden()
    await expect(editor).toHaveText('note')
    await window.getByRole('button', { name: '展开文件树' }).click()
    await expect(first).toHaveAttribute('aria-selected', 'true')
    await expect(first).toBeVisible()
  } finally {
    await app.close()
  }
})

test('edits preserve source bytes, save on navigation and quit, and the vault reopens', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  const settings = info.outputPath('settings')
  await cp('tests/fixtures/vaults/basic', vault, { recursive: true })
  const mixed = join(vault, '混合.md')
  const original = '\uFEFFone\r\ntwo\nthree'
  await writeFile(mixed, original)
  const app = await launch(settings)
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    const tree = window.getByRole('tree', { name: '文件树' })
    const note = (name: string): Locator => tree.getByRole('treeitem', { name, exact: true })
    await expect(note('.隐藏')).toHaveCount(0)
    await expect(note('计划')).toHaveCount(0)
    await note('项目').click()
    await expect(note('计划')).toBeVisible()
    await note('混合').click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await editor.click()
    expect(await readFile(mixed, 'utf8')).toBe(original)
    await window.keyboard.press('Meta+ArrowDown')
    await window.keyboard.insertText(' edited\nnew')
    await expect.poll(() => readFile(mixed, 'utf8')).toBe(original + ' edited\r\nnew')
    await window.keyboard.insertText(' switch')
    await note('计划').click()
    await expect(editor).toHaveAttribute('data-note-path', '项目/计划.md')
    expect(await readFile(mixed, 'utf8')).toBe(original + ' edited\r\nnew switch')
    await note('混合').click()
    await editor.click()
    await window.keyboard.press('Meta+ArrowDown')
    await window.keyboard.insertText(' quit')
  } finally {
    await app.close()
  }
  expect(await readFile(mixed, 'utf8')).toBe(original + ' edited\r\nnew switch quit')

  const reloaded = await launch(settings)
  try {
    const window = await reloaded.firstWindow()
    await expect(window.getByRole('treeitem', { name: '混合' })).toBeVisible()
  } finally {
    await reloaded.close()
  }
})

test('external saves refresh clean notes and keep both sides of a conflict', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp('tests/fixtures/vaults/basic', vault, { recursive: true })
  const file = join(vault, '欢迎.md')
  const temp = join(vault, '.replacement')
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    await window.getByRole('treeitem', { name: '欢迎', exact: true }).click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toContainText('这是 mote 的验证笔记库。')
    await writeFile(file, 'external in place')
    await expect(editor).toHaveText('external in place')
    await writeFile(temp, 'external rename')
    await rename(temp, file)
    await expect(editor).toHaveText('external rename')

    await editor.click()
    await window.keyboard.press('Meta+ArrowDown')
    await window.keyboard.insertText(' draft')
    await writeFile(file, 'other editor')
    await expect(window.getByRole('alert', { name: '' })).toHaveText('检测到外部修改')
    await expect(editor).toHaveText('external rename draft')
    expect(await readFile(file, 'utf8')).toBe('other editor')
    await window.getByRole('button', { name: '使用磁盘版本' }).click()
    await expect(editor).toHaveText('other editor')

    await editor.click()
    await window.keyboard.press('Meta+ArrowDown')
    await window.keyboard.insertText(' kept')
    await writeFile(file, 'other editor again')
    await expect(window.getByText('检测到外部修改')).toBeVisible()
    await window.getByRole('button', { name: '保留我的修改' }).click()
    await expect.poll(() => readFile(file, 'utf8')).toBe('other editor kept')
  } finally {
    await app.close()
  }
})

test('quick open ranks notes like Obsidian and lists recent notes for an empty query', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp('tests/fixtures/vaults/basic', vault, { recursive: true })
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    await expect(window.getByRole('tree', { name: '文件树' })).toBeVisible()
    const dialog = window.getByRole('dialog', { name: '快速打开' })
    const options = dialog.getByRole('option')
    const editor = window.getByRole('textbox', { name: '编辑器' })

    await window.keyboard.press('Meta+O')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('没有最近打开的笔记')
    await window.keyboard.insertText('笔记')
    await expect(options).toHaveText(['CRLF笔记'])
    await window.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await window.keyboard.press('Meta+O')
    await window.keyboard.insertText('计划')
    await expect(options).toHaveText(['项目/计划'])
    await window.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(editor).toHaveAttribute('data-note-path', '项目/计划.md')
    await expect(editor).toBeFocused()

    await window.keyboard.press('Meta+O')
    await window.keyboard.insertText('欢迎')
    await window.keyboard.press('Enter')
    await expect(editor).toHaveAttribute('data-note-path', '欢迎.md')

    await window.keyboard.press('Meta+O')
    await expect(options).toHaveText(['欢迎', '项目/计划'])
    await window.keyboard.press('ArrowDown')
    await window.keyboard.press('Enter')
    await expect(editor).toHaveAttribute('data-note-path', '项目/计划.md')
  } finally {
    await app.close()
  }
})

test('the backlinks pane lists links to the open note and jumps to them', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp('tests/fixtures/vaults/basic', vault, { recursive: true })
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    const pane = window.getByRole('complementary', { name: '反向链接' })
    const hits = pane.locator('button.hit')
    const editor = window.getByRole('textbox', { name: '编辑器' })
    const selected = (): Promise<string> =>
      window.evaluate(() => window.getSelection()?.toString() ?? '')

    await window.getByRole('treeitem', { name: '欢迎', exact: true }).click()
    const badge = window.locator('.title-relation-badge')
    await expect(badge).toBeVisible()
    await badge.click()
    await expect(pane.locator('[data-note-path="欢迎.md"]')).toBeVisible()
    await expect(hits).toHaveText(['回到 [[欢迎]]。'])
    await expect(hits.locator('mark')).toHaveText(['[[欢迎]]'])
    await hits.first().click()
    await expect(editor).toHaveAttribute('data-note-path', '项目/计划.md')
    await expect.poll(selected).toBe('[[欢迎]]')

    await expect(pane.locator('[data-note-path="项目/计划.md"]')).toBeVisible()
    await expect(hits).toHaveText(['- [ ] 读一遍 [[项目/计划]]', '- [x] 打开 [计划](项目/计划.md)'])
    await hits.nth(1).click()
    await expect(editor).toHaveAttribute('data-note-path', '欢迎.md')
    await expect.poll(selected).toBe('[计划](项目/计划.md)')

    await writeFile(join(vault, '外部.md'), '外部新增 [[欢迎]]')
    await expect(pane.locator('.hit-group[data-path="外部.md"]')).toBeVisible()
    await rm(join(vault, '外部.md'))
    await expect(pane.locator('.hit-group[data-path="外部.md"]')).toHaveCount(0)

    await editor.click()
    await window.keyboard.press('Meta+ArrowDown')
    await window.keyboard.insertText('\n自己 [[欢迎]]')
    await expect(pane.locator('.hit-group[data-path="欢迎.md"]')).toBeVisible()
    await expect(window.getByRole('status', { name: '反向链接数' })).toHaveText('2')
  } finally {
    await app.close()
  }
})

test('search finds notes by body and file name, jumps to matches, and follows changes', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp('tests/fixtures/vaults/basic', vault, { recursive: true })
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    await expect(window.getByRole('tree', { name: '文件树' })).toBeVisible()
    const box = window.getByRole('searchbox', { name: '搜索' })
    const summary = window.getByRole('status', { name: '搜索结果数' })
    const groups = window.getByRole('list', { name: '搜索结果' }).locator('.hit-group')
    const hits = window.getByRole('list', { name: '搜索结果' }).locator('button.hit')
    const editor = window.getByRole('textbox', { name: '编辑器' })
    const selected = (): Promise<string> =>
      window.evaluate(() => window.getSelection()?.toString() ?? '')

    await window.keyboard.press('Meta+Shift+F')
    await expect(box).toBeFocused()
    await window.keyboard.insertText('笔记')
    await expect(summary).toHaveText('2 篇笔记，3 处')
    await expect(groups).toHaveCount(2)
    expect(await groups.evaluateAll((nodes) => nodes.map((n) => n.dataset.path))).toEqual([
      'CRLF笔记.md',
      '欢迎.md'
    ])

    await box.fill('crlf 换行')
    await expect(summary).toHaveText('1 篇笔记，3 处')
    await expect(hits.locator('mark')).toHaveText(['CRLF', 'CRLF', '换行'])

    await box.fill('BOM.md')
    await expect(summary).toHaveText('1 篇笔记，0 处')
    await expect(groups).toHaveAttribute('data-path', '带BOM.md')

    await box.fill('验证笔记库')
    await expect(summary).toHaveText('1 篇笔记，1 处')
    await hits.first().click()
    await expect(editor).toHaveAttribute('data-note-path', '欢迎.md')
    await expect.poll(selected).toBe('验证笔记库')

    await window.getByRole('button', { name: '文件', exact: true }).click()
    await window.getByRole('treeitem', { name: 'CRLF笔记', exact: true }).click()
    await editor.click()
    await window.keyboard.press('Meta+ArrowUp')
    await window.keyboard.press('Shift+End')
    await window.keyboard.press('Meta+Shift+F')
    await expect(box).toHaveValue('"# CRLF 笔记"')
    await expect(summary).toHaveText('1 篇笔记，1 处')

    await box.fill('外部新增搜索词')
    await expect(summary).toHaveText('0 篇笔记，0 处')
    await writeFile(join(vault, '外部.md'), '外部新增搜索词')
    await expect(summary).toHaveText('1 篇笔记，1 处')
    await rm(join(vault, '外部.md'))
    await expect(summary).toHaveText('0 篇笔记，0 处')
  } finally {
    await app.close()
  }
})
