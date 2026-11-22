import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { VaultEntry, VaultPath } from '../../core/ipc'
import { isHtmlPath } from '../../core/fileUrl'
import { Highlighted } from './HitList'
import { suggest } from './quickOpenMatch'
import { workspace } from './workspace'

export function QuickOpen({
  entries,
  onClose
}: {
  entries: VaultEntry[]
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const notes = useMemo(
    () =>
      entries
        .filter((entry) => entry.kind === 'note' || isHtmlPath(entry.path))
        .map((entry) => entry.path),
    [entries]
  )
  const recent = useMemo(() => workspace.recent(), [])
  const results = useMemo(() => suggest(notes, recent, query), [notes, recent, query])

  useEffect(() => input.current?.focus(), [])

  async function choose(path: VaultPath | undefined): Promise<void> {
    if (!path) return
    onClose()
    await workspace.open(path)
    document.querySelector<HTMLElement>('.cm-content')?.focus()
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      if (results.length) setSelected((selected + step + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void choose(results[selected]?.path)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="quick-open"
        role="dialog"
        aria-label="快速打开"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={input}
          role="combobox"
          aria-label="快速打开"
          aria-expanded="true"
          aria-controls="quick-open-results"
          aria-activedescendant={results.length ? `quick-open-${selected}` : undefined}
          placeholder="输入笔记名"
          value={query}
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          onKeyDown={keyDown}
        />
        <ul id="quick-open-results" role="listbox" aria-label="快速打开结果">
          {results.map((result, index) => (
            <li
              key={result.path}
              id={`quick-open-${index}`}
              role="option"
              aria-selected={index === selected}
              title={result.path}
              onMouseMove={() => setSelected(index)}
              onClick={() => void choose(result.path)}
            >
              <Highlighted text={result.label} ranges={result.match?.matches ?? []} />
            </li>
          ))}
        </ul>
        {results.length === 0 && (
          <div className="quick-open-empty">
            {query.trim() ? '没有匹配的笔记' : '没有最近打开的笔记'}
          </div>
        )}
      </div>
    </div>
  )
}
