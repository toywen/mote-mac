import { test, expect, _electron as electron, type Locator } from '@playwright/test'
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function launch(settings: string): ReturnType<typeof electron.launch> {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return electron.launch({ args: ['.', `--user-data-dir=${settings}`], env })
}

test('the main window shows the three panes', async () => {
  const info = test.info()
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('complementary', { name: '文件树' })).toBeVisible()
    await expect(window.getByRole('main', { name: '编辑器' })).toBeVisible()
    await expect(window.getByRole('complementary', { name: '反向链接' })).toBeVisible()
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
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, vault)
    await window.getByRole('button', { name: '打开笔记库' }).click()
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
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, vault)
    await window.getByRole('button', { name: '打开笔记库' }).click()
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
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, vault)
    await window.getByRole('button', { name: '打开笔记库' }).click()
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
