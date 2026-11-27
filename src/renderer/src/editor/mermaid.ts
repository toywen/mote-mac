import { Decoration, WidgetType, type EditorView } from '@codemirror/view'
import type { Mermaid } from 'mermaid'
import { codeRenderers } from './code'
import type { Renderer } from './preview'
import './mermaid.css'

type Scheme = 'light' | 'dark'
type Drawing = { svg: string } | { error: string }
type Entry = { promise: Promise<Drawing>; done?: Drawing }

// Shown until the first drawing arrives, so the lines below move only once.
const PLACEHOLDER_HEIGHT = 160
const CACHE_LIMIT = 64

const darkScheme = matchMedia('(prefers-color-scheme: dark)')
const currentScheme = (): Scheme => {
  const theme = document.documentElement.dataset.theme
  if (theme === 'dark' || theme === 'light') return theme
  return darkScheme.matches ? 'dark' : 'light'
}

const DIAGRAM_FONT =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', sans-serif"

function themeVariables(scheme: Scheme): Record<string, string | boolean> {
  if (scheme === 'dark') {
    return {
      darkMode: true,
      background: 'transparent',
      fontFamily: DIAGRAM_FONT,
      primaryColor: '#25231f',
      primaryTextColor: '#e9e6de',
      primaryBorderColor: '#4a473f',
      lineColor: '#9d998d',
      secondaryColor: '#2f271c',
      tertiaryColor: '#1c1b18',
      clusterBkg: '#211f1b',
      clusterBorder: '#3b3831',
      edgeLabelBackground: '#1c1b18',
      nodeTextColor: '#e9e6de'
    }
  }
  return {
    darkMode: false,
    background: 'transparent',
    fontFamily: DIAGRAM_FONT,
    primaryColor: '#f5f3ec',
    primaryTextColor: '#1f1e1c',
    primaryBorderColor: '#c9c4b8',
    lineColor: '#6e6a63',
    secondaryColor: '#faf3e8',
    tertiaryColor: '#fcfbf8',
    clusterBkg: '#f7f5ef',
    clusterBorder: '#d5d0c5',
    edgeLabelBackground: '#fcfbf8',
    nodeTextColor: '#1f1e1c'
  }
}

// The library loads the first time a diagram is drawn, so a note without one never fetches it.
let library: Promise<Mermaid> | undefined
// mermaid.initialize sets the theme for the whole library, so drawings run one at a time.
let queue: Promise<unknown> = Promise.resolve()
let lastId = 0
const drawings = new Map<string, Entry>()

async function render(code: string, scheme: Scheme): Promise<Drawing> {
  const id = `mote-mermaid-${++lastId}`
  try {
    library ??= import('mermaid').then((module) => module.default)
    const mermaid = await library
    // Note text may come from a web clipping, so labels stay sanitized and scripts stay off.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      themeVariables: themeVariables(scheme)
    })
    return { svg: (await mermaid.render(id, code)).svg }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  } finally {
    // mermaid draws in a scratch element under body and may leave it behind after an error.
    document.getElementById(`d${id}`)?.remove()
  }
}

// One drawing per code text and color scheme, shared by every widget that shows it.
function drawing(code: string, scheme: Scheme): Entry {
  const key = `${scheme}\n${code}`
  const cached = drawings.get(key)
  if (cached) return cached
  const promise = queue.then(() => render(code, scheme))
  queue = promise
  const entry: Entry = { promise }
  void promise.then((done) => (entry.done = done))
  drawings.set(key, entry)
  if (drawings.size > CACHE_LIMIT) drawings.delete(drawings.keys().next().value!)
  return entry
}

function fill(box: HTMLElement, done: Drawing, code: string): void {
  box.classList.remove('mote-mermaid-pending')
  if ('svg' in done) {
    box.classList.remove('mote-mermaid-error')
    box.innerHTML = done.svg
    return
  }
  box.classList.add('mote-mermaid-error')
  const message = document.createElement('div')
  message.className = 'mote-mermaid-message'
  message.textContent = done.error
  const source = document.createElement('pre')
  source.textContent = code
  box.replaceChildren(message, source)
}

const schemeListeners = new WeakMap<HTMLElement, () => void>()

// A diagram in place of its code block. eq keeps the drawing while the note changes elsewhere,
// and the drawing follows the color scheme by itself.
class MermaidWidget extends WidgetType {
  constructor(readonly code: string) {
    super()
  }

  eq(other: MermaidWidget): boolean {
    return other.code === this.code
  }

  get estimatedHeight(): number {
    return PLACEHOLDER_HEIGHT
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div')
    box.className = 'mote-mermaid mote-mermaid-pending'
    box.style.minHeight = `${PLACEHOLDER_HEIGHT}px`
    let wanted = ''
    const show = (): void => {
      const scheme = currentScheme()
      const entry = drawing(this.code, scheme)
      wanted = scheme
      const draw = (done: Drawing): void => {
        fill(box, done, this.code)
        box.style.minHeight = ''
        view.requestMeasure()
      }
      if (entry.done) return draw(entry.done)
      // The old drawing stays until the new one is ready.
      void entry.promise.then((done) => {
        if (wanted === scheme) draw(done)
      })
    }
    show()
    darkScheme.addEventListener('change', show)
    const observer = new MutationObserver(show)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    schemeListeners.set(box, () => {
      darkScheme.removeEventListener('change', show)
      observer.disconnect()
    })
    return box
  }

  destroy(dom: HTMLElement): void {
    schemeListeners.get(dom)?.()
  }

  // A click puts the cursor at the block, which shows its source in live preview.
  ignoreEvent(): boolean {
    return false
  }
}

const fencedCode = codeRenderers.FencedCode

// A ```mermaid block that starts its line is drawn as a diagram while its source is hidden. Any
// other code block, and one inside a quote or a list item's marker line, stays a code block.
const mermaidCode: Renderer = (node, cx) => {
  const items = fencedCode(node, cx)
  const { doc } = cx.state
  const info = node.node.getChild('CodeInfo')
  if (!info || doc.sliceString(info.from, info.to).trim().split(/\s/)[0] !== 'mermaid') return items
  const first = doc.lineAt(node.from)
  if (!/^[ \t]*$/.test(doc.sliceString(first.from, node.from))) return items
  const text = node.node.getChild('CodeText')
  const code = text ? doc.sliceString(text.from, text.to) : ''
  const from = first.from
  const to = doc.lineAt(node.to).to
  const widget = Decoration.replace({ widget: new MermaidWidget(code), block: true })
  return items.map((item) => ({
    ...item,
    reveal: { from, to },
    concealed: [widget.range(from, to)],
    block: true
  }))
}

export const mermaidRenderers: Record<string, Renderer> = {
  FencedCode: mermaidCode
}
