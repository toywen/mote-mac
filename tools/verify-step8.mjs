#!/usr/bin/env node
// Step 8 acceptance verification:
// 1. HTML-1: In-app HTML direct opening & sandboxed viewing
// 2. 验收-13: FileTree click & Markdown link following into sandboxed iframe in main viewport
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`)
  return execFileSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    ...opts
  })
}

async function main() {
  console.log('====================================================')
  console.log('       Step 8 Acceptance Verification Suite         ')
  console.log('====================================================\n')

  // 1. Unit Tests
  console.log('== 1. Unit Tests (fileUrl & HTML mime types) ==')
  run('npx', ['vitest', 'run', 'src/core/fileUrl.test.ts'])
  console.log('✓ Unit tests passed.\n')

  // 2. Typecheck & Lint
  console.log('== 2. Typecheck & Lint ==')
  run('npm', ['run', 'typecheck'])
  run('npm', ['run', 'lint'])
  console.log('✓ Typecheck and lint passed.\n')

  // 3. E2E Tests (验收-13)
  console.log('== 3. Playwright E2E Tests (验收-13) ==')
  run('npx', ['electron-vite', 'build'])
  run('npx', ['playwright', 'test', 'tests/e2e/html.spec.ts'])
  console.log('✓ E2E tests passed.\n')

  console.log('====================================================')
  console.log('🎉 ALL STEP 8 ACCEPTANCE CRITERIA VERIFIED!')
  console.log('====================================================')
}

main().catch((err) => {
  console.error('\n❌ Verification failed:', err)
  process.exit(1)
})
