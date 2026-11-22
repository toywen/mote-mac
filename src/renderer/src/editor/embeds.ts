import { Compartment, EditorState, Facet, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import type { VaultPath } from '../../../core/ipc'
import { linkDest } from '../../../core/linkDest'
import { linkTarget, markdownParser } from '../../../core/markdown'
import { subpathRange } from '../../../core/subpath'
import { sourceText } from '../../../core/text'
import { workspace } from '../workspace'
import { videoWikiEmbed } from './videos'
import { editorMode, linkContext } from './livePreview'
import { noteView } from './noteView'
import type { LinkContext, Renderer } from './preview'
import { editorLocked } from './tasks'
import './embeds.css'

// A note an embed shows, cut to a heading or block when subpath is set.
type Shown = { path: VaultPath; subpath: string | null }

// The notes from the main editor's note down to this view's own, outermost first. The main
// editor sets none: its chain is its own note.
const embedChain = Facet.define<Shown[], Shown[]>({ combine: (values) => values[0] ?? [] })

// Embeds nest this many levels below the main editor's note.
const MAX_LEVEL = 3

const sameShown = (a: Shown, b: Shown): boolean => a.path === b.path && a.subpath === b.subpath
const chainKey = (chain: Shown[]): string =>
  chain.map(({ path, subpath }) => `${path}${subpath ?? ''}`).join('\n')
const noteName = (path: VaultPath): string => path.slice(path.lastIndexOf('/') + 1, -3)

// The part of a note's normalized text an embed shows: the heading or block for a subpath, or
// the whole note after its properties. Null when the subpath does not exist.
function cut(text: string, subpath: string | null): string | null {
  if (subpath) {
    const range = subpathRange(text, subpath)
    return range && text.slice(range.from, range.to)
  }
  const first = markdownParser.parse(text).topNode.firstChild
  return first?.name === 'Frontmatter' ? text.slice(first.to).replace(/^\n+/, '') : text
}

// The live part of one embed: the nested view, and the subscription that keeps its text current.
class Embed {
  private view: EditorView | null = null
  private readonly context = new Compartment()
  private links: LinkContext
  private revision = -1
  private openText: string | null = null
  private reads = 0
  private readonly unsubscribe: () => void
  private readonly resize: ResizeObserver

  constructor(
    private readonly widget: EmbedWidget,
    private readonly content: HTMLElement,
    host: EditorView
  ) {
    this.links = widget.links
    this.unsubscribe = workspace.subscribe(() => this.check())
    // The host measures its lines only when asked; the nested view grows after it draws.
    this.resize = new ResizeObserver(() => host.requestMeasure())
    this.resize.observe(content)
    this.check()
  }

  // Reads again after any vault change or save, and, for the open note, after any edit.
  private check(): void {
    const { revision, doc } = workspace.snapshot()
    const openText = doc?.path === this.widget.shown.path && 'text' in doc ? doc.text : null
    if (revision === this.revision && openText === this.openText) return
    this.revision = revision
    this.openText = openText
    void this.read()
  }

  private async read(): Promise<void> {
    const id = ++this.reads
    const raw = await workspace.noteText(this.widget.shown.path).catch(() => null)
    if (id !== this.reads) return
    const text = raw === null ? null : cut(sourceText(raw).text, this.widget.shown.subpath)
    if (text === null) this.showMissing()
    else this.show(text)
  }

  private show(text: string): void {
    const { view } = this
    if (view) {
      if (view.state.doc.toString() !== text)
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
      return
    }
    this.content.replaceChildren()
    this.view = new EditorView({
      parent: this.content,
      state: EditorState.create({ doc: text, extensions: this.extensions() })
    })
  }

  // Read only, with no history and no keys. A press inside never moves focus or the selection,
  // so the note around the embed keeps both; a link still follows on the click.
  private extensions(): Extension {
    const { shown, chain } = this.widget
    return [
      noteView(),
      this.context.of(linkContext.of({ ...this.links, path: shown.path })),
      embedChain.of([...chain, shown]),
      editorMode.of('reading'),
      editorLocked.of(true),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.contentAttributes.of({ 'aria-label': noteName(shown.path) }),
      EditorView.domEventHandlers({
        mousedown: (event) => {
          event.preventDefault()
          return true
        }
      })
    ]
  }

  // A note that is gone or a heading that is not there shows as a missing link. The title above
  // still opens the note.
  private showMissing(): void {
    this.view?.destroy()
    this.view = null
    const { path, subpath } = this.widget.shown
    const link = document.createElement('span')
    link.className = 'mote-link mote-link-missing'
    link.textContent = noteName(path) + (subpath ?? '')
    this.content.replaceChildren(link)
  }

  relink(links: LinkContext): void {
    this.links = links
    this.view?.dispatch({
      effects: this.context.reconfigure(linkContext.of({ ...links, path: this.widget.shown.path }))
    })
  }

  destroy(): void {
    this.reads++
    this.unsubscribe()
    this.resize.disconnect()
    this.view?.destroy()
  }
}

const embeds = new WeakMap<HTMLElement, Embed>()

// Another note's content in place of its ![[embed]]. eq keeps the nested view while the note
// changes elsewhere. A new file list reaches the nested view through updateDOM.
class EmbedWidget extends WidgetType {
  constructor(
    readonly shown: Shown,
    readonly chain: Shown[],
    readonly links: LinkContext
  ) {
    super()
  }

  private same(other: EmbedWidget): boolean {
    return sameShown(other.shown, this.shown) && chainKey(other.chain) === chainKey(this.chain)
  }

  eq(other: EmbedWidget): boolean {
    return this.same(other) && other.links === this.links
  }

  updateDOM(dom: HTMLElement, _view: EditorView, from: EmbedWidget): boolean {
    const embed = embeds.get(dom)
    if (!embed || !this.same(from)) return false
    embed.relink(this.links)
    return true
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div')
    box.className = 'mote-embed'
    const { path, subpath } = this.shown
    const title = document.createElement('button')
    title.type = 'button'
    title.className = 'mote-embed-title'
    title.textContent = noteName(path)
    title.addEventListener(
      'click',
      () => void workspace.open(path, subpath ? { subpath } : undefined)
    )
    const content = document.createElement('div')
    content.className = 'mote-embed-content'
    box.append(title, content)
    embeds.set(box, new Embed(this, content, view))
    return box
  }

  destroy(dom: HTMLElement): void {
    embeds.get(dom)?.destroy()
    embeds.delete(dom)
  }

  // The nested view and the title handle their own clicks. A click on the frame reaches the
  // editor, which puts the cursor at the embed and shows its source.
  ignoreEvent(event: Event): boolean {
    return (
      event.target instanceof Element &&
      event.target.closest('.mote-embed-content, .mote-embed-title') !== null
    )
  }

  get estimatedHeight(): number {
    return 120
  }
}

const imageEmbed = videoWikiEmbed

// ![[note]] whose target is a note shows that note. Images, other files, targets that do not
// resolve, a note already in the chain above and a fourth level go to the image renderer, which
// draws an image or a link.
const noteEmbed: Renderer = (node, cx) => {
  const link = linkTarget(node.node, (from, to) => cx.state.doc.sliceString(from, to))
  const links = cx.links
  const dest = link && links && linkDest(link, links.path, links.index, links.config)
  if (dest?.kind !== 'note' || !links) return imageEmbed(node, cx)
  const above = cx.state.facet(embedChain)
  const chain = above.length ? above : [{ path: links.path, subpath: null }]
  const shown: Shown = { path: dest.path, subpath: dest.subpath }
  if (chain.length > MAX_LEVEL || chain.some((item) => sameShown(item, shown)))
    return imageEmbed(node, cx)
  const { doc } = cx.state
  const line = doc.lineAt(node.from)
  // An embed alone on its line is drawn between lines; one inside a line stays in it.
  const block = doc.sliceString(line.from, line.to).trim() === doc.sliceString(node.from, node.to)
  const from = block ? line.from : node.from
  const to = block ? line.to : node.to
  const widget = new EmbedWidget(shown, chain, links)
  return [
    {
      reveal: { from, to },
      always: [],
      concealed: [Decoration.replace({ widget, block }).range(from, to)],
      block: true
    }
  ]
}

export const embedRenderers: Record<string, Renderer> = {
  WikiEmbed: noteEmbed
}
