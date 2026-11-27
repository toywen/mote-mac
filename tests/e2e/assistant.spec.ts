import { test, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { launch, openVault } from './app'

// A stand-in for DeepSeek's chat API. It records each request and streams a fixed answer in
// pieces, the way the real one does.
type Request = {
  auth: string
  body: { model: string; messages: { role: string; content: string }[] }
}

async function fakeDeepSeek(
  answer: string[]
): Promise<{ server: Server; url: string; seen: Request[] }> {
  const seen: Request[] = []
  const read = async (req: IncomingMessage): Promise<string> => {
    let body = ''
    for await (const piece of req) body += piece
    return body
  }
  const server = createServer(async (req, res) => {
    const body = JSON.parse(await read(req))
    seen.push({ auth: String(req.headers.authorization), body })
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const content of answer) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
    }
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}`, seen }
}

test('the assistant reads this week, streams an answer and inserts it into the note', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  const settings = info.outputPath('settings')
  const today = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  await mkdir(join(vault, 'Daily'), { recursive: true })
  await writeFile(join(vault, 'Daily', `${date}.md`), '修好了同步断线。\n')
  await writeFile(join(vault, 'Daily', '2001-01-01.md'), '很久以前。\n')
  await writeFile(join(vault, '周记.md'), '# 周记\n')

  const fake = await fakeDeepSeek(['这一周', '只做了一件事：', `修好同步断线，见 [[${date}]]。`])
  await mkdir(settings, { recursive: true })
  await writeFile(join(settings, 'settings.json'), JSON.stringify({ aiBaseUrl: fake.url }))

  const app = await launch(settings)
  const window = await app.firstWindow()
  const errors: string[] = []
  window.on('pageerror', (error) => errors.push(error.message))
  try {
    await openVault(app, window, vault)
    await window.getByRole('treeitem', { name: '周记', exact: true }).click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveAttribute('data-note-path', '周记.md')

    await window.getByRole('button', { name: '打开助手' }).click()
    const pane = window.getByRole('complementary', { name: '助手' })

    // No key yet: the pane asks for one, and it goes to the keychain, not settings.json in clear.
    await pane.getByLabel('DeepSeek API key').fill('sk-test-123')
    await pane.getByRole('button', { name: '保存' }).click()
    const saved = await readFile(join(settings, 'settings.json'), 'utf8')
    expect(saved).not.toContain('sk-test-123')

    await pane.getByRole('button', { name: '本周日记' }).click()
    await expect(pane.locator('.assistant-scope-label')).toContainText('1 篇')
    await pane.getByRole('textbox', { name: '问助手' }).fill('这一周我都做了什么？')
    await pane.getByRole('textbox', { name: '问助手' }).press('Enter')

    await expect(pane.locator('.assistant-answer')).toContainText(
      '这一周只做了一件事：修好同步断线'
    )
    await expect(pane.locator('.assistant-sources summary')).toHaveText('读了 1 篇 · 9 字')

    // Main sent the key and only this week's daily note.
    expect(fake.seen).toHaveLength(1)
    expect(fake.seen[0].auth).toBe('Bearer sk-test-123')
    expect(fake.seen[0].body.model).toBe('deepseek-flash')
    const system = fake.seen[0].body.messages[0].content
    expect(system).toContain('修好了同步断线。')
    expect(system).not.toContain('很久以前。')
    expect(fake.seen[0].body.messages.at(-1)).toEqual({
      role: 'user',
      content: '这一周我都做了什么？'
    })

    // The link in the answer resolves like one in a note.
    await expect(pane.locator('.assistant-answer .mote-link-missing')).toHaveCount(0)

    // Inserting goes through the editor, so the note saves the usual way.
    await editor.click()
    await window.keyboard.press('Meta+ArrowDown')
    await pane.getByRole('button', { name: '插入到笔记' }).click()
    await expect
      .poll(() => readFile(join(vault, '周记.md'), 'utf8'), { timeout: 10_000 })
      .toBe(`# 周记\n\n这一周只做了一件事：修好同步断线，见 [[${date}]]。\n`)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    fake.server.close()
  }
})
