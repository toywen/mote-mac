import { expect, test } from '@playwright/test'
import { cp } from 'node:fs/promises'
import { launch, openVault } from './app'

const fixture = 'tests/fixtures/vaults/preview'

test('image and pdf files preview as tabs in main workspace', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp(fixture, vault, { recursive: true })

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)

    // 1. Expand '附图' folder in the file tree
    const folderTreeItem = window.getByRole('treeitem', { name: '附图' })
    await expect(folderTreeItem).toBeVisible()
    await folderTreeItem.click()

    // 2. Click '宽图.png'
    const imgTreeItem = window.getByRole('treeitem', { name: '宽图.png', exact: true })
    await expect(imgTreeItem).toBeVisible()
    await imgTreeItem.click()

    // 3. Verify tab bar and image viewer
    const activeTab = window.getByRole('tab', { selected: true })
    await expect(activeTab).toContainText('宽图.png')

    const imageViewer = window.locator('.image-viewer-container')
    await expect(imageViewer).toBeVisible()
    await expect(imageViewer).toHaveAttribute('data-image-path', '附图/宽图.png')

    const img = imageViewer.locator('img.image-viewer-img')
    await expect(img).toBeVisible()
    await expect(img).toHaveClass(/is-fit/)

    // Toggle 1:1 view
    const fitButton = imageViewer.getByRole('button', { name: /查看原始尺寸|1:1 原图/ })
    await expect(fitButton).toBeVisible()
    await fitButton.click()
    await expect(img).toHaveClass(/is-natural/)

    // Verify "在系统默认应用中打开" button is present in pane header
    const extButton = window.getByRole('button', { name: '在系统默认应用中打开' })
    await expect(extButton).toBeVisible()

    // 4. Click '文档.pdf'
    const pdfTreeItem = window.getByRole('treeitem', { name: '文档.pdf', exact: true })
    await expect(pdfTreeItem).toBeVisible()
    await pdfTreeItem.click()

    // Verify PDF viewer
    const pdfTab = window.getByRole('tab', { selected: true })
    await expect(pdfTab).toContainText('文档.pdf')

    const pdfViewer = window.locator('.pdf-viewer-container')
    await expect(pdfViewer).toBeVisible()
    await expect(pdfViewer).toHaveAttribute('data-pdf-path', '附图/文档.pdf')

    const pdfFrame = pdfViewer.locator('iframe.pdf-viewer-frame')
    await expect(pdfFrame).toBeVisible()
    const pdfSrc = await pdfFrame.getAttribute('src')
    expect(pdfSrc).toContain('mote-file://vault/')
    expect(decodeURIComponent(pdfSrc ?? '')).toContain('附图/文档.pdf')

    // 5. Switch back to '宽图.png' tab
    const imgTab = window.getByRole('tab').filter({ hasText: '宽图.png' })
    await imgTab.click()
    await expect(imageViewer).toBeVisible()
    await expect(pdfViewer).not.toBeVisible()

    // 6. Close the image tab
    const closeImgTab = window.getByRole('button', { name: '关闭 宽图.png' })
    await closeImgTab.click()
    await expect(imageViewer).not.toBeVisible()
    await expect(pdfViewer).toBeVisible()
  } finally {
    await app.close()
  }
})
