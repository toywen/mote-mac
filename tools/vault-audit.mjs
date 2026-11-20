#!/usr/bin/env node
// Count which Obsidian features a vault uses, so mote knows what it must support.
// Usage: node tools/vault-audit.mjs <vault-dir> [<vault-dir> ...]
import fs from 'node:fs'
import path from 'node:path'

const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules'])

const FEATURES = {
  wikilink: /(?<!!)\[\[[^\]\n]+\]\]/g,
  wikilinkWithHeading: /(?<!!)\[\[[^\]\n|]*#[^\]\n]*\]\]/g,
  wikilinkWithAlias: /(?<!!)\[\[[^\]\n]*\|[^\]\n]*\]\]/g,
  embed: /!\[\[[^\]\n]+\]\]/g,
  mdLink: /(?<!!)\[[^\]\n]*\]\((?!https?:)[^)\n]+\)/g,
  mdLinkToNote: /(?<!!)\[[^\]\n]*\]\((?!https?:)[^)\n#]+\.md(?:#[^)\n]*)?\)/g,
  mdImage: /!\[[^\]\n]*\]\([^)\n]+\)/g,
  tag: /(?:^|\s)#[\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*/gu,
  callout: /^>\s*\[![\w-]+\]/gm,
  task: /^\s*[-*] \[[ xX]\]/gm,
  dataviewBlock: /^```dataview(js)?\b/gm,
  dataviewInline: /`=\s[^`]+`|\w+::\s/g,
  mermaid: /^```mermaid\b/gm,
  mathBlock: /^\$\$/gm,
  highlight: /==[^=\n]+==/g,
  comment: /%%[\s\S]*?%%/g,
  table: /^\|.*\|\s*$\n^\|\s*:?-+/gm,
  blockId: /\s\^[\w-]+$/gm
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out)
    } else if (entry.isFile()) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function audit(vault) {
  const files = walk(vault, [])
  const byExt = {}
  const counts = Object.fromEntries(Object.keys(FEATURES).map((k) => [k, { uses: 0, files: 0 }]))
  let mdFiles = 0
  let mdBytes = 0
  let maxMdBytes = 0
  let frontmatterFiles = 0
  const frontmatterKeys = {}
  let newestMtime = 0
  const dirs = new Set()

  for (const file of files) {
    const ext = path.extname(file).toLowerCase() || '(none)'
    byExt[ext] = (byExt[ext] ?? 0) + 1
    dirs.add(path.dirname(path.relative(vault, file)))
    const stat = fs.statSync(file)
    newestMtime = Math.max(newestMtime, stat.mtimeMs)
    if (ext !== '.md') continue

    mdFiles++
    mdBytes += stat.size
    maxMdBytes = Math.max(maxMdBytes, stat.size)
    const text = fs.readFileSync(file, 'utf8')

    const fm = text.match(/^---\n([\s\S]*?)\n---/)
    if (fm) {
      frontmatterFiles++
      for (const m of fm[1].matchAll(/^([\w-]+):/gm)) {
        frontmatterKeys[m[1]] = (frontmatterKeys[m[1]] ?? 0) + 1
      }
    }
    const body = fm ? text.slice(fm[0].length) : text
    for (const [name, re] of Object.entries(FEATURES)) {
      const n = body.match(re)?.length ?? 0
      counts[name].uses += n
      if (n) counts[name].files++
    }
  }

  const obsidian = path.join(vault, '.obsidian')
  return {
    vault,
    lastModified: new Date(newestMtime).toISOString().slice(0, 10),
    files: files.length,
    folders: dirs.size,
    mdFiles,
    mdMB: +(mdBytes / 1e6).toFixed(2),
    largestMdKB: +(maxMdBytes / 1e3).toFixed(1),
    byExt: Object.fromEntries(Object.entries(byExt).sort((a, b) => b[1] - a[1])),
    frontmatterFiles,
    topFrontmatterKeys: Object.entries(frontmatterKeys)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12),
    features: counts,
    corePlugins: readJson(path.join(obsidian, 'core-plugins.json')),
    communityPlugins: readJson(path.join(obsidian, 'community-plugins.json')),
    appConfig: readJson(path.join(obsidian, 'app.json')),
    dailyNotesConfig: readJson(path.join(obsidian, 'daily-notes.json')),
    templatesConfig: readJson(path.join(obsidian, 'templates.json'))
  }
}

const vaults = process.argv.slice(2)
if (!vaults.length) {
  console.error('usage: node tools/vault-audit.mjs <vault-dir> [...]')
  process.exit(1)
}
console.log(
  JSON.stringify(
    vaults.map((v) => audit(path.resolve(v))),
    null,
    2
  )
)
