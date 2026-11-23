#!/usr/bin/env node
// Checks the doc tables that past mistakes broke. `npm test` runs it.
//   node tools/check-docs.mjs [--features <file>] [--architecture <file>]
// docs/features.md:
//   - every 已实现 or 通过 row cites evidence that exists: `测试：<e2e test title>`,
//     `Vitest：<describe/it/test title>` or `verify：<feature file>`. A title may end in … to cite by prefix.
//   - every cited title or feature file exists.
//   - no 编号 appears twice.
// ARCHITECTURE.md module table:
//   - no first cell appears twice.
//   - every path in a first cell exists. A bare name sits in the folder of the path before it.
// Exit code 1 when any check fails.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? join(ROOT, fallback) : args[i + 1]
}
const featuresFile = flag('--features', 'docs/features.md')
const architectureFile = flag('--architecture', 'ARCHITECTURE.md')

const DONE = ['已实现', '通过']
const FIX_EVIDENCE =
  'Fix: cite an existing e2e test name or change the status to 部分 and say what is missing.'
const errors = []
const fail = (file, line, message) =>
  errors.push(`${relative(process.cwd(), file)}:${line}: ${message}`)

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

function titles(files, callee) {
  const pattern = new RegExp(
    `\\b(?:${callee})(?:\\.\\w+)*\\(\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`,
    'g'
  )
  const found = new Set()
  for (const file of files)
    for (const [, , title] of readFileSync(file, 'utf8').matchAll(pattern))
      if (!title.includes('${')) found.add(title.replace(/\\(.)/g, '$1'))
  return found
}

const e2eDir = join(ROOT, 'tests/e2e')
const featureDir = join(ROOT, '.claude/skills/verify-mote/features')
const evidence = {
  测试: {
    what: 'e2e test title in tests/e2e/*.spec.ts',
    names: titles(
      readdirSync(e2eDir)
        .filter((f) => f.endsWith('.spec.ts'))
        .map((f) => join(e2eDir, f)),
      'test'
    )
  },
  Vitest: {
    what: 'Vitest title in src/**/*.test.ts',
    names: titles(
      [...walk(join(ROOT, 'src'))].filter((f) => f.endsWith('.test.ts')),
      'describe|it|test'
    )
  },
  verify: {
    what: 'file in .claude/skills/verify-mote/features/',
    names: new Set(
      readdirSync(featureDir)
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .map((f) => f.slice(0, -3))
    )
  }
}
const RENAMED_LABELS = { 单元测试: 'Vitest', E2E: '测试' }

function cells(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim())
}

function tables(text) {
  const result = []
  let table = null
  text.split('\n').forEach((line, i) => {
    if (!line.trimStart().startsWith('|')) {
      table = null
      return
    }
    const row = cells(line)
    if (!table) result.push((table = { header: row, rows: [] }))
    else if (!row.every((c) => /^:?-+:?$/.test(c))) table.rows.push({ cells: row, line: i + 1 })
  })
  return result
}

function cited(name, names) {
  if (names.has(name)) return true
  const prefix = name.match(/^(.*?)(?:…|\.\.\.)$/)?.[1]
  return Boolean(prefix) && [...names].some((n) => n.startsWith(prefix))
}

function checkEvidence(file, line, id, cell) {
  let found = 0
  const before = errors.length
  const pattern = /(?<![\p{L}\p{N}])(单元测试|测试|Vitest|verify|E2E)：([^；。]*)/gu
  for (const [, label, list] of cell.matchAll(pattern)) {
    if (RENAMED_LABELS[label]) {
      fail(
        file,
        line,
        `${id}: "${label}：" is not an evidence label. Fix: write "${RENAMED_LABELS[label]}：<test title>".`
      )
      continue
    }
    for (const raw of list.split('、')) {
      const name = raw
        .replace(/（[^）]*）\s*$/, '')
        .replace(/`/g, '')
        .trim()
      if (!name) continue
      if (cited(name, evidence[label].names)) found++
      else
        fail(
          file,
          line,
          `${id}: "${label}：${name}" matches no ${evidence[label].what}. ${FIX_EVIDENCE}`
        )
    }
  }
  if (found === 0 && errors.length === before)
    fail(
      file,
      line,
      `${id}: marked done but cites no 测试：, Vitest： or verify： evidence. ${FIX_EVIDENCE}`
    )
}

function checkFeatures(file) {
  const seen = new Map()
  for (const { header, rows } of tables(readFileSync(file, 'utf8'))) {
    const col = (...names) => header.findIndex((h) => names.includes(h))
    const [status, id, proof] = [col('状态'), col('编号'), col('证据', '结果')]
    if (status === -1 || id === -1) continue
    for (const { cells: row, line } of rows) {
      const key = row[id]
      if (seen.has(key))
        fail(
          file,
          line,
          `duplicate row ${key}, first at line ${seen.get(key)}. A rebase or merge kept both copies. Fix: keep one row and merge the newer status, evidence and notes into it.`
        )
      else seen.set(key, line)
      if (proof !== -1 && DONE.some((d) => row[status].includes(d)))
        checkEvidence(file, line, key, row[proof] ?? '')
    }
  }
  return seen.size
}

function checkArchitecture(file) {
  const table = tables(readFileSync(file, 'utf8')).find((t) => t.header[0] === '目录或文件')
  if (!table) {
    fail(file, 1, 'no module table with the header 目录或文件. Fix: restore the 模块地图 table.')
    return 0
  }
  const seen = new Map()
  for (const { cells: row, line } of table.rows) {
    const key = row[0]
    if (seen.has(key))
      fail(
        file,
        line,
        `duplicate module row ${key}, first at line ${seen.get(key)}. A rebase or merge kept both copies. Fix: delete one.`
      )
    else seen.set(key, line)
    let dir = ''
    for (const [, path] of key.matchAll(/`([^`]+)`/g)) {
      const full = path.includes('/') ? path : join(dir, path)
      if (path.includes('/')) dir = path.endsWith('/') ? path : dirname(path)
      if (!existsSync(join(ROOT, full)))
        fail(
          file,
          line,
          `module row names ${full}, which does not exist. Fix: point the row at the file's new path, or delete the row.`
        )
    }
  }
  return seen.size
}

const featureRows = checkFeatures(featuresFile)
const moduleRows = checkArchitecture(architectureFile)
if (errors.length) {
  console.error(errors.join('\n'))
  console.error(`check-docs: ${errors.length} problem(s)`)
  process.exit(1)
}
console.log(`check-docs: ${featureRows} feature rows and ${moduleRows} module rows ok`)
