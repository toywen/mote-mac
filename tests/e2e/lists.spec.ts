import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { cp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

const fixture = 'tests/fixtures/vaults/lists'

async function start(): Promise<{
  app: ElectronApplication
  window: Page
  editor: Locator
  note: () => Promise<string>
}> {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp(fixture, vault, { recursive: true })
  const app = await launch(info.outputPath('settings'))
  const window = await app.firstWindow()
  await openVault(app, window, vault)
  await window.getByRole('treeitem', { name: '列表', exact: true }).click()
  const editor = window.getByRole('textbox', { name: '编辑器' })
  await expect(editor).toHaveAttribute('data-note-path', '列表.md')
  return { app, window, editor, note: () => readFile(join(vault, '列表.md'), 'utf8') }
}

test('list bullets, numbers and task checkboxes stay rendered while the cursor is on their line', async () => {
  const { app, window, editor, note } = await start()
  try {
    const line = (text: string): Locator => editor.locator('.cm-line').filter({ hasText: text })
    // Each item: its text, what the line shows with the marker rendered, and its source after typing.
    const items = [
      { text: '无序项', shown: '•无序项甲', source: '- 无序项甲' },
      { text: '有序项', shown: '1.有序项甲', source: '1. 有序项甲' },
      { text: '待办项', shown: '待办项甲', source: '- [ ] 待办项甲', checked: false },
      { text: '完成项', shown: '完成项甲', source: '- [x] 完成项甲', checked: true }
    ]
    for (const item of items) {
      const row = line(item.text)
      await row.click()
      await window.keyboard.press('End')
      await window.keyboard.insertText('甲')
      await expect.poll(note).toContain(item.source)
      for (const key of ['End', 'Home']) {
        await window.keyboard.press(key)
        await expect(row, `${item.text} after ${key}`).toHaveText(item.shown, {
          useInnerText: true
        })
        if (item.checked === undefined) continue
        const box = row.getByRole('checkbox', { name: `${item.text}甲` })
        await expect(box).toBeVisible()
        await expect(box).toBeChecked({ checked: item.checked })
      }
    }
  } finally {
    await app.close()
  }
})

test('a list inside a quote or callout keeps its markers inside the border and indents like any list', async () => {
  const { app, editor } = await start()
  try {
    const line = (text: string): Locator => editor.locator('.cm-line').filter({ hasText: text })
    const marker = async (text: string): Promise<{ x: number; right: number }> => {
      const box = (await line(text).locator('.mote-list-marker').boundingBox())!
      return { x: box.x, right: box.x + box.width }
    }
    for (const text of ['引用一', '引用二', '引用外', '引用内', '标注一']) {
      const box = (await line(text).boundingBox())!
      const border = await line(text).evaluate((el) =>
        parseFloat(getComputedStyle(el).borderLeftWidth)
      )
      expect((await marker(text)).x, text).toBeGreaterThanOrEqual(box.x + border)
    }
    const step = (await marker('普通内')).right - (await marker('普通外')).right
    expect((await marker('引用内')).right - (await marker('引用外')).right).toBeCloseTo(step, 0)
  } finally {
    await app.close()
  }
})

test('Cmd+Enter turns a line into a task, checks it, then turns it back into text', async () => {
  const { app, window, editor, note } = await start()
  try {
    const row = editor.locator('.cm-line').filter({ hasText: '段落。' })
    const box = row.getByRole('checkbox', { name: '段落。' })
    await row.click()

    await window.keyboard.press('Meta+Enter')
    await expect.poll(note).toContain('\n- [ ] 段落。\n')
    await expect(box).not.toBeChecked()

    await window.keyboard.press('Meta+Enter')
    await expect.poll(note).toContain('\n- [x] 段落。\n')
    await expect(box).toBeChecked()

    await window.keyboard.press('Meta+Enter')
    await expect.poll(note).toContain('\n段落。\n')
    await expect(box).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('Tab indents a task or bullet item into a nested list and Shift+Tab outdents it', async () => {
  const { app, window, editor, note } = await start()
  try {
    const taskRow = editor.locator('.cm-line').filter({ hasText: '待办项' })
    await taskRow.click()
    await window.keyboard.press('Tab')
    await expect.poll(note).toContain('\n  - [ ] 待办项\n')

    await window.keyboard.press('Shift+Tab')
    await expect.poll(note).toContain('\n- [ ] 待办项\n')

    const bulletRow = editor.locator('.cm-line').filter({ hasText: '无序项' })
    await bulletRow.click()
    await window.keyboard.press('Tab')
    await expect.poll(note).toContain('\n  - 无序项\n')

    await window.keyboard.press('Shift+Tab')
    await expect.poll(note).toContain('\n- 无序项\n')
  } finally {
    await app.close()
  }
})

test('nested tasks and bullets render distinct 3-level icons and cap Tab indentation at level 3', async () => {
  const { app, window, editor, note } = await start()
  try {
    const bulletOuter = editor.locator('.cm-line').filter({ hasText: '普通外' })
    const bulletInner = editor.locator('.cm-line').filter({ hasText: '普通内' })
    await expect(bulletOuter).toHaveAttribute('data-list-depth', '1')
    await expect(bulletInner).toHaveAttribute('data-list-depth', '2')

    await bulletInner.click()
    await window.keyboard.press('End')
    await window.keyboard.press('Enter')
    await window.keyboard.insertText('普通三')
    await window.keyboard.press('Tab')
    await expect.poll(note).toContain('\n    - 普通三\n')

    const bulletThird = editor.locator('.cm-line').filter({ hasText: '普通三' })
    await expect(bulletThird).toHaveAttribute('data-list-depth', '3')

    // Pressing Tab at level 3 keeps it at level 3 without adding 4th-level indentation
    await window.keyboard.press('Tab')
    await expect.poll(note).toContain('\n    - 普通三\n')
    await expect.poll(note).not.toContain('\n      - 普通三\n')

    // Nested tasks carry per-level depth attributes (1 -> 2 -> 3)
    const taskOuter = editor.locator('.cm-line').filter({ hasText: '待办项' })
    await taskOuter.click()
    await window.keyboard.press('End')
    await window.keyboard.press('Enter')
    await window.keyboard.insertText('子待办')
    await window.keyboard.press('Tab')
    await window.keyboard.press('Enter')
    await window.keyboard.insertText('微步骤')
    await window.keyboard.press('Tab')
    await expect.poll(note).toContain('- [ ] 待办项\n  - [ ] 子待办\n    - [ ] 微步骤')

    const taskSecond = editor.locator('.cm-line').filter({ hasText: '子待办' })
    const taskThird = editor.locator('.cm-line').filter({ hasText: '微步骤' })
    await expect(taskOuter.locator('.mote-task-box')).toHaveAttribute('data-depth', '1')
    await expect(taskSecond.locator('.mote-task-box')).toHaveAttribute('data-depth', '2')
    await expect(taskThird.locator('.mote-task-box')).toHaveAttribute('data-depth', '3')

    // Tab at level 3 task does not indent to level 4
    await window.keyboard.press('Tab')
    await expect.poll(note).not.toContain('      - [ ] 微步骤')
  } finally {
    await app.close()
  }
})
