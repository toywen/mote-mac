import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { VaultPath } from './ipc.ts'
import { fileToLinktext, linkText, type LinkFormat } from './linkText.ts'
import { extractLinks } from './markdown.ts'
import { buildLinkIndex, resolveLink, type LinkIndex } from './resolve.ts'

const paths = (...list: string[]): VaultPath[] => list as VaultPath[]
const files = paths(
  '欢迎.md',
  '带 空格.md',
  '项目/计划.md',
  'a/规则.md',
  'a/重名.md',
  'b/重名.md',
  'b/c/重名.md',
  '附件/图片.png'
)
const index = buildLinkIndex(files)
const wiki = (newLinkFormat: LinkFormat['newLinkFormat']): LinkFormat => ({
  useMarkdownLinks: false,
  newLinkFormat
})
const markdown = (newLinkFormat: LinkFormat['newLinkFormat']): LinkFormat => ({
  useMarkdownLinks: true,
  newLinkFormat
})
const text = (target: string, source: string, format: LinkFormat, after?: string): string =>
  linkText(index, target as VaultPath, source as VaultPath, format, after).text

describe('linkText', () => {
  it('uses the note name alone when it is unique, in every folder', () => {
    expect(text('项目/计划.md', '欢迎.md', wiki('shortest'))).toBe('[[计划]]')
    expect(text('项目/计划.md', 'b/c/重名.md', wiki('shortest'))).toBe('[[计划]]')
    expect(text('项目/计划.md', '欢迎.md', markdown('shortest'))).toBe('[计划](计划.md)')
  })

  it('uses the path for a duplicate name, and shows the name as the alias', () => {
    expect(text('a/重名.md', '欢迎.md', wiki('shortest'))).toBe('[[a/重名|重名]]')
    expect(text('b/c/重名.md', 'a/规则.md', wiki('shortest'))).toBe('[[b/c/重名|重名]]')
    expect(text('a/重名.md', '欢迎.md', markdown('shortest'))).toBe('[重名](a/重名.md)')
  })

  it('encodes a space in a Markdown link but not in a wiki link', () => {
    expect(text('带 空格.md', 'a/规则.md', wiki('shortest'))).toBe('[[带 空格]]')
    expect(text('带 空格.md', 'a/规则.md', markdown('shortest'))).toBe('[带 空格](带%20空格.md)')
    expect(text('带 空格.md', 'a/规则.md', markdown('relative'))).toBe('[带 空格](../带%20空格.md)')
  })

  it('walks up from the source folder for relative links', () => {
    expect(text('b/c/重名.md', 'a/规则.md', wiki('relative'))).toBe('[[../b/c/重名|重名]]')
    expect(text('a/重名.md', 'a/规则.md', wiki('relative'))).toBe('[[重名]]')
    expect(text('b/c/重名.md', 'b/重名.md', markdown('relative'))).toBe('[重名](c/重名.md)')
    expect(text('欢迎.md', 'b/c/重名.md', markdown('relative'))).toBe('[欢迎](../../欢迎.md)')
  })

  it('uses the full path for absolute links', () => {
    expect(text('项目/计划.md', 'a/规则.md', wiki('absolute'))).toBe('[[项目/计划|计划]]')
    expect(text('欢迎.md', 'a/规则.md', wiki('absolute'))).toBe('[[欢迎]]')
    expect(text('项目/计划.md', 'a/规则.md', markdown('absolute'))).toBe('[计划](项目/计划.md)')
  })

  it('keeps the extension of a file that is not a note, and adds no alias to an image', () => {
    expect(text('附件/图片.png', '欢迎.md', wiki('absolute'))).toBe('[[附件/图片.png]]')
    expect(text('附件/图片.png', '欢迎.md', markdown('shortest'))).toBe('[图片](图片.png)')
  })

  it('replaces text up to the next ]] after the cursor, and keeps an alias there', () => {
    const plan = '项目/计划.md' as VaultPath
    const from = '欢迎.md' as VaultPath
    expect(linkText(index, plan, from, wiki('shortest'), ']] 后')).toEqual({
      text: '[[计划]]',
      consumed: 2
    })
    expect(linkText(index, plan, from, wiki('shortest'), '|别名]]')).toEqual({
      text: '[[计划|别名]]',
      consumed: 5
    })
    expect(linkText(index, plan, from, markdown('shortest'), ' 尾|别名]]')).toEqual({
      text: '[计划](计划.md)',
      consumed: 7
    })
    expect(linkText(index, plan, from, wiki('shortest'), ' [[下]]')).toEqual({
      text: '[[计划]]',
      consumed: 0
    })
  })
})

