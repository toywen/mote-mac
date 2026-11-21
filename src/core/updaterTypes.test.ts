import { describe, expect, it } from 'vitest'
import {
  compareSemver,
  isNewerVersion,
  parseSemver,
  pickBestAsset,
  type ReleaseAsset
} from './updaterTypes.js'

describe('updaterTypes - semver', () => {
  it('parses standard semver and prefixed versions', () => {
    expect(parseSemver('1.0.0')).toEqual([1, 0, 0])
    expect(parseSemver('v1.2.3')).toEqual([1, 2, 3])
    expect(parseSemver('V2.10.5')).toEqual([2, 10, 5])
    expect(parseSemver('1.0.0-beta.1')).toEqual([1, 0, 0])
  })

  it('correctly compares semantic versions', () => {
    expect(compareSemver('1.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(compareSemver('1.1.0', '1.0.9')).toBeGreaterThan(0)
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0)
    expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0)
  })

  it('evaluates isNewerVersion correctly', () => {
    expect(isNewerVersion('v1.0.1', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false)
  })
})

describe('updaterTypes - pickBestAsset', () => {
  const assets: ReleaseAsset[] = [
    {
      name: 'mote-1.0.1-arm64.dmg',
      browserDownloadUrl: 'https://example.com/arm64.dmg',
      size: 100,
      contentType: 'application/octet-stream'
    },
    {
      name: 'mote-1.0.1-arm64-mac.zip',
      browserDownloadUrl: 'https://example.com/arm64.zip',
      size: 100,
      contentType: 'application/zip'
    },
    {
      name: 'mote-1.0.1-x64.dmg',
      browserDownloadUrl: 'https://example.com/x64.dmg',
      size: 100,
      contentType: 'application/octet-stream'
    },
    {
      name: 'mote-1.0.1-x64-mac.zip',
      browserDownloadUrl: 'https://example.com/x64.zip',
      size: 100,
      contentType: 'application/zip'
    }
  ]

  it('picks arm64 zip when target arch is arm64', () => {
    const picked = pickBestAsset(assets, 'arm64')
    expect(picked?.name).toBe('mote-1.0.1-arm64-mac.zip')
  })

  it('picks x64 zip when target arch is x64', () => {
    const picked = pickBestAsset(assets, 'x64')
    expect(picked?.name).toBe('mote-1.0.1-x64-mac.zip')
  })

  it('falls back to dmg if zip is not available', () => {
    const dmgOnly: ReleaseAsset[] = [
      {
        name: 'mote-1.0.1-arm64.dmg',
        browserDownloadUrl: 'https://example.com/arm64.dmg',
        size: 100,
        contentType: 'application/octet-stream'
      }
    ]
    const picked = pickBestAsset(dmgOnly, 'arm64')
    expect(picked?.name).toBe('mote-1.0.1-arm64.dmg')
  })

  it('returns null if no macOS assets match', () => {
    const winAssets: ReleaseAsset[] = [
      {
        name: 'mote-1.0.1-setup.exe',
        browserDownloadUrl: 'https://example.com/setup.exe',
        size: 100,
        contentType: 'application/octet-stream'
      }
    ]
    expect(pickBestAsset(winAssets, 'arm64')).toBeNull()
  })

  it('rejects arm64 assets when target is x64 and returns null if only arm64 assets exist', () => {
    const armOnly: ReleaseAsset[] = [
      {
        name: 'mote-1.0.0-arm64.dmg',
        browserDownloadUrl: 'https://example.com/arm64.dmg',
        size: 100,
        contentType: 'application/octet-stream'
      },
      {
        name: 'mote-1.0.0-arm64-mac.zip',
        browserDownloadUrl: 'https://example.com/arm64-mac.zip',
        size: 100,
        contentType: 'application/zip'
      }
    ]
    expect(pickBestAsset(armOnly, 'x64')).toBeNull()
  })

  it('picks universal asset when target is x64 or arm64 and universal is provided', () => {
    const universalAssets: ReleaseAsset[] = [
      {
        name: 'mote-1.0.1-universal.dmg',
        browserDownloadUrl: 'https://example.com/universal.dmg',
        size: 200,
        contentType: 'application/octet-stream'
      },
      {
        name: 'mote-1.0.1-universal-mac.zip',
        browserDownloadUrl: 'https://example.com/universal.zip',
        size: 200,
        contentType: 'application/zip'
      }
    ]
    expect(pickBestAsset(universalAssets, 'x64')?.name).toBe('mote-1.0.1-universal-mac.zip')
    expect(pickBestAsset(universalAssets, 'arm64')?.name).toBe('mote-1.0.1-universal-mac.zip')
  })
})
