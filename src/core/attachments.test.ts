import { describe, expect, it } from 'vitest'
import type { VaultPath } from './ipc.ts'
import {
  formatImageEmbed,
  formatPastedImageName,
  nextAvailableAttachmentPath,
  resolveAttachmentFolder
} from './attachments.ts'
import { buildLinkIndex } from './resolve.ts'

describe('resolveAttachmentFolder', () => {
  it('resolves root folder when config is empty, slash, or dot', () => {
    expect(resolveAttachmentFolder('', '欢迎.md')).toBe('')
    expect(resolveAttachmentFolder('  ', '欢迎.md')).toBe('')
    expect(resolveAttachmentFolder('/', '欢迎.md')).toBe('')
    expect(resolveAttachmentFolder('.', '欢迎.md')).toBe('')
    expect(resolveAttachmentFolder(undefined, '项目/计划.md')).toBe('')
  })

  it('resolves fixed folder relative to vault root', () => {
    expect(resolveAttachmentFolder('attachments', '欢迎.md')).toBe('attachments')
    expect(resolveAttachmentFolder('attachments', '项目/计划.md')).toBe('attachments')
    expect(resolveAttachmentFolder('/attachments/', '项目/计划.md')).toBe('attachments')
    expect(resolveAttachmentFolder('assets/images', '项目/计划.md')).toBe('assets/images')
  })

  it('resolves same folder as current file for ./', () => {
    expect(resolveAttachmentFolder('./', '欢迎.md')).toBe('')
    expect(resolveAttachmentFolder('./', '项目/计划.md')).toBe('项目')
    expect(resolveAttachmentFolder('./', 'a/b/c/笔记.md')).toBe('a/b/c')
  })

  it('resolves subfolder under current file for ./subfolder', () => {
    expect(resolveAttachmentFolder('./attachments', '欢迎.md')).toBe('attachments')
    expect(resolveAttachmentFolder('./attachments', '项目/计划.md')).toBe('项目/attachments')
    expect(resolveAttachmentFolder('./assets/img/', 'a/b/笔记.md')).toBe('a/b/assets/img')
  })
})

describe('formatPastedImageName', () => {
  it('formats timestamp correctly with YYYYMMDDHHmmss pattern', () => {
    const date = new Date(2026, 10, 21, 19, 5, 9) // Month is 0-indexed: 10 -> 11
    expect(formatPastedImageName(date)).toBe('Pasted image 20261121190509.png')
    expect(formatPastedImageName(date, 'jpg')).toBe('Pasted image 20261121190509.jpg')
    expect(formatPastedImageName(date, '.webp')).toBe('Pasted image 20261121190509.webp')
  })
})

describe('nextAvailableAttachmentPath', () => {
  it('returns clean candidate path when name is not taken', () => {
    const exists = (): boolean => false
    expect(nextAvailableAttachmentPath('', 'photo.png', exists)).toBe('photo.png')
    expect(nextAvailableAttachmentPath('attachments', 'photo.png', exists)).toBe(
      'attachments/photo.png'
    )
  })

  it('numbers the candidate path when name is taken', () => {
    const taken = new Set<VaultPath>([
      'attachments/photo.png' as VaultPath,
      'attachments/photo 1.png' as VaultPath
    ])
    const exists = (p: VaultPath): boolean => taken.has(p)
    expect(nextAvailableAttachmentPath('attachments', 'photo.png', exists)).toBe(
      'attachments/photo 2.png'
    )
  })

  it('sanitizes slashes in filename to prevent traversal', () => {
    const exists = (): boolean => false
    expect(nextAvailableAttachmentPath('assets', '../../secret.png', exists)).toBe(
      'assets/secret.png'
    )
  })
})

describe('formatImageEmbed', () => {
  const files = ['欢迎.md', '项目/计划.md', '附件/图片.png', 'assets/image.png'] as VaultPath[]
  const index = buildLinkIndex(files)

  it('formats wikilink image embed with shortest link by default', () => {
    const embed = formatImageEmbed(index, '附件/图片.png' as VaultPath, '欢迎.md' as VaultPath, {
      useMarkdownLinks: false,
      newLinkFormat: 'shortest'
    })
    expect(embed).toBe('![[图片.png]]')
  })

  it('formats wikilink image embed with relative link', () => {
    const embed = formatImageEmbed(
      index,
      '附件/图片.png' as VaultPath,
      '项目/计划.md' as VaultPath,
      { useMarkdownLinks: false, newLinkFormat: 'relative' }
    )
    expect(embed).toBe('![[../附件/图片.png]]')
  })

  it('formats wikilink image embed with absolute link', () => {
    const embed = formatImageEmbed(index, '附件/图片.png' as VaultPath, '欢迎.md' as VaultPath, {
      useMarkdownLinks: false,
      newLinkFormat: 'absolute'
    })
    expect(embed).toBe('![[附件/图片.png]]')
  })

  it('formats markdown image embed with shortest link', () => {
    const embed = formatImageEmbed(index, '附件/图片.png' as VaultPath, '欢迎.md' as VaultPath, {
      useMarkdownLinks: true,
      newLinkFormat: 'shortest'
    })
    expect(embed).toBe('![图片](图片.png)')
  })

  it('formats markdown image embed with relative link and encoding', () => {
    const filesWithSpaces = ['a/b/note.md', 'assets/my photo.png'] as VaultPath[]
    const idx = buildLinkIndex(filesWithSpaces)
    const embed = formatImageEmbed(
      idx,
      'assets/my photo.png' as VaultPath,
      'a/b/note.md' as VaultPath,
      { useMarkdownLinks: true, newLinkFormat: 'relative' }
    )
    expect(embed).toBe('![my photo](../../assets/my%20photo.png)')
  })
})
