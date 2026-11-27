import type { AiScopeItem, VaultPath } from './ipc.ts'

// A daily note is a note named YYYY-MM-DD.md. With a daily folder in the vault config, only
// notes under that folder count, so a dated meeting note elsewhere is left out.
const dailyName = /^(\d{4}-\d{2}-\d{2})\.md$/

export function dailyDate(path: VaultPath, folder: string): string | null {
  const root = folder.replace(/^\/+|\/+$/g, '')
  if (root && !path.startsWith(root + '/')) return null
  return dailyName.exec(path.slice(path.lastIndexOf('/') + 1))?.[1] ?? null
}

// The daily notes dated from..to, both included, oldest first.
export function dailyNotesIn(
  paths: readonly VaultPath[],
  folder: string,
  from: string,
  to: string
): VaultPath[] {
  const dated: [string, VaultPath][] = []
  for (const path of paths) {
    const date = dailyDate(path, folder)
    if (date && date >= from && date <= to) dated.push([date, path])
  }
  return dated.sort((a, b) => a[0].localeCompare(b[0])).map(([, path]) => path)
}

export function localDate(day: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

// This week so far: Monday to today.
export function thisWeek(today: Date): { from: string; to: string } {
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  return { from: localDate(monday), to: localDate(today) }
}

// Resolves a mixed list of @-pinned scope items into deduplicated note paths in selection order.
export function resolveScopePaths(options: {
  items: readonly AiScopeItem[]
  notes: readonly VaultPath[]
  dailyFolder: string
  notesWithTag: (tag: string) => readonly VaultPath[]
}): VaultPath[] {
  const { items, notes, dailyFolder, notesWithTag } = options
  const known = new Set(notes)
  const seen = new Set<VaultPath>()
  const out: VaultPath[] = []
  const add = (path: VaultPath): void => {
    if (!known.has(path) || seen.has(path)) return
    seen.add(path)
    out.push(path)
  }

  for (const item of items) {
    switch (item.kind) {
      case 'note':
        add(item.path)
        break
      case 'folder': {
        const prefix = item.path.replace(/^\/+|\/+$/g, '') + '/'
        notes
          .filter((p) => p.startsWith(prefix))
          .sort((a, b) => a.localeCompare(b, 'zh-CN'))
          .forEach(add)
        break
      }
      case 'tag':
        notesWithTag(item.tag).forEach(add)
        break
      case 'daily':
        dailyNotesIn(notes, dailyFolder, item.from, item.to).forEach(add)
        break
      case 'vault':
        notes
          .slice()
          .sort((a, b) => a.localeCompare(b, 'zh-CN'))
          .forEach(add)
        break
    }
  }
  return out
}
