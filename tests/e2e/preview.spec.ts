import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { cp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

const fixture = 'tests/fixtures/vaults/preview'

const lineOf = (editor: Locator, text: string): Locator =>
  editor.locator('.cm-line').filter({ hasText: text })

const style = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property)

async function openNote(window: Page, name: string): Promise<Locator> {
  await window.getByRole('treeitem', { name, exact: true }).click()
  const editor = window.getByRole('textbox', { name: '编辑器' })
  await expect(editor).toHaveAttribute('data-note-path', `${name}.md`)
  return editor
}

async function start(
  name: string
): Promise<{ app: ElectronApplication; window: Page; vault: string }> {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp(fixture, vault, { recursive: true })
  const app = await launch(info.outputPath('settings'))
  const window = await app.firstWindow()
  await openVault(app, window, vault)
  await expect(window.getByRole('treeitem', { name, exact: true })).toBeVisible()
  return { app, window, vault }
}

test('live preview hides syntax away from the selection and shows it at the selection', async () => {
  const { app, window, vault } = await start('行内')
  try {
    const inline = join(vault, '行内.md')
    const original = await readFile(inline, 'utf8')
    const editor = await openNote(window, '行内')
    const styled = lineOf(editor, '这一行有')
    const links = lineOf(editor, '双链')
    await expect(styled).toHaveText('这一行有 粗体、斜体、删除线、高亮 和 行内代码。')
    await expect(links).toHaveText('双链 目标，带别名的 别名，不存在的 不存在的笔记。')
    await expect(lineOf(editor, 'Markdown 链接')).toHaveText(
      'Markdown 链接 目标笔记，不存在的 缺失，外部 示例网站，裸网址 https://example.com/path 结束。'
    )
    const text = await editor.innerText()
    for (const mark of ['**', '==', '~~', '`', '[[', '](', '# '])
      expect(text, `visible text has no ${mark}`).not.toContain(mark)

    const bold = styled.getByText('粗体', { exact: true })
    expect(await style(bold, 'font-weight')).toBe('700')
    const bodySize = Number.parseFloat(await style(styled, 'font-size'))
    expect(Number.parseFloat(await style(lineOf(editor, '行内元素'), 'font-size'))).toBeGreaterThan(
      bodySize
    )
    const body = await style(styled, 'color')
    const found = await style(links.getByText('别名', { exact: true }), 'color')
    const missing = await style(links.getByText('不存在的笔记', { exact: true }), 'color')
    expect(new Set([body, found, missing]).size).toBe(3)

    // Only the element the selection touches shows its source.
    await bold.click()
    await expect(styled).toHaveText('这一行有 **粗体**、斜体、删除线、高亮 和 行内代码。')
    await window.keyboard.press('ArrowDown')
    await expect(styled).toHaveText('这一行有 粗体、斜体、删除线、高亮 和 行内代码。')
    // A click on a link follows it, so a click right after the link puts the cursor at its end.
    const alias = await links.getByText('别名', { exact: true }).boundingBox()
    if (!alias) throw new Error('no alias on screen')
    await window.mouse.click(alias.x + alias.width + 2, alias.y + alias.height / 2)
    await expect(links).toHaveText('双链 目标，带别名的 [[目标|别名]]，不存在的 不存在的笔记。')
    await window.screenshot({ path: test.info().outputPath('inline.png') })
    expect(await readFile(inline, 'utf8')).toBe(original)

    // A wrapped list line starts under the item's text, and Enter continues the list.
    const list = await openNote(window, '列表')
    const long = lineOf(list, '第二项')
    await expect(long).toHaveText(/^•第二项/)
    const starts = await long.evaluate((line) => {
      const text = [...line.childNodes].find((node) => node.textContent?.startsWith('第二项'))
      const range = document.createRange()
      range.selectNodeContents(text!)
      return [...range.getClientRects()].map((rect) => Math.round(rect.left))
    })
    expect(starts.length).toBeGreaterThan(1)
    expect(new Set(starts).size).toBe(1)
    await lineOf(list, '第三项').click()
    await window.keyboard.press('End')
    await window.keyboard.press('Enter')
    await window.keyboard.insertText('第四项')
    await expect
      .poll(() => readFile(join(vault, '列表.md'), 'utf8'))
      .toContain('- 第三项\n- 第四项\n\n1. 有序一')

    // Properties are a monospace block of plain YAML. Its --- lines show at the selection.
    const properties = await openNote(window, '属性')
    const opening = properties.locator('.cm-line').first()
    const title = lineOf(properties, 'title: 属性示例')
    await expect(opening).toHaveText('')
    expect(await style(title, 'font-family')).toContain('Mono')
    await title.click()
    await expect(opening).toHaveText('---')
    await window.keyboard.press('End')
    await window.keyboard.insertText('二')
    await expect
      .poll(() => readFile(join(vault, '属性.md'), 'utf8'))
      .toBe(
        '---\ntitle: 属性示例二\ntags: [测试, mote]\nrelated: "[[目标]]"\n---\n# 属性\n\n正文。\n'
      )
  } finally {
    await app.close()
  }
})

