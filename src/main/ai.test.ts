import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { VaultPath } from '../core/ipc.ts'
import { aiBaseUrlOf, buildMessages, envKey, streamChat } from './ai.ts'

// A response whose body arrives in the given pieces, split wherever the network splits it.
function streamed(pieces: string[], status = 200): typeof fetch {
  return (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece))
          controller.close()
        }
      }),
      { status }
    )) as typeof fetch
}

const chunk = (content: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

async function collect(send: typeof fetch): Promise<string> {
  let text = ''
  await streamChat({
    baseUrl: 'http://fake',
    key: 'k',
    messages: [],
    signal: new AbortController().signal,
    onDelta: (d) => (text += d),
    fetch: send
  })
  return text
}

describe('streamChat', () => {
  it('joins the deltas of a server-sent stream, even when a line is split across reads', async () => {
    const body = chunk('这一周') + chunk('很忙。') + 'data: [DONE]\n\n'
    expect(await collect(streamed([body.slice(0, 17), body.slice(17, 40), body.slice(40)]))).toBe(
      '这一周很忙。'
    )
  })

  it('skips keep-alive comments and empty deltas', async () => {
    const body = ': keep-alive\n\n' + chunk('') + chunk('好') + 'data: [DONE]\n\n'
    expect(await collect(streamed([body]))).toBe('好')
  })

  it('turns an HTTP error into a message for the window', async () => {
    const reply = JSON.stringify({ error: { message: 'Authentication Fails' } })
    await expect(collect(streamed([reply], 401))).rejects.toThrow('DeepSeek 不认这个 API key')
    await expect(collect(streamed([reply], 400))).rejects.toThrow('Authentication Fails')
  })

  it('asks for the flash model, streaming, with thinking off', async () => {
    let sent: Record<string, unknown> = {}
    const send = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
      return streamed(['data: [DONE]\n\n'])('')
    }) as typeof fetch
    await collect(send)
    expect(sent).toMatchObject({
      model: 'deepseek-flash',
      stream: true,
      thinking: { type: 'disabled' }
    })
  })
})

describe('buildMessages', () => {
  it('puts every note in the system message and keeps the conversation after it', () => {
    const messages = buildMessages(
      [{ path: 'Daily/2026-11-25.md' as VaultPath, text: '发版。' }],
      [{ role: 'user', content: '总结' }],
      '2026-11-27'
    )
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('=== 笔记：Daily/2026-11-25.md ===\n发版。')
    expect(messages[0].content).toContain('[[2026-11-25]]')
    expect(messages.slice(1)).toEqual([{ role: 'user', content: '总结' }])
  })
})

describe('aiBaseUrlOf', () => {
  it('uses DeepSeek unless settings.json names another http address', () => {
    expect(aiBaseUrlOf(undefined)).toEqual({ ok: true, url: 'https://api.deepseek.com' })
    expect(aiBaseUrlOf('http://127.0.0.1:9/')).toEqual({ ok: true, url: 'http://127.0.0.1:9' })
    expect(aiBaseUrlOf('ftp://x').ok).toBe(false)
  })
})

describe('envKey', () => {
  it('reads DEEPSEEK_API_KEY from the process first', async () => {
    expect(await envKey({ DEEPSEEK_API_KEY: ' sk-own ' }, true)).toBe('sk-own')
    expect(await envKey({}, false)).toBe('')
  })

  it('asks an interactive login shell, ignoring what the profile prints', async () => {
    const zdot = await mkdtemp(join(tmpdir(), 'mote-zdot-'))
    await writeFile(join(zdot, '.zshrc'), 'echo welcome\nexport DEEPSEEK_API_KEY=sk-shell\n')
    expect(await envKey({ SHELL: '/bin/zsh', ZDOTDIR: zdot, HOME: zdot }, true)).toBe('sk-shell')
  })
})
