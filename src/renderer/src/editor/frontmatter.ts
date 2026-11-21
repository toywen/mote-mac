import { Decoration, WidgetType, type EditorView } from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'
import YAML from 'yaml'
import { hidden, type PreviewContext, type PreviewItem, type Renderer } from './preview'
import './frontmatter.css'

export type PropertyData = Record<string, unknown>

export function parseYamlProperties(text: string): PropertyData | null {
  try {
    const clean = text.replace(/^---\r?\n/, '').replace(/\r?\n---\s*$/, '')
    const parsed = YAML.parse(clean)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as PropertyData
    }
  } catch {
    // Fall back on invalid YAML
  }
  return null
}

export class PropertyCardWidget extends WidgetType {
  constructor(
    readonly rawYaml: string,
    readonly props: PropertyData,
    readonly from: number,
    readonly to: number
  ) {
    super()
  }

  get estimatedHeight(): number {
    return 36
  }

  eq(other: PropertyCardWidget): boolean {
    return other.rawYaml === this.rawYaml
  }

  toDOM(view: EditorView): HTMLElement {
    const card = document.createElement('div')
    card.className = 'fm-foldable-card'
    card.setAttribute('role', 'region')
    card.setAttribute('aria-label', '文档属性')

    const summary = document.createElement('div')
    summary.className = 'fm-card-summary'

    const badges = document.createElement('div')
    badges.className = 'fm-card-badges'

    const entries = Object.entries(this.props)
    const count = entries.length

    // Render key summary chips
    for (const [key, val] of entries) {
      const lower = key.toLowerCase()
      if (lower.includes('cat') || lower === 'folder') {
        const span = document.createElement('span')
        span.className = 'fm-chip fm-chip-link'
        span.textContent = `📁 ${String(val)}`
        badges.append(span)
      } else if (lower === 'status' || lower === 'state') {
        const span = document.createElement('span')
        span.className = 'fm-chip fm-chip-status'
        const dot = document.createElement('i')
        dot.className = 'fm-status-dot'
        span.append(dot, ` ${String(val)}`)
        badges.append(span)
      } else if (lower === 'tag' || lower === 'tags') {
        const tagList = Array.isArray(val) ? val : [val]
        for (const t of tagList) {
          const span = document.createElement('span')
          span.className = 'fm-chip fm-chip-tag'
          span.textContent = `#${String(t)}`
          badges.append(span)
        }
      } else if (lower.includes('date') || lower === 'schedule' || lower === 'time') {
        const span = document.createElement('span')
        span.className = 'fm-chip fm-chip-date'
        span.textContent = String(val)
        badges.append(span)
      }
    }

    if (badges.children.length === 0) {
      for (const [key, val] of entries.slice(0, 2)) {
        const span = document.createElement('span')
        span.className = 'fm-chip'
        span.textContent = `${key}: ${String(val)}`
        badges.append(span)
      }
    }

    const toggleBtn = document.createElement('button')
    toggleBtn.type = 'button'
    toggleBtn.className = 'fm-toggle-btn'
    toggleBtn.textContent = `展开全部 (${count}项) ▾`

    summary.append(badges, toggleBtn)

    const body = document.createElement('div')
    body.className = 'fm-card-body'
    body.hidden = true

    for (const [key, val] of entries) {
      const item = document.createElement('div')
      item.className = 'fm-grid-item'
      const k = document.createElement('span')
      k.className = 'fm-grid-key'
      k.title = key
      k.textContent = key
      const v = document.createElement('span')
      v.className = 'fm-grid-val'
      v.textContent = typeof val === 'object' ? JSON.stringify(val) : String(val)
      item.append(k, v)
      body.append(item)
    }

    let expanded = false
    const toggle = (e?: Event): void => {
      e?.preventDefault()
      e?.stopPropagation()
      expanded = !expanded
      body.hidden = !expanded
      toggleBtn.textContent = expanded ? '收起属性 ▴' : `展开全部 (${count}项) ▾`
      view.requestMeasure()
    }

    toggleBtn.addEventListener('click', toggle)

    card.append(summary, body)
    return card
  }

  ignoreEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null
    if (target?.closest('.fm-toggle-btn')) return true
    return false
  }
}

export const frontmatterRenderer: Renderer = (
  node: SyntaxNodeRef,
  cx: PreviewContext
): PreviewItem[] => {
  const text = cx.state.doc.sliceString(node.from, node.to)
  const props = parseYamlProperties(text)
  if (!props || Object.keys(props).length === 0) {
    return []
  }

  const widget = Decoration.widget({
    widget: new PropertyCardWidget(text, props, node.from, node.to),
    side: -1
  })

  return [
    {
      reveal: { from: node.from, to: node.to },
      always: [],
      concealed: [hidden.range(node.from, node.to), widget.range(node.from)],
      block: true
    }
  ]
}
