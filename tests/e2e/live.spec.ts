import { test, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, openVault } from './app'

// Drives the real window against the deployed service. Set MOTE_USER and MOTE_PASS, and
// MOTE_SYNC_URL to use another address than the built-in one, and either MOTE_REGISTER=1 to make the account or MOTE_REGISTER=0
// to sign in with one that exists. MOTE_VAULT picks the folder to open; without it the test
// makes an empty one.
const url = process.env.MOTE_SYNC_URL
const user = process.env.MOTE_USER
const pass = process.env.MOTE_PASS
const register = process.env.MOTE_REGISTER === '1'
const vaultDir = process.env.MOTE_VAULT

test.describe.configure({ timeout: 600_000 })

test(`the deployed service ${register ? 'signs up' : 'signs in'} and syncs`, async () => {
  test.skip(!user || !pass, 'set MOTE_USER and MOTE_PASS')
  const root = await mkdtemp(join(tmpdir(), 'mote-live-'))
  const settings = join(root, 'settings')
  const vault = vaultDir ?? join(root, 'vault')
  await mkdir(vault, { recursive: true })
  await mkdir(settings, { recursive: true })
  if (url) await writeFile(join(settings, 'settings.json'), JSON.stringify({ syncServerUrl: url }))

  const app = await launch(settings)
  const window = await app.firstWindow()
  await openVault(app, window, vault)

  await window.getByRole('button', { name: /打开同步设置/ }).click()
  const panel = window.getByRole('dialog', { name: '同步设置' })
  await panel.getByLabel('用户名').fill(user!)
  await panel.getByLabel('密码').fill(pass!)
  if (register) {
    await panel.getByRole('button', { name: '注册' }).click()
    await panel.getByRole('button', { name: '创建账户' }).click()
    await expect(panel.locator('.sync-code')).toHaveText(/[A-Za-z0-9_-]{20,}/)
    await panel.getByRole('button', { name: '我记下了' }).click()
  } else {
    await panel.getByRole('button', { name: '登录' }).click()
  }

  const status = window.getByRole('button', { name: /打开同步设置/ })
  await expect(status).toContainText('已同步', { timeout: 600_000 })
  await app.close()
})
