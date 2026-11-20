import { test, expect, type Locator, type Page } from '@playwright/test'
import { cp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

const fixture = 'tests/fixtures/vaults/preview'

function lineOf(editor: Locator, text: string): Locator {
  return editor.locator('.cm-line').filter({ hasText: text })
}

const style = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property)

async function openNote(window: Page, name: string): Promise<Locator> {
  await window.getByRole('treeitem', { name, exact: true }).click()
  const editor = window.getByRole('textbox', { name: '编辑器' })
  await expect(editor).toHaveAttribute('data-note-path', `${name}.md`)
  return editor
}

test('live preview hides syntax away from the selection and shows it at the selection', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp(fixture, vault, { recursive: true })
  const inline = join(vault, '行内.md')
  const original = await readFile(inline, 'utf8')
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    const editor = await openNote(window, '行内')
    const styled = lineOf(editor, '这一行有')
    await expect(styled).toHaveText('这一行有 粗体、斜体、删除线、高亮 和 行内代码。')
    const text = await editor.innerText()
    expect(text).not.toContain('**')
    expect(text).not.toContain('[[')

    const bold = styled.getByText('粗体', { exact: true })
    expect(await style(bold, 'font-weight')).toBe('700')
    expect(Number.parseFloat(await style(lineOf(editor, '行内元素'), 'font-size'))).toBeGreaterThan(
      Number.parseFloat(await style(styled, 'font-size'))
    )

    await bold.click()
    await expect(styled).toHaveText('这一行有 **粗体**、斜体、删除线、高亮 和 行内代码。')
    await window.keyboard.press('ArrowDown')
    await expect(styled).toHaveText('这一行有 粗体、斜体、删除线、高亮 和 行内代码。')
    expect(await readFile(inline, 'utf8')).toBe(original)
    await window.screenshot({ path: info.outputPath('inline.png') })
  } finally {
    await app.close()
  }
})
