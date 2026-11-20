#!/usr/bin/env node
// Drive a disposable mote instance for verification. Read ../SKILL.md before using it.
// Usage: .claude/skills/verify-mote/scripts/verify-mote.mjs <command> [--flag value ...] [-- app args]
import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const SCRATCH_ROOT = path.join(os.tmpdir(), 'mote-verify')
const EVIDENCE_ROOT = path.join(REPO, 'verify-artifacts')
const DEFAULT_VAULT = path.join(REPO, 'tests/fixtures/vaults/basic')
const RENDERER_URL = pathToFileURL(path.join(REPO, 'out/renderer/index.html')).href
const ELECTRON = createRequire(import.meta.url)('electron')
const READY_TIMEOUT_MS = 30_000

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = {}
  const extra = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      extra.push(...argv.slice(i + 1))
      break
    }
    if (!arg.startsWith('--')) throw new UsageError(`unexpected argument: ${arg}`)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) opts[arg.slice(2)] = true
    else {
      opts[arg.slice(2)] = next
      i++
    }
  }
  return { opts, extra }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readState(run) {
  const file = path.join(SCRATCH_ROOT, run, 'state.json')
  if (!fs.existsSync(file)) throw new UsageError(`no run named ${run} in ${SCRATCH_ROOT}`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function runsOfThisCheckout() {
  if (!fs.existsSync(SCRATCH_ROOT)) return []
  return fs
    .readdirSync(SCRATCH_ROOT)
    .filter((run) => fs.existsSync(path.join(SCRATCH_ROOT, run, 'state.json')))
    .map(readState)
    .filter((state) => state.repo === REPO)
}

// A command without --run uses the only live run of this checkout, so two agents never share one.
function selectRun(opts) {
  const named = opts.run ?? process.env.MOTE_VERIFY_RUN
  if (named) return readState(named)
  const live = runsOfThisCheckout().filter((state) => isAlive(state.pid))
  if (live.length === 1) return live[0]
  if (live.length === 0) throw new UsageError('no live run for this checkout; run `launch` first')
  throw new UsageError(`several live runs, pass --run: ${live.map((s) => s.run).join(', ')}`)
}

function record(state, command, result) {
  const line = { time: new Date().toISOString(), command, result }
  fs.appendFileSync(path.join(state.evidence, 'actions.jsonl'), JSON.stringify(line) + '\n')
}

// Hash every entry, dot entries included, so a write to .obsidian or a new empty folder shows up.
// tools/hash-vault.mjs skips dot entries, so it cannot prove .obsidian is untouched.
function hashTree(root) {
  const lines = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const full = path.join(dir, entry.name)
      const rel = path.relative(root, full)
      if (entry.isSymbolicLink()) lines.push(`link ${rel} -> ${fs.readlinkSync(full)}`)
      else if (entry.isDirectory()) {
        lines.push(`dir  ${rel}/`)
        walk(full)
      } else if (entry.isFile()) {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
        lines.push(`file ${rel} ${hash}`)
      }
    }
  }
  walk(root)
  return lines.sort().join('\n') + '\n'
}

function diffHashes(before, after) {
  const index = (text) => {
    const map = new Map()
    for (const line of text.split('\n').filter(Boolean)) {
      const kind = line.slice(0, 4).trim()
      const entry = line.slice(5)
      const boundary =
        kind === 'file' ? entry.length - 65 : kind === 'link' ? entry.indexOf(' -> ') : entry.length
      map.set(`${kind} ${entry.slice(0, boundary)}`, entry.slice(boundary))
    }
    return map
  }
  const a = index(before)
  const b = index(after)
  const out = []
  for (const [key, value] of a) {
    if (!b.has(key)) out.push(`removed ${key}`)
    else if (b.get(key) !== value) out.push(`changed ${key}`)
  }
  for (const key of b.keys()) if (!a.has(key)) out.push(`added   ${key}`)
  return out
}

function newestMtime(dir) {
  let newest = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    newest = Math.max(newest, fs.statSync(path.join(entry.parentPath, entry.name)).mtimeMs)
  }
  return newest
}

