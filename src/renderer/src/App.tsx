import {
  ArrowUpDown,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Link2,
  Moon,
  PanelLeft,
  PencilLine,
  Search,
  Sun,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { EditorView } from '@codemirror/view'
import { FileTree, type FileTreeHandle } from './FileTree'
import { type SortOrder } from './tree'
import { type FontMode } from '../../core/ipc'
import { groupHits } from '../../core/hits'
import { buildLinkIndex } from '../../core/resolve'
import { HitList } from './HitList'
import { NoteEditor } from './NoteEditor'
import { QuickOpen } from './QuickOpen'
import { SearchPanel } from './SearchPanel'
import { TabBar } from './TabBar'
import { UpdateNotification } from './UpdateNotification'
import { executeFormatting, type FormatAction } from './editor/formatting'
import { workspace } from './workspace'

function App(): React.JSX.Element {
  const { vault, tabs, doc, busy, error, backlinks, selection, mode } = useSyncExternalStore(
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
  const [backlinksOpen, setBacklinksOpen] = useState(false)
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  })
  const [fontMode, setFontMode] = useState<FontMode>('kai')
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    return (localStorage.getItem('mote.sort-order') as SortOrder) || 'name-asc'
  })
  const [sortMenuPos, setSortMenuPos] = useState<{ top: number; left: number } | null>(null)
  const fileTreeRef = useRef<FileTreeHandle>(null)

  useEffect(() => {
    if (!sortMenuPos) return
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        setSortMenuPos(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [sortMenuPos])

  const handleSortChange = (order: SortOrder): void => {
    setSortOrder(order)
    localStorage.setItem('mote.sort-order', order)
    setSortMenuPos(null)
  }
  useEffect(() => workspace.connect(), [])
  useEffect(() => {
    document.documentElement.dataset.font = fontMode
  }, [fontMode])
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
  }, [isDark])
  useEffect(() => {
    const offFont = window.mote?.onFontChanged?.((font) => {
      setFontMode(font)
    })
    void window.mote?.getFont?.().then((font) => {
      if (font) setFontMode(font)
    })
    return () => {
      offFont?.()
    }
  }, [])
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const updateMedia = (): void => setIsDark(media.matches)
    media?.addEventListener('change', updateMedia)

    const offTheme = window.mote?.onThemeChanged?.((state) => {
      setIsDark(state.shouldUseDarkColors)
    })

    void window.mote?.getTheme?.().then((state) => {
      setIsDark(state.shouldUseDarkColors)
    })

    return () => {
      media?.removeEventListener('change', updateMedia)
      offTheme?.()
    }
  }, [])
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
      } else if (event.metaKey && event.shiftKey && !event.altKey && event.code === 'KeyD') {
        event.preventDefault()
        void window.mote?.toggleTheme?.()
      } else if (event.metaKey && event.shiftKey && !event.altKey && event.code === 'KeyK') {
        event.preventDefault()
        if (window.mote?.toggleFont) {
          void window.mote.toggleFont()
        } else {
          setFontMode((f) => (f === 'kai' ? 'hei' : 'kai'))
        }
      } else if (event.metaKey && !event.shiftKey && !event.altKey && event.code === 'KeyW') {
        event.preventDefault()
        void workspace.closeActiveTab()
      } else if (event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Tab') {
        event.preventDefault()
        workspace.cycleTab(event.shiftKey ? -1 : 1)
      } else if (
        event.metaKey &&
        event.shiftKey &&
        !event.altKey &&
        (event.code === 'BracketLeft' || event.code === 'BracketRight')
      ) {
        event.preventDefault()
        workspace.cycleTab(event.code === 'BracketLeft' ? -1 : 1)
      } else if (
        event.metaKey &&
        !event.shiftKey &&
        !event.altKey &&
        (event.key === '\\' || event.code === 'Backslash')
      ) {
        event.preventDefault()
        setSidebarOpen((open) => !open)
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

  useEffect(() => {
    if (!window.mote?.onMenuAction) return
    const offMenu = window.mote.onMenuAction((action) => {
      switch (action) {
        case 'new-note':
          setSidebarOpen(true)
          setSidebarView('files')
          void fileTreeRef.current?.createNote()
          break
        case 'quick-open':
          setQuickOpen(true)
          break
        case 'save':
          void workspace.save()
          break
        case 'close-tab':
          void workspace.closeActiveTab()
          break
        case 'next-tab':
          workspace.cycleTab(1)
          break
        case 'prev-tab':
          workspace.cycleTab(-1)
          break
        case 'search': {
          const inEditor = document.activeElement?.closest('.cm-content')
          const selected = inEditor ? (document.getSelection()?.toString() ?? '') : ''
          const query = /\s/.test(selected) ? `"${selected}"` : selected
          if (query) setSearchQuery(query)
          setSidebarOpen(true)
          setSidebarView('search')
          setSearchFocus((id) => id + 1)
          break
        }
        case 'choose-vault':
          void workspace.chooseVault()
          break
        case 'show-in-folder':
          if (doc && vault) void window.mote.showInFolder(vault.dir, doc.path)
          break
        case 'open-with-default-app':
          if (doc && vault) void window.mote.openWithDefaultApp(vault.dir, doc.path)
          break
        case 'insert-image':
          if (vault && doc && mode === 'live' && !busy) {
            void (async () => {
              const saved = await window.mote.chooseAndSaveImage(vault.dir, doc.path)
              if (saved) {
                const cmEl = document.querySelector('.cm-editor')
                if (cmEl) {
                  const view = EditorView.findFromDOM(cmEl as HTMLElement)
                  if (view) {
                    const { from, to } = view.state.selection.main
                    view.dispatch({
                      changes: { from, to, insert: saved.embedText },
                      selection: { anchor: from + saved.embedText.length },
                      scrollIntoView: true
                    })
                  }
                }
              }
            })()
          }
          break
        case 'toggle-mode':
          workspace.toggleMode()
          break
        case 'toggle-sidebar':
          setSidebarOpen((open) => !open)
          break
        case 'toggle-font':
          if (window.mote?.toggleFont) {
            void window.mote.toggleFont()
          } else {
            setFontMode((f) => (f === 'kai' ? 'hei' : 'kai'))
          }
          break
        case 'toggle-theme':
          void window.mote?.toggleTheme?.()
          break
        case 'format-bold':
        case 'format-italic':
        case 'format-strike':
        case 'format-highlight':
        case 'format-code':
        case 'format-link':
        case 'format-codeblock':
        case 'format-quote':
          executeFormatting(action as FormatAction)
          break
      }
    })
    return () => offMenu()
  }, [doc, vault, mode, busy])

  return (
    <div className={sidebarOpen ? 'layout' : 'layout sidebar-hidden'}>
      <aside id="file-sidebar" className="pane sidebar" aria-label="侧栏">
        <header className="pane-header" />
        {vault && sidebarView === 'search' && (
          <SearchPanel
            key={vault.dir}
            query={searchQuery}
            onQuery={setSearchQuery}
            focusId={searchFocus}
            onClose={() => setSidebarView('files')}
          />
        )}
        {vault && sidebarView === 'files' && (
          <>
            <div
              className="vault-header"
              onContextMenu={(e) => {
                if (e.target instanceof HTMLElement && e.target.closest('button')) {
                  return
                }
                e.preventDefault()
                fileTreeRef.current?.openRootContextMenu(e.clientX, e.clientY)
              }}
            >
              <div className="vault-name" title={vault.dir}>
                {vault.dir.split('/').pop() || '/'}
              </div>
              <div className="vault-actions">
                <button
                  className="icon-button"
                  type="button"
                  title="搜索（⌘⇧F）"
                  aria-label="搜索"
                  onClick={() => {
                    setSidebarView('search')
                    setSearchFocus((id) => id + 1)
                  }}
                >
                  <Search size={14} strokeWidth={1.5} />
                </button>
                <button
                  className={`icon-button ${sortMenuPos ? 'is-active' : ''}`}
                  type="button"
                  title={
                    sortOrder === 'name-asc'
                      ? '排序方式：文件名（从 A 到 Z）'
                      : '排序方式：文件名（从 Z 到 A）'
                  }
                  aria-label="更改排序方式"
                  aria-haspopup="menu"
                  aria-expanded={Boolean(sortMenuPos)}
                  onClick={(e) => {
                    if (sortMenuPos) {
                      setSortMenuPos(null)
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setSortMenuPos({
                        top: rect.bottom + 4,
                        left: Math.max(8, Math.min(rect.left - 40, window.innerWidth - 170))
                      })
                    }
                  }}
                >
                  <ArrowUpDown size={14} strokeWidth={1.5} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="新建笔记（⌘N）"
                  aria-label="新建笔记"
                  onClick={() => void fileTreeRef.current?.createNote()}
                >
                  <FilePlus size={14} strokeWidth={1.5} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="新建文件夹"
                  aria-label="新建文件夹"
                  onClick={() => void fileTreeRef.current?.createFolder()}
                >
                  <FolderPlus size={14} strokeWidth={1.5} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="打开笔记库"
                  aria-label="打开笔记库"
                  disabled={busy}
                  onClick={() => void workspace.chooseVault()}
                >
                  <FolderOpen size={14} strokeWidth={1.5} />
                </button>
              </div>
            </div>
            {sortMenuPos && (
              <>
                <div
                  className="context-menu-backdrop"
                  onClick={() => setSortMenuPos(null)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setSortMenuPos(null)
                  }}
                />
                <ul
                  className="context-menu"
                  style={{
                    position: 'fixed',
                    top: sortMenuPos.top,
                    left: sortMenuPos.left
                  }}
                  role="menu"
                  aria-label="排序选项"
                >
                  <li role="none">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortOrder === 'name-asc'}
                      className={`context-menu-item ${sortOrder === 'name-asc' ? 'is-active' : ''}`}
                      onClick={() => handleSortChange('name-asc')}
                    >
                      <Check
                        size={13}
                        strokeWidth={2}
                        style={{
                          visibility: sortOrder === 'name-asc' ? 'visible' : 'hidden'
                        }}
                      />
                      <span>文件名（从 A 到 Z）</span>
                    </button>
                  </li>
                  <li role="none">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortOrder === 'name-desc'}
                      className={`context-menu-item ${sortOrder === 'name-desc' ? 'is-active' : ''}`}
                      onClick={() => handleSortChange('name-desc')}
                    >
                      <Check
                        size={13}
                        strokeWidth={2}
                        style={{
                          visibility: sortOrder === 'name-desc' ? 'visible' : 'hidden'
                        }}
                      />
                      <span>文件名（从 Z 到 A）</span>
                    </button>
                  </li>
                </ul>
              </>
            )}
            <nav
              className="tree-scroll"
              aria-label="笔记库"
              onContextMenu={(e) => {
                if (e.target instanceof HTMLElement && e.target.closest('.tree-row')) {
                  return
                }
                e.preventDefault()
                fileTreeRef.current?.openRootContextMenu(e.clientX, e.clientY)
              }}
            >
              <FileTree
                ref={fileTreeRef}
                vault={vault}
                selected={doc?.path}
                sortOrder={sortOrder}
              />
            </nav>
          </>
        )}
      </aside>
      <main className="pane editor" aria-label="编辑器">
        <header className="pane-header">
          <div className="editor-title">
            {vault && (
              <button
                className={`icon-button ${sidebarOpen ? 'is-active' : ''}`}
                type="button"
                title={sidebarAction}
                aria-label={sidebarAction}
                aria-expanded={sidebarOpen}
                aria-controls="file-sidebar"
                onClick={() => setSidebarOpen((open) => !open)}
              >
                <PanelLeft size={16} strokeWidth={1.5} />
              </button>
            )}
            {vault ? (
              <TabBar
                tabs={tabs}
                activePath={doc?.path}
                dirtyPath={doc?.kind === 'dirty' ? doc.path : undefined}
                onNewTab={() => {
                  setSidebarOpen(true)
                  setSidebarView('files')
                  void fileTreeRef.current?.createNote()
                }}
              />
            ) : (
              <h1>mote</h1>
            )}
          </div>
          <div className="editor-actions">
            {doc && backlinks?.path === doc.path && backlinks.hits.length > 0 && (
              <button
                type="button"
                className="title-relation-badge"
                onClick={() => setBacklinksOpen((open) => !open)}
                title={`反向链接 (${backlinks.hits.length})`}
                aria-expanded={backlinksOpen}
              >
                <Link2 size={12} strokeWidth={1.6} />
                <span className="hit-count" role="status" aria-label="反向链接数">
                  {backlinks.hits.length}
                </span>
                <span>处引用</span>
                {backlinksOpen ? (
                  <ChevronUp size={11} strokeWidth={1.8} />
                ) : (
                  <ChevronDown size={11} strokeWidth={1.8} />
                )}
              </button>
            )}
            {doc && (
              <button
                className="icon-button"
                type="button"
                title={`${modeAction}（⌘E）`}
                aria-label={modeAction}
                onClick={() => workspace.toggleMode()}
              >
                {mode === 'live' ? (
                  <BookOpen size={16} strokeWidth={1.5} />
                ) : (
                  <PencilLine size={16} strokeWidth={1.5} />
                )}
              </button>
            )}
            <button
              className="icon-button theme-toggle"
              type="button"
              title={isDark ? '切换到浅色外观（⌘⇧D）' : '切换到深色外观（⌘⇧D）'}
              aria-label={isDark ? '切换到浅色外观' : '切换到深色外观'}
              onClick={() => void window.mote?.toggleTheme?.()}
            >
              {isDark ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
            </button>
          </div>
        </header>
        <UpdateNotification />
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
                <FolderOpen size={16} strokeWidth={1.5} />
                打开笔记库
              </button>
            )}
            {vault && (doc ? '笔记已从磁盘删除' : '选择一篇笔记')}
          </div>
        )}
      </main>
      {backlinksOpen && doc && backlinks?.path === doc.path && (
        <aside
          className="pane backlinks relation-popover"
          role="complementary"
          aria-label="反向链接"
        >
          <header className="relation-popover-header">
            <h2>反向链接 ({backlinks.hits.length})</h2>
            <button
              type="button"
              className="icon-button"
              title="关闭反向链接浮窗"
              aria-label="关闭"
              onClick={() => setBacklinksOpen(false)}
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </header>
          <div className="hit-scroll" data-note-path={doc.path}>
            {backlinks.hits.length ? (
              <HitList groups={groupHits(backlinks.hits)} label="反向链接列表" />
            ) : (
              <div className="hit-empty">没有反向链接</div>
            )}
          </div>
        </aside>
      )}
      {quickOpen && vault && (
        <QuickOpen entries={vault.entries} onClose={() => setQuickOpen(false)} />
      )}
    </div>
  )
}

export default App
