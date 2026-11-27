import type { AiMessage, VaultPath } from '../core/ipc.ts'

// The assistant talks to DeepSeek's OpenAI-style API. `aiBaseUrl` in settings.json replaces the
// address, so tests can point it at a local fake. See ADR 0031.
export const DEFAULT_AI_URL = 'https://api.deepseek.com'
export const AI_MODEL = 'deepseek-flash'

// More than this is refused rather than cut, so an answer never rests on notes it did not see.
export const MAX_SOURCE_CHARS = 400_000

export function aiBaseUrlOf(
  configured: unknown
): { ok: true; url: string } | { ok: false; error: string } {
  if (configured === undefined) return { ok: true, url: DEFAULT_AI_URL }
  try {
    const url = new URL(String(configured))
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return { ok: true, url: url.href.replace(/\/+$/, '') }
    }
  } catch {
    // Falls through to the message below.
  }
  return { ok: false, error: 'settings.json 里的 aiBaseUrl 要以 http:// 或 https:// 开头' }
}

export type Source = { path: VaultPath; text: string }

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

const noteName = (path: VaultPath): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')

// The notes go into the system message, so every turn of the conversation sees them.
export function buildMessages(
  sources: Source[],
  history: AiMessage[],
  today: string
): ChatMessage[] {
  const notes = sources
    .map(({ path, text }) => `=== 笔记：${path} ===\n${text.trim()}`)
    .join('\n\n')
  const system = [
    '你是 mote 笔记应用里的助手。今天是 ' + today + '。',
    '用户的笔记附在最后，每篇以「=== 笔记：路径 ===」开头。只根据这些笔记回答，笔记里没有的就说没有，不要编。',
    '用中文回答，用 Markdown。第一句给结论，再分点展开。不要写开场白。',
    '提到某篇笔记时，用双链写它的文件名，例如 [[' +
      (sources[0] ? noteName(sources[0].path) : '2026-11-25') +
      ']]，方便用户点回原文。',
    '',
    notes || '（这次没有附笔记。）'
  ].join('\n')
  return [{ role: 'system', content: system }, ...history]
}

function httpError(status: number, detail: string): string {
  if (status === 401) return 'DeepSeek 不认这个 API key，请重新填写'
  if (status === 402) return 'DeepSeek 账户余额不足'
  if (status === 429) return 'DeepSeek 说请求太频繁，稍后再试'
  if (status >= 500) return `DeepSeek 服务出错（${status}），稍后再试`
  return `DeepSeek 返回 ${status}${detail ? '：' + detail : ''}`
}

// Posts the conversation and calls onDelta with each piece of the answer as it streams in.
// Thinking mode is off: a summary does not need it, and it makes the first word much later.
export async function streamChat(options: {
  baseUrl: string
  key: string
  messages: ChatMessage[]
  signal: AbortSignal
  onDelta: (text: string) => void
  fetch?: typeof fetch
}): Promise<void> {
  const send = options.fetch ?? fetch
  const response = await send(`${options.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.key}` },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: options.messages,
      stream: true,
      thinking: { type: 'disabled' }
    }),
    signal: options.signal
  })
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '')
    let detail = body.slice(0, 200)
    try {
      detail = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? detail
    } catch {
      // Not JSON; the raw text is the detail.
    }
    throw new Error(httpError(response.status, detail))
  }
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(chunk, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] })
        .choices?.[0]?.delta?.content
      if (delta) options.onDelta(delta)
    }
  }
}
