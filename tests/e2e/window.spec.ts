import { test, expect } from '@playwright/test'
import { cp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

test('a search hit is selected in reading mode', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp('tests/fixtures/vaults/basic', vault, { recursive: true })
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    await window.getByRole('treeitem', { name: '带BOM', exact: true }).click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveAttribute('data-note-path', '带BOM.md')
    await window.keyboard.press('Meta+E')
    await expect(editor).toHaveAttribute('contenteditable', 'false')

    await window.keyboard.press('Meta+Shift+F')
    await window.keyboard.type('验证笔记库')
    await window.locator('button.hit').click()
    await expect(editor).toHaveAttribute('data-note-path', '欢迎.md')
    await expect.poll(() => window.evaluate(() => getSelection()?.toString())).toBe('验证笔记库')
    // The selection shows, and reading mode still takes no typing.
    await window.keyboard.type('字')
    await expect(editor).toContainText('这是 mote 的验证笔记库。')
    await expect(editor).not.toContainText('字。')
  } finally {
    await app.close()
  }
})

test('the window does not navigate away from mote, and vault images come with inert headers', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp('tests/fixtures/vaults/basic', vault, { recursive: true })
  await writeFile(
    join(vault, '附件/脚本.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>document.title = "ran"</script></svg>'
  )
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    await expect(window.getByRole('tree', { name: '文件树' })).toBeVisible()
    const home = window.url()
    const svg =
      'mote-file://vault/' + encodeURIComponent('附件') + '/' + encodeURIComponent('脚本.svg')

    const headers = await app.evaluate(async ({ net }, url) => {
      const response = await net.fetch(url)
      return {
        status: response.status,
        type: response.headers.get('content-type'),
        csp: response.headers.get('content-security-policy'),
        sniff: response.headers.get('x-content-type-options')
      }
    }, svg)
    expect(headers).toEqual({
      status: 200,
      type: 'image/svg+xml',
      csp: "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      sniff: 'nosniff'
    })

    // Asked from the main process: Playwright keeps waiting for a navigation that mote cancelled.
    for (const url of [svg, 'https://example.com/', 'file:///etc/hosts']) {
      const after = await app.evaluate(async ({ BrowserWindow }, to) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents
        await contents.executeJavaScript(`location.href = ${JSON.stringify(to)}; 0`)
        await new Promise((resolve) => setTimeout(resolve, 300))
        return {
          url: contents.getURL(),
          tree: await contents.executeJavaScript(`!!document.querySelector('[role="tree"]')`)
        }
      }, url)
      expect(after, url).toEqual({ url: home, tree: true })
    }
  } finally {
    await app.close()
  }
})
