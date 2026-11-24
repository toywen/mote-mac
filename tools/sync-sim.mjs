#!/usr/bin/env node
// Two simulated devices sync through a real local mote-sync server over pinned TLS.
//   node tools/sync-sim.mjs [path/to/mote-sync]   (default ../mote-sync)
// Each device is a real Vault on a temporary folder plus the real Sync module. The server is
// ../mote-sync/server/dist/index.js on 127.0.0.1 with a fresh self-signed certificate.
// Prints each scenario's measurements. Exits 1 on the first failed check.
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

process.removeAllListeners('warning')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serverJs = resolve(process.argv[2] ?? join(root, '..', 'mote-sync'), 'server/dist/index.js')
if (!existsSync(serverJs)) {
  console.error(`no ${serverJs}. Build the server first:`)
  console.error('  cd ../mote-sync && npm install && npm run build')
  process.exit(1)
}
const { Vault } = await import('../src/main/vault.ts')
const { Sync } = await import('../src/main/sync.ts')
const { createRemote } = await import('../src/main/syncRemote.ts')

const work = await realpath(await mkdtemp(join(tmpdir(), 'mote-sync-sim-')))
const data = join(work, 'server')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const lines = []
const say = (line) => {
  lines.push(line)
  console.log(line)
}

class Failed extends Error {}
function check(ok, what) {
  if (!ok) throw new Failed(what)
  say(`  ok   ${what}`)
}

async function waitFor(what, test, timeoutMs = 15_000) {
  const start = performance.now()
  for (;;) {
    if (await test()) return Math.round(performance.now() - start)
    if (performance.now() - start > timeoutMs) throw new Failed(`timed out: ${what}`)
    await sleep(10)
  }
}

function selfSigned(name) {
  const key = join(work, `${name}.key`)
  const cert = join(work, `${name}.pem`)
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      `/CN=${name}`,
      '-addext',
      'subjectAltName=IP:127.0.0.1'
    ],
    { stdio: 'ignore' }
  )
  return { key, cert }
}

