import { test, expect } from '@playwright/test'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch, openVault } from './app'

// The sync service lives in its own repository. This test drives a real one, so it needs that
// checkout built next to this one. Without it the test says how to build it and skips.
const serverJs = resolve(process.cwd(), '..', 'mote-sync', 'server', 'dist', 'index.js')

type Cli = Record<string, string | number>

function cli(data: string, ...args: string[]): Cli {
  const out = execFileSync(process.execPath, [serverJs, ...args, '--data', data], {
    env: { ...process.env, DATA_DIR: data }
  })
  return JSON.parse(out.toString()) as Cli
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer()
    probe.once('error', fail)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() =>
        typeof address === 'object' && address ? done(address.port) : fail(new Error('no port'))
      )
    })
  })
}

function startServer(
  data: string,
  port: number
): Promise<import('node:child_process').ChildProcess> {
  const child = execFile(process.execPath, [serverJs, 'serve'], {
    env: { ...process.env, DATA_DIR: data, PORT: String(port), HOST: '127.0.0.1' }
  })
  const deadline = AbortSignal.timeout(15_000)
  return new Promise((done, fail) => {
    deadline.addEventListener('abort', () => fail(new Error('the sync service did not start')))
    // The service prints its listening line on stderr, like most of its command line.
    const heard = (chunk: Buffer): void => {
      if (chunk.toString().includes('listening')) done(child)
    }
    child.stdout?.on('data', heard)
    child.stderr?.on('data', heard)
    child.once('exit', (code) => fail(new Error(`the sync service exited with ${code}`)))
  })
}

function stopServer(child: import('node:child_process').ChildProcess): Promise<void> {
  return new Promise((done) => {
    if (child.exitCode !== null) return done()
    child.once('exit', () => done())
    child.kill('SIGTERM')
  })
}

test.describe.configure({ timeout: 120_000 })

test('sync settings connect, go offline and come back', async () => {
  test.skip(
    !existsSync(serverJs),
    `build the sync service first: (cd ../mote-sync && npm install && npm run build)`
  )
  const root = await mkdtemp(join(tmpdir(), 'mote-sync-e2e-'))
  const data = join(root, 'service')
  const settings = join(root, 'settings')
  const vault = join(root, 'vault')
  await mkdir(vault, { recursive: true })

  cli(data, 'init')
  const account = cli(data, 'account', 'create', '--name', 'me')
  cli(data, 'vault', 'create', '--account', String(account.id), '--name', 'life-os')
  const device = cli(data, 'device', 'create', '--account', String(account.id), '--name', 'mac')

  const port = await freePort()
  let server = await startServer(data, port)

  const app = await launch(settings)
  const window = await app.firstWindow()
  await openVault(app, window, vault)

  await window.getByRole('button', { name: /打开同步设置/ }).click()
  await window.getByLabel('服务器地址').fill(`http://127.0.0.1:${port}`)
  await window.getByLabel('设备令牌').fill(String(device.token))
  await window.getByRole('button', { name: '保存并连接' }).click()
  const panel = window.getByRole('dialog', { name: '同步设置' })
  await expect(panel.locator('.sync-error')).toHaveCount(0)
  await expect(panel.getByRole('status')).toContainText('已同步', { timeout: 30_000 })
  await window.getByRole('button', { name: '关闭' }).click()

  const status = window.getByRole('button', { name: /打开同步设置/ })
  await expect(status).toContainText('已同步', { timeout: 30_000 })

  await stopServer(server)
  await expect(status).toContainText('离线', { timeout: 30_000 })

  server = await startServer(data, port)
  await expect(status).toContainText('已同步', { timeout: 30_000 })

  await app.close()
  await stopServer(server)
})
