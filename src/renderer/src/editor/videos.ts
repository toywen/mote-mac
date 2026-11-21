import { Decoration, WidgetType, type EditorView } from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'
import { fileUrl, videoType } from '../../../core/fileUrl'
import { linkTarget, type ReadText } from '../../../core/markdown'
import { resolveLink } from '../../../core/resolve'
import { imageRenderers } from './images'
import { hidden, type PreviewItem, type PreviewContext, type Renderer } from './preview'
import './videos.css'

export type VideoSize = { width: number | null; height: number | null; alt: string }

export function parseVideoSize(title: string): VideoSize {
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

export type YouTubeInfo = {
  videoId: string
  start: number | null
  width: number | null
  height: number | null
}

const YOUTUBE_REGEX =
  /(?:youtube(?:-nocookie)?\.com\/(?:[^/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i

export function parseYouTubeUrl(raw: string, defaultSize?: VideoSize): YouTubeInfo | null {
  const bar = raw.indexOf('|')
  const url = bar < 0 ? raw : raw.slice(0, bar)
  const sizeFromUrl = bar < 0 ? null : parseVideoSize(raw)
  const match = url.match(YOUTUBE_REGEX)
  if (!match) return null
  const videoId = match[1]

  let start: number | null = null
  const timeMatch = url.match(/[?&](?:t|start)=([0-9]+)s?/)
  if (timeMatch) start = parseInt(timeMatch[1], 10)

  return {
    videoId,
    start,
    width: sizeFromUrl?.width ?? defaultSize?.width ?? null,
    height: sizeFromUrl?.height ?? defaultSize?.height ?? null
  }
}

export function parseYouTubeIframe(html: string): YouTubeInfo | null {
  const iframeMatch = html.match(/<iframe\b([^>]*?)>/i)
  if (!iframeMatch) return null
  const attrs = iframeMatch[1]

  const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i)
  if (!srcMatch) return null

  const info = parseYouTubeUrl(srcMatch[1])
  if (!info) return null

  const widthMatch = attrs.match(/\bwidth=["']?([0-9]+)["']?/i)
  const heightMatch = attrs.match(/\bheight=["']?([0-9]+)["']?/i)
  if (widthMatch) info.width = parseInt(widthMatch[1], 10)
  if (heightMatch) info.height = parseInt(heightMatch[1], 10)

  return info
}

const placeholder = (name: string): HTMLElement => {
  const span = document.createElement('span')
  span.className = 'mote-video-missing'
  span.textContent = name
  return span
}

class VideoWidget extends WidgetType {
  constructor(
    readonly src: string | null,
    readonly name: string,
    readonly size: VideoSize
  ) {
    super()
  }

  eq(other: VideoWidget): boolean {
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
    box.className = 'mote-video'
    if (!this.src) {
      box.append(placeholder(this.name))
      return box
    }
    const video = document.createElement('video')
    video.src = this.src
    video.controls = true
    video.preload = 'metadata'
    if (this.size.width) video.width = this.size.width
    if (this.size.height) video.height = this.size.height
    video.addEventListener('loadedmetadata', () => view.requestMeasure())
    video.addEventListener('error', () => {
      box.replaceChildren(placeholder(this.name))
      view.requestMeasure()
    })
    box.append(video)
    return box
  }

  ignoreEvent(event: Event): boolean {
    return event.target instanceof HTMLVideoElement
  }
}

class YouTubeWidget extends WidgetType {
  constructor(readonly info: YouTubeInfo) {
    super()
  }

  eq(other: YouTubeWidget): boolean {
    return (
      other.info.videoId === this.info.videoId &&
      other.info.start === this.info.start &&
      other.info.width === this.info.width &&
      other.info.height === this.info.height
    )
  }

  toDOM(): HTMLElement {
    const box = document.createElement('span')
    box.className = 'mote-youtube'
    const iframe = document.createElement('iframe')
    let embedUrl = `https://www.youtube-nocookie.com/embed/${this.info.videoId}`
    if (this.info.start !== null) embedUrl += `?start=${this.info.start}`
    iframe.src = embedUrl
    iframe.width = String(this.info.width ?? 560)
    iframe.height = String(this.info.height ?? 315)
    iframe.allow =
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
    iframe.allowFullscreen = true
    box.append(iframe)
    return box
  }

  ignoreEvent(): boolean {
    return true
  }
}

function videoItem(
  node: SyntaxNodeRef,
  src: string | null,
  name: string,
  title: string
): PreviewItem {
  const widget = Decoration.widget({
    widget: new VideoWidget(src, name, parseVideoSize(title)),
    side: 1
  })
  return {
    reveal: { from: node.from, to: node.to },
    always: [widget.range(node.to)],
    concealed: [hidden.range(node.from, node.to)],
    block: true
  }
}

function youtubeItem(node: SyntaxNodeRef, info: YouTubeInfo): PreviewItem {
  const widget = Decoration.widget({
    widget: new YouTubeWidget(info),
    side: 1
  })
  return {
    reveal: { from: node.from, to: node.to },
    always: [widget.range(node.to)],
    concealed: [hidden.range(node.from, node.to)],
    block: true
  }
}

function vaultVideo(cx: PreviewContext, target: string): string | null {
  const path = cx.links && resolveLink(cx.links.index, target, cx.links.path)
  return path && videoType(path) ? fileUrl(path) : null
}

const markdownVideoOrImage: Renderer = (node, cx) => {
  const read: ReadText = (from, to) => cx.state.doc.sliceString(from, to)
  const link = linkTarget(node.node, read)
  if (!link) return []
  const [open, close] = node.node.getChildren('LinkMark')
  const alt = read(open.to, close.from)

  if (link.kind === 'external') {
    const yt = parseYouTubeUrl(link.url, parseVideoSize(alt))
    if (yt) return [youtubeItem(node, yt)]
    if (videoType(link.url)) return [videoItem(node, link.url, link.url, alt)]
  } else {
    let target = link.ref.target
    let sizeTitle = alt
    const bar = target.indexOf('|')
    if (bar >= 0) {
      if (!sizeTitle) sizeTitle = target.slice(bar + 1)
      target = target.slice(0, bar)
    }
    if (videoType(target)) {
      return [videoItem(node, vaultVideo(cx, target), target, sizeTitle)]
    }
  }

  return imageRenderers.Image(node, cx)
}

export const videoWikiEmbed: Renderer = (node, cx) => {
  const link = linkTarget(node.node, (from, to) => cx.state.doc.sliceString(from, to))
  if (link?.kind === 'vault') {
    let target = link.ref.target
    let alias = link.ref.alias
    const bar = target.indexOf('|')
    if (bar >= 0) {
      if (!alias) alias = target.slice(bar + 1)
      target = target.slice(0, bar)
    }
    const yt = parseYouTubeUrl(target, parseVideoSize(alias ?? ''))
    if (yt) return [youtubeItem(node, yt)]
    if (videoType(target)) {
      return [videoItem(node, vaultVideo(cx, target), target, alias ?? '')]
    }
  }
  return imageRenderers.WikiEmbed(node, cx)
}

const htmlIframeRenderer: Renderer = (node, cx) => {
  const text = cx.state.doc.sliceString(node.from, node.to)
  const info = parseYouTubeIframe(text)
  if (!info) return []
  return [youtubeItem(node, info)]
}

export const videoRenderers: Record<string, Renderer> = {
  Image: markdownVideoOrImage,
  WikiEmbed: videoWikiEmbed,
  HTMLBlock: htmlIframeRenderer,
  HTMLTag: htmlIframeRenderer
}
