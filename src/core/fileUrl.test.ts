import { describe, expect, it } from 'vitest'
import { fileUrl, imageType, mediaType, parseFileUrl, videoType } from './fileUrl.ts'
import { parseVaultPath } from './ipc.ts'

describe('fileUrl and parseFileUrl', () => {
  it('round-trip paths with Chinese names, spaces, # and ?', () => {
    for (const raw of [
      '附件/图片.png',
      'Pasted image 20260319100003.png',
      '02_Projects/a#b/c d?.jpg',
      '100%/封面 (1).webp'
    ]) {
      const path = parseVaultPath(raw)
      const url = fileUrl(path)
      expect(url.startsWith('mote-file://vault/')).toBe(true)
      expect(url).not.toMatch(/[ #?]/)
      expect(parseFileUrl(url)).toBe(path)
    }
    expect(fileUrl(parseVaultPath('附件/图 片.png'))).toBe(
      'mote-file://vault/%E9%99%84%E4%BB%B6/%E5%9B%BE%20%E7%89%87.png'
    )
  })

  it('reject .. and dot segments, also when percent-encoded', () => {
    for (const url of [
      'mote-file://vault/../secret.png',
      'mote-file://vault/a/../../secret.png',
      'mote-file://vault/%2e%2e/secret.png',
      'mote-file://vault/a%2F..%2F..%2Fsecret.png',
      'mote-file://vault/./a.png',
      'mote-file://vault/.obsidian/app.json',
      'mote-file://vault/a/.hidden.png',
      'mote-file://vault//Users/me/secret.png',
      'mote-file://vault/',
      'mote-file://vault/a.png%00.md'
    ])
      expect(() => parseFileUrl(url), url).toThrow()
  })

  it('reject another scheme, host, query, fragment or bad encoding', () => {
    for (const url of [
      'file:///Users/me/secret.png',
      'https://vault/a.png',
      'mote-file:///Users/me/secret.png',
      'mote-file://Users/me/secret.png',
      'mote-file://other/a.png',
      'mote-file://vault:80/a.png',
      'mote-file://user@vault/a.png',
      'mote-file://vault/a.png?x=1',
      'mote-file://vault/a.png#top',
      'mote-file://vault/%E5%9B.png'
    ])
      expect(() => parseFileUrl(url), url).toThrow()
  })
})

describe('imageType', () => {
  it('knows the image types Obsidian shows, in any case', () => {
    expect(imageType('a/b.PNG')).toBe('image/png')
    expect(imageType('照片.jpeg')).toBe('image/jpeg')
    expect(imageType('图.svg')).toBe('image/svg+xml')
    for (const path of ['a.png', 'a.jpg', 'a.gif', 'a.webp', 'a.bmp', 'a.avif'])
      expect(imageType(path), path).not.toBeNull()
  })

  it('is null for notes, other files and names that only look like keys', () => {
    for (const path of [
      '笔记.md',
      'a.pdf',
      'a.base',
      'png',
      'a.png/b',
      'a.constructor',
      'a.toString'
    ])
      expect(imageType(path), path).toBeNull()
  })
})

describe('videoType and mediaType', () => {
  it('identifies supported video formats', () => {
    expect(videoType('video.mp4')).toBe('video/mp4')
    expect(videoType('folder/clip.WEBM')).toBe('video/webm')
    expect(videoType('movie.mov')).toBe('video/quicktime')
    expect(videoType('file.m4v')).toBe('video/mp4')
    expect(videoType('audio.ogv')).toBe('video/ogg')
  })

  it('is null for non-video files', () => {
    expect(videoType('image.png')).toBeNull()
    expect(videoType('doc.pdf')).toBeNull()
    expect(videoType('note.md')).toBeNull()
  })

  it('mediaType covers both images and videos', () => {
    expect(mediaType('image.png')).toBe('image/png')
    expect(mediaType('video.mp4')).toBe('video/mp4')
    expect(mediaType('doc.pdf')).toBeNull()
  })
})
