#!/usr/bin/env node
// Checks that every link mote's [[ completion can insert leads back to its target:
//   node tools/check-linktext.mjs ~/mote-link-check/*-copy
// For every source note and target file of each vault, under each newLinkFormat with wiki and
// Markdown links, it parses linkText's output with the shared parser and resolves the link from
// the source. Reads the vaults only. Exit code 1 when any link resolves elsewhere or nowhere.
import { realpathSync } from 'node:fs'

process.removeAllListeners('warning')
const { scanVault } = await import('../src/main/notes.ts')
const { buildLinkIndex, resolveLink } = await import('../src/core/resolve.ts')
const { linkText } = await import('../src/core/linkText.ts')
const { extractLinks } = await import('../src/core/markdown.ts')

const dirs = process.argv.slice(2)
if (dirs.length === 0) {
  console.error('usage: check-linktext.mjs <vault>...')
  process.exit(2)
}

let failures = 0
for (const input of dirs) {
  const dir = realpathSync(input)
  const entries = [...(await scanVault(dir)).values()]
  const files = entries.filter((entry) => entry.kind !== 'folder').map((entry) => entry.path)
  const notes = entries.filter((entry) => entry.kind === 'note').map((entry) => entry.path)
  const index = buildLinkIndex(files)
  // The parse depends only on the text, and many pairs share one.
  const parsed = new Map()
  const failed = []
  let checks = 0
  for (const useMarkdownLinks of [false, true])
    for (const newLinkFormat of ['shortest', 'relative', 'absolute'])
      for (const source of notes)
        for (const target of files) {
          const { text } = linkText(index, target, source, { useMarkdownLinks, newLinkFormat })
          if (!parsed.has(text)) parsed.set(text, extractLinks(text))
          const links = parsed.get(text)
          const dest = links.length === 1 ? resolveLink(index, links[0].target, source) : null
          if (dest !== target) failed.push({ newLinkFormat, source, target, text, dest })
          checks++
        }
  failures += failed.length
  console.log(
    JSON.stringify({
      vault: dir,
      notes: notes.length,
      files: files.length,
      pairs: notes.length * files.length,
      checks,
      failed: failed.length,
      first: failed.slice(0, 5)
    })
  )
}
process.exit(failures ? 1 : 0)
