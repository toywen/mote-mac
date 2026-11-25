import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { cp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

const fixture = 'tests/fixtures/vaults/preview'

const style = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property)

// The editor line whose whole text is text.
const line = (editor: Locator, text: string): Locator =>
  editor.locator('.cm-line').filter({ hasText: new RegExp(`^${text}$`) })

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
  await expect(window.getByRole('treeitem', { name: '任务', exact: true })).toBeVisible()
  return { app, window, vault }
}

// Each byte offset where b differs from a, with both bytes. Lengths must match.
function changedBytes(a: Buffer, b: Buffer): { at: number; was: number; now: number }[] {
  if (a.length !== b.length) return [{ at: -1, was: a.length, now: b.length }]
  const changed: { at: number; was: number; now: number }[] = []
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) changed.push({ at: i, was: a[i], now: b[i] })
  return changed
}

test('callouts, tables and task checkboxes render, and a checkbox click changes one byte', async () => {
  const { app, window, vault } = await start()
  try {
    // Callouts: the [!type] marks hide, the title shows, and every kind has the accent color.
    const callouts = await openNote(window, 'callout')
    await expect.poll(() => callouts.innerText()).not.toContain('[!')
    const titles = ['笔记', '信息', '提示', '重要', '注意', '危险', '示例', '引言']
    const border: Record<string, string> = {}
    for (const title of titles) {
      await expect(line(callouts, title)).toHaveCount(1)
      border[title] = await style(line(callouts, title), 'border-left-color')
    }
    expect(new Set(Object.values(border)).size).toBe(1)
    expect(await style(line(callouts, '提示正文'), 'border-left-color')).toBe(border['提示'])
    expect(await style(line(callouts, '未知类型像笔记'), 'border-left-color')).toBe(border['笔记'])
    const quote = await style(line(callouts, '普通引用不是 callout。'), 'border-left-color')
    expect(Object.values(border)).not.toContain(quote)
    await expect(line(callouts, 'Summary')).toHaveCount(1)
    await expect(line(callouts, '内层')).toHaveCount(1)
    expect(await callouts.locator('.mote-callout-icon').count()).toBeGreaterThanOrEqual(12)
    // The title line shows its source while the selection is on it.
    await line(callouts, '注意').click()
    await expect(line(callouts, '> \\[!warning\\] 注意')).toHaveCount(1)
    await window.keyboard.press('ArrowDown')
    await expect(line(callouts, '注意')).toHaveCount(1)

    // Tables: real rows and cells with their inline styles, links and alignment.
    const tables = await openNote(window, '表格')
    await expect(tables.getByRole('table')).toHaveCount(3)
    const table = tables.getByRole('table').first()
    await expect(table.getByRole('columnheader')).toHaveText(['左对齐', '居中', '右对齐', '默认'])
    await expect(table.getByRole('cell')).toHaveText([
      '粗体',
      '斜体',
      '删除',
      '高亮',
      '代码',
      '#标签',
      '别名',
      '不存在的笔记',
      'Markdown 链接',
      '竖线 | 转义',
      '',
      '最后一格'
    ])
    const aligns = await table
      .getByRole('columnheader')
      .evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).textAlign))
    expect(aligns).toEqual(['left', 'center', 'right', 'left'])
    expect(await style(table.getByText('粗体', { exact: true }), 'font-weight')).toBe('700')
    expect(await style(table.getByText('删除', { exact: true }), 'text-decoration')).toContain(
      'line-through'
    )
    const source = await readFile(join(vault, '表格.md'), 'utf8')
    const alias = table.getByText('别名', { exact: true })
    await expect(alias).toHaveClass('mote-link')
    await expect(alias).toHaveAttribute('data-link-from', String(source.indexOf('[[目标\\|别名]]')))
    await expect(table.getByText('不存在的笔记')).toHaveClass('mote-link mote-link-missing')
    await expect(table.getByText('Markdown 链接')).toHaveClass('mote-link')
    // GFM gives every body row as many cells as the header.
    const short = tables.getByRole('table').nth(1)
    await expect(short.getByRole('cell')).toHaveText(['只有一格', '', '一', '二'])

    // P1-2: A click on a cell allows editing it in-place while keeping the table rendered.
    const delimiter = line(tables, '\\| :--- \\| :---: \\| ---: \\| --- \\|')
    await expect(delimiter).toHaveCount(0)
    await expect(tables.getByRole('table')).toHaveCount(3)
    await table.getByText('斜体', { exact: true }).click()
    await expect(delimiter).toHaveCount(0)
    await expect(tables.getByRole('table')).toHaveCount(3)
    await window.keyboard.insertText('甲')
    await line(tables, '表格下面一行。').click()
    await expect.poll(() => readFile(join(vault, '表格.md'), 'utf8')).toContain('| *斜体*甲 |')
    await expect(delimiter).toHaveCount(0)
    await expect(tables.getByRole('table')).toHaveCount(3)

    // A caret at the top of the note used to turn every table back into its source.
    await tables.locator('.cm-line').first().click()
    await window.keyboard.press('Home')
    await expect(delimiter).toHaveCount(0)
    await expect(tables.getByRole('table')).toHaveCount(3)

    // Tasks: a checkbox in the bullet's place, and a click changes one byte.
    const path = join(vault, '任务.md')
    const original = await readFile(path)
    const marker = original.indexOf('[ ] 待办任务') + 1
    const tasks = await openNote(window, '任务')
    await expect(tasks.getByRole('checkbox')).toHaveCount(5)
    const todo = tasks.getByRole('checkbox', { name: '待办任务' })
    await expect(todo).not.toBeChecked()
    await expect(tasks.getByRole('checkbox', { name: '已完成的任务' })).toBeChecked()
    // The bullet keeps its width for the checkbox but shows nothing.
    const todoLine = tasks.locator('.cm-line').filter({ hasText: '待办任务' })
    await expect(todoLine).toHaveText('待办任务', { useInnerText: true })
    const finished = tasks.getByText('已完成的任务', { exact: true })
    expect(await style(finished, 'text-decoration')).toContain('line-through')

    await line(tasks, '普通段落。').click()
    await todo.click()
    await expect(todo).toBeChecked()
    const checked = [{ at: marker, was: 0x20, now: 0x78 }]
    await expect.poll(async () => changedBytes(original, await readFile(path))).toEqual(checked)
    // Undo takes the click back like any typing.
    await window.keyboard.press('Meta+Z')
    await expect(todo).not.toBeChecked()
    await expect.poll(async () => changedBytes(original, await readFile(path))).toEqual([])

    // Reading mode renders the same blocks, and a checkbox still toggles.
    await window.keyboard.press('Meta+E')
    await expect(tasks).toHaveAttribute('contenteditable', 'false')
    await todo.click()
    await expect(todo).toBeChecked()
    await expect.poll(async () => changedBytes(original, await readFile(path))).toEqual(checked)
    await todo.click()
    await expect.poll(async () => changedBytes(original, await readFile(path))).toEqual([])
    const reading = await openNote(window, '表格')
    await reading.getByRole('table').first().getByText('斜体甲', { exact: true }).click()
    await expect(reading.getByRole('table')).toHaveCount(3)
    await window.screenshot({ path: test.info().outputPath('reading.png') })
  } finally {
    await app.close()
  }
})

test('a selection dragged across quote lines stays inside the quote', async () => {
  const { app, window } = await start()
  try {
    const editor = await openNote(window, '块')
    const first = (await editor.locator('.cm-line.mote-quote').nth(0).boundingBox())!
    const second = (await editor.locator('.cm-line.mote-quote').nth(1).boundingBox())!
    await window.mouse.move(first.x + 60, first.y + first.height / 2)
    await window.mouse.down()
    await window.mouse.move(second.x + 90, second.y + second.height / 2, { steps: 5 })
    await window.mouse.up()
    const drawn = window.locator('.cm-selectionBackground')
    await expect(drawn).toHaveCount(2)
    for (const piece of await drawn.all()) {
      const box = (await piece.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(first.x)
      expect(box.x + box.width).toBeLessThanOrEqual(first.x + first.width)
    }
  } finally {
    await app.close()
  }
})