function git(...args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim()
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

async function waitForLog(logFile, pid) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const log = fs.readFileSync(logFile, 'utf8')
    const inspector = log.match(/Debugger listening on (ws:\/\/\S+)/)
    const devtools = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
    if (inspector && devtools) return { inspectorUrl: inspector[1], cdpPort: Number(devtools[1]) }
    if (!isAlive(pid)) throw new Error(`mote exited during launch:\n${log}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`mote printed no debug endpoints in ${READY_TIMEOUT_MS} ms`)
}

async function withPage(state, fn) {
  // noDefaults keeps Playwright from forcing a light color scheme and focus onto the window.
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`, {
    noDefaults: true
  })
  try {
    const pages = browser.contexts().flatMap((context) => context.pages())
    const page = pages.find((p) => p.url().startsWith(RENDERER_URL))
    if (!page) throw new Error(`no mote window; pages: ${pages.map((p) => p.url()).join(', ')}`)
    return await fn(page)
  } finally {
    // Closing a CDP connection only disconnects. The app keeps running.
    await browser.close()
  }
}

// Usable means React mounted and the preload bridge exists.
// Extend this when mote gains a state that must load first, such as an open vault.
async function waitUntilUsable(page) {
  await page.waitForFunction(
    () => document.querySelector('#root > *') !== null && typeof window.mote === 'object',
    undefined,
    { timeout: READY_TIMEOUT_MS }
  )
}

// Obsidian's resolvedLinks read backwards: target -> { source: count }.
function obsidianBacklinks(exportFile) {
  const { resolved } = JSON.parse(fs.readFileSync(exportFile, 'utf8'))
  const result = {}
  for (const [source, targets] of Object.entries(resolved))
    for (const [target, count] of Object.entries(targets)) (result[target] ??= {})[source] = count
  return result
}

// Nearest-rank percentile.
function percentile(values, p) {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
}

const round = (ms) => Math.round(ms * 100) / 100

async function walkNotes(page, vault, exportFile) {
  const started = performance.now()
  const noteMs = []
  const expectedBacklinks = exportFile ? obsidianBacklinks(exportFile) : null
  const backlinkMismatches = []
  let backlinkCount = 0
  const tree = page.getByRole('tree', { name: '文件树' })
  await tree.waitFor()
  const expected = fs
    .readdirSync(vault, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.md')
    .map((entry) => path.relative(vault, path.join(entry.parentPath, entry.name)))
    .filter((rel) => !rel.split(path.sep).some((part) => part.startsWith('.')))
    .sort()
  const folders = new Set()
  for (const note of expected) {
    const parts = note.split(path.sep)
    for (let depth = 1; depth < parts.length; depth++) folders.add(parts.slice(0, depth).join('/'))
  }
  for (const folder of folders) {
    const row = tree.locator(`[data-kind="folder"][data-path=${JSON.stringify(folder)}]`)
    if ((await row.getAttribute('aria-expanded')) === 'false') await row.click()
  }
  const rows = tree.locator('[data-kind="note"]')
  const paths = await rows.evaluateAll((nodes) => nodes.map((node) => node.dataset.path))
  if (JSON.stringify(paths.toSorted()) !== JSON.stringify(expected)) {
    throw new Error(
      `visible tree notes (${paths.length}) differ from the vault (${expected.length})`
    )
  }
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const note of paths) {
    const row = rows.and(page.locator(`[data-path=${JSON.stringify(note)}]`))
    // Times the open inside the page: Playwright's click and waitFor add about 60 ms of their own.
    await page.evaluate((note) => {
      window.__moteOpenMs = new Promise((resolve) => {
        let clickedAt = null
        const editor = `.cm-content[data-note-path="${CSS.escape(note)}"]`
        const observer = new MutationObserver(() => check())
        const check = () => {
          if (clickedAt === null || !document.querySelector(editor)) return
          observer.disconnect()
          resolve(performance.now() - clickedAt)
        }
        // check() also covers a note that is open already, which adds no mutation.
        const onClick = (event) => {
          clickedAt = event.timeStamp
          check()
        }
        addEventListener('click', onClick, { capture: true, once: true })
        observer.observe(document.body, { childList: true, subtree: true, attributes: true })
      })
    }, note)
    await row.click()
    await page
      .getByRole('textbox', { name: '编辑器' })
      .and(page.locator(`[data-note-path=${JSON.stringify(note)}]`))
      .waitFor({ timeout: 5000 })
    noteMs.push(await page.evaluate(() => window.__moteOpenMs))
    const alerts = await page.getByRole('alert').allTextContents()
    if (errors.length || alerts.length)
      throw new Error(`${note}: ${[...errors, ...alerts].join('; ')}`)
    if (expectedBacklinks) {
      const pane = page.getByRole('complementary', { name: '反向链接' })
      const list = pane.locator(`[data-note-path=${JSON.stringify(note)}]`)
      await list.waitFor({ timeout: 5000 })
      const shown = await list
        .locator('button.hit')
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.path))
      const actual = {}
      for (const source of shown) actual[source] = (actual[source] ?? 0) + 1
      const want = expectedBacklinks[note] ?? {}
      backlinkCount += shown.length
      for (const source of new Set([...Object.keys(want), ...Object.keys(actual)]))
        if ((want[source] ?? 0) !== (actual[source] ?? 0))
          backlinkMismatches.push({
            note,
            source,
            obsidian: want[source] ?? 0,
            mote: actual[source] ?? 0
          })
    }
  }
  return {
    opened: paths.length,
    expected: expected.length,
    errorCount: errors.length,
    durationMs: round(performance.now() - started),
    medianNoteMs: round(percentile(noteMs, 50)),
    ...(expectedBacklinks ? { backlinks: backlinkCount, backlinkMismatches } : {}),
    paths
  }
}

