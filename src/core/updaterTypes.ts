/**
 * Updater domain models, state machine types and semver utilities.
 * Pure TypeScript without Electron dependencies (Model the Domain & Boundary Discipline).
 */

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export interface ReleaseAsset {
  name: string
  browserDownloadUrl: string
  size: number
  contentType: string
}

export interface ReleaseInfo {
  version: string
  tagName: string
  name: string
  body: string
  publishedAt: string
  htmlUrl: string
  asset: ReleaseAsset
}

export interface DownloadProgress {
  percent: number
  bytesDownloaded: number
  totalBytes: number
}

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  release?: ReleaseInfo
  progress?: DownloadProgress
  downloadedFilePath?: string
  error?: string
}

/**
 * Parses a semantic version string (e.g. "v1.2.3", "1.0.0-beta.1") into [major, minor, patch].
 */
export function parseSemver(v: string): [number, number, number] {
  const clean = v.trim().replace(/^v/i, '')
  const mainPart = clean.split('-')[0].split('+')[0]
  const segments = mainPart.split('.').map((s) => Number.parseInt(s, 10))
  return [
    Number.isNaN(segments[0]) ? 0 : segments[0],
    Number.isNaN(segments[1]) ? 0 : segments[1],
    Number.isNaN(segments[2]) ? 0 : segments[2]
  ]
}

/**
 * Compares two versions. Returns > 0 if v1 > v2, < 0 if v1 < v2, 0 if equal.
 */
export function compareSemver(v1: string, v2: string): number {
  const [maj1, min1, pat1] = parseSemver(v1)
  const [maj2, min2, pat2] = parseSemver(v2)

  if (maj1 !== maj2) return maj1 - maj2
  if (min1 !== min2) return min1 - min2
  return pat1 - pat2
}

/**
 * Returns true if remote version is strictly newer than current version.
 */
export function isNewerVersion(remote: string, current: string): boolean {
  return compareSemver(remote, current) > 0
}

/**
 * Selects the best matching macOS asset for the target architecture.
 * Prefers .zip for in-place atomic update, falls back to .dmg.
 */
export function pickBestAsset(
  assets: ReleaseAsset[],
  targetArch: string = process.arch
): ReleaseAsset | null {
  const macAssets = assets.filter((a) => {
    const name = a.name.toLowerCase()
    return name.endsWith('.dmg') || name.endsWith('.zip')
  })

  if (macAssets.length === 0) return null

  const isArm = targetArch === 'arm64'
  const archMatch = isArm ? 'arm64' : 'x64'

  // 1. Exact arch zip
  const exactZip = macAssets.find((a) => {
    const name = a.name.toLowerCase()
    return name.endsWith('.zip') && name.includes(archMatch)
  })
  if (exactZip) return exactZip

  // 2. Exact arch dmg
  const exactDmg = macAssets.find((a) => {
    const name = a.name.toLowerCase()
    return name.endsWith('.dmg') && name.includes(archMatch)
  })
  if (exactDmg) return exactDmg

  // 3. Universal/generic mac zip
  const genericZip = macAssets.find((a) => {
    const name = a.name.toLowerCase()
    return (
      name.endsWith('.zip') &&
      (name.includes('mac') || name.includes('darwin') || name.includes('universal'))
    )
  })
  if (genericZip) return genericZip

  // 4. Any mac zip
  const anyZip = macAssets.find((a) => a.name.toLowerCase().endsWith('.zip'))
  if (anyZip) return anyZip

  // 5. Any dmg
  return macAssets.find((a) => a.name.toLowerCase().endsWith('.dmg')) || macAssets[0]
}
