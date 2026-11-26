import { File, FileCode, FileImage, FileText, FileType, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { isHtmlPath, isImagePath, isPdfPath } from '../../core/fileUrl'
import type { VaultPath } from '../../core/ipc'
import { MenuLayer } from './MenuLayer'
import { workspace } from './workspace'

export function TabBar({
  tabs,
  activePath,
  onNewPanel,
  onLocate
}: {
  tabs: VaultPath[]
  activePath?: VaultPath
  onNewPanel: () => void
  onLocate?: (path: VaultPath) => void
}): React.JSX.Element {
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    path: VaultPath
  } | null>(null)
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of tabs) {
      const isMd = p.toLowerCase().endsWith('.md')
      const baseName = p.slice(p.lastIndexOf('/') + 1)
      const name = isMd ? baseName.replace(/\.md$/i, '') : baseName
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return counts
  }, [tabs])

  if (tabs.length === 0) {
    return (
      <div className="tab-bar is-empty" role="tablist" aria-label="标签页">
        <button
          type="button"
          className="tab-add"
          title="新面板"
          aria-label="打开空面板"
          onClick={onNewPanel}
        >
          <Plus size={13} strokeWidth={1.6} />
        </button>
      </div>
    )
  }

  return (
    <div className="tab-bar" role="tablist" aria-label="标签页">
      <div className="tab-scroll">
        {tabs.map((path) => {
          const isActive = path === activePath
          const isMd = path.toLowerCase().endsWith('.md')
          const baseName = path.slice(path.lastIndexOf('/') + 1)
          const name = isMd ? baseName.replace(/\.md$/i, '') : baseName
          const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null
          const parentFolder = folder ? folder.slice(folder.lastIndexOf('/') + 1) : null
          const showFolderHint = (nameCounts.get(name) ?? 0) > 1 && parentFolder

          const Icon = isHtmlPath(path)
            ? FileCode
            : isImagePath(path)
              ? FileImage
              : isPdfPath(path)
                ? FileType
                : isMd
                  ? FileText
                  : File

          const isMenuTarget = contextMenu?.path === path

          return (
            <div
              key={path}
              className={`tab-item ${isActive ? 'active' : ''} ${isMenuTarget ? 'menu-target' : ''}`}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              title={path}
              onClick={() => void workspace.open(path)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  void workspace.closeTab(path)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  path
                })
              }}
            >
              <Icon size={13} strokeWidth={1.5} className="tab-icon" aria-hidden="true" />
              <span className="tab-name">{name}</span>
              {showFolderHint && <span className="tab-folder-hint">({parentFolder})</span>}
              <button
                type="button"
                className="tab-close"
                title="关闭标签页（⌘W）"
                aria-label={`关闭 ${name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void workspace.closeTab(path)
                }}
              >
                <X size={10.5} strokeWidth={2} />
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="tab-add"
        title="新面板"
        aria-label="打开空面板"
        onClick={onNewPanel}
      >
        <Plus size={13} strokeWidth={1.6} />
      </button>

      {contextMenu && (
        <MenuLayer onClose={() => setContextMenu(null)}>
          <ul
            className="context-menu"
            role="menu"
            aria-label="标签页操作菜单"
            style={{
              left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 190)),
              top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 260)),
              minWidth: 180
            }}
          >
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                onClick={() => {
                  const target = contextMenu.path
                  setContextMenu(null)
                  void workspace.closeTab(target)
                }}
              >
                <span className="context-menu-label">关闭标签页</span>
                <span className="context-menu-shortcut">⌘W</span>
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                disabled={tabs.length <= 1}
                onClick={() => {
                  const target = contextMenu.path
                  setContextMenu(null)
                  void workspace.closeOtherTabs(target)
                }}
              >
                <span className="context-menu-label">关闭其他标签页</span>
                <span className="context-menu-shortcut">⌥⌘T</span>
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                disabled={tabs.indexOf(contextMenu.path) === tabs.length - 1}
                onClick={() => {
                  const target = contextMenu.path
                  setContextMenu(null)
                  void workspace.closeTabsToTheRight(target)
                }}
              >
                <span className="context-menu-label">关闭右侧标签页</span>
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                onClick={() => {
                  setContextMenu(null)
                  void workspace.closeAllTabs()
                }}
              >
                <span className="context-menu-label">全部关闭</span>
              </button>
            </li>
            <li className="context-menu-separator" role="separator" />
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                onClick={() => {
                  const target = contextMenu.path
                  setContextMenu(null)
                  void navigator.clipboard.writeText(target)
                }}
              >
                <span className="context-menu-label">复制相对路径</span>
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                onClick={() => {
                  const target = contextMenu.path
                  setContextMenu(null)
                  const vaultDir = workspace.snapshot().vault?.dir
                  if (vaultDir) void window.mote.showInFolder(vaultDir, target)
                }}
              >
                <span className="context-menu-label">在访达中显示</span>
              </button>
            </li>
            {onLocate && (
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  onClick={() => {
                    const target = contextMenu.path
                    setContextMenu(null)
                    onLocate(target)
                  }}
                >
                  <span className="context-menu-label">在文件树中定位</span>
                </button>
              </li>
            )}
            <li className="context-menu-separator" role="separator" />
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                onClick={() => {
                  setContextMenu(null)
                  const vaultDir = workspace.snapshot().vault?.dir
                  if (vaultDir) void window.mote.newWindow(vaultDir)
                }}
              >
                <span className="context-menu-label">在新窗口打开</span>
                <span className="context-menu-shortcut">⇧⌘N</span>
              </button>
            </li>
          </ul>
        </MenuLayer>
      )}
    </div>
  )
}
