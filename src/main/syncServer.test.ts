import { describe, expect, it } from 'vitest'
import { checkServerUrl, DEFAULT_SYNC_SERVER, syncServerOf } from './syncServer'

describe('checkServerUrl', () => {
  it.each([
    ['http://1.2.3.4:8443', 'http://1.2.3.4:8443'],
    ['  http://127.0.0.1:9000/', 'http://127.0.0.1:9000'],
    ['https://sync.example.com', 'https://sync.example.com']
  ])('accepts %s', (text, url) => {
    expect(checkServerUrl(text)).toEqual({ ok: true, url })
  })

  it.each([
    ['', '服务器地址要像 http://1.2.3.4:8443'],
    ['1.2.3.4:8443', '服务器地址要像 http://1.2.3.4:8443'],
    ['ftp://1.2.3.4', '服务器地址要以 http:// 或 https:// 开头'],
    ['http://1.2.3.4:8443/v1', '服务器地址只写到主机和端口'],
    ['http://1.2.3.4:8443/?a=1', '服务器地址只写到主机和端口']
  ])('rejects %j', (text, error) => {
    expect(checkServerUrl(text)).toEqual({ ok: false, error })
  })
})

describe('syncServerOf', () => {
  it('uses the deployed service when settings.json names none', () => {
    expect(syncServerOf(undefined)).toEqual({ ok: true, url: DEFAULT_SYNC_SERVER })
  })

  it('uses the address settings.json names', () => {
    expect(syncServerOf('http://127.0.0.1:9000/')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:9000'
    })
  })

  it('says which setting is wrong', () => {
    expect(syncServerOf('nope')).toEqual({
      ok: false,
      error: 'settings.json 里的 syncServerUrl 不对：服务器地址要像 http://1.2.3.4:8443'
    })
    expect(syncServerOf(42).ok).toBe(false)
  })
})
