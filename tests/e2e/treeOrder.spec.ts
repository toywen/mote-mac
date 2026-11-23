import { test, expect } from '@playwright/test'
import { cp } from 'node:fs/promises'
import { launch, openVault } from './app'

// Quitting waits up to 30 s for the update check that starts 3 s after launch, when
// api.github.com does not resolve. Leave room for that.
test.describe.configure({ timeout: 60_000 })

test('the file tree sorts Chinese names by pinyin, numbers by value, and folders first', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp('tests/fixtures/vaults/order', vault, { recursive: true })
  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    const tree = window.getByRole('tree', { name: '文件树' })
    const items = tree.getByRole('treeitem')
    await tree.getByRole('treeitem', { name: '甲', exact: true }).click()
    // 甲 jia, 乙 yi; 丙 bing, 丁 ding; 北京 bei, 笔记 bi, 广州 guang, 上海 shang.
    await expect(items).toHaveText([
      '甲',
      '丙',
      '丁',
      '乙',
      '北京',
      '笔记2',
      '笔记10',
      '广州',
      '上海'
    ])

    await window.getByRole('button', { name: '更改排序方式' }).click()
    await window
      .getByRole('menu', { name: '排序选项' })
      .getByRole('menuitemradio', { name: '文件名（从 Z 到 A）' })
      .click()
    await expect(items).toHaveText([
      '乙',
      '甲',
      '丁',
      '丙',
      '上海',
      '广州',
      '笔记10',
      '笔记2',
      '北京'
    ])
  } finally {
    await app.close()
  }
})
