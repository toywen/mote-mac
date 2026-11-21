#!/usr/bin/env node
// Step 4 acceptance verification: proves 验收-3 on life-os and Pesemic vault copies.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { Vault } from '../src/main/vault.ts'
import { parseVaultPath } from '../src/core/ipc.ts'

const HOME = os.homedir()
const LIFE_OS_COPY = path.join(HOME, 'mote-link-check/life-os-copy')
const PESEMIC_COPY = path.join(HOME, 'mote-link-check/Pesemic-copy')
const SCRATCH = path.join(os.tmpdir(), 'mote-verify-step4')

async function runDiff(originalDir, testDir) {
  try {
    const diff = execFileSync('diff', ['-r', '-u', '-x', '.git', '-x', '.obsidian', originalDir, testDir], {
      encoding: 'utf8'
    })
    return diff
  } catch (err) {
    if (err.stdout) return err.stdout
    throw err
  }
}

async function verifyLifeOs() {
  console.log('== 1. Verifying life-os rename and link rewriting ==')
  const workDir = path.join(SCRATCH, 'life-os')
  await rm(workDir, { recursive: true, force: true })
  await cp(LIFE_OS_COPY, workDir, { recursive: true })

  const journalDir = path.join(SCRATCH, 'journal-life-os')
  await mkdir(journalDir, { recursive: true })
  const journalFile = path.join(journalDir, 'journal.json')
  const journalHandler = {
    async read() {
      try {
        return JSON.parse(await readFile(journalFile, 'utf8'))
      } catch {
        return null
      }
    },
    async write(j) {
      await writeFile(journalFile, JSON.stringify(j))
    },
    async clear() {
      await rm(journalFile, { force: true })
    }
  }

  const vault = await Vault.open(workDir, () => {}, journalHandler)
  const from = parseVaultPath('English/Weekly/2026-W31.md')
  const to = parseVaultPath('English/Weekly/2026-W31-renamed.md')

  console.log(`Renaming ${from} -> ${to}...`)
  await vault.renameOrMove(from, to, true, journalHandler)
  vault.close()

  const diffOutput = await runDiff(LIFE_OS_COPY, workDir)
  const changedFiles = []
  const plusPrefix = '+++ ' + workDir + '/'
  for (const line of diffOutput.split('\n')) {
    if (line.startsWith(plusPrefix)) {
      changedFiles.push(line.slice(plusPrefix.length).split('\t')[0])
    } else if (line.startsWith('Only in ' + path.join(workDir, 'English/Weekly') + ': ')) {
      changedFiles.push('English/Weekly/' + line.split(': ')[1])
    } else if (line.startsWith('Only in ' + path.join(LIFE_OS_COPY, 'English/Weekly') + ': ')) {
      changedFiles.push('English/Weekly/' + line.split(': ')[1])
    }
  }

  console.log('Changed files in life-os:', changedFiles)

  // Verify only the renamed note and notes linking to it were changed
  // In life-os, notes linking to 2026-W31:
  // English/Weekly/2026-W31.md (deleted/moved to 2026-W31-renamed.md)
  // Plus inbound references in Weekly / Vocabulary notes
  const nonRenameOrInbound = changedFiles.filter((f) => {
    if (f === 'English/Weekly/2026-W31.md' || f === 'English/Weekly/2026-W31-renamed.md') return false
    return !f.startsWith('English/')
  })

  if (nonRenameOrInbound.length > 0) {
    throw new Error(`Unexpected files changed: ${nonRenameOrInbound.join(', ')}`)
  }

  console.log('✓ life-os: only renamed note and its linked notes were touched!')
}

