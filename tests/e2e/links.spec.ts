import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { launch, openVault } from './app'

const lineOf = (editor: Locator, text: string): Locator =>
  editor.locator('.cm-line').filter({ hasText: text })

async function makeVault(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), text)
  }
}

async function start(
  files: Record<string, string>
): Promise<{ app: ElectronApplication; window: Page; vault: string; editor: Locator }> {
  const info = test.info()
  const vault = info.outputPath('vault')
  await makeVault(vault, files)
  const app = await launch(info.outputPath('settings'))
  const window = await app.firstWindow()
  await openVault(app, window, vault)
  return { app, window, vault, editor: window.getByRole('textbox', { name: '编辑器' }) }
}

// Every file under dir, relative, sorted.
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort()
}

test('clicking a link opens its target and Cmd+Option+Left goes back', async () => {
  const filler = Array.from({ length: 120 }, (_, i) => `第 ${i + 1} 行。`).join('\n\n')
  const { app, window, vault, editor } = await start({
    '起点.md':
      '---\nrelated: "[[项目/计划]]"\n---\n# 起点\n\n光标会停在这句话的末尾。\n\n' +
      '去 [[项目/计划]]，去标题 [[长笔记#第三节|第三节]]，附件 [[图片.png]] 与 [[表格.xlsx]]，网址 [网站](https://example.com/页)。\n',
    '项目/计划.md': '# 计划\n\n回到 [[起点]] 再说。\n',
    '长笔记.md': `# 长笔记\n\n## 第一节\n\n${filler}\n\n## 第三节\n\n标题下面的字。\n\n${filler}\n`,
    '附件/图片.png': 'png',
    '附件/表格.xlsx': 'xlsx'
  })
  try {
    // Opening a file or an address goes to the system; the test records what it would open.
    await app.evaluate(({ shell }) => {
      const record = globalThis as unknown as { opened: string[]; external: string[] }
      record.opened = []
      record.external = []
      shell.openPath = async (path) => {
        record.opened.push(path)
        return ''
      }
      shell.openExternal = async (url) => {
        record.external.push(url)
      }
    })
    const recorded = (): Promise<{ opened: string[]; external: string[] }> =>
      app.evaluate(() => {
        const { opened, external } = globalThis as unknown as Record<string, string[]>
        return { opened, external }
      })
    await window.getByRole('treeitem', { name: '起点', exact: true }).click()
    await expect(editor).toHaveAttribute('data-note-path', '起点.md')
    const links = lineOf(editor, '去 ')
    await lineOf(editor, '光标会停在').click()
    await window.keyboard.press('End')

    // A plain click follows the link instead of showing its source.
    await links.getByText('项目/计划', { exact: true }).click()
    await expect(editor).toHaveAttribute('data-note-path', '项目/计划.md')
    await lineOf(editor, '回到').click()
    await window.keyboard.press('End')

    // Back puts the cursor where it was; the key does not also move it by a word.
    await window.keyboard.press('Meta+Alt+ArrowLeft')
    await expect(editor).toHaveAttribute('data-note-path', '起点.md')
    await window.keyboard.insertText('甲')
    await window.keyboard.press('Meta+Alt+ArrowRight')
    await expect(editor).toHaveAttribute('data-note-path', '项目/计划.md')
    await window.keyboard.insertText('乙')
    await expect
      .poll(() => readFile(join(vault, '项目/计划.md'), 'utf8'))
      .toBe('# 计划\n\n回到 [[起点]] 再说。乙\n')
    await window.keyboard.press('Meta+Alt+ArrowLeft')
    await expect(editor).toHaveAttribute('data-note-path', '起点.md')
    await expect
      .poll(() => readFile(join(vault, '起点.md'), 'utf8'))
      .toContain('光标会停在这句话的末尾。甲\n')

    // A heading link puts the heading at the top of the editor, with the cursor on it.
    await links.getByText('第三节', { exact: true }).click()
    await expect(editor).toHaveAttribute('data-note-path', '长笔记.md')
    const heading = lineOf(editor, '第三节')
    await expect(heading).toHaveText('## 第三节')
    const scroller = window.locator('.cm-scroller')
    expect(await scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(1000)
    const [line, top] = await Promise.all([heading.boundingBox(), scroller.boundingBox()])
    expect(Math.abs((line?.y ?? 0) - (top?.y ?? 0))).toBeLessThan(40)
    await window.keyboard.press('Meta+Alt+ArrowLeft')
    await expect(editor).toHaveAttribute('data-note-path', '起点.md')

    // Opened again from the file tree, that note starts at the top.
    await window.getByRole('treeitem', { name: '长笔记', exact: true }).click()
    await expect(editor).toHaveAttribute('data-note-path', '长笔记.md')
    await window.waitForTimeout(500)
    expect(await scroller.evaluate((node) => node.scrollTop)).toBe(0)
    await window.keyboard.press('Meta+Alt+ArrowLeft')
    await expect(editor).toHaveAttribute('data-note-path', '起点.md')

    // An image opens in its own tab (ADR 0020).
    await links.getByText('图片.png', { exact: true }).click()
    await expect(window.locator('.image-viewer-container')).toHaveAttribute(
      'data-image-path',
      '附件/图片.png'
    )
    await window.keyboard.press('Meta+Alt+ArrowLeft')
    await expect(editor).toHaveAttribute('data-note-path', '起点.md')

    // A file mote cannot show opens in the default app and an address in the browser. The
    // note stays open.
    await links.getByText('表格.xlsx', { exact: true }).click()
    await links.getByText('网站', { exact: true }).click()
    await expect.poll(recorded).toEqual({
      opened: [join(await realpath(vault), '附件/表格.xlsx')],
      external: ['https://example.com/页']
    })
    await expect(editor).toHaveAttribute('data-note-path', '起点.md')

    // While a link shows its source, a plain click edits it and Cmd+click still follows it.
    for (const key of ['ArrowDown', 'ArrowDown', 'Home', 'ArrowRight', 'ArrowRight'])
      await window.keyboard.press(key)
    await expect(links).toContainText('[[项目/计划]]')
    await links.getByText('项目/计划', { exact: true }).click()
    await expect(editor).toHaveAttribute('data-note-path', '起点.md')
    await links.getByText('项目/计划', { exact: true }).click({ modifiers: ['Meta'] })
    await expect(editor).toHaveAttribute('data-note-path', '项目/计划.md')
    await window.keyboard.press('Meta+Alt+ArrowLeft')
    await expect(editor).toHaveAttribute('data-note-path', '起点.md')

    // A link in the properties block follows on Cmd+click only.
    const point = await lineOf(editor, 'related:').evaluate((line) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const text = walker.currentNode
        const at = text.textContent?.indexOf('项目') ?? -1
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(text, at)
        range.setEnd(text, at + 2)
        const box = range.getBoundingClientRect()
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      }
      throw new Error('no link text in the properties')
    })
    await window.mouse.click(point.x, point.y)
    await expect(editor).toHaveAttribute('data-note-path', '起点.md')
    await window.keyboard.down('Meta')
    await window.mouse.click(point.x, point.y)
    await window.keyboard.up('Meta')
    await expect(editor).toHaveAttribute('data-note-path', '项目/计划.md')
    await window.keyboard.press('Meta+Alt+ArrowLeft')
    await expect(editor).toHaveAttribute('data-note-path', '起点.md')

    // Reading mode follows links on a plain click too.
    await window.keyboard.press('Meta+E')
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await links.getByText('项目/计划', { exact: true }).click()
    await expect(editor).toHaveAttribute('data-note-path', '项目/计划.md')
    expect((await recorded()).external).toHaveLength(1)
  } finally {
    await app.close()
  }
})

