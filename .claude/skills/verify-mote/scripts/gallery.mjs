#!/usr/bin/env node
// Shoots the notes of each vault copy that hold the most Markdown elements, in live preview and
// reading mode, dark and light, and collects the shots into one page for a person to look at.
//   node .claude/skills/verify-mote/scripts/gallery.mjs [--per-vault 6] [--out dir] <vault copy>...
//   add --dry-run to print the picked notes and their views without launching mote
// Each vault gets one mote launch through verify-mote.mjs, under the shared Electron lock when
// /Users/wenli/codes/mote-wt/elock.sh exists. The page is <out>/index.html.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.removeAllListeners('warning')
const { markdownParser } = await import('../../../../src/core/markdown.ts')

const SELF = fileURLToPath(import.meta.url)
const REPO = path.resolve(path.dirname(SELF), '../../../..')
const V = path.join(path.dirname(SELF), 'verify-mote.mjs')
const ELOCK = '/Users/wenli/codes/mote-wt/elock.sh'

// Element kinds the picker counts, with the label the page shows.
const KINDS = {
  table: '表格',
  callout: 'callout',
  image: '图片',
  task: '任务',
  link: '链接',
  code: '代码块',
  mermaid: 'Mermaid',
  embed: '笔记嵌入',
  tag: '标签',
  highlight: '高亮',
  property: '属性'
}
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
// Source lines one screen shows, about. Only used to keep scrolled views apart.
const VIEW_LINES = 20
const MAX_SCROLLED = 3
// JPEG of the 2x window shot, resampled. Chinese body text stays sharp at this width.
const JPEG_WIDTH = 1800
const JPEG_QUALITY = 70

// One screenshot pass: every view, or only the top and the densest, in one mode and scheme.
// The order keeps mode and scheme switches to three per note.
const PHASES = [
  { mode: 'live', scheme: 'dark', views: 'all' },
  { mode: 'reading', scheme: 'dark', views: 'all' },
  { mode: 'reading', scheme: 'light', views: 'light' },
  { mode: 'live', scheme: 'light', views: 'light' }
]
const MODE_LABEL = { live: '实时预览', reading: '阅读模式' }
const SCHEME_LABEL = { dark: '深色', light: '浅色' }

function parseArgs(argv) {
  const opts = { perVault: 6, out: path.join(REPO, 'verify-artifacts/step-3-gallery'), vaults: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--per-vault') opts.perVault = Number(argv[++i])
    else if (argv[i] === '--out') opts.out = path.resolve(argv[++i])
    else if (argv[i] === '--session') opts.session = argv[++i]
    else if (argv[i] === '--dry-run') opts.dryRun = true
    else if (argv[i].startsWith('--')) throw new Error(`unknown flag ${argv[i]}`)
    else opts.vaults.push(path.resolve(argv[i]))
  }
  if (!opts.session && (!opts.vaults.length || !(opts.perVault > 0)))
    throw new Error('usage: gallery.mjs [--per-vault 6] [--out dir] <vault copy>...')
  return opts
}

