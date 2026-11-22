import { test, expect } from '@playwright/test'
import { cp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

const fixture = 'tests/fixtures/vaults/preview'

test('math formulas render in live preview and reading mode, and reveal source at selection', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp(fixture, vault, { recursive: true })

  const mathNote = `行内公式 $E = mc^2$ 呈现。

$$
\\sum_{i=1}^n i = \\frac{n(n+1)}{2}
$$

公式后面一行。`

  await writeFile(join(vault, '公式.md'), mathNote, 'utf8')

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)

    // Open math note
    await window.getByRole('treeitem', { name: '公式', exact: true }).click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveAttribute('data-note-path', '公式.md')

    // 1. Verify KaTeX rendered widgets in live preview
    const inlineMath = editor.locator('.mote-math-inline .katex')
    await expect(inlineMath).toBeVisible()
    await expect(inlineMath).toContainText('E')
    await expect(inlineMath).toContainText('m')

    const blockMath = editor.locator('.mote-math-block .katex-display')
    await expect(blockMath).toBeVisible()
    await expect(blockMath).toContainText('∑')

    // 2. Click near inline math: moving cursor into formula reveals source
    const lineWithMath = editor.locator('.cm-line').filter({ hasText: '行内公式' })
    await lineWithMath.click()
    // In live preview, cursor touching math reveals raw source $E = mc^2$
    await window.keyboard.press('End')
    // Move cursor left into the formula
    for (let i = 0; i < 6; i++) {
      await window.keyboard.press('ArrowLeft')
    }
    // Verify source $ is displayed in line
    await expect(lineWithMath).toContainText('$E = mc^2$')

    // 3. Move cursor away to "公式后面一行。"
    const lineAfter = editor.locator('.cm-line').filter({ hasText: '公式后面一行。' })
    await lineAfter.click()
    await expect(inlineMath).toBeVisible()
    await expect(blockMath).toBeVisible()

    // 4. Switch to reading mode (Cmd+E)
    await window.keyboard.press('Meta+E')
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await expect(inlineMath).toBeVisible()
    await expect(blockMath).toBeVisible()

    // 5. In reading mode, clicks do not reveal source
    await editor.locator('.mote-math-inline').first().click({ force: true })
    await expect(editor.locator('.mote-math-inline').first()).toBeVisible()
    await expect(editor.locator('.cm-line').filter({ hasText: '$E = mc^2$' })).toHaveCount(0)

    // Switch back to live preview
    await window.keyboard.press('Meta+E')
    await expect(editor).toHaveAttribute('contenteditable', 'true')
  } finally {
    await app.close()
  }
})
