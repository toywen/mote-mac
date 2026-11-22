import { test, expect } from '@playwright/test'
import { cp } from 'node:fs/promises'
import { launch, openVault } from './app'

const fixture = 'tests/fixtures/vaults/preview'

test('html file viewing and sandbox rendering (验收-13)', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp(fixture, vault, { recursive: true })

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)

    // 1. Click '网页.html' in the file tree
    const htmlTreeItem = window.getByRole('treeitem', { name: '网页.html', exact: true })
    await expect(htmlTreeItem).toBeVisible()
    await htmlTreeItem.click()

    // 2. Verify tab bar shows '网页.html' as active
    const activeTab = window.getByRole('tab', { selected: true })
    await expect(activeTab).toContainText('网页.html')

    // 3. Verify HTML viewer container and sandbox iframe
    const viewer = window.locator('.html-viewer-container')
    await expect(viewer).toBeVisible()
    await expect(viewer).toHaveAttribute('data-html-path', '网页.html')

    const iframe = window.locator('iframe.html-viewer-frame')
    await expect(iframe).toBeVisible()
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
    const src = await iframe.getAttribute('src')
    expect(src).toContain('mote-file://vault/')
    expect(src).toContain(encodeURIComponent('网页.html'))

    // 4. Verify iframe content rendering via Playwright frame locator
    const frame = window.frameLocator('iframe.html-viewer-frame')
    await expect(frame.locator('#page-title')).toHaveText('HTML 测试页面')
    await expect(frame.locator('#desc-badge')).toHaveText('沙箱环境直接阅读')

    // 5. Verify pane header shows "在默认浏览器中打开" button
    const extButton = window.getByRole('button', { name: '在默认浏览器中打开' })
    await expect(extButton).toBeVisible()

    // 6. Open '网页链接.md' and follow the link to '网页.html'
    const noteTreeItem = window.getByRole('treeitem', { name: '网页链接', exact: true })
    await expect(noteTreeItem).toBeVisible()
    await noteTreeItem.click()

    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toBeVisible()
    await expect(editor).toHaveAttribute('data-note-path', '网页链接.md')

    // Click the markdown link targeting '网页.html'
    const linkLine = editor.locator('.cm-line').filter({ hasText: '点击打开' })
    await expect(linkLine).toBeVisible()
    const htmlLink = linkLine.getByText('测试网页', { exact: true })
    await expect(htmlLink).toBeVisible()
    await htmlLink.click()

    // Verify main view switches back to HTML viewer tab
    await expect(viewer).toBeVisible()
    await expect(viewer).toHaveAttribute('data-html-path', '网页.html')
    await expect(frame.locator('#page-title')).toHaveText('HTML 测试页面')

    // 7. Verify closing tab via close button
    const closeTabButton = window.getByRole('button', { name: '关闭 网页.html' })
    await closeTabButton.click()
    await expect(viewer).not.toBeVisible()
  } finally {
    await app.close()
  }
})