// Reads CodeMirror's document through the view it keeps on .cm-content. Read only.
function readEditor(page, from = 0, to = 0) {
  return page.evaluate(
    ([from, to]) => {
      const view = document.querySelector('.cm-content')?.cmTile?.root?.view
      if (!view) throw new Error('no CodeMirror view on .cm-content')
      const { doc, selection } = view.state
      return { length: doc.length, head: selection.main.head, slice: doc.sliceString(from, to) }
    },
    [from, to]
  )
}

const MAIN_THREAD_METRICS = {
  task: 'TaskDuration',
  script: 'ScriptDuration',
  layout: 'LayoutDuration',
  recalcStyle: 'RecalcStyleDuration'
}

// Counts the renderer main-thread work each key causes, so the number does not depend on vsync.
async function benchTyping(page, { chars, gap, where }) {
  const editor = page.getByRole('textbox', { name: '编辑器' })
  const note = await editor.getAttribute('data-note-path')
  // A hidden page skips layout and paint, so its numbers would leave out work a user waits on.
  if ((await page.evaluate(() => document.visibilityState)) !== 'visible')
    throw new Error('the mote window is hidden; it must draw frames while it is measured')
  await editor.click()
  await page.keyboard.press(where === 'start' ? 'Meta+ArrowUp' : 'Meta+ArrowDown')
  const before = await readEditor(page)
  if (before.head !== (where === 'start' ? 0 : before.length))
    throw new Error(`caret at ${before.head} of ${before.length}, not at the ${where}`)

  const cdp = await page.context().newCDPSession(page)
  const sample = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics')
    const seconds = Object.fromEntries(metrics.map((m) => [m.name, m.value]))
    return Object.fromEntries(
      Object.entries(MAIN_THREAD_METRICS).map(([key, name]) => [key, seconds[name] * 1000])
    )
  }
  const measure = async (key) => {
    const start = await sample()
    if (key) await page.keyboard.press(key)
    await new Promise((resolve) => setTimeout(resolve, gap))
    const end = await sample()
    return Object.fromEntries(Object.keys(start).map((k) => [k, end[k] - start[k]]))
  }
  const text = Array.from({ length: chars }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')
  const idle = []
  const keys = []
  try {
    await cdp.send('Performance.enable')
    // The same sampling with no key shows what the gap costs on its own.
    for (let i = 0; i < 20; i++) idle.push((await measure(null)).task)
    for (const key of text) keys.push(await measure(key))
  } finally {
    await cdp.detach()
  }

  const after = await readEditor(page, before.head, before.head + chars)
  if (after.length !== before.length + chars || after.slice !== text)
    throw new Error(`editor grew by ${after.length - before.length}, expected ${chars}`)
  const task = keys.map((k) => k.task)
  const mean = (key) => round(keys.reduce((sum, k) => sum + k[key], 0) / keys.length)
  return {
    note,
    where,
    chars,
    gapMs: gap,
    docLength: { before: before.length, after: after.length },
    taskMs: {
      median: round(percentile(task, 50)),
      p95: round(percentile(task, 95)),
      max: round(percentile(task, 100))
    },
    meanMs: { script: mean('script'), layout: mean('layout'), recalcStyle: mean('recalcStyle') },
    idleTaskMs: { median: round(percentile(idle, 50)), max: round(percentile(idle, 100)) }
  }
}

