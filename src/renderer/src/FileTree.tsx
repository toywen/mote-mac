import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileText,
  FileType,
  Folder,
  FolderOpen
} from 'lucide-react'
import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useEffect,
  type KeyboardEvent
} from 'react'
import { parseVaultPath, type VaultInfo, type VaultPath } from '../../core/ipc'
import { isHtmlPath, isImagePath, isPdfPath } from '../../core/fileUrl'
import { buildTree, type SortOrder, type TreeNode } from './tree'
import { workspace } from './workspace'

function RenameInput({
  initialValue,
  onCommit,
  onCancel
}: {
  initialValue: string
  onCommit: (val: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [val, setVal] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  return (
    <input
      ref={inputRef}
      className="tree-input"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          onCommit(val)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }}
      onBlur={() => onCommit(val)}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

export type FileTreeHandle = {
  createNote(folder?: VaultPath | null): Promise<void>
  createFolder(folder?: VaultPath | null): Promise<void>
  openRootContextMenu(x: number, y: number): void
}

export const FileTree = forwardRef<
  FileTreeHandle,
  {
    vault: VaultInfo
    selected?: VaultPath
    sortOrder?: SortOrder
  }
>(function FileTree({ vault, selected, sortOrder = 'name-asc' }, ref): React.JSX.Element {
  const roots = useMemo(() => buildTree(vault.entries, sortOrder), [vault.entries, sortOrder])
  const [expandedFolders, setExpandedFolders] = useState<Set<VaultPath>>(() => new Set())
  const [focused, setFocused] = useState<VaultPath>()
  const [renamingPath, setRenamingPath] = useState<VaultPath | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    node?: TreeNode
  } | null>(null)
  const [confirmLinkUpdate, setConfirmLinkUpdate] = useState<{
    oldPath: VaultPath
    newPath: VaultPath
    count: number
  } | null>(null)
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<TreeNode | null>(null)

  function toggle(path: VaultPath): void {
    setExpandedFolders((previous) => {
      const next = new Set(previous)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  function resolveTargetFolder(specifiedFolder?: VaultPath | null): VaultPath | undefined {
    if (specifiedFolder === null) return undefined
    if (specifiedFolder) return specifiedFolder
    if (focused) {
      const entry = vault.entries.find((e) => e.path === focused)
      if (entry?.kind === 'folder') return entry.path
      if (entry && entry.path.includes('/')) {
        return entry.path.slice(0, entry.path.lastIndexOf('/')) as VaultPath
      }
    }
    if (selected && vault.config.newFileLocation === 'current') {
      if (selected.includes('/')) {
        return selected.slice(0, selected.lastIndexOf('/')) as VaultPath
      }
    }
    return undefined
  }

  async function handleCreateNote(targetFolder?: VaultPath | null): Promise<void> {
    const folder = resolveTargetFolder(targetFolder)
    try {
      const created = await window.mote.createNoteInVault(vault.dir, folder)
      if (folder) {
        setExpandedFolders((prev) => new Set(prev).add(folder))
      }
      await workspace.open(created)
      setFocused(created)
      setRenamingPath(created)
    } catch (err) {
      console.error('Failed to create note:', err)
    }
  }

  async function handleCreateFolder(targetFolder?: VaultPath | null): Promise<void> {
    const folder = resolveTargetFolder(targetFolder)
    try {
      const created = await window.mote.createFolder(vault.dir, folder)
      if (folder) {
        setExpandedFolders((prev) => new Set(prev).add(folder))
      }
      setFocused(created)
      setRenamingPath(created)
    } catch (err) {
      console.error('Failed to create folder:', err)
    }
  }

  useImperativeHandle(ref, () => ({
    createNote: handleCreateNote,
    createFolder: handleCreateFolder,
    openRootContextMenu: (x: number, y: number) => {
      setContextMenu({ x, y })
    }
  }))

  async function commitRename(node: TreeNode, newName: string): Promise<void> {
    setRenamingPath(null)
    const trimmed = newName.trim()
    if (!trimmed || trimmed === node.name) return
    if (trimmed.includes('/') || trimmed.startsWith('.')) {
      return
    }

    const parent = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : ''
    const fullNewName = node.kind === 'note' ? `${trimmed}.md` : trimmed
    const targetPath = parseVaultPath(parent ? `${parent}/${fullNewName}` : fullNewName)
    if (targetPath === node.path) return

    if (vault.config.alwaysUpdateLinks) {
      await window.mote.renameOrMove(vault.dir, node.path, targetPath, true)
      workspace.renameTab(node.path, targetPath)
      if (selected === node.path) void workspace.open(targetPath)
    } else {
      const count = await window.mote.countInboundLinks(vault.dir, node.path)
      if (count > 0) {
        setConfirmLinkUpdate({ oldPath: node.path, newPath: targetPath, count })
      } else {
        await window.mote.renameOrMove(vault.dir, node.path, targetPath, true)
        workspace.renameTab(node.path, targetPath)
        if (selected === node.path) void workspace.open(targetPath)
      }
    }
  }

  async function handleDelete(node: TreeNode): Promise<void> {
    if (node.kind === 'folder' && node.children.length > 0) {
      setConfirmDeleteFolder(node)
      return
    }
    await window.mote.deleteEntry(vault.dir, node.path)
    if (node.kind === 'note') {
      void workspace.closeTab(node.path)
    }
  }

  function keyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    node: TreeNode,
    expanded: boolean
  ): void {
    if (renamingPath === node.path) return

    if (event.key === 'F2' || (event.key === 'Enter' && !event.metaKey)) {
      event.preventDefault()
      setRenamingPath(node.path)
      return
    }

    if (
      event.key === 'Backspace' ||
      event.key === 'Delete' ||
      (event.metaKey && event.key === 'Backspace')
    ) {
      event.preventDefault()
      void handleDelete(node)
      return
    }

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
      const expanded = folder && expandedFolders.has(node.path)
      const Icon = folder
        ? expanded
          ? FolderOpen
          : Folder
        : node.kind === 'note'
          ? FileText
          : isHtmlPath(node.path)
            ? FileCode
            : isImagePath(node.path)
              ? FileImage
              : isPdfPath(node.path)
                ? FileType
                : File
      const isRenaming = renamingPath === node.path

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
              else if (
                node.kind === 'note' ||
                isHtmlPath(node.path) ||
                isImagePath(node.path) ||
                isPdfPath(node.path)
              )
                void workspace.open(node.path)
              else void workspace.openFile(node.path)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setFocused(node.path)
              setContextMenu({ x: e.clientX, y: e.clientY, node })
            }}
          >
            <span className="tree-caret" aria-hidden="true">
              {folder &&
                (expanded ? (
                  <ChevronDown size={12} strokeWidth={1.6} />
                ) : (
                  <ChevronRight size={12} strokeWidth={1.6} />
                ))}
            </span>
            <Icon size={14} strokeWidth={1.5} className="tree-icon" aria-hidden="true" />
            {isRenaming ? (
              <RenameInput
                initialValue={node.name}
                onCommit={(val) => void commitRename(node, val)}
                onCancel={() => setRenamingPath(null)}
              />
            ) : (
              <span className="tree-name">{node.name}</span>
            )}
          </button>
          {expanded && <ul role="group">{render(node.children, depth + 1)}</ul>}
        </li>
      )
    })
  }

  return (
    <>
      <ul
        className="file-tree"
        role="tree"
        aria-label="文件树"
        onContextMenu={(e) => {
          if (e.target instanceof HTMLElement && e.target.closest('.tree-row')) {
            return
          }
          e.preventDefault()
          e.stopPropagation()
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {render(roots, 0)}
      </ul>

      {contextMenu && (
        <>
          <div
            className="context-menu-backdrop"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setContextMenu(null)
            }}
          />
          <ul
            className="context-menu"
            style={{
              left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 170)),
              top: Math.max(
                8,
                Math.min(contextMenu.y, window.innerHeight - (contextMenu.node ? 190 : 115))
              )
            }}
            role="menu"
            aria-label="操作菜单"
          >
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                onClick={() => {
                  const target = contextMenu.node
                    ? contextMenu.node.kind === 'folder'
                      ? contextMenu.node.path
                      : contextMenu.node.path.includes('/')
                        ? (contextMenu.node.path.slice(
                            0,
                            contextMenu.node.path.lastIndexOf('/')
                          ) as VaultPath)
                        : undefined
                    : null
                  setContextMenu(null)
                  void handleCreateNote(target)
                }}
              >
                新建笔记
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                onClick={() => {
                  const target = contextMenu.node
                    ? contextMenu.node.kind === 'folder'
                      ? contextMenu.node.path
                      : contextMenu.node.path.includes('/')
                        ? (contextMenu.node.path.slice(
                            0,
                            contextMenu.node.path.lastIndexOf('/')
                          ) as VaultPath)
                        : undefined
                    : null
                  setContextMenu(null)
                  void handleCreateFolder(target)
                }}
              >
                新建文件夹
              </button>
            </li>
            <li className="context-menu-separator" role="separator" />
            {contextMenu.node && (
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  onClick={() => {
                    const node = contextMenu.node!
                    setContextMenu(null)
                    setRenamingPath(node.path)
                  }}
                >
                  重命名
                </button>
              </li>
            )}
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                onClick={() => {
                  const node = contextMenu.node
                  setContextMenu(null)
                  void window.mote.showInFolder(vault.dir, node?.path)
                }}
              >
                在访达中显示
              </button>
            </li>
            {contextMenu.node && (
              <>
                <li className="context-menu-separator" role="separator" />
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="context-menu-item danger"
                    onClick={() => {
                      const node = contextMenu.node!
                      setContextMenu(null)
                      void handleDelete(node)
                    }}
                  >
                    移到废纸篓
                  </button>
                </li>
              </>
            )}
          </ul>
        </>
      )}

      {confirmLinkUpdate && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="更新内部链接">
          <div className="modal-box">
            <h2 className="modal-title">更新内部链接</h2>
            <p className="modal-message">
              检测到 {confirmLinkUpdate.count} 处链接引用此
              {confirmLinkUpdate.oldPath.endsWith('.md') ? '笔记' : '文件夹'}
              。是否自动更新内部链接？
            </p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setConfirmLinkUpdate(null)}>
                取消
              </button>
              <button
                type="button"
                className="button"
                onClick={async () => {
                  const { oldPath, newPath } = confirmLinkUpdate
                  setConfirmLinkUpdate(null)
                  await window.mote.renameOrMove(vault.dir, oldPath, newPath, false)
                  workspace.renameTab(oldPath, newPath)
                  if (selected === oldPath) void workspace.open(newPath)
                }}
              >
                不更新
              </button>
              <button
                type="button"
                className="button primary"
                autoFocus
                onClick={async () => {
                  const { oldPath, newPath } = confirmLinkUpdate
                  setConfirmLinkUpdate(null)
                  await window.mote.renameOrMove(vault.dir, oldPath, newPath, true)
                  workspace.renameTab(oldPath, newPath)
                  if (selected === oldPath) void workspace.open(newPath)
                }}
              >
                更新链接
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteFolder && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="删除文件夹">
          <div className="modal-box">
            <h2 className="modal-title">移到废纸篓</h2>
            <p className="modal-message">
              确定要将文件夹 “{confirmDeleteFolder.name}” 及其所有内容移入废纸篓吗？
            </p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setConfirmDeleteFolder(null)}>
                取消
              </button>
              <button
                type="button"
                className="button danger"
                autoFocus
                onClick={async () => {
                  const node = confirmDeleteFolder
                  setConfirmDeleteFolder(null)
                  await window.mote.deleteEntry(vault.dir, node.path)
                }}
              >
                移到废纸篓
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
})