const cli = (...args) =>
  JSON.parse(
    execFileSync(process.execPath, [serverJs, ...args, '--data', data], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  )

const tls = selfSigned('mote-sync-sim')
const certPem = await readFile(tls.cert, 'utf8')
cli('init')
const account = cli('account', 'create', '--name', 'sim').id
const vaultId = cli('vault', 'create', '--account', account, '--name', 'sim').id
const tokens = {
  甲: cli('device', 'create', '--account', account, '--name', '甲').token,
  乙: cli('device', 'create', '--account', account, '--name', '乙').token
}

let server
let port = 0
async function startServer() {
  const child = spawn(process.execPath, [serverJs, 'serve', '--data', data], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      TLS_CERT: tls.cert,
      TLS_KEY: tls.key
    },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let log = ''
  await new Promise((done, fail) => {
    child.stderr.on('data', (chunk) => {
      log += chunk
      const match = /listening on [\d.]+:(\d+)/.exec(log)
      if (match) {
        port = Number(match[1])
        done()
      }
    })
    child.on('exit', (code) => fail(new Error(`server exited with ${code}: ${log}`)))
  })
  server = child
}
async function stopServer() {
  const exited = new Promise((done) => server.once('exit', done))
  server.kill('SIGTERM')
  await exited
}
function blobCount() {
  let count = 0
  const dir = join(data, 'blobs')
  for (const sub of readdirSync(dir)) count += readdirSync(join(dir, sub)).length
  return count
}

await startServer()
const serverUrl = `https://127.0.0.1:${port}`

/** Counts uploads, and can hold an upload back to stand in for a slow link. */
function counting(remote) {
  const counts = { puts: 0, putBytes: 0, putsInFlight: 0 }
  const hooks = { holdPutMs: 0, onPutStart: () => {} }
  return {
    counts,
    hooks,
    remote: {
      ...remote,
      async putBlob(hash, bytes) {
        counts.puts++
        counts.putBytes += bytes.length
        counts.putsInFlight++
        hooks.onPutStart(bytes.length)
        try {
          if (bytes.length > 1024 * 1024 && hooks.holdPutMs) await sleep(hooks.holdPutMs)
          return await remote.putBlob(hash, bytes)
        } finally {
          counts.putsInFlight--
        }
      }
    }
  }
}

async function makeDevice(name) {
  const dir = join(work, name)
  const trash = join(work, `${name}-trash`)
  await mkdir(dir, { recursive: true })
  await mkdir(trash, { recursive: true })
  return { name, dir, trash, vault: null, sync: null, counts: null, hooks: null }
}

async function startDevice(device) {
  device.vault ??= await Vault.open(device.dir, () => {})
  const config = {
    serverUrl,
    certPem,
    token: tokens[device.name],
    vaultId,
    deviceName: device.name
  }
  const wrapped = counting(createRemote(config))
  device.counts = wrapped.counts
  device.hooks = wrapped.hooks
  device.sync = new Sync({
    vault: device.vault,
    config,
    stateDir: join(work, 'state', device.name),
    trash: (full) => rename(full, join(device.trash, `${Date.now()}-${basename(full)}`)),
    remote: wrapped.remote
  })
  await device.sync.start()
}

const status = (device) => device.sync.status()
const file = (device, path) => readFile(join(device.dir, path)).catch(() => null)

/** Idle with nothing pending for longer than the upload delay, so no event is still on its way. */
async function settled(...devices) {
  let since = performance.now()
  return waitFor(
    `${devices.map((d) => d.name).join(', ')} idle`,
    () => {
      if (!devices.every((d) => status(d).state === 'idle' && status(d).pending === 0)) {
        since = performance.now()
        return false
      }
      return performance.now() - since > 1800
    },
    60_000
  )
}

async function edit(device, path, change) {
  const before = await device.vault.readNote(path)
  const text = change(before.text)
  const result = await device.vault.writeNote(path, text, before.hash)
  if (!result.ok) throw new Failed(`${device.name} could not save ${path}`)
  return Buffer.from(text, 'utf8')
}

function hashVault(dir) {
  return execFileSync(process.execPath, [join(root, 'tools/hash-vault.mjs'), dir], {
    encoding: 'utf8'
  })
}

const conflictFiles = (dir, folder = '') =>
  readdirSync(join(dir, folder)).filter((name) => name.includes('(冲突 '))

const paragraphs = (n, tag) =>
  Array.from({ length: n }, (_, i) => `第 ${i + 1} 段 ${tag}，一些中文正文。`).join('\n\n') + '\n'

const A = await makeDevice('甲')
const B = await makeDevice('乙')
const seeded = {
  '合并.md': paragraphs(5, '合并'),
  '同段.md': paragraphs(3, '同段'),
  '删改.md': '要被甲删掉、被乙改掉的笔记\n',
  '改名前.md': '改名不重新上传内容\n',
  'CRLF.md': '第一行\r\n第二行\r\n',
  'BOM.md': '\uFEFF带 BOM 的笔记\n',
  '一样.md': '两边一样\n',
  '共同.md': '甲的版本\n'
}
for (let i = 1; i <= 30; i++)
  seeded[`笔记/note-${String(i).padStart(2, '0')}.md`] = paragraphs(2, `n${i}`)
for (const [path, text] of Object.entries(seeded)) {
  await mkdir(dirname(join(A.dir, path)), { recursive: true })
  await writeFile(join(A.dir, path), text)
}
await writeFile(join(A.dir, 'latin1.md'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))
const pic = randomBytes(4096)
await mkdir(join(A.dir, '.mote', 'attachments'), { recursive: true })
await writeFile(join(A.dir, '.mote', 'attachments', 'pic.png'), pic)
await mkdir(join(A.dir, '.obsidian'), { recursive: true })
await writeFile(join(A.dir, '.obsidian', 'app.json'), '{}')
await writeFile(join(B.dir, '一样.md'), '两边一样\n')
await writeFile(join(B.dir, '共同.md'), '乙的版本\n')

const scenarios = []
const scenario = (name, run) => scenarios.push({ name, run })

scenario('证书固定：别的证书连不上', async () => {
  const other = await readFile(selfSigned('other').cert, 'utf8')
  const remote = createRemote({ serverUrl, certPem: other, token: tokens.甲, vaultId })
  const error = await remote.listVaults().then(
    () => null,
    (e) => e
  )
  say(`  用另一张自签证书请求：${error?.message}`)
  check(error !== null && error.status === null, '证书不是设置里的那张时，请求失败且没有发出')
})

scenario('第一次同步：没改过的文件字节不变', async () => {
  const before = hashVault(A.dir)
  await startDevice(A)
  const msA = await settled(A)
  say(`  甲第一次同步完成：${msA} ms（含 1.8 s 静止判断）`)
  check(hashVault(A.dir) === before, '甲同步前后 tools/hash-vault.mjs 结果相同')
  await startDevice(B)
  await settled(A, B)
  const afterA = hashVault(A.dir)
  check(afterA === hashVault(B.dir), '乙从同步服务拿到后，两边 hash-vault 结果相同')
  check(
    before.split('\n').every((line) => afterA.includes(line)),
    '甲原有的每个文件的哈希都没变'
  )
  check(String(await file(B, '共同.md')) === '甲的版本\n', '同路径哈希不同：原文件换成远程内容')
  const copies = conflictFiles(B.dir)
  say(`  冲突文件：${copies.join('、')}`)
  check(
    copies.length === 1 && String(await file(B, copies[0])) === '乙的版本\n',
    '乙的内容存进冲突文件，两边都有'
  )
  const attached = await file(B, '.mote/attachments/pic.png')
  check(attached !== null && attached.equals(pic), '.mote/attachments/ 下的附件同步了')
  check(!existsSync(join(B.dir, '.obsidian')), '.obsidian 没有同步')
  check(
    (await file(B, 'latin1.md'))?.equals(await file(A, 'latin1.md')),
    '不是 UTF-8 的 .md 字节不变'
  )
})

scenario('延迟：甲停止输入后，乙的磁盘出现同样的字节', async () => {
  const times = []
  for (let round = 1; round <= 5; round++) {
    const [from, to] = round % 2 ? [A, B] : [B, A]
    const path = `笔记/note-0${round}.md`
    const bytes = await edit(from, path, (text) => text + `第 ${round} 次改动\n`)
    const ms = await waitFor(`${to.name} sees ${path}`, async () =>
      (await file(to, path))?.equals(bytes)
    )
    times.push(ms)
    say(`  第 ${round} 次 ${from.name}→${to.name}：${ms} ms`)
    await settled(A, B)
  }
  check(Math.max(...times) < 3000, `最慢 ${Math.max(...times)} ms，小于 3000 ms`)
})

/** Stops the server, lets both devices change a note while offline, and starts the server again. */
async function offline(changeA, changeB) {
  await stopServer()
  await waitFor(
    'both offline',
    () => status(A).state === 'offline' && status(B).state === 'offline'
  )
  const a = await changeA()
  const b = await changeB()
  await sleep(2000) // past the upload delay, so both tried and found the server gone
  const pendingBefore = [status(A).pending, status(B).pending]
  await startServer()
  const reconnect = await waitFor(
    'both online',
    () =>
      !['offline', 'error'].includes(status(A).state) &&
      !['offline', 'error'].includes(status(B).state),
    70_000
  )
  say(`  服务端恢复后 ${reconnect} ms 两边都重连上`)
  return { a, b, pendingBefore }
}

scenario('同步-1：断线后两边改同一篇的不同段，重连后都在', async () => {
  const path = '合并.md'
  await offline(
    () => edit(A, path, (text) => text.replace('第 1 段 合并', '第 1 段 合并【甲改的】')),
    () => edit(B, path, (text) => text.replace('第 5 段 合并', '第 5 段 合并【乙改的】'))
  )
  const ms = await waitFor('same note on both', async () => {
    const [a, b] = [await file(A, path), await file(B, path)]
    return (
      a && b && a.equals(b) && String(a).includes('【甲改的】') && String(a).includes('【乙改的】')
    )
  })
  await settled(A, B)
  const merged = String(await file(A, path))
  say(`  重连后 ${ms} ms 两边内容相同：\n${merged.replace(/^/gm, '    | ')}`)
  check((await file(A, path)).equals(await file(B, path)), '两边字节相同')
  check(merged.includes('【甲改的】') && merged.includes('【乙改的】'), '两边的改动都在')
  check(conflictFiles(A.dir).length === 1, '没有新的冲突文件')
})

scenario('两边改同一段，重连后两段都在', async () => {
  const path = '同段.md'
  await offline(
    () =>
      edit(A, path, (text) => text.replace('第 2 段 同段，一些中文正文。', '第 2 段：甲的写法。')),
    () =>
      edit(B, path, (text) => text.replace('第 2 段 同段，一些中文正文。', '第 2 段：乙的写法。'))
  )
  const ms = await waitFor('same note on both', async () => {
    const [a, b] = [await file(A, path), await file(B, path)]
    return a && b && a.equals(b) && String(a).includes('甲的写法') && String(a).includes('乙的写法')
  })
  await settled(A, B)
  const merged = String(await file(A, path))
  say(`  重连后 ${ms} ms 两边内容相同：\n${merged.replace(/^/gm, '    | ')}`)
  check(merged.includes('甲的写法') && merged.includes('乙的写法'), '两段都在')
  check(!merged.includes('第 2 段 同段'), '旧的那段没有留下')
})

scenario('甲删除、乙修改同一篇，文件保留', async () => {
  const path = '删改.md'
  await offline(
    () => A.vault.trash(path, (full) => rename(full, join(A.trash, 'deleted.md'))),
    () => edit(B, path, (text) => text + '乙加的一行\n')
  )
  const ms = await waitFor('file back on 甲', async () =>
    String(await file(A, path)).includes('乙加的一行')
  )
  await settled(A, B)
  say(`  重连后 ${ms} ms 甲又有了这篇笔记`)
  check((await file(A, path))?.equals(await file(B, path)), '两边都有，内容是乙改过的')
})

scenario('甲改名，乙出现新名字，内容没有重新上传', async () => {
  const [from, to] = ['改名前.md', '改名后/新名字.md']
  const bytes = await file(A, from)
  const puts = A.counts.puts
  const blobs = blobCount()
  await A.vault.renameOrMove(from, to, false)
  const ms = await waitFor(
    'rename on 乙',
    async () => (await file(B, to))?.equals(bytes) && (await file(B, from)) === null
  )
  await settled(A, B)
  say(`  ${ms} ms 后乙有 ${to}、没有 ${from}`)
  say(`  甲上传次数 ${puts} → ${A.counts.puts}，服务端内容文件 ${blobs} → ${blobCount()}`)
  check(A.counts.puts === puts, '甲没有上传内容')
  check(blobCount() === blobs, '服务端没有多出内容文件')
})

scenario('50M 附件上传时，笔记的延迟仍在 3 秒内', async () => {
  const big = randomBytes(50 * 1024 * 1024)
  const path = '.mote/attachments/big.bin'
  const hold = 4000
  A.hooks.holdPutMs = hold
  let putStarted = 0
  A.hooks.onPutStart = (size) => {
    if (size === big.length) putStarted = performance.now()
  }
  const written = performance.now()
  await writeFile(join(A.dir, path), big)
  await waitFor('big upload starts', () => putStarted > 0)
  say(
    `  写入附件后 ${Math.round(putStarted - written)} ms 开始上传（上传被拖慢 ${hold} ms，代替慢网络）`
  )
  const note = '笔记/note-10.md'
  const bytes = await edit(A, note, (text) => text + '附件上传中写的一行\n')
  const ms = await waitFor('note on 乙', async () => (await file(B, note))?.equals(bytes))
  const uploading = A.counts.putsInFlight > 0
  say(`  笔记延迟 ${ms} ms；那时附件${uploading ? '还在上传' : '已传完'}`)
  check(uploading, '笔记到乙时附件还在上传')
  check(ms < 3000, `笔记延迟 ${ms} ms，小于 3000 ms`)
  const arrived = await waitFor(
    'big on 乙',
    async () => (await file(B, path))?.length === big.length,
    60_000
  )
  check(sha(await file(B, path)) === sha(big), `附件在笔记之后 ${arrived} ms 到乙，字节相同`)
  A.hooks.holdPutMs = 0
  await settled(A, B)
})

scenario('清空甲的笔记库文件夹，同步停下，乙的文件都在', async () => {
  const before = hashVault(B.dir)
  const count = before.trim().split('\n').length
  for (const name of readdirSync(A.dir)) {
    if (name !== '.obsidian') await rm(join(A.dir, name), { recursive: true, force: true })
  }
  const ms = await waitFor('甲 blocked', () => status(A).state === 'blocked')
  say(`  ${ms} ms 后甲的状态：${JSON.stringify(status(A))}`)
  await sleep(3000)
  check(hashVault(B.dir) === before, `3 秒后乙的 ${count} 个文件都在，字节没变`)
  const { changes } = await createRemote({ serverUrl, certPem, token: tokens.乙, vaultId }).changes(
    status(B).seq
  )
  check(changes.length === 0, '同步服务没有收到删除')
})

let failed = null
try {
  for (const { name, run } of scenarios) {
    say(`\n== ${name}`)
    await run()
  }
} catch (error) {
  failed = error
  say(`  FAIL ${error instanceof Failed ? error.message : error.stack}`)
  for (const d of [A, B]) if (d.sync) say(`  ${d.name}: ${JSON.stringify(status(d))}`)
}
for (const d of [A, B]) {
  await d.sync?.stop()
  d.vault?.close()
}
await stopServer().catch(() => {})
if (failed) {
  console.log(`\nFAILED. Kept ${work} for a look.`)
  process.exit(1)
}
await rm(work, { recursive: true, force: true })
console.log(`\nall ${scenarios.length} scenarios passed`)
process.exit(0)