// Notes as the file tree shows them: .md files, no dot entries, vault-relative with `/`.
function listNotes(vault) {
  return fs
    .readdirSync(vault, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.md')
    .map((entry) => path.relative(vault, path.join(entry.parentPath, entry.name)))
    .filter((rel) => !rel.split(path.sep).some((part) => part.startsWith('.')))
    .map((rel) => rel.split(path.sep).join('/'))
    .sort()
}

// Every counted element of one note, with the 1-based source line it starts on.
function profile(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  const lineOf = (pos) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  const elements = []
  const add = (kind, from) => elements.push({ kind, line: lineOf(from) })
  markdownParser.parse(text).iterate({
    enter(ref) {
      const { name, from, to } = ref
      switch (name) {
        case 'Table':
          return add('table', from)
        case 'Blockquote': {
          const end = text.indexOf('\n', from)
          if (/^>\s*\[!/.test(text.slice(from, end < 0 ? to : end))) add('callout', from)
          return
        }
        case 'Image':
          return add('image', from)
        case 'WikiEmbed': {
          const target = text
            .slice(from + 3, to - 2)
            .split('|')[0]
            .split('#')[0]
          return add(IMAGE_EXT.test(target) ? 'image' : 'embed', from)
        }
        case 'Task':
          return add('task', from)
        case 'WikiLink':
          return add('link', from)
        case 'Link':
          // A Link with no URL is a reference or the `[!note]` of a callout, not a link.
          if (ref.node.getChild('URL')) add('link', from)
          return
        case 'FencedCode': {
          const info = ref.node.getChild('CodeInfo')
          const mermaid = info && /^mermaid$/i.test(text.slice(info.from, info.to).trim())
          return add(mermaid ? 'mermaid' : 'code', from)
        }
        case 'Tag':
          return add('tag', from)
        case 'Highlight':
          return add('highlight', from)
        case 'Frontmatter': {
          // One property per top-level key.
          const lines = text.slice(from, to).split('\n')
          lines.forEach((line, i) => {
            if (i > 0 && i < lines.length - 1 && /^[^\s#-][^:]*:/.test(line))
              elements.push({ kind: 'property', line: lineOf(from) + i })
          })
          return false
        }
      }
    }
  })
  const counts = Object.fromEntries(Object.keys(KINDS).map((kind) => [kind, 0]))
  for (const { kind } of elements) counts[kind]++
  return { counts, elements, lines: starts.length }
}

// Greedy cover. A note holding at least half the vault's most of a kind covers that kind; fewer
// cover it in part. Each pick is the note that adds the most cover, ties broken by how rich it is
// across all kinds, then by path. Once no note adds cover, the richest notes fill the rest.
function pickNotes(profiles, count) {
  const kinds = Object.keys(KINDS)
  const most = Object.fromEntries(
    kinds.map((kind) => [kind, Math.max(0, ...profiles.map((p) => p.counts[kind]))])
  )
  const share = (p, kind) =>
    most[kind] ? Math.min(1, p.counts[kind] / Math.max(1, Math.ceil(most[kind] / 2))) : 0
  const richness = (p) =>
    kinds.reduce((sum, kind) => sum + (most[kind] ? p.counts[kind] / most[kind] : 0), 0)
  const covered = Object.fromEntries(kinds.map((kind) => [kind, 0]))
  const gain = (p) =>
    kinds.reduce((sum, kind) => sum + Math.max(0, share(p, kind) - covered[kind]), 0)
  const left = [...profiles]
  const picks = []
  while (picks.length < count && left.length) {
    let best = 0
    for (let i = 1; i < left.length; i++) {
      const [a, b] = [left[i], left[best]]
      const byGain = gain(a) - gain(b)
      if (byGain > 1e-9 || (Math.abs(byGain) <= 1e-9 && richness(a) - richness(b) > 1e-9)) best = i
    }
    const [note] = left.splice(best, 1)
    if (!richness(note)) break
    const represents = kinds.filter((kind) => share(note, kind) > covered[kind] + 1e-9)
    for (const kind of represents) covered[kind] = share(note, kind)
    picks.push({ ...note, represents })
  }
  return picks
}

// The top of the note, then up to three windows of VIEW_LINES lines that hold the most kinds and
// elements, apart from each other. Views come in source order; one is marked densest.
function planViews(note) {
  const items = note.elements.filter((e) => e.kind !== 'property')
  const weight = (from) => {
    const inside = items.filter((e) => e.line >= from && e.line < from + VIEW_LINES)
    const perKind = {}
    for (const { kind } of inside) perKind[kind] = (perKind[kind] ?? 0) + 1
    const kinds = Object.values(perKind)
    return kinds.length * 10 + kinds.reduce((sum, n) => sum + Math.min(5, n), 0)
  }
  const views = [{ line: 1, weight: weight(1) }]
  const starts = [...new Set(items.map((e) => Math.max(1, e.line - 2)))].sort((a, b) => a - b)
  while (views.length <= MAX_SCROLLED) {
    let best = null
    for (const start of starts) {
      if (views.some((v) => Math.abs(v.line - start) < VIEW_LINES)) continue
      const w = weight(start)
      if (w > 0 && (!best || w > best.weight)) best = { line: start, weight: w }
    }
    if (!best) break
    views.push(best)
  }
  const densest = views.reduce((a, b) => (b.weight > a.weight ? b : a))
  return views
    .sort((a, b) => a.line - b.line)
    .map((v) => ({ line: v.line, top: v.line === 1, densest: v === densest }))
}

function printPicks(vault, picks) {
  const short = { ...KINDS, callout: 'callo', mermaid: 'merm', embed: '嵌入', property: '属性' }
  console.log(`\n${vault}`)
  console.log(['note'.padEnd(44), ...Object.values(short).map((s) => s.padStart(5))].join(' '))
  for (const p of picks)
    console.log(
      [
        p.path.slice(-44).padEnd(44),
        ...Object.keys(KINDS).map((k) => String(p.counts[k]).padStart(5))
      ].join(' ') + `  represents ${p.represents.join(',') || '-'}`
    )
}

// ---- the session: one mote launch, run under the lock -------------------------------------

function vm(run, ...args) {
  const argv = [V, ...args, ...(run ? ['--run', run] : [])]
  const out = spawnSync(process.execPath, argv, { cwd: REPO, encoding: 'utf8' })
  if (out.status !== 0) {
    const reason = (out.stderr || out.stdout).trim().split('\n').slice(-6).join('\n')
    throw Object.assign(new Error(`${args[0]} failed: ${reason}`), { stdout: out.stdout })
  }
  return out.stdout.trim()
}

const js = (value) => JSON.stringify(value)

// Waits until the open note's images have loaded and the editor DOM has been still for 250 ms.
const SETTLE_JS = `new Promise((resolve) => {
  const root = document.querySelector('.cm-editor')
  const started = performance.now()
  let still = started
  const observer = new MutationObserver(() => { still = performance.now() })
  observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true })
  const tick = () => {
    const now = performance.now()
    const loaded = [...root.querySelectorAll('img')].every((img) => img.complete)
    if ((loaded && now - still > 250) || now - started > 4000) {
      observer.disconnect()
      resolve(Math.round(now - started))
    } else setTimeout(tick, 50)
  }
  tick()
})`

const MODE_JS = `document.querySelector('[aria-label="切换到阅读模式"]') ? 'live'
  : document.querySelector('[aria-label="切换到实时预览"]') ? 'reading' : 'none'`

// Opens a note from the file tree, as a user does, so the editor has no focus and shows no marks.
function openNote(run, note, lines) {
  const parts = note.split('/')
  for (let depth = 1; depth < parts.length; depth++) {
    const row = `[data-kind="folder"][data-path=${js(parts.slice(0, depth).join('/'))}]`
    const expanded = vm(run, 'eval', '--js', `document.querySelector(${js(row)})?.ariaExpanded`)
    if (expanded === 'false') vm(run, 'click', '--selector', row)
  }
  vm(run, 'click', '--selector', `[data-kind="note"][data-path=${js(note)}]`)
  const editor = `.cm-content[data-note-path=${js(note)}]`
  vm(
    run,
    'eval',
    '--js',
    `new Promise((resolve, reject) => {
      const started = performance.now()
      const tick = () => {
        const view = document.querySelector(${js(editor)})?.cmTile?.root?.view
        if (view && view.state.doc.lines === ${lines}) resolve(true)
        else if (performance.now() - started > 8000) reject(new Error('the note text did not load'))
        else setTimeout(tick, 50)
      }
      tick()
    })`
  )
}

function session(planFile) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
  const result = { startedAt: new Date().toISOString(), notes: [], vaultDiff: null, error: null }
  const save = () => fs.writeFileSync(plan.resultFile, JSON.stringify(result, null, 2))
  const started = performance.now()
  let run = null
  const state = { mode: null, scheme: null }
  const setMode = (mode) => {
    if (vm(run, 'eval', '--js', MODE_JS) !== mode) vm(run, 'press', '--key', 'Meta+E')
    const now = vm(run, 'eval', '--js', MODE_JS)
    if (now !== mode) throw new Error(`Cmd+E left the editor in ${now}, not ${mode}`)
  }
  const setScheme = (scheme) => {
    if (state.scheme !== scheme) vm(run, 'theme', '--scheme', scheme)
    state.scheme = scheme
  }
  try {
    const launched = JSON.parse(vm(null, 'launch', '--skip-build', '--vault', plan.vault))
    run = launched.run
    Object.assign(result, { run, evidence: launched.evidence })
    save()
    vm(run, 'dialog-answer', '--path', '{vault}')
    vm(run, 'click', '--role', 'button', '--name', '打开笔记库')
    vm(run, 'wait', '--role', 'tree', '--name', '文件树', '--timeout', '30000')
    for (const [n, note] of plan.notes.entries()) {
      const noteStarted = performance.now()
      const shot = { path: note.path, views: note.views.map((v) => ({ ...v, shots: {} })) }
      try {
        setScheme('dark')
        openNote(run, note.path, note.lines)
        for (const phase of PHASES) {
          setScheme(phase.scheme)
          setMode(phase.mode)
          for (const [i, view] of shot.views.entries()) {
            if (view.repeat || (phase.views === 'light' && !view.top && !view.densest)) continue
            const scrolled = JSON.parse(vm(run, 'scroll', '--line', String(view.line)))
            // A short note cannot scroll to a later view; keep only the first of equal views.
            const same = shot.views.find(
              (v, j) =>
                j < i &&
                !v.repeat &&
                v.shots[`${phase.mode}-${phase.scheme}`]?.scrollTop === scrolled.scrollTop
            )
            if (same && phase === PHASES[0]) {
              view.repeat = true
              continue
            }
            vm(run, 'eval', '--js', SETTLE_JS)
            const name = `gallery-${n}-${i}-${phase.mode}-${phase.scheme}`
            const png = vm(run, 'screenshot', '--out', name)
            view.shots[`${phase.mode}-${phase.scheme}`] = {
              png,
              scrollTop: scrolled.scrollTop,
              visibleLines: scrolled.visibleLines
            }
          }
        }
      } catch (error) {
        shot.error = error.message
        state.scheme = null
      }
      shot.ms = Math.round(performance.now() - noteStarted)
      console.error(`  ${note.path}: ${shot.error ? `failed: ${shot.error}` : 'ok'} ${shot.ms} ms`)
      result.notes.push(shot)
      save()
    }
    // Back to live preview, so the run ends where it started.
    setMode('live')
    try {
      result.vaultDiff = vm(run, 'vault-diff', '--expect-unchanged', '--out', 'gallery-vault-after')
    } catch (error) {
      result.vaultDiff = error.stdout?.trim() || error.message
    }
  } catch (error) {
    result.error = error.message
  } finally {
    if (run) {
      try {
        vm(run, 'stop')
      } catch (error) {
        result.error = `${result.error ?? ''} stop failed: ${error.message}`.trim()
      }
    }
    result.sessionMs = Math.round(performance.now() - started)
    save()
  }
}

// ---- the page --------------------------------------------------------------------------------

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )

const countText = (counts) =>
  Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${KINDS[kind]} ${n}`)
    .join(' · ') || '无'

function kindsBetween(elements, [from, to]) {
  const counts = {}
  for (const e of elements)
    if (e.line >= from && e.line <= to) counts[e.kind] = (counts[e.kind] ?? 0) + 1
  return countText(counts)
}

function figure(vault, shot, mode, scheme) {
  const caption = `${MODE_LABEL[mode]} · ${SCHEME_LABEL[scheme]}`
  if (!shot)
    return `<figure class="missing"><div>没有截图</div><figcaption>${caption}</figcaption></figure>`
  const [from, to] = shot.visibleLines
  return `<figure><a href="${esc(shot.jpg)}" target="_blank"><img loading="lazy" src="${esc(shot.jpg)}" alt="${esc(caption)}"></a><figcaption>${caption} · 第 ${from}–${to} 行</figcaption></figure>`
}

function noteBlock(vault, note, id) {
  const rows = []
  let place = 0
  for (const view of note.views) {
    if (view.repeat) continue
    const name = view.top ? '顶部' : `第 ${++place} 处${view.densest ? '（最密）' : ''}`
    const live = view.shots['live-dark']
    const range = live?.visibleLines
    const what = range ? kindsBetween(note.profile.elements, range) : ''
    for (const scheme of ['dark', 'light']) {
      const shots = ['live', 'reading'].map((mode) => view.shots[`${mode}-${scheme}`])
      if (scheme === 'light' && !view.top && !view.densest) continue
      rows.push(
        `<div class="row ${scheme}"><div class="label"><b>${name}</b> · ${SCHEME_LABEL[scheme]}${scheme === 'dark' && what ? `<br><span>${esc(what)}</span>` : ''}</div>` +
          `<div class="pair">${figure(vault, shots[0], 'live', scheme)}${figure(vault, shots[1], 'reading', scheme)}</div></div>`
      )
    }
  }
  return `<article id="${id}"><h3>${esc(note.path)}</h3>
<p class="counts">${esc(countText(note.profile.counts))}</p>
<p class="why">代表：${esc(note.represents.map((k) => KINDS[k]).join('、') || '元素总数多')} · 用时 ${(note.ms / 1000).toFixed(1)} 秒</p>
${note.error ? `<p class="error">失败：${esc(note.error)}</p>` : ''}${rows.join('\n')}</article>`
}

function writePage(out, meta, vaults) {
  const toc = vaults
    .map(
      (v) =>
        `<li><a href="#${v.slug}">${esc(v.slug)}</a><ol>${v.notes
          .map(
            (n, i) => `<li><a href="#${v.slug}-${i}">${esc(path.basename(n.path, '.md'))}</a></li>`
          )
          .join('')}</ol></li>`
    )
    .join('')
  const summary = vaults
    .map((v) => {
      const failed = v.notes.filter((n) => n.error)
      const diff = v.vaultDiff ?? '没有结果'
      return `<tr><td><a href="#${v.slug}">${esc(v.slug)}</a></td><td>${v.notes.length - failed.length} / ${v.notes.length}</td><td>${v.shotCount}</td>
<td class="${failed.length || v.error ? 'bad' : ''}">${failed.length ? failed.map((n) => esc(`${n.path}：${n.error}`)).join('<br>') : '无'}${v.error ? `<br>${esc(v.error)}` : ''}</td>
<td class="${diff === 'unchanged' ? 'good' : 'bad'}"><pre>${esc(diff)}</pre></td><td>${(v.sessionMs / 1000).toFixed(0)} 秒</td></tr>`
    })
    .join('\n')
  const sections = vaults
    .map(
      (v) => `<section id="${v.slug}"><h2>${esc(v.slug)}</h2>
<p class="meta">${esc(v.vault)} · ${v.noteCount} 篇笔记，挑出 ${v.notes.length} 篇</p>
${v.notes.map((n, i) => noteBlock(v, n, `${v.slug}-${i}`)).join('\n')}</section>`
    )
    .join('\n')
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>第 3 步截图页</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { --bg: #e9e9ec; --card: #fff; --text: #222; --muted: #666; --line: #ccc }
* { box-sizing: border-box }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, "PingFang SC", sans-serif; display: grid; grid-template-columns: 220px minmax(0, 1fr) }
nav { position: sticky; top: 0; height: 100vh; overflow: auto; padding: 16px 12px; border-right: 1px solid var(--line); background: #f4f4f6; font-size: 13px }
nav ul, nav ol { margin: 0; padding-left: 16px }
nav > ul { padding: 0; list-style: none }
nav > ul > li { margin-bottom: 10px; font-weight: 600 }
nav ol li { font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
a { color: #2a5bd7; text-decoration: none }
main { padding: 16px 24px 80px; min-width: 0 }
h1 { margin: 0 0 4px; font-size: 22px }
table { border-collapse: collapse; background: var(--card); margin: 12px 0 }
td, th { border: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top }
td pre { margin: 0; white-space: pre-wrap; font-size: 12px }
.good { color: #17713a } .bad { color: #b3261e }
section { margin-top: 32px }
section > h2 { position: sticky; top: 0; z-index: 1; margin: 0; padding: 6px 0; background: var(--bg); font-size: 20px }
.meta, .why, .counts { margin: 2px 0; color: var(--muted) }
.counts { color: var(--text) }
article { background: var(--card); border-radius: 8px; padding: 12px 14px; margin: 16px 0 }
article h3 { margin: 0 0 4px; font-size: 16px; word-break: break-all }
.error { color: #b3261e; font-weight: 600 }
.row { margin-top: 12px }
.row.light { margin-top: 4px }
.label { font-size: 13px; margin-bottom: 4px } .label span { color: var(--muted) }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px }
figure { margin: 0 } figure img { width: 100%; display: block; border: 1px solid var(--line); border-radius: 4px; aspect-ratio: 3 / 2; object-fit: contain; background: #888 }
figcaption { font-size: 12px; color: var(--muted) }
.missing div { aspect-ratio: 3 / 2; display: grid; place-content: center; background: #ddd; border-radius: 4px; color: var(--muted) }
</style></head>
<body>
<nav><ul>${toc}</ul></nav>
<main>
<h1>第 3 步截图页</h1>
<p class="meta">生成于 ${esc(meta.date)} · 构建 ${esc(meta.commit)}${meta.dirty ? '（工作区有未提交改动）' : ''} · 每篇：左边实时预览，右边阅读模式；深色在上，浅色在下。点图看原图。</p>
<table><tr><th>副本</th><th>截成的笔记</th><th>截图</th><th>失败</th><th>vault-diff</th><th>用时</th></tr>
${summary}</table>
${sections}
</main></body></html>
`
  fs.writeFileSync(path.join(out, 'index.html'), html)
}

// ---- the run ---------------------------------------------------------------------------------

function slugs(vaults) {
  const seen = new Map()
  return vaults.map((vault) => {
    const base = path.basename(vault).replace(/[^\w.-]+/g, '-') || 'vault'
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  })
}

function shootVault(vault, slug, opts) {
  const notes = listNotes(vault).map((rel) => ({
    path: rel,
    ...profile(fs.readFileSync(path.join(vault, rel), 'utf8'))
  }))
  const picks = pickNotes(notes, opts.perVault)
  printPicks(vault, picks)
  if (opts.dryRun) {
    for (const p of picks)
      console.log(
        `  ${p.path}: views at lines ${planViews(p)
          .map((v) => `${v.line}${v.densest ? '*' : ''}`)
          .join(', ')}`
      )
    return null
  }
  const dir = path.join(opts.out, slug)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const plan = {
    vault,
    resultFile: path.join(dir, 'result.json'),
    notes: picks.map((p) => ({ path: p.path, lines: p.lines, views: planViews(p) }))
  }
  const planFile = path.join(dir, 'plan.json')
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2))

  const session = [process.execPath, SELF, '--session', planFile]
  const command = fs.existsSync(ELOCK) ? [ELOCK, 'run', 'gallery', '--', ...session] : session
  const waited = performance.now()
  spawnSync(command[0], command.slice(1), { cwd: REPO, stdio: 'inherit' })
  const result = fs.existsSync(plan.resultFile)
    ? JSON.parse(fs.readFileSync(plan.resultFile, 'utf8'))
    : { notes: [], error: 'the session wrote no result', sessionMs: 0 }
  const totalMs = performance.now() - waited

  // PNG from the evidence dir to a JPEG next to the page; the PNG is then deleted.
  let shotCount = 0
  for (const note of result.notes)
    for (const view of note.views)
      for (const shot of Object.values(view.shots)) {
        const jpg = `${slug}/${path.basename(shot.png, '.png')}.jpg`
        execFileSync(
          'sips',
          [
            '-s',
            'format',
            'jpeg',
            '-s',
            'formatOptions',
            String(JPEG_QUALITY),
            '--resampleWidth',
            String(JPEG_WIDTH),
            shot.png,
            '--out',
            path.join(opts.out, jpg)
          ],
          { stdio: 'ignore' }
        )
        fs.rmSync(shot.png)
        shot.jpg = jpg
        shotCount++
      }
  const byPath = new Map(picks.map((p) => [p.path, p]))
  return {
    slug,
    vault,
    noteCount: notes.length,
    notes: result.notes.map((n) => ({
      ...n,
      profile: byPath.get(n.path),
      represents: byPath.get(n.path).represents
    })),
    vaultDiff: result.vaultDiff,
    error: result.error,
    sessionMs: result.sessionMs ?? 0,
    waitMs: totalMs - (result.sessionMs ?? 0),
    shotCount
  }
}

