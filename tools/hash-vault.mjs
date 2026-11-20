#!/usr/bin/env node
// Print a SHA-256 for every file in a vault, so two runs can be diffed to prove nothing changed.
// Usage: node tools/hash-vault.mjs <vault-dir> > before.txt
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

const vault = process.argv[2]
if (!vault) {
  console.error('usage: node tools/hash-vault.mjs <vault-dir>')
  process.exit(1)
}
const root = path.resolve(vault)
for (const file of walk(root, []).sort()) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  console.log(`${hash}  ${path.relative(root, file)}`)
}
