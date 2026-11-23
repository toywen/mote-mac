#!/usr/bin/env node
// Builds mote-sync's protocol package and packs it into vendor/. The only way to refresh it:
//   node tools/update-sync-protocol.mjs [path/to/mote-sync]   (default ../mote-sync)
// Then run `npm install` so node_modules picks up the new tarball. Once mote-sync-protocol is
// on npm, depend on the npm version instead and delete this script and vendor/.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(process.argv[2] ?? join(root, '..', 'mote-sync'))
const manifest = join(repo, 'protocol', 'package.json')
if (!existsSync(manifest)) {
  console.error(
    `no ${manifest}. Pass the mote-sync checkout: node tools/update-sync-protocol.mjs <dir>`
  )
  process.exit(1)
}
const { name, version } = JSON.parse(readFileSync(manifest, 'utf8'))
const vendor = join(root, 'vendor')
mkdirSync(vendor, { recursive: true })
for (const file of readdirSync(vendor)) {
  if (file.startsWith(`${name}-`) && file.endsWith('.tgz')) rmSync(join(vendor, file))
}

const run = (args) => execFileSync('npm', args, { cwd: repo, stdio: ['ignore', 'pipe', 'inherit'] })
run(['run', 'build', '--workspace', name])
run(['pack', '--workspace', name, '--pack-destination', vendor])

const tarball = `${name}-${version}.tgz`
if (!existsSync(join(vendor, tarball))) {
  console.error(`npm pack did not write vendor/${tarball}`)
  process.exit(1)
}
const wanted = `file:vendor/${tarball}`
const actual = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies?.[name]
console.log(`vendor/${tarball}`)
if (actual !== wanted) console.log(`set "${name}": "${wanted}" in package.json, then npm install`)
else console.log('run npm install to refresh node_modules')
