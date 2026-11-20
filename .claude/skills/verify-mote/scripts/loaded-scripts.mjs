// Reads what the mote window has loaded and logged, over CDP. Read only.
// Usage: node .claude/skills/verify-mote/scripts/loaded-scripts.mjs <cdpPort>, with the port from `$V paths`.
// Debugger.enable reports every script parsed so far, Runtime.enable replays stored console
// messages and exceptions, and Log.enable replays browser log entries such as CSP violations.
import { chromium } from '@playwright/test'

const port = process.argv[2]
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
try {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((p) => p.url().includes('out/renderer/index.html'))
  if (!page) throw new Error('no mote window')
  const cdp = await page.context().newCDPSession(page)
  const scripts = []
  const messages = []
  cdp.on('Debugger.scriptParsed', (event) => {
    // Renderer chunks only, not Electron's preload and sandbox scripts.
    if (event.url.includes('/out/renderer/assets/')) scripts.push(event.url.split('/').pop())
  })
  cdp.on('Runtime.consoleAPICalled', (event) =>
    messages.push({
      source: 'console',
      level: event.type,
      text: event.args
        .map((arg) => arg.value ?? arg.description ?? '')
        .join(' ')
        .slice(0, 300)
    })
  )
  cdp.on('Runtime.exceptionThrown', (event) =>
    messages.push({
      source: 'exception',
      level: 'error',
      text: (event.exceptionDetails.exception?.description ?? event.exceptionDetails.text).slice(
        0,
        300
      )
    })
  )
  cdp.on('Log.entryAdded', ({ entry }) =>
    messages.push({ source: entry.source, level: entry.level, text: entry.text.slice(0, 300) })
  )
  await cdp.send('Debugger.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await new Promise((resolve) => setTimeout(resolve, 800))
  await cdp.send('Debugger.disable')
  await cdp.send('Log.disable')
  const unique = [...new Set(scripts)]
  console.log(
    JSON.stringify(
      {
        scripts: unique.length,
        lazyChunks: unique.filter((name) => !name.startsWith('index-')),
        entryScripts: unique.filter((name) => name.startsWith('index-')),
        problems: messages.filter((m) => m.level === 'error' || m.level === 'warning'),
        messages: messages.length
      },
      null,
      1
    )
  )
  await cdp.detach()
} finally {
  await browser.close()
}
