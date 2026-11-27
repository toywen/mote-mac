import {
  ArrowUp,
  AtSign,
  Calendar,
  Check,
  FileText,
  Folder,
  Hash,
  History,
  KeyRound,
  Library,
  Plus,
  Search,
  Square,
  X
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type {
  AiMessage,
  AiScope,
  AiScopeItem,
  AiSettingsView,
  AiTagSummary,
  VaultInfo,
  VaultPath
} from '../../core/ipc'
import type { LinkIndex } from '../../core/resolve'
import { dailyNotesIn, thisWeek } from '../../core/ai'
import { editorMode, linkContext } from './editor/livePreview'
import { noteView } from './editor/noteView'
import { editorLocked } from './editor/tasks'
import { MenuLayer } from './MenuLayer'
import type { Doc } from './workspace'
import { workspace } from './workspace'
import './assistant.css'

type Pin =
  | { kind: 'note'; path: VaultPath; label: string }
  | { kind: 'folder'; path: VaultPath; label: string }
  | { kind: 'tag'; tag: string; label: string }
  | { kind: 'week'; label: string }
  | { kind: 'vault'; label: string }

type Candidate = {
  id: string
  section: '常用范围' | '文件夹' | '标签' | '笔记'
  pin: Pin
  hint: string
  searchText: string
}

// One question and its answer.
type Turn = {
  id: string
  question: string
  sources: { path: VaultPath; chars: number }[] | null
  answer: string
  state: 'streaming' | 'done' | 'error'
  error?: string
}

// The conversations live here, in the window, and are gone when the window closes; nothing about
// them is written anywhere. A new one leaves the others in the history.
type Chat = { id: string; startedAt: number; turns: Turn[] }

const newChat = (): Chat => ({ id: crypto.randomUUID(), startedAt: Date.now(), turns: [] })

const clock = (time: number): string =>
  new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

type Links = { index: LinkIndex; config: VaultInfo['config'] } | null

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
const noteName = (path: VaultPath): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
const parentFolder = (path: VaultPath): string => {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '根目录' : path.slice(0, slash)
}
const hasText = (doc: Doc | null): doc is Doc & { text: string } => !!doc && 'text' in doc

// The main editor, not a nested view or an answer: it is the one directly in .editor-content.
function mainEditor(): EditorView | null {
  const el = document.querySelector('.editor-content > .cm-editor')
  return el ? EditorView.findFromDOM(el as HTMLElement) : null
}

function samePin(a: Pin, b: Pin): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'note':
      return a.path === (b as typeof a).path
    case 'folder':
      return a.path === (b as typeof a).path
    case 'tag':
      return a.tag.toLowerCase() === (b as typeof a).tag.toLowerCase()
    case 'week':
    case 'vault':
      return true
  }
}

function PinIcon({ kind, size = 13 }: { kind: Pin['kind']; size?: number }): React.JSX.Element {
  switch (kind) {
    case 'folder':
      return <Folder size={size} strokeWidth={1.75} />
    case 'tag':
      return <Hash size={size} strokeWidth={1.75} />
    case 'week':
      return <Calendar size={size} strokeWidth={1.75} />
    case 'vault':
      return <Library size={size} strokeWidth={1.75} />
    case 'note':
      return <FileText size={size} strokeWidth={1.75} />
  }
}

