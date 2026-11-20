#!/usr/bin/env node
// Compares mote's link resolution with Obsidian's export for each vault copy:
//   node tools/compare-links.mjs ~/mote-link-check/*-copy
//   node tools/compare-links.mjs --bench 5 <dir>...   time scan + read + parse + resolve, no export needed
// Each <dir> needs <dir>.obsidian-links.json from tools/obsidian-export.mjs.
// Exit code 1 when any file set or link count differs.
import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'

process.removeAllListeners('warning')
const { scanVault, readNoteFiles } = await import('../src/main/notes.ts')
const { sourceText } = await import('../src/core/text.ts')
const { extractLinks } = await import('../src/core/markdown.ts')
const { buildLinkIndex, resolveLink, resolveNotes } = await import('../src/core/resolve.ts')

const dirs = process.argv.slice(2)
let bench = 0
if (dirs[0] === '--bench') {
  dirs.shift()
  bench = Number(dirs.shift())
}
if (dirs.length === 0) {
  console.error('usage: compare-links.mjs <vault copy>...')
  process.exit(2)
}

const sum = (counts) => Object.values(counts ?? {}).reduce((a, b) => a + b, 0)
const keys = (...objects) => [...new Set(objects.flatMap((o) => Object.keys(o ?? {})))].sort()

function lineOf(text, offset) {
  const line = text.slice(0, offset).split('\n').length
  const start = text.lastIndexOf('\n', offset - 1) + 1
  const end = text.indexOf('\n', offset)
  return { line, text: text.slice(start, end < 0 ? text.length : end).trim() }
}

// The same steps the main process runs when it opens a vault.
async function readVault(dir) {
  const entries = [...(await scanVault(dir)).values()]
  const files = entries.filter((e) => e.kind !== 'folder').map((e) => e.path)
  const index = buildLinkIndex(files)
  const paths = entries.filter((e) => e.kind === 'note').map((e) => e.path)
  const versions = await readNoteFiles(dir, paths)
  const notes = paths.map((path, i) => {
    const text = sourceText(versions[i]?.text ?? '').text
    return { path, text, links: extractLinks(text) }
  })
  return { files, index, notes, mote: resolveNotes(notes, index) }
}

async function compare(input) {
  const dir = realpathSync(input)
  const exportFile = join(dirname(dir), basename(dir) + '.obsidian-links.json')
  const obsidian = JSON.parse(readFileSync(exportFile, 'utf8'))
  const { files, index, notes, mote } = await readVault(dir)

  const ours = new Set(files)
  const theirs = new Set(obsidian.files)
  const onlyMote = files.filter((f) => !theirs.has(f)).sort()
  const onlyObsidian = obsidian.files.filter((f) => !ours.has(f)).sort()
  const byPath = new Map(notes.map((n) => [n.path, n]))

  let total = 0
  let agree = 0
  let moteTotal = 0
  const mismatches = []
  for (const [kind, field] of [
    ['resolved', 'resolved'],
    ['unresolved', 'unresolved']
  ]) {
    for (const source of keys(obsidian[field], mote[field])) {
      const o = obsidian[field][source] ?? {}
      const m = mote[field][source] ?? {}
      total += sum(o)
      moteTotal += sum(m)
      for (const target of keys(o, m)) {
        const oc = o[target] ?? 0
        const mc = m[target] ?? 0
        agree += Math.min(oc, mc)
        if (oc === mc) continue
        const note = byPath.get(source)
        const lines = []
        if (note) {
          for (const link of note.links) {
            const dest = resolveLink(index, link.target, source)
            const hit =
              kind === 'resolved'
                ? dest === target
                : !dest && (link.target.replace(/\.md$/i, '') === target || link.target === target)
            if (hit) lines.push(lineOf(note.text, link.range.from))
          }
          if (lines.length === 0) {
            const name = basename(target).replace(/\.md$/i, '').toLowerCase()
            let at = note.text.toLowerCase().indexOf(name)
            while (at >= 0 && lines.length < 3) {
              lines.push({ ...lineOf(note.text, at), guess: true })
              at = note.text.toLowerCase().indexOf(name, at + name.length)
            }
          }
        }
        mismatches.push({ kind, source, target, obsidian: oc, mote: mc, lines })
      }
    }
  }
  return { dir, onlyMote, onlyObsidian, total, agree, moteTotal, mismatches }
}

if (bench) {
  for (const input of dirs) {
    const dir = realpathSync(input)
    const times = []
    let notes = 0
    for (let i = 0; i < bench; i++) {
      const start = performance.now()
      notes = (await readVault(dir)).notes.length
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    const ms = (t) => +t.toFixed(1)
    console.log(
      JSON.stringify({
        vault: basename(dir),
        notes,
        runs: bench,
        medianMs: ms(times[Math.floor(bench / 2)]),
        minMs: ms(times[0]),
        maxMs: ms(times[bench - 1])
      })
    )
  }
  process.exit(0)
}

let failed = false
const summary = []
for (const input of dirs) {
  const r = await compare(input)
  const name = basename(r.dir)
  console.log(`== ${name}`)
  const sameFiles = r.onlyMote.length === 0 && r.onlyObsidian.length === 0
  console.log(
    sameFiles
      ? 'files: same'
      : `files: differ, ${r.onlyMote.length} only in mote, ${r.onlyObsidian.length} only in Obsidian`
  )
  for (const f of r.onlyMote) console.log(`  only mote: ${f}`)
  for (const f of r.onlyObsidian) console.log(`  only Obsidian: ${f}`)
  console.log(
    `links: total ${r.total}, agree ${r.agree}, mismatches ${r.mismatches.length}, mote total ${r.moteTotal}`
  )
  for (const m of r.mismatches) {
    console.log(`  [${m.kind}] ${m.source} -> ${m.target}: Obsidian ${m.obsidian}, mote ${m.mote}`)
    for (const l of m.lines)
      console.log(`      ${l.guess ? '~' : ''}L${l.line}: ${l.text.slice(0, 160)}`)
  }
  if (!sameFiles || r.mismatches.length) failed = true
  summary.push({ name, total: r.total, agree: r.agree, mismatches: r.mismatches.length })
}
console.log('== summary')
for (const s of summary)
  console.log(`${s.name}: total ${s.total}, agree ${s.agree}, mismatches ${s.mismatches}`)
process.exit(failed ? 1 : 0)
