#!/usr/bin/env node
// Step 5 acceptance verification:
// 1. 验收-10: Local/vault video embeds (unit tests & Playwright E2E)
// 2. 验收-11: YouTube embeds (unit tests & Playwright E2E)
// 3. 验收-6: 10,000 notes vault benchmarks (open, search, quick open, rename, external change)
import { execFileSync } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const VAULT_10K = '/tmp/mote-vault-10k'

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`)
  return execFileSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    ...opts
  })
}

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function main() {
  console.log('====================================================')
  console.log('       Step 5 Acceptance Verification Suite         ')
  console.log('====================================================\n')

  // 1. Unit Tests (fileUrl)
  console.log('== 1. Unit Tests (fileUrl) ==')
  run('npx', ['vitest', 'run', 'src/core/fileUrl.test.ts'])
  console.log('✓ Unit tests passed.\n')

  // 2. E2E Tests (videos & youtube embeds)
  console.log('== 2. Playwright E2E Tests (videos & YouTube embeds) ==')
  run('npx', ['electron-vite', 'build'])
  run('npx', ['playwright', 'test', 'tests/e2e/videos.spec.ts', 'tests/e2e/youtube.spec.ts'])
  console.log('✓ E2E tests passed.\n')

  // 3. Scale and Benchmarks (10k notes)
  console.log('== 3. 10,000 Notes Vault Benchmarks (验收-6) ==')
  if (!(await exists(VAULT_10K))) {
    console.log(`Generating 10,000 note vault at ${VAULT_10K}...`)
    run('node', ['tools/gen-vault.mjs', VAULT_10K, '10000'])
  } else {
    console.log(`Using existing 10,000 note vault at ${VAULT_10K}.`)
  }

  run('node', ['tools/bench-step5.mjs', VAULT_10K])
  console.log('✓ Benchmark suite passed.\n')

  console.log('====================================================')
  console.log('🎉 ALL STEP 5 ACCEPTANCE CRITERIA VERIFIED!')
  console.log('====================================================')
}

main().catch((err) => {
  console.error('\n❌ Verification failed:', err)
  process.exit(1)
})