export function AssistantPane(props: {
  vault: VaultInfo
  doc: Doc | null
  links: Links
  hidden: boolean
  onClose: () => void
}): React.JSX.Element {
  const { vault, doc, links, hidden, onClose } = props
  const [settings, setSettings] = useState<AiSettingsView | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyError, setKeyError] = useState('')
  const [chats, setChats] = useState<Chat[]>(() => [newChat()])
  const [chatId, setChatId] = useState(() => chats[0].id)
  const chatNow = chats.find((c) => c.id === chatId) ?? chats[0]
  const turns = chatNow.turns
  const [question, setQuestion] = useState('')
  const [pins, setPins] = useState<Pin[]>([])
  const [tags, setTags] = useState<AiTagSummary[]>([])
  const [pickerMode, setPickerMode] = useState<'button' | 'at' | null>(null)
  const [query, setQuery] = useState('')
  const [focusIdx, setFocusIdx] = useState(0)
  const [focusNonce, setFocusNonce] = useState(0)
  const [historyRect, setHistoryRect] = useState<DOMRect | null>(null)
  const closeHistory = useCallback(() => setHistoryRect(null), [])

  const noteOpen = hasText(doc)
  const week = useMemo(() => thisWeek(new Date()), [])
  const chat = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const addRefBtn = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const streaming = chats.flatMap((c) => c.turns).find((t) => t.state === 'streaming')

  useEffect(() => {
    void window.mote.getAiSettings().then(setSettings)
  }, [])

  useEffect(() => {
    let alive = true
    const refreshTags = (): void => {
      void window.mote.listTags(vault.dir).then((next) => {
        if (alive) setTags(next)
      })
    }
    refreshTags()
    const off = window.mote.onVaultChanged((change) => {
      if (change.dir === vault.dir) refreshTags()
    })
    return () => {
      alive = false
      off()
    }
  }, [vault.dir])

  useEffect(
    () =>
      window.mote.onAiEvent((event) => {
        const apply = (turn: Turn): Turn => {
          if (turn.id !== event.id) return turn
          switch (event.kind) {
            case 'sources':
              return { ...turn, sources: event.sources }
            case 'delta':
              return { ...turn, answer: turn.answer + event.text }
            case 'done':
              return { ...turn, state: 'done' }
            case 'error':
              return { ...turn, state: 'error', error: event.message }
          }
        }
        setChats((all) => all.map((c) => ({ ...c, turns: c.turns.map(apply) })))
      }),
    []
  )

  // Close the @ popover on outside click.
  useEffect(() => {
    if (!pickerMode) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (pickerRef.current?.contains(target) || addRefBtn.current?.contains(target)) return
      setPickerMode(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerMode])

  // Follows the answer down while it streams, unless you scrolled up to read.
  const pinnedScroll = useRef(true)
  useEffect(() => {
    const el = chat.current
    if (el && pinnedScroll.current) el.scrollTop = el.scrollHeight
  }, [turns])

  const notes = useMemo(
    () =>
      vault.entries
        .filter((e) => e.kind === 'note' && !e.path.startsWith('.'))
        .map((e) => e.path)
        .sort((a, b) => collator.compare(a, b)),
    [vault.entries]
  )
  const folders = useMemo(
    () =>
      vault.entries
        .filter((e) => e.kind === 'folder' && !e.path.startsWith('.'))
        .map((e) => e.path)
        .sort((a, b) => collator.compare(a, b)),
    [vault.entries]
  )
  const dailyCount = useMemo(
    () => dailyNotesIn(notes, vault.config.daily.folder, week.from, week.to).length,
    [notes, vault.config.daily.folder, week.from, week.to]
  )

  const openPath = noteOpen ? doc.path : null
  const candidates = useMemo<Candidate[]>(() => {
    const all: Candidate[] = []
    if (openPath) {
      const title = noteName(openPath)
      all.push({
        id: `quick-note:${openPath}`,
        section: '常用范围',
        pin: { kind: 'note', path: openPath, label: title },
        hint: '这篇笔记',
        searchText: `这篇笔记 当前笔记 ${title} ${openPath}`.toLowerCase()
      })
    }
    all.push({
      id: 'quick-vault',
      section: '常用范围',
      pin: { kind: 'vault', label: '整个笔记库' },
      hint: `${notes.length} 篇`,
      searchText: `整个笔记库 全库 all vault`.toLowerCase()
    })
    all.push({
      id: 'quick-week',
      section: '常用范围',
      pin: { kind: 'week', label: '本周日记' },
      hint: `${dailyCount} 篇`,
      searchText: `本周日记 日记 daily week`.toLowerCase()
    })

    for (const folder of folders) {
      const prefix = `${folder}/`
      const count = notes.filter((n) => n.startsWith(prefix)).length
      all.push({
        id: `folder:${folder}`,
        section: '文件夹',
        pin: { kind: 'folder', path: folder, label: prefix },
        hint: `${count} 篇`,
        searchText: `${folder} ${prefix} 文件夹 folder`.toLowerCase()
      })
    }

    for (const t of tags) {
      all.push({
        id: `tag:${t.tag.toLowerCase()}`,
        section: '标签',
        pin: { kind: 'tag', tag: t.tag, label: t.tag.slice(1) },
        hint: `${t.count} 篇`,
        searchText: `${t.tag} ${t.tag.slice(1)} 标签 tag`.toLowerCase()
      })
    }

    for (const path of notes) {
      const title = noteName(path)
      const folder = parentFolder(path)
      all.push({
        id: `note:${path}`,
        section: '笔记',
        pin: { kind: 'note', path, label: title },
        hint: folder,
        searchText: `${title} ${path} ${folder}`.toLowerCase()
      })
    }

    const q = query
      .trim()
      .replace(/^[#@]+/, '')
      .toLowerCase()
    if (!q) return all
    return all.filter((c) => c.searchText.includes(q))
  }, [openPath, notes, folders, tags, dailyCount, query])

  const groupedCandidates = useMemo(() => {
    const groups: {
      title: Candidate['section']
      items: { candidate: Candidate; idx: number }[]
    }[] = []
    const bySection = new Map<Candidate['section'], { candidate: Candidate; idx: number }[]>()
    candidates.forEach((candidate, idx) => {
      const bucket = bySection.get(candidate.section)
      if (bucket) bucket.push({ candidate, idx })
      else {
        const created = [{ candidate, idx }]
        bySection.set(candidate.section, created)
        groups.push({ title: candidate.section, items: created })
      }
    })
    return groups
  }, [candidates])

  const activeFocusIdx = candidates.length ? Math.min(focusIdx, candidates.length - 1) : 0

  useEffect(() => {
    if (!pickerMode) return
    const active = listRef.current?.querySelector<HTMLElement>('[data-focused="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeFocusIdx, pickerMode])

  useEffect(() => {
    if (focusNonce > 0) input.current?.focus()
  }, [focusNonce])

  function scopeFor(override?: AiScope): AiScope | null {
    if (override) return override
    if (pins.length > 0) {
      const items: AiScopeItem[] = pins.map((pin) => {
        switch (pin.kind) {
          case 'note':
            return { kind: 'note', path: pin.path }
          case 'folder':
            return { kind: 'folder', path: pin.path }
          case 'tag':
            return { kind: 'tag', tag: pin.tag }
          case 'week':
            return { kind: 'daily', from: week.from, to: week.to }
          case 'vault':
            return { kind: 'vault' }
        }
      })
      return {
        kind: 'pick',
        items,
        openNote: noteOpen ? { path: doc.path, text: doc.text } : undefined
      }
    }
    if (noteOpen) return { kind: 'note', path: doc.path, text: doc.text }
    if (!notes.length) return null
    return { kind: 'pick', items: [{ kind: 'vault' }] }
  }

  function ask(text: string, override?: AiScope): void {
    const q = text.trim()
    const scope = scopeFor(override)
    if (!q || !scope || streaming) return
    const history: AiMessage[] = turns
      .filter((t) => t.state === 'done' && t.answer)
      .flatMap((t) => [
        { role: 'user' as const, content: t.question },
        { role: 'assistant' as const, content: t.answer }
      ])
    const id = crypto.randomUUID()
    const turn: Turn = { id, question: q, sources: null, answer: '', state: 'streaming' }
    setChats((all) =>
      all.map((c) => (c.id === chatNow.id ? { ...c, turns: [...c.turns, turn] } : c))
    )
    setQuestion('')
    setPickerMode(null)
    setQuery('')
    if (input.current) input.current.style.height = 'auto'
    pinnedScroll.current = true
    void window.mote.aiAsk({
      id,
      dir: vault.dir,
      scope,
      messages: [...history, { role: 'user', content: q }]
    })
  }

  const pickCandidate = useCallback(
    (candidate: Candidate | undefined): void => {
      if (!candidate) return
      setPins((prev) => {
        const exists = prev.some((p) => samePin(p, candidate.pin))
        return exists ? prev.filter((p) => !samePin(p, candidate.pin)) : [...prev, candidate.pin]
      })
      if (pickerMode === 'at') {
        setQuestion((prev) =>
          prev.replace(/(?:^|\s)@[^\s@]*$/, (m) => (m.startsWith(' ') ? ' ' : ''))
        )
      }
      setPickerMode(null)
      setQuery('')
      setFocusIdx(0)
      setFocusNonce((n) => n + 1)
    },
    [pickerMode]
  )

  function moveFocus(step: number): void {
    if (!candidates.length) return
    setFocusIdx((idx) => {
      const base = Math.min(idx, candidates.length - 1)
      return (base + step + candidates.length) % candidates.length
    })
  }

  async function saveKey(): Promise<void> {
    if (!keyDraft.trim()) return
    try {
      setSettings(await window.mote.setAiKey(keyDraft))
      setKeyDraft('')
      setKeyError('')
    } catch {
      setKeyError('系统钥匙串不可用，无法保存 API key')
    }
  }

  function insert(answer: string): void {
    const view = mainEditor()
    if (!view) return
    const { from, to } = view.state.selection.main
    const content = view.state.doc
    // The answer goes in as its own paragraphs, with one blank line on each side.
    const lead = content.sliceString(Math.max(0, from - 2), from)
    const before = from === 0 || lead === '\n\n' ? '' : lead.endsWith('\n') ? '\n' : '\n\n'
    const after = to === content.length ? '\n' : '\n\n'
    const text = before + answer.trim() + after
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true
    })
    view.focus()
  }

  const canInsert = noteOpen && doc.kind !== 'conflict'

  // An empty conversation is reused, so the history holds only ones with a question in them.
  function startChat(): void {
    if (!turns.length) return
    const next = newChat()
    setChats((all) => [...all.filter((c) => c.turns.length), next])
    setChatId(next.id)
    input.current?.focus()
  }

  function openPickerFromButton(): void {
    if (pickerMode) {
      setPickerMode(null)
      return
    }
    setPickerMode('button')
    setQuery('')
    setFocusIdx(0)
    requestAnimationFrame(() => searchInput.current?.focus())
  }

  function handleSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>): void {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveFocus(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveFocus(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pickCandidate(candidates[activeFocusIdx])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setPickerMode(null)
      input.current?.focus()
    }
  }

  function handleInputKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (e.nativeEvent.isComposing) return
    if (pickerMode) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveFocus(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveFocus(-1)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        pickCandidate(candidates[activeFocusIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setPickerMode(null)
        return
      }
    }
    if (e.key === 'Backspace' && !question && pins.length > 0) {
      setPins((prev) => prev.slice(0, -1))
      return
    }
    // Enter that confirms a Chinese input method's candidate is not a send.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ask(question)
    }
  }

  const past = chats.filter((c) => c.turns.length).reverse()
  const fallbackHint = noteOpen
    ? `未固定 · 默认读这篇笔记`
    : notes.length
      ? `未固定 · 默认读整个笔记库`
      : `笔记库还没有笔记`

  const placeholder =
    pins.length > 0
      ? '针对已选内容提问，或输入 @ 继续添加…'
      : noteOpen
        ? '问这篇笔记，或输入 @ 引用文件夹、笔记、标签…'
        : '问整个笔记库，或输入 @ 引用文件夹、笔记、标签…'

  return (
    <aside className="pane assistant" aria-label="助手" hidden={hidden}>
      <header className="assistant-header">
        <h2>助手</h2>
        <span className="assistant-grow" />
        {settings?.keySource && (
          <>
            <button
              className="icon-button"
              type="button"
              title="对话历史"
              aria-label="对话历史"
              aria-expanded={!!historyRect}
              disabled={!past.length}
              onClick={(e) => setHistoryRect(e.currentTarget.getBoundingClientRect())}
            >
              <History size={14} />
            </button>
            <button
              className="icon-button"
              type="button"
              title="新的对话"
              aria-label="新的对话"
              disabled={!turns.length}
              onClick={startChat}
            >
              <Plus size={15} />
            </button>
            {settings.keySource === 'saved' && (
              <button
                className="icon-button"
                type="button"
                title="更换 API key"
                aria-label="更换 API key"
                onClick={() => void window.mote.clearAiKey().then(setSettings)}
              >
                <KeyRound size={14} />
              </button>
            )}
          </>
        )}
        <button
          className="icon-button"
          type="button"
          title="关闭助手（⇧⌘A）"
          aria-label="关闭助手"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>

      {settings && !settings.keySource ? (
        <form
          className="assistant-key"
          onSubmit={(e) => {
            e.preventDefault()
            void saveKey()
          }}
        >
          <p className="assistant-key-lead">
            助手用 DeepSeek 读你的笔记。在 shell 配置里设好环境变量 DEEPSEEK_API_KEY 后重开
            mote，或者在这里填一个 API key。
          </p>
          <label htmlFor="assistant-key-input">DeepSeek API key</label>
          <input
            id="assistant-key-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
          />
          {keyError && <p className="assistant-error">{keyError}</p>}
          <button className="assistant-primary" type="submit" disabled={!keyDraft.trim()}>
            保存
          </button>
          <p className="assistant-note">
            key 用系统钥匙串加密，只存在这台电脑上。提问时，你选的笔记全文会发给 DeepSeek。
          </p>
          <button
            type="button"
            className="assistant-link"
            onClick={() => void window.mote.openExternal('https://platform.deepseek.com/api_keys')}
          >
            去 DeepSeek 申请 key
          </button>
        </form>
      ) : (
        <>
          <div
            className="assistant-chat"
            ref={chat}
            onScroll={(e) => {
              const el = e.currentTarget
              pinnedScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
            }}
          >
            {!turns.length && (
              <div className="assistant-empty">
                <p>问问你的笔记。</p>
                {pins.length > 0 ? (
                  <>
                    <button type="button" onClick={() => ask('总结已选范围的核心要点')}>
                      总结已选范围的核心要点
                    </button>
                    <button type="button" onClick={() => ask('已选内容里还有哪些没做完的事？')}>
                      已选内容里还有哪些没做完的事？
                    </button>
                  </>
                ) : noteOpen ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        ask('总结这篇笔记', { kind: 'note', path: doc.path, text: doc.text })
                      }
                    >
                      总结这篇笔记
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        ask('这篇笔记里还有哪些没做完的事？', {
                          kind: 'note',
                          path: doc.path,
                          text: doc.text
                        })
                      }
                    >
                      这篇笔记里还有哪些没做完的事？
                    </button>
                  </>
                ) : (
                  <>
                    {notes.length > 0 && (
                      <button type="button" onClick={() => ask('笔记库里还有哪些没做完的事？')}>
                        笔记库里还有哪些没做完的事？
                      </button>
                    )}
                    {dailyCount > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          ask('这一周我都做了什么？', {
                            kind: 'daily',
                            from: week.from,
                            to: week.to
                          })
                        }
                      >
                        这一周我都做了什么？
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {turns.map((turn) => (
              <section className="assistant-turn" key={turn.id}>
                <div className="assistant-question">{turn.question}</div>
                <Sources turn={turn} />
                {turn.answer && <Answer text={turn.answer} links={links} sources={turn.sources} />}
                {turn.state === 'streaming' && !turn.answer && (
                  <div className="assistant-wait">{turn.sources ? '正在写…' : '正在读笔记…'}</div>
                )}
                {turn.state === 'error' && (
                  <p className="assistant-error" role="alert">
                    {turn.error}
                  </p>
                )}
                {turn.state === 'done' && turn.answer && (
                  <div className="assistant-actions">
                    <button
                      type="button"
                      disabled={!canInsert}
                      title={canInsert ? '插入到当前笔记的光标处' : '先打开一篇笔记'}
                      onClick={() => insert(turn.answer)}
                    >
                      插入到笔记
                    </button>
                    <CopyButton text={turn.answer} />
                  </div>
                )}
              </section>
            ))}
          </div>

          <footer className="assistant-composer">
            {pickerMode && (
              <div
                ref={pickerRef}
                className="assistant-picker"
                role="listbox"
                aria-label="引用笔记、文件夹或标签"
              >
                {pickerMode === 'button' && (
                  <div className="assistant-picker-search">
                    <Search size={13} strokeWidth={1.75} />
                    <input
                      ref={searchInput}
                      type="text"
                      placeholder="筛选文件夹、笔记或标签…"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value)
                        setFocusIdx(0)
                      }}
                      onKeyDown={handleSearchKeyDown}
                    />
                  </div>
                )}
                <div className="assistant-picker-list" ref={listRef}>
                  {groupedCandidates.length ? (
                    groupedCandidates.map((group) => (
                      <div key={group.title}>
                        <div className="assistant-picker-section">{group.title}</div>
                        {group.items.map(({ candidate, idx }) => {
                          const selected = pins.some((p) => samePin(p, candidate.pin))
                          return (
                            <button
                              key={candidate.id}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              data-active={selected}
                              data-focused={idx === activeFocusIdx}
                              className="assistant-picker-item"
                              onMouseMove={() => setFocusIdx(idx)}
                              onClick={() => pickCandidate(candidate)}
                            >
                              <span className="assistant-picker-icon">
                                <PinIcon kind={candidate.pin.kind} size={13} />
                              </span>
                              <span className="assistant-picker-label">{candidate.pin.label}</span>
                              <span className="assistant-picker-hint">
                                {selected ? <Check size={13} strokeWidth={2} /> : candidate.hint}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    ))
                  ) : (
                    <div className="assistant-picker-empty">没有匹配的笔记、文件夹或标签</div>
                  )}
                </div>
                <div className="assistant-picker-foot">
                  <span>↑↓ 选择 · ↩ 添加 · Esc 关闭</span>
                  <span>{candidates.length} 项</span>
                </div>
              </div>
            )}

            <div className="assistant-context-bar">
              {pins.map((pin, idx) => (
                <span className="assistant-chip" key={`${pin.kind}:${pin.label}:${idx}`}>
                  <span className="assistant-chip-icon">
                    <PinIcon kind={pin.kind} size={12} />
                  </span>
                  <span className="assistant-chip-name">{pin.label}</span>
                  <button
                    type="button"
                    className="assistant-chip-remove"
                    aria-label={`移除 ${pin.label}`}
                    onClick={() => setPins((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <X size={10} strokeWidth={2} />
                  </button>
                </span>
              ))}
              <button
                ref={addRefBtn}
                type="button"
                className="assistant-add-ref"
                aria-label="引用笔记、文件夹或标签"
                aria-expanded={!!pickerMode}
                onClick={openPickerFromButton}
              >
                <AtSign size={12} strokeWidth={1.85} />
                <span>引用</span>
              </button>
              {pins.length === 0 && <span className="assistant-default-hint">{fallbackHint}</span>}
            </div>

            <div className="assistant-ask">
              <textarea
                ref={input}
                rows={1}
                aria-label="问助手"
                placeholder={placeholder}
                value={question}
                onChange={(e) => {
                  const val = e.target.value
                  setQuestion(val)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                  const match = /(?:^|\s)@([^\s@]*)$/.exec(val)
                  if (match) {
                    setPickerMode('at')
                    setQuery(match[1])
                    setFocusIdx(0)
                  } else if (pickerMode === 'at') {
                    setPickerMode(null)
                    setQuery('')
                  }
                }}
                onKeyDown={handleInputKeyDown}
              />
              {streaming ? (
                <button
                  className="assistant-send"
                  type="button"
                  title="停止"
                  aria-label="停止"
                  onClick={() => window.mote.aiCancel(streaming.id)}
                >
                  <Square size={11} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="assistant-send"
                  type="button"
                  title="发送（↩）"
                  aria-label="发送"
                  disabled={!question.trim() || (!noteOpen && !pins.length && !notes.length)}
                  onClick={() => ask(question)}
                >
                  <ArrowUp size={14} strokeWidth={2} />
                </button>
              )}
            </div>
          </footer>
        </>
      )}

      {historyRect && (
        <MenuLayer onClose={closeHistory}>
          <div
            className="context-menu assistant-menu assistant-history"
            role="menu"
            aria-label="对话历史"
            style={{ top: historyRect.bottom + 4, right: window.innerWidth - historyRect.right }}
          >
            {past.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitemradio"
                aria-checked={c.id === chatNow.id}
                className="context-menu-item"
                onClick={() => {
                  setChatId(c.id)
                  closeHistory()
                }}
              >
                <Check
                  size={13}
                  strokeWidth={2}
                  style={{ visibility: c.id === chatNow.id ? 'visible' : 'hidden' }}
                />
                <span className="context-menu-label">{c.turns[0].question}</span>
                <span className="context-menu-shortcut">{clock(c.startedAt)}</span>
              </button>
            ))}
          </div>
        </MenuLayer>
      )}
    </aside>
  )
}

// What the answer read: a count you can open into the list of notes.
function Sources({ turn }: { turn: Turn }): React.JSX.Element | null {
  if (!turn.sources) return null
  return (
    <details className="assistant-sources">
      <summary>读了 {turn.sources.length} 篇</summary>
      <ul>
        {turn.sources.map((s) => (
          <li key={s.path}>
            <button type="button" onClick={() => void workspace.open(s.path)}>
              {noteName(s.path)}
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

// The answer is Markdown, drawn by the same read-only note view an embed uses, so its links
// resolve and open like links in a note.
function Answer(props: {
  text: string
  links: Links
  sources: Turn['sources']
}): React.JSX.Element {
  const { text, links, sources } = props
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const from = sources?.[0]?.path

  useEffect(() => {
    if (!host.current) return
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          noteView(),
          links && from ? linkContext.of({ ...links, path: from }) : [],
          editorMode.of('reading'),
          editorLocked.of(true),
          EditorView.editable.of(false),
          EditorState.readOnly.of(true)
        ]
      })
    })
    return () => view.current?.destroy()
    // The view is built once per answer; text changes go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, from])

  useEffect(() => {
    const v = view.current
    if (!v) return
    const current = v.state.doc.toString()
    if (current === text) return
    v.dispatch(
      text.startsWith(current)
        ? { changes: { from: current.length, insert: text.slice(current.length) } }
        : { changes: { from: 0, to: current.length, insert: text } }
    )
  }, [text])

  return <div className="assistant-answer" ref={host} />
}

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text.trim()).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        })
      }}
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}
