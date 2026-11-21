#!/usr/bin/env node
// Benchmarks the 5 performance targets for Step 5 on a 10,000 note vault:
// 1. Vault open to editable: < 2s
// 2. Full text search: < 200ms
// 3. Quick open suggest: < 16ms
// 4. Rename note with 100 backlinks: < 1s
// 5. External change notification: < 100ms
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseVaultPath } from '../src/core/ipc.ts'
import { suggest } from '../src/renderer/src/quickOpenMatch.ts'
import { Vault } from '../src/main/vault.ts'

const vaultDir = process.argv[2] || 'tmp/vault-10k'

const median = (arr) => {
  const sorted = [...arr].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function runBenchmarks() {
  console.log(`== Running Step 5 Performance Benchmarks on ${vaultDir} ==\n`)

  // --- Target 1: Vault Open ---
  console.log('1. Measuring Vault open time...')
  const openTimes = []
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    const vault = await Vault.open(vaultDir, () => {})
    const t1 = performance.now()
    openTimes.push(t1 - t0)
    vault.close()
  }
  const openMs = median(openTimes)
  console.log(
    `   Open times: ${openTimes.map((t) => t.toFixed(1) + 'ms').join(', ')} (median: ${openMs.toFixed(1)}ms)`
  )
  const openPass = openMs <= 2000
  console.log(`   Target: < 2000ms -> ${openPass ? '✓ PASS' : '✗ FAIL'}\n`)

  // Keep one vault instance open for the rest of tests
  let changeEventTime = null
  let changeResolve = null
  const vault = await Vault.open(vaultDir, () => {
    if (changeResolve && changeEventTime === null) {
      changeEventTime = performance.now()
      changeResolve()
    }
  })

  try {
    const info = vault.info()
    const noteCount = info.entries.filter((e) => e.kind === 'note').length
    console.log(`   Vault loaded with ${noteCount} notes.`)

    // --- Target 2: Full Text Search ---
    console.log('\n2. Measuring Full Text Search (< 200ms)...')
    const queries = ['原子观点', '知识库', '性能测试', '指标', '概念']
    const searchTimes = []
    for (const q of queries) {
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now()
        vault.search(q, 50)
        const t1 = performance.now()
        searchTimes.push(t1 - t0)
      }
    }
    const searchMs = median(searchTimes)
    console.log(
      `   Search times across queries: median ${searchMs.toFixed(1)}ms, min ${Math.min(...searchTimes).toFixed(1)}ms, max ${Math.max(...searchTimes).toFixed(1)}ms`
    )
    const searchPass = searchMs <= 200
    console.log(`   Target: < 200ms -> ${searchPass ? '✓ PASS' : '✗ FAIL'}\n`)

    // --- Target 3: Quick Open ---
    console.log('3. Measuring Quick Open Suggestion (< 16ms)...')
    const notePaths = info.entries.filter((e) => e.kind === 'note').map((e) => e.path)
    const quickQueries = ['hub', 'note-0050', 'daily', 'concept', 'art', 'note-099']
    const quickTimes = []
    for (const q of quickQueries) {
      // Warm up
      suggest(notePaths, [], q)
      for (let i = 0; i < 50; i++) {
        const t0 = performance.now()
        suggest(notePaths, [], q)
        const t1 = performance.now()
        quickTimes.push(t1 - t0)
      }
    }
    const quickMs = median(quickTimes)
    console.log(
      `   Quick Open times across queries: median ${quickMs.toFixed(2)}ms, max ${Math.max(...quickTimes).toFixed(2)}ms`
    )
    const quickPass = quickMs <= 16
    console.log(`   Target: < 16ms -> ${quickPass ? '✓ PASS' : '✗ FAIL'}\n`)

    // --- Target 4: Renaming note with 100 backlinks ---
    console.log('4. Measuring Rename of note with 100 backlinks (< 1000ms)...')
    const hubFrom = parseVaultPath('00_Inbox/Hub-Note.md')
    const hubTo = parseVaultPath('00_Inbox/Hub-Note-Renamed.md')

    const initialBacklinks = vault.backlinks(hubFrom)
    console.log(`   Found ${initialBacklinks.length} initial backlinks pointing to Hub-Note.`)
    if (initialBacklinks.length !== 100) {
      throw new Error(`Expected exactly 100 backlinks, but got ${initialBacklinks.length}`)
    }

    const tRename0 = performance.now()
    await vault.renameOrMove(hubFrom, hubTo, true)
    const tRename1 = performance.now()
    const renameMs = tRename1 - tRename0
    console.log(`   Rename took: ${renameMs.toFixed(1)}ms`)

    // Verify rewritten links
    const newBacklinks = vault.backlinks(hubTo)
    console.log(
      `   After rename, found ${newBacklinks.length} backlinks pointing to Hub-Note-Renamed.`
    )
    if (newBacklinks.length !== 100) {
      throw new Error(
        `Expected 100 backlinks updated to Hub-Note-Renamed, got ${newBacklinks.length}`
      )
    }

    // Rename back
    await vault.renameOrMove(hubTo, hubFrom, true)
    console.log(`   Reverted rename back to Hub-Note.md.`)
    const renamePass = renameMs <= 1000
    console.log(`   Target: < 1000ms -> ${renamePass ? '✓ PASS' : '✗ FAIL'}\n`)

    // --- Target 5: External Change Notification ---
    console.log('5. Measuring External Modification Notification (< 100ms)...')
    const testNotePath = join(vaultDir, '00_Inbox/Hub-Note.md')
    const originalContent = await readFile(testNotePath, 'utf8')

    const changePromise = new Promise((resolve) => {
      changeResolve = resolve
    })

    const tWrite = performance.now()
    changeEventTime = null
    await writeFile(testNotePath, originalContent + '\n<!-- external edit -->\n', 'utf8')
    await changePromise
    const externalMs = changeEventTime - tWrite
    console.log(`   External change notification latency: ${externalMs.toFixed(1)}ms`)
    const externalPass = externalMs <= 100
    console.log(`   Target: < 100ms -> ${externalPass ? '✓ PASS' : '✗ FAIL'}\n`)

    // Summary
    console.log('== SUMMARY ==')
    console.log(
      `1. Vault Open:                 ${openMs.toFixed(1)}ms (< 2000ms)  ${openPass ? '✓' : '✗'}`
    )
    console.log(
      `2. Full Text Search:          ${searchMs.toFixed(1)}ms (< 200ms)    ${searchPass ? '✓' : '✗'}`
    )
    console.log(
      `3. Quick Open Suggest:        ${quickMs.toFixed(2)}ms (< 16ms)     ${quickPass ? '✓' : '✗'}`
    )
    console.log(
      `4. Rename (100 backlinks):    ${renameMs.toFixed(1)}ms (< 1000ms)  ${renamePass ? '✓' : '✗'}`
    )
    console.log(
      `5. External Change Latency:   ${externalMs.toFixed(1)}ms (< 100ms)   ${externalPass ? '✓' : '✗'}`
    )

    const allPassed = openPass && searchPass && quickPass && renamePass && externalPass
    if (!allPassed) {
      console.error('\n❌ One or more performance benchmarks failed target criteria!')
      process.exit(1)
    }
    console.log('\n🎉 ALL PERFORMANCE BENCHMARKS PASSED TARGETS!')
  } finally {
    vault.close()
  }
}

runBenchmarks().catch((err) => {
  console.error(err)
  process.exit(1)
})