test('clicking a missing link creates the note where the vault config says', async () => {
  const { app, window, vault, editor } = await start({
    '.obsidian/app.json': JSON.stringify({
      newFileLocation: 'folder',
      newFileFolderPath: '收件箱'
    }),
    '收件箱/已有.md': '已有的笔记\n',
    '源/笔记.md': '想到 [[新想法]]，放到 [[深/层/新笔记]]，还有 [新的](新的.md)。\n'
  })
  try {
    const before = await listFiles(vault)
    await window.getByRole('treeitem', { name: '源', exact: true }).click()
    await window.getByRole('treeitem', { name: '笔记', exact: true }).click()
    await expect(editor).toHaveAttribute('data-note-path', '源/笔记.md')
    const line = lineOf(editor, '想到')
    await expect(line.getByText('新想法', { exact: true })).toHaveClass(/mote-link-missing/)

    // No folder in the link text: the note goes to the folder the vault config names.
    await line.getByText('新想法', { exact: true }).click()
    await expect(editor).toHaveAttribute('data-note-path', '收件箱/新想法.md')
    await window.getByRole('treeitem', { name: '收件箱', exact: true }).click()
    await expect(window.getByRole('treeitem', { name: '新想法', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect((await stat(join(vault, '收件箱/新想法.md'))).size).toBe(0)

    // Folders in the link text start from the vault root and are created.
    await window.keyboard.press('Meta+Alt+ArrowLeft')
    await expect(editor).toHaveAttribute('data-note-path', '源/笔记.md')
    await expect(line.getByText('新想法', { exact: true })).not.toHaveClass(/mote-link-missing/)
    await line.getByText('深/层/新笔记', { exact: true }).click()
    await expect(editor).toHaveAttribute('data-note-path', '深/层/新笔记.md')
    await window.keyboard.press('Meta+Alt+ArrowLeft')
    await line.getByText('新的', { exact: true }).click()
    await expect(editor).toHaveAttribute('data-note-path', '收件箱/新的.md')

    // Only the three empty notes were added. Opening them wrote nothing else.
    await window.waitForTimeout(1000)
    const added = (await listFiles(vault)).filter((path) => !before.includes(path))
    expect(added).toEqual(['收件箱/新想法.md', '收件箱/新的.md', '深/层/新笔记.md'])
    for (const path of added) expect(await readFile(join(vault, path), 'utf8')).toBe('')
    expect(await readFile(join(vault, '源/笔记.md'), 'utf8')).toBe(
      '想到 [[新想法]]，放到 [[深/层/新笔记]]，还有 [新的](新的.md)。\n'
    )
  } finally {
    await app.close()
  }
})
