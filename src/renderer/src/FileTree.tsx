import { ChevronDown, ChevronRight, File, FileText, Folder, FolderOpen } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import type { VaultEntry, VaultPath } from '../../core/ipc'
import { workspace } from './workspace'

type TreeNode = VaultEntry & { name: string; children: TreeNode[] }
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

function buildTree(entries: VaultEntry[]): TreeNode[] {
  const roots: TreeNode[] = []
  const nodes = new Map<VaultPath, TreeNode>()
  for (const entry of entries) {
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
    branch.sort(
      (a, b) =>
        Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
        collator.compare(a.name, b.name)
    )
    for (const node of branch) sort(node.children)
  }
  sort(roots)
  return roots
}

export function FileTree({
  entries,
  selected
}: {
  entries: VaultEntry[]
  selected?: VaultPath
}): React.JSX.Element {
  const roots = useMemo(() => buildTree(entries), [entries])
  const [collapsed, setCollapsed] = useState<Set<VaultPath>>(() => new Set())
  const [focused, setFocused] = useState<VaultPath>()

  function toggle(path: VaultPath): void {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  function keyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    node: TreeNode,
    expanded: boolean
  ): void {
    const row = event.currentTarget
    const rows = Array.from(
      row.closest('[role="tree"]')?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? []
    )
    const index = rows.indexOf(row)
    let target: HTMLButtonElement | undefined
    switch (event.key) {
      case 'ArrowDown':
        target = rows[index + 1]
        break
      case 'ArrowUp':
        target = rows[index - 1]
        break
      case 'Home':
        target = rows[0]
        break
      case 'End':
        target = rows.at(-1)
        break
      case 'ArrowRight':
        if (node.kind === 'folder' && !expanded) toggle(node.path)
        else if (node.children.length) target = rows[index + 1]
        break
      case 'ArrowLeft':
        if (expanded) toggle(node.path)
        else
          target = row.closest('[role="group"]')?.previousElementSibling as
            HTMLButtonElement | undefined
        break
      default:
        return
    }
    event.preventDefault()
    target?.focus()
  }

  function render(branch: TreeNode[], depth: number): React.JSX.Element[] {
    return branch.map((node) => {
      const folder = node.kind === 'folder'
      const expanded = folder && !collapsed.has(node.path)
      const Icon = folder
        ? expanded
          ? FolderOpen
          : Folder
        : node.kind === 'note'
          ? FileText
          : File
      return (
        <li role="none" key={node.path}>
          <button
            className="tree-row"
            type="button"
            role="treeitem"
            aria-label={node.name}
            aria-level={depth + 1}
            aria-selected={folder ? undefined : selected === node.path}
            aria-expanded={folder ? expanded : undefined}
            data-path={node.path}
            data-kind={node.kind}
            title={node.path}
            tabIndex={(focused ?? roots[0]?.path) === node.path ? 0 : -1}
            style={{ paddingInlineStart: 8 + depth * 15 }}
            onFocus={() => setFocused(node.path)}
            onKeyDown={(event) => keyDown(event, node, expanded)}
            onClick={() => {
              if (folder) toggle(node.path)
              else if (node.kind === 'note') void workspace.open(node.path)
              else void workspace.openFile(node.path)
            }}
          >
            <span className="tree-caret" aria-hidden="true">
              {folder && (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
            </span>
            <Icon size={15} aria-hidden="true" />
            <span className="tree-name">{node.name}</span>
          </button>
          {expanded && <ul role="group">{render(node.children, depth + 1)}</ul>}
        </li>
      )
    })
  }

  return (
    <ul className="file-tree" role="tree" aria-label="文件树">
      {render(roots, 0)}
    </ul>
  )
}
