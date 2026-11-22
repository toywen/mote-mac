import { File, FileCode, FileImage, FileText, FileType, Plus, X } from 'lucide-react'
import { useMemo } from 'react'
import { isHtmlPath, isImagePath, isPdfPath } from '../../core/fileUrl'
import type { VaultPath } from '../../core/ipc'
import { workspace } from './workspace'

export function TabBar({
  tabs,
  activePath,
  dirtyPath,
  onNewTab
}: {
  tabs: VaultPath[]
  activePath?: VaultPath
  dirtyPath?: VaultPath
  onNewTab: () => void
}): React.JSX.Element {
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
          title="新建笔记（⌘N）"
          aria-label="新建标签页"
          onClick={onNewTab}
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
          const isDirty = path === dirtyPath
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

          return (
            <div
              key={path}
              className={`tab-item ${isActive ? 'active' : ''}`}
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
            >
              <Icon size={13} strokeWidth={1.5} className="tab-icon" aria-hidden="true" />
              <span className="tab-name">{name}</span>
              {showFolderHint && <span className="tab-folder-hint">({parentFolder})</span>}
              {isDirty && <span className="tab-dirty" title="未保存修改" aria-label="未保存" />}
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
        title="新建笔记（⌘N）"
        aria-label="新建标签页"
        onClick={onNewTab}
      >
        <Plus size={13} strokeWidth={1.6} />
      </button>
    </div>
  )
}
