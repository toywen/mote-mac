import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { cp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

const fixture = 'tests/fixtures/vaults/basic'
const line = '这是 mote 的验证笔记库。'

async function start(
  name: string,
  config?: object
): Promise<{ app: ElectronApplication; window: Page; vault: string }> {
  const info = test.info()
  const vault = info.outputPath(name)
  await cp(fixture, vault, { recursive: true })
  if (config) await writeFile(join(vault, '.obsidian/app.json'), JSON.stringify(config))
  const app = await launch(info.outputPath(`${name}-settings`))
  const window = await app.firstWindow()
  await openVault(app, window, vault)
  await expect(window.getByRole('treeitem', { name: '欢迎', exact: true })).toBeVisible()
  return { app, window, vault }
}

async function open(window: Page, name: string, path: string): Promise<void> {
  await window.getByRole('treeitem', { name, exact: true }).click()
  await expect(window.getByRole('textbox', { name: '编辑器' })).toHaveAttribute(
    'data-note-path',
    path
  )
}

test("typing [[ completes note names in the vault's link format", async () => {
  const original = await readFile(join(fixture, '欢迎.md'), 'utf8')

  // The default config writes wiki links with the shortest path.
  const wiki = await start('wiki')
  try {
    const { window, vault } = wiki
    await window.getByRole('treeitem', { name: '项目', exact: true }).click()
    await open(window, '计划', '项目/计划.md')
    await open(window, '欢迎', '欢迎.md')
    const editor = window.getByRole('textbox', { name: '编辑器' })
    const list = window.getByRole('listbox', { name: '链接补全' })
    const rows = list.getByRole('option')

    await editor.locator('.cm-line').filter({ hasText: line }).click()
    await window.keyboard.press('End')
    await window.keyboard.type(' [[')
    // With no query, the list holds the notes opened last, newest first.
    await expect(rows).toHaveText(['欢迎', '计划项目'])
    await window.keyboard.type('计')
    await expect(rows).toHaveText(['计划项目'])
    await expect(rows.first().locator('.cm-completionLabel')).toHaveText('计划')
    await expect(rows.first().locator('.cm-completionDetail')).toHaveText('项目')
    await window.screenshot({ path: test.info().outputPath('wiki-list.png') })
    await window.keyboard.press('Enter')
    await expect(list).toBeHidden()
    // The cursor sits after the link, so typing goes on after it.
    await window.keyboard.type('。')

    // A macOS input method composes 计划 after [[. Its Enter arrives as key code 229 while the
    // composition is open: it commits the composition and picks nothing.
    await window.keyboard.type(' [[')
    const ime = await window.context().newCDPSession(window)
    await ime.send('Input.imeSetComposition', { text: '计划', selectionStart: 2, selectionEnd: 2 })
    await expect(rows).toHaveText(['计划项目'])
    await ime.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 229
    })
    await ime.send('Input.insertText', { text: '计划' })
    const edited = editor.locator('.cm-line').filter({ hasText: line })
    await expect(edited).toHaveText(`${line} 计划。 [[计划`)
    await expect(rows).toHaveText(['计划项目'])
    await window.keyboard.press('Enter')
    await expect(edited).toHaveText(`${line} 计划。 [[计划]]`)

    // Inside a code block, [[ completes nothing.
    await window.keyboard.press('Meta+ArrowDown')
    await window.keyboard.type('```')
    await window.keyboard.press('Enter')
    await window.keyboard.type('[[计')
    await window.waitForTimeout(500)
    await expect(list).toBeHidden()

    await expect
      .poll(() => readFile(join(vault, '欢迎.md'), 'utf8'))
      .toBe(original.replace(line, `${line} [[计划]]。 [[计划]]`) + '```\n[[计')
  } finally {
    await wiki.app.close()
  }

  // A vault that asks for Markdown links with relative paths.
  const markdown = await start('markdown', { useMarkdownLinks: true, newLinkFormat: 'relative' })
  try {
    const { window, vault } = markdown
    await open(window, '欢迎', '欢迎.md')
    const editor = window.getByRole('textbox', { name: '编辑器' })
    const rows = window.getByRole('listbox', { name: '链接补全' }).getByRole('option')
    await editor.locator('.cm-line').filter({ hasText: line }).click()
    await window.keyboard.press('End')
    await window.keyboard.type(' [[计')
    await expect(rows).toHaveText(['计划项目'])
    await window.keyboard.press('Enter')
    await window.keyboard.type('。')
    await expect
      .poll(() => readFile(join(vault, '欢迎.md'), 'utf8'))
      .toBe(original.replace(line, `${line} [计划](项目/计划.md)。`))
    await window.screenshot({ path: test.info().outputPath('markdown.png') })
  } finally {
    await markdown.app.close()
  }
})
