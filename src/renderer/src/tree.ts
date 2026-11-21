import { type VaultEntry, type VaultPath } from '../../core/ipc'

export type TreeNode = VaultEntry & { name: string; children: TreeNode[] }
export type SortOrder = 'name-asc' | 'name-desc'

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export function buildTree(entries: VaultEntry[], sortOrder: SortOrder = 'name-asc'): TreeNode[] {
  const roots: TreeNode[] = []
  const nodes = new Map<VaultPath, TreeNode>()
  for (const entry of entries) {
    if (entry.path.startsWith('.')) continue
    const leaf = entry.path.slice(entry.path.lastIndexOf('/') + 1)
    nodes.set(entry.path, {
      ...entry,
      name: entry.kind === 'note' ? leaf.slice(0, -3) : leaf,
      children: []
    })
  }
  for (const node of nodes.values()) {
    const parent = nodes.get(node.path.slice(0, node.path.lastIndexOf('/')) as VaultPath)
    if (node.path.includes('/') && parent) parent.children.push(node)
    else roots.push(node)
  }
  function sort(branch: TreeNode[]): void {
    branch.sort((a, b) => {
      const folderDiff = Number(b.kind === 'folder') - Number(a.kind === 'folder')
      if (folderDiff !== 0) return folderDiff
      const comp = collator.compare(a.name, b.name)
      return sortOrder === 'name-desc' ? -comp : comp
    })
    for (const node of branch) sort(node.children)
  }
  sort(roots)
  return roots
}
