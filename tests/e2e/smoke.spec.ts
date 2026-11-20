import { test, expect, _electron as electron } from '@playwright/test'

test('the main window shows the three panes', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.locator('.sidebar')).toHaveText('文件树')
  await expect(window.locator('.editor')).toHaveText('编辑器')
  await expect(window.locator('.backlinks')).toHaveText('反向链接')
  expect(await window.evaluate(() => typeof window.mote)).toBe('object')
  await window.screenshot({ path: 'test-results/smoke.png' })
  await app.close()
})