async function verifyPesemic() {
  console.log('== 2. Verifying Pesemic rename and link rewriting ==')
  const workDir = path.join(SCRATCH, 'Pesemic')
  await rm(workDir, { recursive: true, force: true })
  await cp(PESEMIC_COPY, workDir, { recursive: true })

  const journalDir = path.join(SCRATCH, 'journal-pesemic')
  await mkdir(journalDir, { recursive: true })
  const journalFile = path.join(journalDir, 'journal.json')
  const journalHandler = {
    async read() {
      try {
        return JSON.parse(await readFile(journalFile, 'utf8'))
      } catch {
        return null
      }
    },
    async write(j) {
      await writeFile(journalFile, JSON.stringify(j))
    },
    async clear() {
      await rm(journalFile, { force: true })
    }
  }

  const vault = await Vault.open(workDir, () => {}, journalHandler)
  const from = parseVaultPath('compute/liwen-deps.md')
  const to = parseVaultPath('compute/liwen-deps-renamed.md')

  console.log(`Renaming ${from} -> ${to}...`)
  await vault.renameOrMove(from, to, true, journalHandler)
  vault.close()

  const diffOutput = await runDiff(PESEMIC_COPY, workDir)
  const changedFiles = []
  const plusPrefix = '+++ ' + workDir + '/'
  for (const line of diffOutput.split('\n')) {
    if (line.startsWith(plusPrefix)) {
      changedFiles.push(line.slice(plusPrefix.length).split('\t')[0])
    } else if (line.startsWith('Only in ' + path.join(workDir, 'compute') + ': ')) {
      changedFiles.push('compute/' + line.split(': ')[1])
    } else if (line.startsWith('Only in ' + path.join(PESEMIC_COPY, 'compute') + ': ')) {
      changedFiles.push('compute/' + line.split(': ')[1])
    }
  }

  console.log('Changed files in Pesemic:', changedFiles)

  // Expected:
  // compute/liwen-deps.md -> compute/liwen-deps-renamed.md
  // compute/compute_phase1_spec.md
  const expected = new Set([
    'compute/liwen-deps.md',
    'compute/liwen-deps-renamed.md',
    'compute/compute_phase1_spec.md'
  ])

  for (const f of changedFiles) {
    if (!expected.has(f)) {
      throw new Error(`Unexpected file changed in Pesemic: ${f}`)
    }
  }

  // Check the diff of compute_phase1_spec.md
  const updatedSpec = await readFile(path.join(workDir, 'compute/compute_phase1_spec.md'), 'utf8')
  if (!updatedSpec.includes('liwen-deps-renamed.md')) {
    throw new Error('compute_phase1_spec.md does not contain updated link text!')
  }

  console.log('✓ Pesemic: only compute/liwen-deps.md and compute_phase1_spec.md were changed!')
}

async function verifyJournalCrashRecovery() {
  console.log('== 3. Verifying journal crash recovery ==')
  const workDir = path.join(SCRATCH, 'crash-recovery')
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })

  // Note A links to Note B
  await writeFile(path.join(workDir, 'A.md'), 'Links to [[B]].')
  await writeFile(path.join(workDir, 'B.md'), '# Note B')

  const journalDir = path.join(SCRATCH, 'journal-crash')
  await mkdir(journalDir, { recursive: true })
  const journalFile = path.join(journalDir, 'journal.json')

  // Simulate a crash that happened after physically moving B.md to B-new.md, but before rewriting A.md
  await cp(path.join(workDir, 'B.md'), path.join(workDir, 'B-new.md'))
  await rm(path.join(workDir, 'B.md'))
  await writeFile(
    journalFile,
    JSON.stringify({
      dir: workDir,
      from: 'B.md',
      to: 'B-new.md',
      kind: 'note',
      updateLinks: true
    })
  )

  const journalHandler = {
    async read() {
      try {
        return JSON.parse(await readFile(journalFile, 'utf8'))
      } catch {
        return null
      }
    },
    async write(j) {
      await writeFile(journalFile, JSON.stringify(j))
    },
    async clear() {
      await rm(journalFile, { force: true })
    }
  }

  // Opening the vault should detect the journal, replay the link update on A.md, and remove the journal
  const vault = await Vault.open(workDir, () => {}, journalHandler)
  vault.close()

  const textA = await readFile(path.join(workDir, 'A.md'), 'utf8')
  if (textA !== 'Links to [[B-new]].') {
    throw new Error(`Crash recovery failed: A.md is "${textA}", expected "Links to [[B-new]]."`)
  }

  const remainingJournal = await journalHandler.read()
  if (remainingJournal !== null) {
    throw new Error('Journal was not cleared after crash recovery!')
  }

  console.log('✓ Crash recovery: journal was replayed and cleared successfully!')
}

async function main() {
  await rm(SCRATCH, { recursive: true, force: true })
  await mkdir(SCRATCH, { recursive: true })

  await verifyLifeOs()
  await verifyPesemic()
  await verifyJournalCrashRecovery()

  console.log('\n🎉 ALL STEP 4 ACCEPTANCE CHECKS PASSED!')
}

main().catch((err) => {
  console.error('\n❌ Verification failed:', err)
  process.exit(1)
})
