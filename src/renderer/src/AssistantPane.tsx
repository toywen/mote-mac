import { ArrowUp, Check, ChevronDown, History, KeyRound, Plus, Square, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { AiMessage, AiScope, AiSettingsView, VaultInfo, VaultPath } from '../../core/ipc'
import type { LinkIndex } from '../../core/resolve'
import { dailyNotesIn, thisWeek } from '../../core/ai'
import { editorMode, linkContext } from './editor/livePreview'
import { noteView } from './editor/noteView'
import { editorLocked } from './editor/tasks'
import { MenuLayer } from './MenuLayer'
import type { Doc } from './workspace'
import { workspace } from './workspace'
import './assistant.css'

type ScopeKind = 'note' | 'week' | 'range'

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

type MenuAt = { kind: 'scope' | 'history'; rect: DOMRect }

type Links = { index: LinkIndex; config: VaultInfo['config'] } | null

const noteName = (path: VaultPath): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
const shortDate = (date: string): string => date.slice(5)
const hasText = (doc: Doc | null): doc is Doc & { text: string } => !!doc && 'text' in doc

// The main editor, not a nested view or an answer: it is the one directly in .editor-content.
function mainEditor(): EditorView | null {
  const el = document.querySelector('.editor-content > .cm-editor')
  return el ? EditorView.findFromDOM(el as HTMLElement) : null
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
  const [menu, setMenu] = useState<MenuAt | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const noteOpen = hasText(doc)
  // Null until you pick one: then it reads the open note, or this week when no note is open.
  const [scopeKind, setScopeKind] = useState<ScopeKind | null>(null)
  const week = useMemo(() => thisWeek(new Date()), [])
  const [range, setRange] = useState(week)
  const chat = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const streaming = chats.flatMap((c) => c.turns).find((t) => t.state === 'streaming')

  useEffect(() => {
    void window.mote.getAiSettings().then(setSettings)
  }, [])

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
        setChats((all) => all.map((chat) => ({ ...chat, turns: chat.turns.map(apply) })))
      }),
    []
  )

  // Follows the answer down while it streams, unless you scrolled up to read.
  const pinned = useRef(true)
  useEffect(() => {
    const el = chat.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [turns])

  const notes = useMemo(
    () => vault.entries.filter((e) => e.kind === 'note').map((e) => e.path),
    [vault.entries]
  )
  const kind: ScopeKind =
    scopeKind === null || (scopeKind === 'note' && !noteOpen)
      ? noteOpen
        ? 'note'
        : 'week'
      : scopeKind
  const dates = kind === 'range' ? range : week
  const dailyCount = useMemo(
    () => dailyNotesIn(notes, vault.config.daily.folder, dates.from, dates.to).length,
    [notes, vault.config.daily.folder, dates.from, dates.to]
  )
  const scopeLabel =
    kind === 'note' && noteOpen
      ? `这篇笔记 · ${noteName(doc.path)}`
      : `${kind === 'week' ? '本周日记' : `${shortDate(dates.from)} → ${shortDate(dates.to)}`} · ${dailyCount} 篇`

  function scopeFor(target: ScopeKind): AiScope | null {
    if (target === 'note')
      return hasText(doc) ? { kind: 'note', path: doc.path, text: doc.text } : null
    const { from, to } = target === 'range' ? range : week
    return { kind: 'daily', from, to }
  }

  function ask(text: string, target: ScopeKind = kind): void {
    const q = text.trim()
    const scope = scopeFor(target)
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
      all.map((chat) => (chat.id === chatNow.id ? { ...chat, turns: [...chat.turns, turn] } : chat))
    )
    setQuestion('')
    pinned.current = true
    void window.mote.aiAsk({
      id,
      dir: vault.dir,
      scope,
      messages: [...history, { role: 'user', content: q }]
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

  const openMenu = (kind: MenuAt['kind'], el: HTMLElement): void =>
    setMenu({ kind, rect: el.getBoundingClientRect() })
  const past = chats.filter((c) => c.turns.length).reverse()

  return (
    <aside className="pane assistant" aria-label="助手" hidden={hidden}>
      <header className="assistant-header">
        <h2>助手</h2>
        <span className="assistant-grow" />
        {settings?.hasKey && (
          <>
            <button
              className="icon-button"
              type="button"
              title="对话历史"
              aria-label="对话历史"
              aria-expanded={menu?.kind === 'history'}
              disabled={!past.length}
              onClick={(e) => openMenu('history', e.currentTarget)}
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
            <button
              className="icon-button"
              type="button"
              title="更换 API key"
              aria-label="更换 API key"
              onClick={() => void window.mote.clearAiKey().then(setSettings)}
            >
              <KeyRound size={14} />
            </button>
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

      {settings && !settings.hasKey ? (
        <form
          className="assistant-key"
          onSubmit={(e) => {
            e.preventDefault()
            void saveKey()
          }}
        >
          <p className="assistant-key-lead">助手用 DeepSeek 读你的笔记。先填一个 API key。</p>
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
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
            }}
          >
            {!turns.length && (
              <div className="assistant-empty">
                <p>问问你的笔记。</p>
                {noteOpen && (
                  <button type="button" onClick={() => ask('总结这篇笔记', 'note')}>
                    总结这篇笔记
                  </button>
                )}
                <button type="button" onClick={() => ask('这一周我都做了什么？', 'week')}>
                  这一周我都做了什么？
                </button>
                <button type="button" onClick={() => ask('这一周还有哪些没做完的事？', 'week')}>
                  这一周还有哪些没做完的事？
                </button>
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
            <button
              type="button"
              className="assistant-scope"
              aria-label={`范围：${scopeLabel}`}
              aria-expanded={menu?.kind === 'scope'}
              onClick={(e) => openMenu('scope', e.currentTarget)}
            >
              <span className="assistant-scope-text">{scopeLabel}</span>
              <ChevronDown size={12} />
            </button>
            <div className="assistant-ask">
              <textarea
                ref={input}
                rows={1}
                aria-label="问助手"
                placeholder={
                  kind === 'note'
                    ? '问这篇笔记，或说「总结一下」'
                    : '问这几天的日记，或说「总结一下」'
                }
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                }}
                onKeyDown={(e) => {
                  // Enter that confirms a Chinese input method's candidate is not a send.
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    ask(question)
                  }
                }}
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
                  disabled={
                    !question.trim() ||
                    (kind === 'week' || kind === 'range' ? dailyCount === 0 : false)
                  }
                  onClick={() => ask(question)}
                >
                  <ArrowUp size={14} strokeWidth={2} />
                </button>
              )}
            </div>
          </footer>
        </>
      )}

      {menu?.kind === 'scope' && (
        <MenuLayer onClose={closeMenu}>
          <div
            className="context-menu assistant-menu"
            role="menu"
            aria-label="范围"
            style={{ left: menu.rect.left, bottom: window.innerHeight - menu.rect.top + 6 }}
          >
            {noteOpen && (
              <ScopeItem
                on={kind === 'note'}
                label="这篇笔记"
                hint={noteName(doc.path)}
                onClick={() => {
                  setScopeKind('note')
                  closeMenu()
                }}
              />
            )}
            <ScopeItem
              on={kind === 'week'}
              label="本周日记"
              hint={`${shortDate(week.from)} → ${shortDate(week.to)}`}
              onClick={() => {
                setScopeKind('week')
                closeMenu()
              }}
            />
            <ScopeItem on={kind === 'range'} label="选日期" onClick={() => setScopeKind('range')} />
            {kind === 'range' && (
              <div className="assistant-range">
                <input
                  type="date"
                  aria-label="开始日期"
                  value={range.from}
                  max={range.to}
                  onChange={(e) =>
                    e.target.value && setRange((r) => ({ ...r, from: e.target.value }))
                  }
                />
                <span>→</span>
                <input
                  type="date"
                  aria-label="结束日期"
                  value={range.to}
                  min={range.from}
                  onChange={(e) =>
                    e.target.value && setRange((r) => ({ ...r, to: e.target.value }))
                  }
                />
              </div>
            )}
          </div>
        </MenuLayer>
      )}

      {menu?.kind === 'history' && (
        <MenuLayer onClose={closeMenu}>
          <div
            className="context-menu assistant-menu assistant-history"
            role="menu"
            aria-label="对话历史"
            style={{ top: menu.rect.bottom + 4, right: window.innerWidth - menu.rect.right }}
          >
            {past.map((chat) => (
              <ScopeItem
                key={chat.id}
                on={chat.id === chatNow.id}
                label={chat.turns[0].question}
                hint={clock(chat.startedAt)}
                onClick={() => {
                  setChatId(chat.id)
                  closeMenu()
                }}
              />
            ))}
          </div>
        </MenuLayer>
      )}
    </aside>
  )
}

function ScopeItem(props: {
  on: boolean
  label: string
  hint?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.on}
      className="context-menu-item"
      onClick={props.onClick}
    >
      <Check size={13} strokeWidth={2} style={{ visibility: props.on ? 'visible' : 'hidden' }} />
      <span className="context-menu-label">{props.label}</span>
      {props.hint && <span className="context-menu-shortcut">{props.hint}</span>}
    </button>
  )
}

// What the answer read: a count you can open into the list of notes.
function Sources({ turn }: { turn: Turn }): React.JSX.Element | null {
  if (!turn.sources) return null
  const chars = turn.sources.reduce((sum, s) => sum + s.chars, 0)
  return (
    <details className="assistant-sources">
      <summary>
        读了 {turn.sources.length} 篇 · {chars.toLocaleString('en-US')} 字
      </summary>
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
