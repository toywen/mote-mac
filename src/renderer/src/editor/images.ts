import { Decoration, WidgetType, type EditorView } from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'
import { fileUrl, imageType } from '../../../core/fileUrl'
import { linkTarget, type ReadText } from '../../../core/markdown'
import { resolveLink } from '../../../core/resolve'
import { linkClass, linkMark } from './links'
import { hidden, marks, type PreviewContext, type PreviewItem, type Renderer } from './preview'
import './images.css'

type Size = { width: number | null; height: number | null; alt: string }

// Ported from Obsidian 1.15.0 app.js Zl and Y0. The text after the last `|`, or the whole text
// when it has no `|`, sets the size when it reads `300` or `300x200`. The rest is the alt text.
function imageSize(title: string): Size {
  const parse = (text: string): RegExpMatchArray | null =>
    text.match(/^\s*([0-9]+)\s*(?:x\s*([0-9]+)\s*)?$/)
  const bar = title.lastIndexOf('|')
  const match = parse(bar < 0 ? title : title.slice(bar + 1))
  if (!match) return { width: null, height: null, alt: title }
  return {
    width: Number(match[1]) || null,
    height: Number(match[2]) || null,
    alt: bar < 0 ? '' : title.slice(0, bar)
  }
}

const placeholder = (name: string): HTMLElement => {
  const span = document.createElement('span')
  span.className = 'mote-image-missing'
  span.textContent = name
  return span
}

// An image under its source. src is null when the target does not resolve to an image. eq keeps
// the <img> while the document changes elsewhere, so it does not load again.
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string | null,
    readonly name: string,
    readonly size: Size
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return (
      other.src === this.src &&
      other.name === this.name &&
      other.size.width === this.size.width &&
      other.size.height === this.size.height &&
      other.size.alt === this.size.alt
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span')
    box.className = 'mote-image'
    if (!this.src) {
      box.append(placeholder(this.name))
      return box
    }
    const img = document.createElement('img')
    img.alt = this.size.alt || this.name
    img.draggable = false
    if (this.size.width) img.width = this.size.width
    if (this.size.height) img.height = this.size.height
    // A loaded or failed image changes the line's height; CodeMirror must measure it again.
    img.addEventListener('load', () => view.requestMeasure())
    img.addEventListener('error', () => {
      box.replaceChildren(placeholder(this.name))
      view.requestMeasure()
    })
    img.src = this.src
    box.append(img)
    return box
  }

  // A click on the image puts the cursor next to it, which shows its source.
  ignoreEvent(): boolean {
    return false
  }
}

// The image goes after the source. While the source is hidden, only the image shows.
function image(node: SyntaxNodeRef, src: string | null, name: string, title: string): PreviewItem {
  const widget = Decoration.widget({
    widget: new ImageWidget(src, name, imageSize(title)),
    side: 1
  })
  return {
    reveal: { from: node.from, to: node.to },
    always: [widget.range(node.to)],
    concealed: [hidden.range(node.from, node.to)],
    block: true
  }
}

// The URL of a vault image, or null when the target does not resolve to one.
function vaultImage(cx: PreviewContext, target: string): string | null {
  const path = cx.links && resolveLink(cx.links.index, target, cx.links.path)
  return path && imageType(path) ? fileUrl(path) : null
}

// ![alt|300](path): an image from the vault or from an https address.
const markdownImage: Renderer = (node, cx) => {
  const read: ReadText = (from, to) => cx.state.doc.sliceString(from, to)
  const link = linkTarget(node.node, read)
  if (!link) return []
  const [open, close] = node.node.getChildren('LinkMark')
  const alt = read(open.to, close.from)
  if (link.kind === 'external') return [image(node, link.url, link.url, alt)]
  return [image(node, vaultImage(cx, link.ref.target), link.ref.target, alt)]
}

// ![[图片.png|300]] is an image. Any other embed shows its target as a link for now.
const wikiEmbed: Renderer = (node, cx) => {
  const link = linkTarget(node.node, (from, to) => cx.state.doc.sliceString(from, to))
  if (link?.kind !== 'vault') return []
  const { target, subpath, alias } = link.ref
  if (imageType(target)) return [image(node, vaultImage(cx, target), target, alias ?? '')]
  const className = linkClass(node.node, cx)
  if (!className) return []
  const item: PreviewItem = { reveal: { from: node.from, to: node.to }, always: [], concealed: [] }
  const textFrom = node.from + 3
  const textTo = textFrom + target.length + (subpath?.length ?? 0)
  if (textFrom >= textTo) {
    linkMark(item, className, node.from, node.from, node.to)
    return [item]
  }
  linkMark(item, className, node.from, textFrom, textTo)
  return [
    marks(item, [
      { from: node.from, to: textFrom },
      { from: textTo, to: node.to }
    ])
  ]
}

export const imageRenderers: Record<string, Renderer> = {
  Image: markdownImage,
  WikiEmbed: wikiEmbed
}
