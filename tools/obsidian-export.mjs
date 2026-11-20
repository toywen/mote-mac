#!/usr/bin/env node
// Opens a vault copy in an isolated Obsidian and saves Obsidian's link resolution next to it:
//   node tools/obsidian-export.mjs ~/mote-link-check/wiki-copy [more copies...]
// writes ~/mote-link-check/wiki-copy.obsidian-links.json as { obsidian, files, resolved, unresolved }.
//
// Obsidian runs with its own --user-data-dir, so the user's Obsidian settings and vault list are
// never read or written. The loader picks the newest obsidian-*.asar in that dir, so the script
// copies the user's installed version there to pin it. Obsidian writes the copy's .obsidian folder.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { chromium } from '@playwright/test'

const OBSIDIAN = '/Applications/Obsidian.app/Contents/MacOS/Obsidian'
const VERSION = process.env.OBSIDIAN_VERSION ?? '1.15.1'
const ASAR = join(homedir(), 'Library/Application Support/obsidian', `obsidian-${VERSION}.asar`)
const ALLOWED = [join(homedir(), 'mote-link-check'), realpathSync(tmpdir())]
const TIMEOUT_MS = 180_000

const vaults = process.argv.slice(2)
if (vaults.length === 0) {
  console.error('usage: obsidian-export.mjs <vault copy>...')
  process.exit(2)
}
if (!existsSync(ASAR)) throw new Error(`missing ${ASAR}; set OBSIDIAN_VERSION`)

async function devtoolsPort(child) {
  return new Promise((resolve, reject) => {
    let log = ''
    const timer = setTimeout(() => reject(new Error(`no DevTools port:\n${log}`)), 30_000)
    const read = (chunk) => {
      log += chunk
      const match = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
      if (match) {
        clearTimeout(timer)
        resolve(Number(match[1]))
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('exit', (code) => reject(new Error(`Obsidian exited with ${code}:\n${log}`)))
  })
}

async function exportVault(input) {
  const vault = realpathSync(input)
  if (!ALLOWED.some((root) => vault.startsWith(realpathSync(root) + '/')))
    throw new Error(`refusing ${vault}: only copies under ${ALLOWED.join(' or ')}`)
  const out = join(dirname(vault), basename(vault) + '.obsidian-links.json')
  const userData = mkdtempSync(join(tmpdir(), 'obsidian-export-'))
  copyFileSync(ASAR, join(userData, basename(ASAR)))
  writeFileSync(
    join(userData, 'obsidian.json'),
    JSON.stringify({ vaults: { a1b2c3d4e5f60718: { path: vault, ts: Date.now(), open: true } } })
  )
  const child = spawn(OBSIDIAN, [`--user-data-dir=${userData}`, '--remote-debugging-port=0'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let browser
  try {
    const port = await devtoolsPort(child)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const deadline = Date.now() + TIMEOUT_MS
    let page
    while (!page) {
      if (Date.now() > deadline) throw new Error('no vault window')
      for (const candidate of browser.contexts().flatMap((context) => context.pages()))
        if (await candidate.evaluate(() => !!window.app?.metadataCache).catch(() => false))
          page = candidate
      if (!page) await new Promise((resolve) => setTimeout(resolve, 500))
    }
    const result = await page.evaluate(async (timeout) => {
      const { metadataCache, vault } = window.app
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const end = Date.now() + timeout
      while (!metadataCache.initialized || metadataCache.inProgressTaskCount > 0) {
        if (Date.now() > end) throw new Error('metadata cache did not finish indexing')
        await sleep(200)
      }
      await new Promise((resolve) => metadataCache.onCleanCache(resolve))
      // Link resolution runs in its own queue after indexing; wait until it stops changing.
      let last = ''
      for (let stable = 0; stable < 4;) {
        if (Date.now() > end) throw new Error('link resolution did not settle')
        await sleep(500)
        const now = JSON.stringify([metadataCache.resolvedLinks, metadataCache.unresolvedLinks])
        stable = now === last && !metadataCache.linkResolverQueue?.running ? stable + 1 : 0
        last = now
      }
      const files = vault.getFiles().map((file) => file.path)
      const markdown = files.filter((path) => path.endsWith('.md'))
      const missing = markdown.filter((path) => !(path in metadataCache.resolvedLinks))
      return {
        obsidian: window.electron.ipcRenderer.sendSync('version'),
        vault: vault.adapter.basePath,
        missing,
        files,
        resolved: metadataCache.resolvedLinks,
        unresolved: metadataCache.unresolvedLinks
      }
    }, TIMEOUT_MS)
    if (result.vault !== vault) throw new Error(`Obsidian opened ${result.vault}, not ${vault}`)
    if (result.obsidian !== VERSION)
      throw new Error(`Obsidian ran ${result.obsidian}, not ${VERSION}`)
    if (result.missing.length)
      throw new Error(`notes missing from resolvedLinks: ${result.missing.slice(0, 5).join(', ')}`)
    const { obsidian, files, resolved, unresolved } = result
    writeFileSync(out, JSON.stringify({ obsidian, files, resolved, unresolved }))
    const count = (links) =>
      Object.values(links).reduce(
        (sum, targets) => sum + Object.values(targets).reduce((a, b) => a + b, 0),
        0
      )
    console.log(
      JSON.stringify({
        out,
        obsidian,
        files: files.length,
        notes: Object.keys(resolved).length,
        resolvedLinks: count(resolved),
        unresolvedLinks: count(unresolved)
      })
    )
  } finally {
    await browser?.close().catch(() => {})
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    rmSync(userData, { recursive: true, force: true })
  }
}

for (const vault of vaults) await exportVault(vault)
