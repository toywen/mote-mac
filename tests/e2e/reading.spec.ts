import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { cp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

const fixture = 'tests/fixtures/vaults/preview'

const lineOf = (editor: Locator, text: string): Locator =>
  editor.locator('.cm-line').filter({ hasText: text })

async function openNote(window: Page, name: string): Promise<Locator> {
  await window.getByRole('treeitem', { name, exact: true }).click()
  const editor = window.getByRole('textbox', { name: '编辑器' })
  await expect(editor).toHaveAttribute('data-note-path', `${name}.md`)
  return editor
}

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

test('reading mode renders mermaid diagrams and embedded notes', async () => {
  const { app, window, vault } = await start()
  const errors: string[] = []
  window.on('pageerror', (error) => errors.push(error.message))
  window.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  try {
    const original = await readFile(join(vault, '图表.md'), 'utf8')
    const editor = await openNote(window, '图表')
    const diagrams = editor.locator('.mote-mermaid')
    // A working diagram draws an svg; a broken one shows its code and mermaid's message.
    await expect(diagrams.first().locator('svg')).toBeVisible()
    await expect(diagrams.first()).toContainText('开始')
    await expect(diagrams.nth(1)).toContainText('A --> (')
    await expect(diagrams.nth(1).locator('.mote-mermaid-message')).not.toBeEmpty()
    await expect(lineOf(editor, 'const b = 2')).toBeVisible()
    await expect(editor).not.toContainText('```')

    // In live preview the block shows its source while the cursor is in it.
    await lineOf(editor, '图下面一行').click()
    await window.keyboard.press('ArrowUp')
    await window.keyboard.press('ArrowUp')
    await expect(lineOf(editor, '```mermaid')).toHaveCount(1)
    await expect(lineOf(editor, '开始 --> 结束')).toBeVisible()
    await expect(diagrams).toHaveCount(1)
    await window.keyboard.press('ArrowDown')
    await expect(diagrams).toHaveCount(2)

    // Reading mode never shows the source.
    await window.keyboard.press('Meta+E')
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await expect(diagrams.first().locator('svg')).toBeVisible()
    await window.screenshot({ path: test.info().outputPath('mermaid.png') })
    expect(await readFile(join(vault, '图表.md'), 'utf8')).toBe(original)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
