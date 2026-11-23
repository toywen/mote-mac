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

function parseSemver(v: string): [number, number, number] {
  const clean = v.trim().replace(/^v/i, '')
  const mainPart = clean.split('-')[0].split('+')[0]
  const segments = mainPart.split('.').map((s) => Number.parseInt(s, 10))
  return [
    Number.isNaN(segments[0]) ? 0 : segments[0],
    Number.isNaN(segments[1]) ? 0 : segments[1],
    Number.isNaN(segments[2]) ? 0 : segments[2]
  ]
}

function compareSemver(v1: string, v2: string): number {
  const [maj1, min1, pat1] = parseSemver(v1)
  const [maj2, min2, pat2] = parseSemver(v2)

  if (maj1 !== maj2) return maj1 - maj2
  if (min1 !== min2) return min1 - min2
  return pat1 - pat2
}

export function isNewerVersion(remote: string, current: string): boolean {
  return compareSemver(remote, current) > 0
}

export function pickBestAsset(
  assets: ReleaseAsset[],
  targetArch: string = process.arch
): ReleaseAsset | null {
  const isArm = targetArch === 'arm64'
  const archMatch = isArm ? 'arm64' : 'x64'
  const oppositeArch = isArm ? 'x64' : 'arm64'

  const macAssets = assets.filter((a) => {
    const name = a.name.toLowerCase()
    if (!name.endsWith('.dmg') && !name.endsWith('.zip')) return false
    if (!isArm && (name.includes('arm64') || name.includes('aarch64'))) {
      return false
    }
    return true
  })

  if (macAssets.length === 0) return null

  const exactZip = macAssets.find((a) => {
    const name = a.name.toLowerCase()
    return name.endsWith('.zip') && name.includes(archMatch)
  })
  if (exactZip) return exactZip

  const exactDmg = macAssets.find((a) => {
    const name = a.name.toLowerCase()
    return name.endsWith('.dmg') && name.includes(archMatch)
  })
  if (exactDmg) return exactDmg

  const universalZip = macAssets.find((a) => {
    const name = a.name.toLowerCase()
    return name.endsWith('.zip') && name.includes('universal')
  })
  if (universalZip) return universalZip

  const universalDmg = macAssets.find((a) => {
    const name = a.name.toLowerCase()
    return name.endsWith('.dmg') && name.includes('universal')
  })
  if (universalDmg) return universalDmg

  const genericZip = macAssets.find((a) => {
    const name = a.name.toLowerCase()
    return (
      name.endsWith('.zip') &&
      !name.includes(oppositeArch) &&
      (name.includes('mac') || name.includes('darwin'))
    )
  })
  if (genericZip) return genericZip

  const genericDmg = macAssets.find((a) => {
    const name = a.name.toLowerCase()
    return (
      name.endsWith('.dmg') &&
      !name.includes(oppositeArch) &&
      (name.includes('mac') || name.includes('darwin'))
    )
  })
  if (genericDmg) return genericDmg

  if (isArm) {
    const anyZip = macAssets.find((a) => a.name.toLowerCase().endsWith('.zip'))
    if (anyZip) return anyZip
    return macAssets.find((a) => a.name.toLowerCase().endsWith('.dmg')) || macAssets[0]
  }

  return null
}