type Insert = [text: string, consumed: number, cursor: number]
type Export = {
  obsidian: string
  files: VaultPath[]
  after: string[]
  formats: (LinkFormat & {
    links: Record<VaultPath, Record<VaultPath, [string, string, Insert[]]>>
  })[]
}

const obsidian: Export = JSON.parse(
  readFileSync('tests/fixtures/vaults/links.obsidian-linktext.json', 'utf8')
)

// Every link [[ completion can insert into a note of files, and whether it leads back.
function roundTrip(files: VaultPath[], index: LinkIndex): { checked: number; failed: string[] } {
  const failed: string[] = []
  let checked = 0
  for (const useMarkdownLinks of [false, true])
    for (const newLinkFormat of ['shortest', 'relative', 'absolute'] as const)
      for (const source of files.filter((path) => path.endsWith('.md')))
        for (const target of files) {
          const { text } = linkText(index, target, source, { useMarkdownLinks, newLinkFormat })
          const links = extractLinks(text)
          const dest = links.length === 1 ? resolveLink(index, links[0].target, source) : null
          if (dest !== target) failed.push(`${source} -> ${target}: ${text} -> ${dest}`)
          checked++
        }
  return { checked, failed }
}

describe('linkText against Obsidian 1.15.1', () => {
  const index = buildLinkIndex(obsidian.files)

  it('makes the link path fileToLinktext makes, for every pair of note and file', () => {
    const differences: string[] = []
    let checked = 0
    for (const format of obsidian.formats)
      for (const [source, targets] of Object.entries(format.links))
        for (const [target, [expected]] of Object.entries(targets)) {
          const ours = fileToLinktext(
            index,
            target as VaultPath,
            source as VaultPath,
            format.newLinkFormat,
            !format.useMarkdownLinks
          )
          if (ours !== expected) differences.push(`${source} -> ${target}: ${ours} != ${expected}`)
          checked++
        }
    expect(differences).toEqual([])
    expect(checked).toBe(6 * 9 * obsidian.files.length)
  })

  it('inserts what the [[ suggestion inserts, and puts the cursor after the link', () => {
    const differences: string[] = []
    let checked = 0
    for (const format of obsidian.formats)
      for (const [source, targets] of Object.entries(format.links))
        for (const [target, [, , inserts]] of Object.entries(targets))
          obsidian.after.forEach((after, i) => {
            const ours = linkText(index, target as VaultPath, source as VaultPath, format, after)
            const [text, consumed, cursor] = inserts[i]
            if (ours.text !== text || ours.consumed !== consumed || ours.text.length !== cursor)
              differences.push(`${source} -> ${target} + ${after}: ${JSON.stringify(ours)}`)
            checked++
          })
    expect(differences).toEqual([])
    expect(checked).toBe(6 * 9 * obsidian.files.length * obsidian.after.length)
  })

  it('makes links that resolve back to their target', () => {
    const { checked, failed } = roundTrip(obsidian.files, index)
    expect(failed).toEqual([])
    expect(checked).toBe(6 * 9 * obsidian.files.length)
  })
})

describe('linkText round trip', () => {
  it('resolves back for duplicate names, spaces and nested folders', () => {
    const { checked, failed } = roundTrip(files, index)
    expect(failed).toEqual([])
    expect(checked).toBe(6 * 7 * files.length)
  })
})
