import { test, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, openVault } from './app'

// Runs against the deployed service when MOTE_SYNC_URL and MOTE_SYNC_CERT point at it. The
// account it registers is throwaway; the name carries the time so runs do not collide.
const url = process.env.MOTE_SYNC_URL
const certPath = process.env.MOTE_SYNC_CERT

test.describe.configure({ timeout: 120_000 })

test('the deployed service signs up, signs in and syncs', async () => {
  test.skip(!url || !certPath, 'set MOTE_SYNC_URL and MOTE_SYNC_CERT to run against a live service')
  const root = await mkdtemp(join(tmpdir(), 'mote-live-'))
  const settings = join(root, 'settings')
  const vault = join(root, 'vault')
  await mkdir(vault, { recursive: true })
  const cert = await readFile(certPath!, 'utf8')
  const username = `e2e${Date.now().toString(36)}`.slice(0, 32)

  const app = await launch(settings)
  const window = await app.firstWindow()
  await openVault(app, window, vault)

  await window.getByRole('button', { name: /打开同步设置/ }).click()
  const panel = window.getByRole('dialog', { name: '同步设置' })
  await panel.getByLabel('服务器地址').fill(url!)
  await panel.getByLabel('证书（PEM）').fill(cert)
  await panel.getByLabel('用户名').fill(username)
  await panel.getByLabel('密码').fill('correct horse')
  await panel.getByRole('button', { name: '注册' }).click()
  await panel.getByRole('button', { name: '创建账户' }).click()

  await expect(panel.locator('.sync-code')).toHaveText(/[A-Za-z0-9_-]{20,}/)
  await panel.getByRole('button', { name: '我记下了' }).click()
  const status = window.getByRole('button', { name: /打开同步设置/ })
  await expect(status).toContainText('已同步', { timeout: 30_000 })

  await app.close()
})
