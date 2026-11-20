#!/usr/bin/env node
// Runs mote's quick-open matcher in Node on a vault's note paths.
//   node tools/bench-quick-open.mjs <vault> <query>...          top 20 per query, as JSON lines
//   node tools/bench-quick-open.mjs <vault> --bench N <query>...  scale paths to N, median of 100 runs
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

process.removeAllListeners('warning')
const { suggest } = await import('../src/renderer/src/quickOpenMatch.ts')

const args = process.argv.slice(2)
const vault = args.shift()
let bench = 0
if (args[0] === '--bench') {
  args.shift()
  bench = Number(args.shift())
}
if (!vault || args.length === 0 || Number.isNaN(bench)) {
  console.error('usage: bench-quick-open.mjs <vault> [--bench N] <query>...')
  process.exit(2)
}

// Same walk as Vault.scan in src/main/vault.ts: readdir order, depth first, skip dot entries.
function notes(dir, prefix = '', out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = prefix + entry.name
    if (entry.isDirectory()) notes(join(dir, entry.name), path + '/', out)
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(path)
  }
  return out
}

const paths = notes(vault)

if (!bench) {
  for (const query of args) {
    const labels = suggest(paths, [], query).map((result) => result.label)
    console.log(JSON.stringify({ query, labels }))
  }
} else {
  const scaled = []
  for (let copy = 0; scaled.length < bench; copy++)
    for (const path of paths) {
      if (scaled.length === bench) break
      scaled.push(copy ? `copy-${copy}/${path}` : path)
    }
  for (const query of args) {
    for (let i = 0; i < 10; i++) suggest(scaled, [], query)
    const times = []
    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      suggest(scaled, [], query)
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    console.log(
      JSON.stringify({
        query,
        paths: scaled.length,
        medianMs: +times[50].toFixed(2),
        p95Ms: +times[95].toFixed(2),
        maxMs: +times[99].toFixed(2)
      })
    )
  }
}
