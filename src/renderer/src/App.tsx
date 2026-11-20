import { FolderOpen } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import { FileTree } from './FileTree'
import { NoteEditor } from './NoteEditor'
import { workspace } from './workspace'

function App(): React.JSX.Element {
  const { vault, doc, busy, error } = useSyncExternalStore(workspace.subscribe, workspace.snapshot)
  useEffect(() => workspace.connect(), [])

  return (
    <div className="layout">
      <aside className="pane sidebar" aria-label="文件树">
        <header className="pane-header">
          <h2>文件树</h2>
          {vault && (
            <button
              className="icon-button"
              type="button"
              title="打开笔记库"
              aria-label="打开笔记库"
              disabled={busy}
              onClick={() => void workspace.chooseVault()}
            >
              <FolderOpen size={17} />
            </button>
          )}
        </header>
        {vault && (
          <>
            <div className="vault-name" title={vault.dir}>
              {vault.dir.split('/').pop() || '/'}
            </div>
            <nav className="tree-scroll" aria-label="笔记库">
              <FileTree key={vault.dir} entries={vault.entries} selected={doc?.path} />
            </nav>
          </>
        )}
      </aside>
      <main className="pane editor" aria-label="编辑器">
        <header className="pane-header">
          {doc ? (
            <h1 title={doc.path}>{doc.path.split('/').pop()?.slice(0, -3)}</h1>
          ) : (
            <h1>编辑器</h1>
          )}
          {doc && doc.kind !== 'missing' && doc.kind !== 'conflict' && (
            <span className="save-state" role="status">
              {doc.kind === 'dirty' ? '未保存' : doc.kind === 'saving' ? '保存中' : '已保存'}
            </span>
          )}
        </header>
        {error && (
          <div className="notice" role="alert">
            <span>{error}</span>
            {doc?.kind === 'dirty' && (
              <button type="button" onClick={() => void workspace.save()}>
                重试保存
              </button>
            )}
          </div>
        )}
        {doc?.kind === 'conflict' && (
          <section className="notice conflict" aria-label="外部修改冲突">
            <h2 role="alert">检测到外部修改</h2>
            <div className="actions">
              <button type="button" onClick={() => void workspace.save(true)}>
                保留我的修改
              </button>
              <button type="button" onClick={() => void workspace.useDisk()}>
                使用磁盘版本
              </button>
            </div>
            <details>
              <summary>查看磁盘版本</summary>
              <pre>{doc.disk?.text ?? '笔记已从磁盘删除'}</pre>
            </details>
          </section>
        )}
        {doc && doc.kind !== 'missing' ? (
          <NoteEditor key={doc.path} path={doc.path} source={doc.source} locked={busy} />
        ) : (
          <div className="empty">
            {!vault && !busy && (
              <button
                className="open-button"
                type="button"
                onClick={() => void workspace.chooseVault()}
              >
                <FolderOpen size={18} />
                打开笔记库
              </button>
            )}
            {vault && (doc ? '笔记已从磁盘删除' : '选择一篇笔记')}
          </div>
        )}
      </main>
      <aside className="pane backlinks" aria-label="反向链接">
        <header className="pane-header">
          <h2>反向链接</h2>
        </header>
      </aside>
    </div>
  )
}

export default App