async function mainEval(state, expression) {
  const ws = new WebSocket(state.inspectorUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('cannot reach the main-process inspector'))
  })
  try {
    const params = {
      expression: `(async () => { const electron = require('electron'); return (${expression}) })()`,
      includeCommandLineAPI: true,
      awaitPromise: true,
      returnByValue: true
    }
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params }))
    const reply = await new Promise((resolve) => {
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.id === 1) resolve(message)
      }
    })
    const failure = reply.error ?? reply.result.exceptionDetails
    if (failure) throw new Error(failure.exception?.description ?? failure.message ?? failure.text)
    return reply.result.result.value
  } finally {
    ws.close()
  }
}

function locate(page, opts) {
  const exact = Boolean(opts.exact)
  if (opts.role) {
    return page.getByRole(opts.role, opts.name ? { name: opts.name, exact } : {})
  }
  if (opts.text) return page.getByText(opts.text, { exact })
  if (opts.label) return page.getByLabel(opts.label, { exact })
  if (opts.selector) return page.locator(opts.selector)
  throw new UsageError('give a locator: --role R [--name N] | --text T | --label L | --selector S')
}

function evidencePath(state, opts, ext) {
  if (!opts.out) throw new UsageError('give --out <name>; the file goes into the evidence dir')
  return path.join(state.evidence, `${opts.out}${ext}`)
}

async function launch(opts, extra) {
  const run = opts.run ?? `${stamp()}-${crypto.randomBytes(2).toString('hex')}`
  const source = path.resolve(opts.vault ?? DEFAULT_VAULT)
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) {
    throw new UsageError(`vault is not a directory: ${source}`)
  }
  const scratch = path.join(SCRATCH_ROOT, run)
  if (fs.existsSync(scratch)) throw new UsageError(`run ${run} already exists`)
  const evidence = path.join(EVIDENCE_ROOT, run)
  const vault = path.join(scratch, 'vault')
  const userData = path.join(scratch, 'user-data')
  fs.mkdirSync(evidence, { recursive: true })
  fs.mkdirSync(userData, { recursive: true })

  if (!opts['skip-build']) {
    try {
      execFileSync('npx', ['electron-vite', 'build'], { cwd: REPO, stdio: 'pipe' })
    } catch (error) {
      throw new Error(`build failed:\n${error.stdout}\n${error.stderr}`, { cause: error })
    }
  }
  const builtAt = Math.min(
    ...['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html'].map(
      (file) => fs.statSync(path.join(REPO, file)).mtimeMs
    )
  )

  // Clone-on-write copy, so even a large vault copies in seconds. The source is never opened by mote.
  fs.cpSync(source, vault, {
    recursive: true,
    mode: fs.constants.COPYFILE_FICLONE,
    verbatimSymlinks: true,
    preserveTimestamps: true,
    filter: (src) => path.basename(src) !== '.git'
  })
  fs.writeFileSync(path.join(evidence, 'vault-before.txt'), hashTree(vault))

  const logFile = path.join(scratch, 'app.log')
  const logFd = fs.openSync(logFile, 'a')
  const env = { ...process.env }
  delete env.ELECTRON_RENDERER_URL
  delete env.ELECTRON_RUN_AS_NODE
  const appArgs = extra.map((arg) => arg.replaceAll('{vault}', vault))
  // A window that macOS reports as covered stops drawing frames, so clicks and benchmarks stall.
  // This switch keeps the run drawing while the user works in other windows.
  const child = spawn(
    ELECTRON,
    [
      REPO,
      '--inspect=0',
      '--remote-debugging-port=0',
      `--user-data-dir=${userData}`,
      '--disable-backgrounding-occluded-windows',
      ...appArgs
    ],
    { cwd: REPO, detached: true, stdio: ['ignore', logFd, logFd], env }
  )
  child.unref()

  const state = {
    run,
    repo: REPO,
    pid: child.pid,
    vaultSource: source,
    vault,
    userData,
    scratch,
    evidence,
    appArgs,
    revision: git('rev-parse', 'HEAD'),
    dirty: git('status', '--porcelain') !== '',
    builtAt,
    launchedAt: new Date().toISOString()
  }
  try {
    Object.assign(state, await waitForLog(logFile, child.pid))
    fs.writeFileSync(path.join(scratch, 'state.json'), JSON.stringify(state, null, 2))
    await withPage(state, waitUntilUsable)
  } catch (error) {
    stopProcess(state.pid)
    fs.rmSync(scratch, { recursive: true, force: true })
    throw error
  }
  fs.writeFileSync(path.join(evidence, 'run.json'), JSON.stringify(state, null, 2))
  record(state, ['launch', opts, extra], 'usable')
  return state
}