function dirBytes(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .reduce((sum, e) => sum + fs.statSync(path.join(e.parentPath, e.name)).size, 0)
}

const opts = parseArgs(process.argv.slice(2))
if (opts.session) session(opts.session)
else if (opts.dryRun) opts.vaults.forEach((vault) => shootVault(vault, 'dry', opts))
else {
  // One build for every vault, outside the lock; each launch then reuses out/.
  execFileSync('npx', ['electron-vite', 'build'], { cwd: REPO, stdio: 'ignore' })
  const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim()
  const meta = {
    date: new Date().toLocaleString('zh-CN', { hour12: false }),
    commit: git('rev-parse', '--short', 'HEAD'),
    dirty: git('status', '--porcelain') !== ''
  }
  fs.mkdirSync(opts.out, { recursive: true })
  const vaults = []
  for (const [i, slug] of slugs(opts.vaults).entries()) {
    const shot = shootVault(opts.vaults[i], slug, opts)
    if (!shot) continue
    vaults.push(shot)
    writePage(opts.out, meta, vaults)
  }
  for (const v of vaults)
    console.log(
      `${v.slug}: ${v.notes.filter((n) => !n.error).length}/${v.notes.length} notes, ${v.shotCount} shots, ` +
        `session ${(v.sessionMs / 1000).toFixed(0)} s, waited ${(v.waitMs / 1000).toFixed(0)} s, ` +
        `vault-diff ${v.vaultDiff === 'unchanged' ? 'unchanged' : 'CHANGED or missing'}`
    )
  console.log(`${path.join(opts.out, 'index.html')}  ${(dirBytes(opts.out) / 1e6).toFixed(1)} MB`)
}
