import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { appendFile, cp, readFile } from 'node:fs/promises'
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

    // In live preview a click on the diagram, or the cursor at its edge, shows its source.
    // Up and Down skip a block widget, as CodeMirror does for every block widget.
    await diagrams.first().click()
    await expect(lineOf(editor, '```mermaid')).toHaveCount(1)
    await expect(lineOf(editor, '开始 --> 结束')).toBeVisible()
    await expect(diagrams).toHaveCount(1)
    await lineOf(editor, '图下面一行').click()
    await expect(diagrams).toHaveCount(2)
    await window.keyboard.press('Home')
    await window.keyboard.press('ArrowLeft')
    await window.keyboard.press('ArrowLeft')
    await expect(lineOf(editor, '开始 --> 结束')).toBeVisible()
    await lineOf(editor, '图下面一行').click()
    await expect(diagrams).toHaveCount(2)

    // Reading mode never shows the source.
    await window.keyboard.press('Meta+E')
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await expect(diagrams.first().locator('svg')).toBeVisible()
    await window.screenshot({ path: test.info().outputPath('mermaid.png') })
    expect(await readFile(join(vault, '图表.md'), 'utf8')).toBe(original)

    // An embed shows the note under its name. Links in it resolve from the note's folder.
    const host = join(vault, '嵌入.md')
    const hostText = await readFile(host, 'utf8')
    await openNote(window, '嵌入')
    const embeds = editor.locator('.mote-embed')
    const whole = embeds.nth(0)
    await expect(whole.locator('.mote-embed-title')).toHaveText('计划')
    await expect(whole).toContainText('计划的正文')
    await expect(whole.locator('.mote-link', { hasText: '附注' })).not.toHaveClass(
      /mote-link-missing/
    )
    // A heading shows its section, a block id its block, a missing heading a missing link.
    const section = embeds.nth(1)
    await expect(section).toContainText('只属于目标这一节')
    await expect(section).toContainText('目标下面的细节')
    await expect(section).not.toContainText('风险')
    await expect(embeds.nth(2)).toContainText('这一段有块 ID。')
    await expect(embeds.nth(2)).not.toContainText('风险')
    await expect(embeds.nth(3).locator('.mote-link-missing')).toHaveText('计划#不存在的标题')

    // A note already in the chain above, and a fourth level, show as links.
    const cycle = embeds.filter({ has: window.getByRole('button', { name: '循环甲' }) })
    await expect(cycle).toContainText('甲的正文')
    await expect(cycle).toContainText('乙的正文')
    await expect(cycle.locator('.mote-link', { hasText: '循环甲' })).toBeVisible()
    const deep = embeds.filter({ has: window.getByRole('button', { name: '深一' }) })
    await expect(deep).toContainText('深三的正文')
    await expect(deep.locator('.mote-link', { hasText: '深四' })).toBeVisible()
    await expect(deep).not.toContainText('深四的正文')
    await expect(embeds).toHaveCount(9)
    await window.screenshot({ path: test.info().outputPath('embeds.png') })

    // A change from outside shows in the embed.
    await appendFile(join(vault, '项目', '计划.md'), '\n外部写入的一行。\n')
    await expect(whole).toContainText('外部写入的一行。')

    // In live preview the embed's line shows its source while the cursor is on it.
    await window.keyboard.press('Meta+E')
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    await lineOf(editor, '嵌入下面一行').click()
    await window.keyboard.press('Home')
    await window.keyboard.press('ArrowLeft')
    await window.keyboard.press('ArrowLeft')
    await expect(lineOf(editor, '![[计划]]')).toBeVisible()
    await lineOf(editor, '嵌入下面一行').click()
    await expect(lineOf(editor, '![[计划]]')).toHaveCount(0)
    expect(await readFile(host, 'utf8')).toBe(hostText)

    // A click on a link inside the embed follows it; a click on the name opens the note.
    await whole.locator('.mote-link', { hasText: '附注' }).click()
    await expect(editor).toHaveAttribute('data-note-path', '项目/附注.md')
    await openNote(window, '嵌入')
    await whole.locator('.mote-embed-title').click()
    await expect(editor).toHaveAttribute('data-note-path', '项目/计划.md')

    // An embed of the open note's own section shows the editor's text before it is saved.
    await openNote(window, '自身')
    const own = editor.locator('.mote-embed')
    await expect(own).toContainText('第二节的文字。')
    await lineOf(editor, '第二节的文字。').and(editor.locator(':scope > .cm-line')).click()
    await window.keyboard.press('End')
    await window.keyboard.insertText('新加')
    await expect(own).toContainText('第二节的文字。新加')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
