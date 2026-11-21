import { describe, expect, it } from 'vitest'
import { parseVideoSize, parseYouTubeIframe, parseYouTubeUrl } from './videos.ts'

describe('parseVideoSize', () => {
  it('parses empty or plain title', () => {
    expect(parseVideoSize('')).toEqual({ width: null, height: null, alt: '' })
    expect(parseVideoSize('clip')).toEqual({ width: null, height: null, alt: 'clip' })
  })

  it('parses |width', () => {
    expect(parseVideoSize('clip|400')).toEqual({ width: 400, height: null, alt: 'clip' })
    expect(parseVideoSize('|500')).toEqual({ width: 500, height: null, alt: '' })
  })

  it('parses |width x height', () => {
    expect(parseVideoSize('clip|640x360')).toEqual({ width: 640, height: 360, alt: 'clip' })
    expect(parseVideoSize('|800x600')).toEqual({ width: 800, height: 600, alt: '' })
  })
})

describe('parseYouTubeUrl', () => {
  it('parses standard watch URL', () => {
    const res = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(res).not.toBeNull()
    expect(res?.videoId).toBe('dQw4w9WgXcQ')
    expect(res?.start).toBeNull()
  })

  it('parses short youtu.be URL', () => {
    const res = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')
    expect(res).not.toBeNull()
    expect(res?.videoId).toBe('dQw4w9WgXcQ')
  })

  it('parses embed URL with start timestamp', () => {
    const res = parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ?start=120')
    expect(res).not.toBeNull()
    expect(res?.videoId).toBe('dQw4w9WgXcQ')
    expect(res?.start).toBe(120)
  })

  it('parses watch URL with t timestamp', () => {
    const res = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=45s')
    expect(res).not.toBeNull()
    expect(res?.videoId).toBe('dQw4w9WgXcQ')
    expect(res?.start).toBe(45)
  })

  it('applies default size', () => {
    const res = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ', {
      width: 640,
      height: 360,
      alt: ''
    })
    expect(res?.width).toBe(640)
    expect(res?.height).toBe(360)
  })

  it('returns null for non-youtube URLs', () => {
    expect(parseYouTubeUrl('https://vimeo.com/123456')).toBeNull()
    expect(parseYouTubeUrl('https://example.com/video.mp4')).toBeNull()
  })
})

describe('parseYouTubeIframe', () => {
  it('parses standard iframe tag with dimensions', () => {
    const html =
      '<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="YouTube video player" frameborder="0" allowfullscreen></iframe>'
    const res = parseYouTubeIframe(html)
    expect(res).not.toBeNull()
    expect(res?.videoId).toBe('dQw4w9WgXcQ')
    expect(res?.width).toBe(560)
    expect(res?.height).toBe(315)
  })

  it('parses iframe without dimensions', () => {
    const html = '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>'
    const res = parseYouTubeIframe(html)
    expect(res).not.toBeNull()
    expect(res?.videoId).toBe('dQw4w9WgXcQ')
    expect(res?.width).toBeNull()
    expect(res?.height).toBeNull()
  })

  it('returns null for non-youtube iframe', () => {
    const html = '<iframe src="https://example.com"></iframe>'
    expect(parseYouTubeIframe(html)).toBeNull()
  })
})
