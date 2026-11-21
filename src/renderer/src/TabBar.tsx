import { Plus, X } from 'lucide-react'
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
          <Plus size={14} />
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
          const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
          const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null

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
              {folder && <span className="tab-folder">{folder}/</span>}
              <span className="tab-name">{name}</span>
              {isDirty && (
                <span className="tab-dirty" title="未保存修改" aria-label="未保存">
                  •
                </span>
              )}
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
                <X size={12} />
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
        <Plus size={14} />
      </button>
    </div>
  )
}
