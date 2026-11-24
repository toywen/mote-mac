import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkServerUrl, colonFingerprint, parseCert } from './syncCert'

const dir = mkdtempSync(join(tmpdir(), 'mote-cert-'))
execFileSync('openssl', [
  'req',
  '-x509',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-subj',
  '/CN=mote-sync',
  '-days',
  '1',
  '-keyout',
  join(dir, 'key.pem'),
  '-out',
  join(dir, 'cert.pem')
])
const pem = readFileSync(join(dir, 'cert.pem'), 'utf8')
const openssl = execFileSync('openssl', ['x509', '-in', join(dir, 'cert.pem'), '-noout', '-fingerprint', '-sha256'])
  .toString()
  .trim()
  .replace('sha256 Fingerprint=', '')
  .toLowerCase()
  .replace(/:/g, '')
rmSync(dir, { recursive: true, force: true })

describe('parseCert', () => {
  it('gives the same fingerprint as openssl', () => {
    expect(parseCert(pem)).toEqual({ ok: true, fingerprint: openssl })
  })

  it('rejects text that is not a certificate', () => {
    expect(parseCert('hello')).toEqual({ ok: false, error: '证书不是有效的 PEM' })
  })
})

describe('colonFingerprint', () => {
  it('groups the hex by two, in upper case', () => {
    expect(colonFingerprint('aabbcc')).toBe('AA:BB:CC')
  })
})

describe('checkServerUrl', () => {
  it.each([
    ['https://1.2.3.4:8443', 'https://1.2.3.4:8443'],
    ['  http://127.0.0.1:9000/', 'http://127.0.0.1:9000'],
    ['https://sync.example.com', 'https://sync.example.com']
  ])('accepts %s', (text, url) => {
    expect(checkServerUrl(text)).toEqual({ ok: true, url })
  })

  it.each([
    ['', '服务器地址要像 https://1.2.3.4:8443'],
    ['1.2.3.4:8443', '服务器地址要像 https://1.2.3.4:8443'],
    ['ftp://1.2.3.4', '服务器地址要以 https:// 开头'],
    ['https://1.2.3.4:8443/v1', '服务器地址只写到主机和端口'],
    ['https://1.2.3.4:8443/?a=1', '服务器地址只写到主机和端口']
  ])('rejects %j', (text, error) => {
    expect(checkServerUrl(text)).toEqual({ ok: false, error })
  })
})
