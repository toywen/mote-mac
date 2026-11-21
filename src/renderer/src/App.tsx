import {
  BookOpen,
  FilePlus,
  FolderOpen,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { FileTree, type FileTreeHandle } from './FileTree'
import { groupHits } from '../../core/hits'
import { buildLinkIndex } from '../../core/resolve'
import { HitList } from './HitList'
import { NoteEditor } from './NoteEditor'
import { QuickOpen } from './QuickOpen'
import { SearchPanel } from './SearchPanel'
import { workspace } from './workspace'

function App(): React.JSX.Element {
  const { vault, doc, busy, error, backlinks, selection, mode } = useSyncExternalStore(
    workspace.subscribe,
    workspace.snapshot
  )
  const modeAction = mode === 'live' ? '切换到阅读模式' : '切换到实时预览'
  // The editor resolves links against the same file list, in the same order, as main. Folders
  // and the vault config say where a click on a missing link creates the note.
  const entries = vault?.entries
  const config = vault?.config
  const links = useMemo(() => {
    if (!entries || !config) return null
    const files = entries.filter((e) => e.kind !== 'folder').map((e) => e.path)
    const folders = entries.filter((e) => e.kind === 'folder').map((e) => e.path)
    return { index: buildLinkIndex(files, folders), config }
  }, [entries, config])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const sidebarAction = sidebarOpen ? '收起文件树' : '展开文件树'
  const [quickOpen, setQuickOpen] = useState(false)
  const [sidebarView, setSidebarView] = useState<'files' | 'search'>('files')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocus, setSearchFocus] = useState(0)
  const fileTreeRef = useRef<FileTreeHandle>(null)
  useEffect(() => workspace.connect(), [])
  useEffect(() => {
    function keyDown(event: KeyboardEvent): void {
      if (event.metaKey && !event.shiftKey && !event.altKey && event.code === 'KeyN') {
        event.preventDefault()
        setSidebarOpen(true)
        setSidebarView('files')
        void fileTreeRef.current?.createNote()
      } else if (event.metaKey && !event.shiftKey && !event.altKey && event.code === 'KeyO') {
        event.preventDefault()
        setQuickOpen(true)
      } else if (event.metaKey && event.shiftKey && !event.altKey && event.code === 'KeyF') {
        event.preventDefault()
        // Text selected in the editor fills the search box, quoted when it has a space.
        const inEditor = document.activeElement?.closest('.cm-content')
        const selected = inEditor ? (document.getSelection()?.toString() ?? '') : ''
        const query = /\s/.test(selected) ? `"${selected}"` : selected
        if (query) setSearchQuery(query)
        setSidebarOpen(true)
        setSidebarView('search')
        setSearchFocus((id) => id + 1)
      } else if (event.metaKey && !event.shiftKey && !event.altKey && event.code === 'KeyE') {
        event.preventDefault()
        workspace.toggleMode()
      } else if (
        event.metaKey &&
        event.altKey &&
        !event.shiftKey &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ) {
        // The editor never sees the key, so the cursor does not also move by a word.
        event.preventDefault()
        event.stopPropagation()
        void (event.key === 'ArrowLeft' ? workspace.back() : workspace.forward())
      }
    }
    window.addEventListener('keydown', keyDown, true)
    return () => window.removeEventListener('keydown', keyDown, true)
  }, [])

  return (
    <div className={sidebarOpen ? 'layout' : 'layout sidebar-hidden'}>
      <aside id="file-sidebar" className="pane sidebar" aria-label="侧栏" hidden={!sidebarOpen}>
        <header className="pane-header">
          <div className="sidebar-views" role="group" aria-label="侧栏视图">
            <button
              type="button"
              aria-pressed={sidebarView === 'files'}
              onClick={() => setSidebarView('files')}
            >
              文件
            </button>
            <button
              type="button"
              aria-pressed={sidebarView === 'search'}
              onClick={() => setSidebarView('search')}
            >
              搜索
            </button>
          </div>
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
        {vault && sidebarView === 'search' && (
          <SearchPanel
            key={vault.dir}
            query={searchQuery}
            onQuery={setSearchQuery}
            focusId={searchFocus}
          />
        )}
        {vault && sidebarView === 'files' && (
          <>
            <div className="vault-header">
              <div className="vault-name" title={vault.dir}>
                {vault.dir.split('/').pop() || '/'}
              </div>
              <div className="vault-actions">
                <button
                  className="icon-button"
                  type="button"
                  title="新建笔记（⌘N）"
                  aria-label="新建笔记"
                  onClick={() => void fileTreeRef.current?.createNote()}
                >
                  <FilePlus size={16} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="新建文件夹"
                  aria-label="新建文件夹"
                  onClick={() => void fileTreeRef.current?.createFolder()}
                >
                  <FolderPlus size={16} />
                </button>
              </div>
            </div>
            <nav className="tree-scroll" aria-label="笔记库">
              <FileTree ref={fileTreeRef} vault={vault} selected={doc?.path} />
            </nav>
          </>
        )}
      </aside>
      <main className="pane editor" aria-label="编辑器">
        <header className="pane-header">
          <div className="editor-title">
            {vault && (
              <button
                className="icon-button"
                type="button"
                title={sidebarAction}
                aria-label={sidebarAction}
                aria-expanded={sidebarOpen}
                aria-controls="file-sidebar"
                onClick={() => setSidebarOpen((open) => !open)}
              >
                {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
              </button>
            )}
            {doc ? (
              <h1 title={doc.path}>{doc.path.split('/').pop()?.slice(0, -3)}</h1>
            ) : (
              <h1>编辑器</h1>
            )}
          </div>
          <div className="editor-actions">
            {doc && doc.kind !== 'missing' && doc.kind !== 'conflict' && (
              <span className="save-state" role="status">
                {doc.kind === 'dirty' ? '未保存' : doc.kind === 'saving' ? '保存中' : '已保存'}
              </span>
            )}
            {doc && (
              <button
                className="icon-button"
                type="button"
                title={`${modeAction}（⌘E）`}
                aria-label={modeAction}
                onClick={() => workspace.toggleMode()}
              >
                {mode === 'live' ? <BookOpen size={17} /> : <PencilLine size={17} />}
              </button>
            )}
          </div>
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
          <NoteEditor
            key={doc.path}
            path={doc.path}
            source={doc.source}
            locked={busy}
            selection={selection}
            mode={mode}
            links={links}
            vault={vault}
          />
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
          {doc && backlinks?.path === doc.path && (
            <span className="hit-count" role="status" aria-label="反向链接数">
              {backlinks.hits.length}
            </span>
          )}
        </header>
        {doc && backlinks?.path === doc.path && (
          <div className="hit-scroll" data-note-path={doc.path}>
            {backlinks.hits.length ? (
              <HitList groups={groupHits(backlinks.hits)} label="反向链接列表" />
            ) : (
              <div className="hit-empty">没有反向链接</div>
            )}
          </div>
        )}
      </aside>
      {quickOpen && vault && (
        <QuickOpen entries={vault.entries} onClose={() => setQuickOpen(false)} />
      )}
    </div>
  )
}

export default App