test('Cmd+E switches to reading mode and back', async () => {
  const { app, window, vault } = await start('行内')
  try {
    const inline = join(vault, '行内.md')
    const original = await readFile(inline, 'utf8')
    const editor = await openNote(window, '行内')
    const styled = lineOf(editor, '这一行有')
    const hidden = '这一行有 粗体、斜体、删除线、高亮 和 行内代码。'
    await styled.getByText('粗体', { exact: true }).click()
    await expect(styled).toHaveText('这一行有 **粗体**、斜体、删除线、高亮 和 行内代码。')

    await window.keyboard.press('Meta+E')
    await expect(window.getByRole('button', { name: '切换到实时预览' })).toBeVisible()
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await expect(styled).toHaveText(hidden)
    await styled.getByText('粗体', { exact: true }).click()
    await window.keyboard.insertText('不该出现')
    await window.keyboard.press('Enter')
    await expect(styled).toHaveText(hidden)

    // The mode belongs to the window, so another note opens in reading mode too.
    const list = await openNote(window, '列表')
    await expect(list).toHaveAttribute('contenteditable', 'false')
    await openNote(window, '行内')
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await window.waitForTimeout(1000)
    expect(await readFile(inline, 'utf8')).toBe(original)

    await window.keyboard.press('Meta+E')
    await expect(window.getByRole('button', { name: '切换到阅读模式' })).toBeVisible()
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    await window.getByRole('button', { name: '切换到阅读模式' }).click()
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await window.getByRole('button', { name: '切换到实时预览' }).click()
    await styled.getByText('行内代码', { exact: true }).click()
    await window.keyboard.press('End')
    await window.keyboard.insertText('可以输入')
    await expect.poll(() => readFile(inline, 'utf8')).toContain('`行内代码`。可以输入\n')
  } finally {
    await app.close()
  }
})

type Rgb = [number, number, number]

function parseColor(color: string): Rgb {
  const hex = color.match(/^#(?:[0-9a-f]{2})?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (hex) return [hex[1], hex[2], hex[3]].map((part) => Number.parseInt(part, 16)) as Rgb
  const rgb = color.match(/^rgba?\((\d+), (\d+), (\d+)/)
  if (!rgb) throw new Error(`unknown color ${color}`)
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
}

// WCAG 2 contrast ratio.
function contrast(a: Rgb, b: Rgb): number {
  const luminance = (color: Rgb): number => {
    const [r, g, b] = color.map((value) => {
      const c = value / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

test('the window follows the system color scheme', async () => {
  const { app, window } = await start('行内')
  try {
    const editor = await openNote(window, '行内')
    // Playwright emulates a light scheme by default. Turn that off so the system setting applies.
    await window.emulateMedia({ colorScheme: null })
    const seen: Record<string, { background: Rgb; text: Rgb }> = {}
    for (const scheme of ['dark', 'light'] as const) {
      await app.evaluate(({ nativeTheme }, source) => {
        nativeTheme.themeSource = source
      }, scheme)
      await expect
        .poll(() => window.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches))
        .toBe(scheme === 'dark')
      const colors = await editor.evaluate((content) => {
        let node: Element | null = content
        while (node && getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)')
          node = node.parentElement
        return {
          background: node ? getComputedStyle(node).backgroundColor : '',
          text: getComputedStyle(content).color
        }
      })
      const background = parseColor(colors.background)
      const text = parseColor(colors.text)
      expect(contrast(background, text), `${scheme} text contrast`).toBeGreaterThanOrEqual(4.5)
      const frame = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBackgroundColor()
      )
      expect(parseColor(frame), `${scheme} window background`).toEqual(background)
      seen[scheme] = { background, text }
      await window.screenshot({ path: test.info().outputPath(`${scheme}.png`) })
    }
    expect(seen.dark.background).not.toEqual(seen.light.background)
    expect(seen.dark.text).not.toEqual(seen.light.text)
    expect(contrast(seen.dark.background, [0, 0, 0])).toBeLessThan(2)
    expect(contrast(seen.light.background, [255, 255, 255])).toBeLessThan(1.1)
  } finally {
    await app.close()
  }
})
