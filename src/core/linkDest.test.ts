import { describe, expect, it } from 'vitest'
import { parseVaultPath, type VaultConfig, type VaultPath } from './ipc.ts'
import { linkDest, newNotePath } from './linkDest.ts'
import { markdownParser, linkTarget, type LinkTarget } from './markdown.ts'
import { buildLinkIndex } from './resolve.ts'

const paths = (...list: string[]): VaultPath[] => list.map(parseVaultPath)
const index = buildLinkIndex(
  paths('欢迎.md', '项目/计划.md', '附件/图片.png', 'Inbox/已有.md', '新笔记.md', '新笔记 1.md'),
  paths('项目', '附件', 'Inbox', '空文件夹')
)
const source = parseVaultPath('项目/计划.md')
const config = (overrides: Partial<VaultConfig> = {}): VaultConfig => ({
  useMarkdownLinks: false,
  newLinkFormat: 'shortest',
  alwaysUpdateLinks: false,
  newFileLocation: 'root',
  newFileFolderPath: '',
  daily: { folder: '', format: 'YYYY-MM-DD' },
  ...overrides
})

// The target of the first link in text.
function target(text: string): LinkTarget {
  let found: LinkTarget | null = null
  markdownParser.parse(text).iterate({
    enter(node) {
      found ??= linkTarget(node.node, (from, to) => text.slice(from, to))
      return found ? false : undefined
    }
  })
  if (!found) throw new Error(`no link in ${text}`)
  return found
}

const dest = (text: string, settings = config()): ReturnType<typeof linkDest> =>
  linkDest(target(text), source, index, settings)

describe('linkDest', () => {
  it('goes to a note with its subpath, or to the source note for #heading', () => {
    expect(dest('[[欢迎#标题]]')).toEqual({ kind: 'note', path: '欢迎.md', subpath: '#标题' })
    expect(dest('[计划](计划.md)')).toEqual({ kind: 'note', path: '项目/计划.md', subpath: null })
    expect(dest('[[#目标]]')).toEqual({ kind: 'note', path: '项目/计划.md', subpath: '#目标' })
    expect(dest('[本节](#目标)')).toEqual({ kind: 'note', path: '项目/计划.md', subpath: '#目标' })
  })

  it('opens a file that is not a note in the default app', () => {
    expect(dest('[[图片.png]]')).toEqual({ kind: 'file', path: '附件/图片.png' })
    expect(dest('[图](../附件/图片.png)')).toEqual({ kind: 'file', path: '附件/图片.png' })
  })

  it('creates a missing note', () => {
    expect(dest('[[不存在]]')).toEqual({ kind: 'missing', path: '不存在.md' })
    expect(dest('[缺失](缺失.md)')).toEqual({ kind: 'missing', path: '缺失.md' })
  })

  it('opens http, https and mailto addresses, and nothing else outside the vault', () => {
    expect(dest('[a](https://example.com/x)')).toEqual({
      kind: 'external',
      url: 'https://example.com/x'
    })
    expect(dest('<http://example.com>')).toEqual({ kind: 'external', url: 'http://example.com' })
    expect(dest('[m](mailto:a@b.c)')).toEqual({ kind: 'external', url: 'mailto:a@b.c' })
    expect(dest('<a@b.c>')).toEqual({ kind: 'external', url: 'mailto:a@b.c' })
    expect(dest('[f](file:///etc/passwd)')).toBe(null)
    expect(dest('[o](obsidian://open?vault=x)')).toBe(null)
    expect(dest('[j](javascript:alert(1))')).toBe(null)
  })

  it('goes nowhere when the missing path cannot be a note', () => {
    expect(dest('[[../外面]]')).toBe(null)
    expect(dest('[[./同级]]')).toBe(null)
    expect(dest('[[a:b]]')).toBe(null)
    expect(dest('[[白板.canvas]]')).toBe(null)
    expect(dest('[[.隐藏]]')).toBe(null)
  })
})

describe('newNotePath', () => {
  const at = (linkpath: string, settings = config()): string | null =>
    newNotePath(linkpath, source, index, settings)

  it('puts a note with no folder in its link text where the vault config says', () => {
    expect(at('新')).toBe('新.md')
    expect(at('新', config({ newFileLocation: 'current' }))).toBe('项目/新.md')
    expect(at('新', config({ newFileLocation: 'folder', newFileFolderPath: 'Inbox' }))).toBe(
      'Inbox/新.md'
    )
    expect(at('新', config({ newFileLocation: 'folder', newFileFolderPath: '空文件夹' }))).toBe(
      '空文件夹/新.md'
    )
  })

  it('falls back to the vault root when the configured folder is missing', () => {
    expect(at('新', config({ newFileLocation: 'folder', newFileFolderPath: '没有' }))).toBe('新.md')
    expect(at('新', config({ newFileLocation: 'folder', newFileFolderPath: 'Inbox/' }))).toBe(
      '新.md'
    )
  })

  it('takes folders in the link text from the vault root, ignoring the config', () => {
    const current = config({ newFileLocation: 'current' })
    expect(at('甲/乙/新', current)).toBe('甲/乙/新.md')
    expect(at('/甲/新', current)).toBe('甲/新.md')
    expect(at('甲//乙/新', current)).toBe('甲/乙/新.md')
    expect(at('inbox/新', current)).toBe('Inbox/新.md')
  })

  it('drops .md, keeps other extensions, and numbers a name that is taken', () => {
    expect(at('新.md')).toBe('新.md')
    expect(at('新.MD')).toBe('新.md')
    expect(at('报告.pdf')).toBe('报告.pdf.md')
    expect(at('新笔记')).toBe('新笔记 2.md')
    expect(at('  前后空格  ')).toBe('前后空格.md')
  })

  it('refuses a name under a file, outside the vault, or with a colon', () => {
    expect(at('欢迎.md/新')).toBe(null)
    expect(at('../新')).toBe(null)
    expect(at('a:b')).toBe(null)
    expect(at('')).toBe(null)
  })
})
