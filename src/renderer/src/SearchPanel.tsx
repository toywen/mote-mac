import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SearchResult } from '../../core/ipc'
import { parseQuery } from '../../core/search'
import { HitList } from './HitList'
import { workspace } from './workspace'

const DEBOUNCE_MS = 150
const PAGE = 50

// Full-text search over main's note index. Searches 150 ms after typing stops, never while an
// input method is composing, and again whenever note contents change. focusId changes when
// the panel should take focus.
export function SearchPanel({
  query,
  onQuery,
  focusId,
  onClose
}: {
  query: string
  onQuery: (query: string) => void
  focusId: number
  onClose?: () => void
}): React.JSX.Element {
  const { revision } = useSyncExternalStore(workspace.subscribe, workspace.snapshot)
  // More pages only for the query they were asked for.
  const [pages, setPages] = useState({ query, limit: PAGE })
  const limit = pages.query === query ? pages.limit : PAGE
  const [composing, setComposing] = useState(false)
  const [result, setResult] = useState<(SearchResult & { query: string }) | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const runId = useRef(0)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusId])

  useEffect(() => {
    if (composing) return
    const id = ++runId.current
    const timer = window.setTimeout(() => {
      if (parseQuery(query).length === 0) {
        setResult(null)
        return
      }
      void workspace.search(query, limit)?.then(
        (found) => {
          if (id === runId.current) setResult({ ...found, query })
        },
        () => {
          if (id === runId.current) setResult(null)
        }
      )
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, limit, composing, revision])

  return (
    <div className="search-panel">
      {onClose && (
        <div className="search-header">
          <button
            type="button"
            className="search-back-button"
            onClick={onClose}
            title="返回文件列表（Esc）"
          >
            <ArrowLeft size={13} strokeWidth={1.5} />
            <span>文件</span>
          </button>
        </div>
      )}
      <input
        ref={input}
        type="search"
        aria-label="搜索"
        placeholder="搜索笔记"
        value={query}
        spellCheck={false}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose?.()
          }
        }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
      />
      {result && (
        <div className="hit-scroll" data-query={result.query}>
          <div className="search-summary" role="status" aria-label="搜索结果数">
            {result.notes} 篇笔记，{result.total} 处
          </div>
          {result.notes > 0 && <HitList groups={result.groups} label="搜索结果" />}
          {result.groups.length < result.notes && (
            <button
              type="button"
              className="search-more"
              onClick={() => setPages({ query, limit: limit + PAGE })}
            >
              显示更多（还有 {result.notes - result.groups.length} 篇）
            </button>
          )}
        </div>
      )}
    </div>
  )
}