function stopProcess(pid) {
  // detached: true made the app a process group leader, so this signals only what we started.
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  const deadline = Date.now() + 5000
  while (isAlive(pid) && Date.now() < deadline) execFileSync('sleep', ['0.2'])
  if (isAlive(pid)) process.kill(-pid, 'SIGKILL')
}

async function doctor(state) {
  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok, detail })
  const alive = isAlive(state.pid)
  check('process alive', alive, `pid ${state.pid}`)
  if (alive) {
    const command = execFileSync('ps', ['-o', 'command=', '-p', String(state.pid)], {
      encoding: 'utf8'
    })
    check(
      'process is this run',
      command.includes(`--user-data-dir=${state.userData}`),
      command.trim()
    )
    let owners
    try {
      owners = execFileSync('lsof', ['-nP', `-iTCP:${state.cdpPort}`, '-sTCP:LISTEN', '-t'], {
        encoding: 'utf8'
      })
    } catch {
      owners = ''
    }
    check('debug port owned by run', owners.split('\n').includes(String(state.pid)), owners.trim())
    try {
      await withPage(state, async (page) => {
        await waitUntilUsable(page)
        check('window usable', true, page.url())
      })
    } catch (error) {
      check('window usable', false, error.message)
    }
    try {
      const userData = await mainEval(state, `electron.app.getPath('userData')`)
      check(
        'settings isolated',
        fs.realpathSync(userData) === fs.realpathSync(state.userData),
        userData
      )
    } catch (error) {
      check('settings isolated', false, error.message)
    }
  }
  const srcNewest = newestMtime(path.join(REPO, 'src'))
  check('build fresh', srcNewest <= state.builtAt, 'src/ must not change after the build')
  check('vault copy exists', fs.existsSync(state.vault), state.vault)
  return { ok: checks.every((c) => c.ok), run: state.run, revision: state.revision, checks }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { opts, extra } = parseArgs(rest)
  if (command === 'launch') {
    const state = await launch(opts, extra)
    console.log(JSON.stringify({ run: state.run, vault: state.vault, evidence: state.evidence }))
    return
  }
  if (command === 'list') {
    for (const s of runsOfThisCheckout()) {
      console.log(`${s.run}  ${isAlive(s.pid) ? 'live' : 'dead'}  ${s.vaultSource}`)
    }
    return
  }
  const state = selectRun(opts)
  const act = (fn) => withPage(state, (page) => fn(page))
  let result
  switch (command) {
    case 'paths':
      result = state
      break
    case 'doctor':
      result = await doctor(state)
      if (!result.ok) process.exitCode = 1
      break
    case 'snapshot':
      result = await act((page) => page.locator('body').ariaSnapshot())
      if (opts.out) fs.writeFileSync(evidencePath(state, opts, '.aria.txt'), result + '\n')
      break
    case 'walk-notes': {
      const opened = await act((page) => walkNotes(page, state.vault, opts.obsidian))
      if (opts.out)
        fs.writeFileSync(evidencePath(state, opts, '.json'), JSON.stringify(opened, null, 2) + '\n')
      result = {
        opened: opened.opened,
        expected: opened.expected,
        errorCount: opened.errorCount,
        durationMs: opened.durationMs,
        medianNoteMs: opened.medianNoteMs
      }
      if (opened.backlinkMismatches) {
        result.backlinks = opened.backlinks
        result.backlinkMismatches = opened.backlinkMismatches
        if (opened.backlinkMismatches.length) process.exitCode = 1
      }
      break
    }
    case 'theme': {
      const scheme = opts.scheme
      if (!['dark', 'light', 'system'].includes(scheme))
        throw new UsageError('give --scheme dark|light|system')
      // themeSource applies to this app only. The macOS appearance setting stays as it is.
      const dark = await mainEval(
        state,
        `(() => {
          electron.nativeTheme.themeSource = ${JSON.stringify(scheme)}
          return electron.nativeTheme.shouldUseDarkColors
        })()`
      )
      await act((page) =>
        page.waitForFunction(
          (dark) => matchMedia('(prefers-color-scheme: dark)').matches === dark,
          dark,
          { timeout: 5000 }
        )
      )
      result = { themeSource: scheme, inEffect: dark ? 'dark' : 'light' }
      break
    }
    case 'bench-typing': {
      const chars = Number(opts.chars ?? 200)
      const gap = Number(opts.gap ?? 50)
      const where = opts.where ?? 'end'
      if (!['end', 'start'].includes(where)) throw new UsageError('give --where end|start')
      if (!(chars > 0) || !(gap >= 0 && gap < 750))
        throw new UsageError('give --chars N > 0 and --gap ms below the 750 ms autosave delay')
      result = await act((page) => benchTyping(page, { chars, gap, where }))
      break
    }
    case 'screenshot':
      result = evidencePath(state, opts, '.png')
      await act((page) => page.screenshot({ path: result }))
      break
    case 'click':
      await act((page) => locate(page, opts).click())
      result = 'clicked'
      break
    case 'fill':
      await act((page) => locate(page, opts).fill(String(opts.value ?? '')))
      result = 'filled'
      break
    case 'press':
      await act((page) => page.keyboard.press(opts.key))
      result = 'pressed'
      break
    case 'type':
      await act((page) => page.keyboard.type(String(opts.text)))
      result = 'typed'
      break
    case 'wait':
      await act((page) =>
        locate(page, opts).waitFor({
          state: opts.state ?? 'visible',
          timeout: Number(opts.timeout ?? 5000)
        })
      )
      result = `reached ${opts.state ?? 'visible'}`
      break
    case 'read':
      result = await act((page) => locate(page, opts).innerText())
      break
    case 'ime': {
      const composing = String(opts.text ?? '')
      const commit = String(opts.commit ?? '')
      result = await act(async (page) => {
        await page.evaluate(() => {
          window.__moteImeKeys = []
          window.addEventListener(
            'keydown',
            (event) =>
              window.__moteImeKeys.push({
                key: event.key,
                keyCode: event.keyCode,
                isComposing: event.isComposing
              }),
            { capture: true, once: true }
          )
        })
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Input.imeSetComposition', {
          text: composing,
          selectionStart: composing.length,
          selectionEnd: composing.length
        })
        // --hold N keeps the composition open for N ms; --probe-js reads state at that moment.
        let probe
        if (opts.hold) await page.waitForTimeout(Number(opts.hold))
        if (opts['probe-js']) probe = await page.evaluate(String(opts['probe-js']))
        await page.keyboard.press('Enter')
        await cdp.send('Input.insertText', { text: commit })
        await cdp.detach()
        const enterKeydown = await page.evaluate(() => window.__moteImeKeys)
        return opts['probe-js'] ? { enterKeydown, probe } : { enterKeydown }
      })
      break
    }
    case 'eval':
      result = await act((page) => page.evaluate(opts.js))
      break
    case 'main-eval':
      result = await mainEval(state, opts.js)
      break
    case 'dialog-answer': {
      const answer = String(opts.path).replaceAll('{vault}', state.vault)
      result = await mainEval(
        state,
        `(() => {
          const p = ${JSON.stringify(answer)}
          electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
          electron.dialog.showOpenDialogSync = () => [p]
          return p
        })()`
      )
      break
    }
    case 'vault-diff': {
      const name = opts.out ?? `vault-after-${stamp()}`
      const after = hashTree(state.vault)
      fs.writeFileSync(path.join(state.evidence, `${name}.txt`), after)
      const before = fs.readFileSync(path.join(state.evidence, 'vault-before.txt'), 'utf8')
      const changes = diffHashes(before, after)
      fs.writeFileSync(path.join(state.evidence, `${name}.diff.txt`), changes.join('\n') + '\n')
      result = changes.length ? changes.join('\n') : 'unchanged'
      if (opts['expect-unchanged'] && changes.length) process.exitCode = 1
      break
    }
    case 'stop':
      stopProcess(state.pid)
      fs.copyFileSync(path.join(state.scratch, 'app.log'), path.join(state.evidence, 'app.log'))
      record(state, ['stop'], 'stopped')
      fs.rmSync(state.scratch, { recursive: true, force: true })
      result = `stopped; evidence kept in ${state.evidence}`
      break
    default:
      throw new UsageError(`unknown command: ${command ?? '(none)'}`)
  }
  if (command !== 'stop' && command !== 'paths') record(state, [command, opts], result)
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error instanceof UsageError ? `usage: ${error.message}` : error.stack)
  process.exit(error instanceof UsageError ? 2 : 1)
})
