import { describe, expect, it } from 'vitest'
import { extractLinks } from './markdown.ts'
import { parseVaultPath, type VaultPath } from './ipc.ts'
import { buildRenameMapping, rewriteNoteLinks } from './rename.ts'

describe('rewriteNoteLinks', () => {
  it('rewrites simple wikilinks when target is renamed', () => {
    const from = parseVaultPath('old-note.md')
    const to = parseVaultPath('new-note.md')
    const source = parseVaultPath('index.md')

    const renames = new Map<VaultPath, VaultPath>([[from, to]])
    const currentFiles = [to, source]
    const mapping = buildRenameMapping(renames, currentFiles)

    const text = 'Here is a link: [[old-note]] and another [[old-note]].'
    const links = extractLinks(text)

    const updated = rewriteNoteLinks(source, source, text, links, mapping, {
      useMarkdownLinks: false,
      newLinkFormat: 'shortest'
    })

    expect(updated).toBe('Here is a link: [[new-note]] and another [[new-note]].')

    // Idempotent: re-running on updated text yields null
    const links2 = extractLinks(updated!)
    const reUpdated = rewriteNoteLinks(source, source, updated!, links2, mapping, {
      useMarkdownLinks: false,
      newLinkFormat: 'shortest'
    })
    expect(reUpdated).toBeNull()
  })

  it('preserves aliases and subpaths in wikilinks', () => {
    const from = parseVaultPath('sub/old.md')
    const to = parseVaultPath('sub/new.md')
    const source = parseVaultPath('index.md')

    const renames = new Map<VaultPath, VaultPath>([[from, to]])
    const currentFiles = [to, source]
    const mapping = buildRenameMapping(renames, currentFiles)

    const text = 'Check [[old#Heading|Custom Alias]] and ![[old#^block123]]'
    const links = extractLinks(text)

    const updated = rewriteNoteLinks(source, source, text, links, mapping, {
      useMarkdownLinks: false,
      newLinkFormat: 'shortest'
    })

    expect(updated).toBe('Check [[new#Heading|Custom Alias]] and ![[new#^block123]]')
  })

  it('rewrites markdown links and handles url encoding', () => {
    const from = parseVaultPath('my old file.md')
    const to = parseVaultPath('my new file.md')
    const source = parseVaultPath('index.md')

    const renames = new Map<VaultPath, VaultPath>([[from, to]])
    const currentFiles = [to, source]
    const mapping = buildRenameMapping(renames, currentFiles)

    const text = 'Link: [Read this](my%20old%20file.md#intro)'
    const links = extractLinks(text)

    const updated = rewriteNoteLinks(source, source, text, links, mapping, {
      useMarkdownLinks: true,
      newLinkFormat: 'shortest'
    })

    expect(updated).toBe('Link: [Read this](my%20new%20file.md#intro)')
  })

  it('rewrites relative markdown links when source note is moved', () => {
    // source was at folderA/note.md, moved to folderB/note.md
    // target is at folderA/target.md (did not move)
    const oldSource = parseVaultPath('folderA/note.md')
    const currentSource = parseVaultPath('folderB/note.md')
    const target = parseVaultPath('folderA/target.md')

    const renames = new Map<VaultPath, VaultPath>([[oldSource, currentSource]])
    const currentFiles = [currentSource, target]
    const mapping = buildRenameMapping(renames, currentFiles)

    // Originally, note was in folderA, so link to target was simply target.md
    const text = 'See [Target](target.md)'
    const links = extractLinks(text)

    const updated = rewriteNoteLinks(currentSource, oldSource, text, links, mapping, {
      useMarkdownLinks: true,
      newLinkFormat: 'relative'
    })

    // Now from folderB, relative link to folderA/target.md is ../folderA/target.md
    expect(updated).toBe('See [Target](../folderA/target.md)')
  })

  it('leaves unrelated links untouched', () => {
    const from = parseVaultPath('old.md')
    const to = parseVaultPath('new.md')
    const source = parseVaultPath('index.md')
    const other = parseVaultPath('other.md')

    const renames = new Map<VaultPath, VaultPath>([[from, to]])
    const currentFiles = [to, source, other]
    const mapping = buildRenameMapping(renames, currentFiles)

    const text = 'Unrelated link: [[other]] and https://example.com'
    const links = extractLinks(text)

    const updated = rewriteNoteLinks(source, source, text, links, mapping, {
      useMarkdownLinks: false,
      newLinkFormat: 'shortest'
    })

    expect(updated).toBeNull()
  })

  it('rewrites multiple links when an entire folder is renamed', () => {
    const from1 = parseVaultPath('folderA/note1.md')
    const to1 = parseVaultPath('folderB/note1.md')
    const from2 = parseVaultPath('folderA/sub/note2.md')
    const to2 = parseVaultPath('folderB/sub/note2.md')
    const source = parseVaultPath('index.md')

    const renames = new Map<VaultPath, VaultPath>([
      [from1, to1],
      [from2, to2]
    ])
    const currentFiles = [to1, to2, source]
    const mapping = buildRenameMapping(renames, currentFiles)

    const text = 'Notes: [[folderA/note1]] and [[folderA/sub/note2]]'
    const links = extractLinks(text)

    const updated = rewriteNoteLinks(source, source, text, links, mapping, {
      useMarkdownLinks: false,
      newLinkFormat: 'relative'
    })

    expect(updated).toBe('Notes: [[folderB/note1]] and [[folderB/sub/note2]]')
  })

  it('updates path in wikilink when target moves with shortest format', () => {
    const from = parseVaultPath('folderA/unique-note.md')
    const to = parseVaultPath('folderB/unique-note.md')
    const source = parseVaultPath('index.md')

    const renames = new Map<VaultPath, VaultPath>([[from, to]])
    const currentFiles = [to, source]
    const mapping = buildRenameMapping(renames, currentFiles)

    const text = 'Link: [[folderA/unique-note]]'
    const links = extractLinks(text)

    const updated = rewriteNoteLinks(source, source, text, links, mapping, {
      useMarkdownLinks: false,
      newLinkFormat: 'shortest'
    })

    // With shortest format, unique name simplifies to unique-note
    expect(updated).toBe('Link: [[unique-note]]')
  })

  it('updates path in wikilink when target moves with shortest format and colliding names', () => {
    const from = parseVaultPath('folderA/dup.md')
    const to = parseVaultPath('folderB/dup.md')
    const other = parseVaultPath('folderC/dup.md')
    const source = parseVaultPath('index.md')

    const renames = new Map<VaultPath, VaultPath>([[from, to]])
    const currentFiles = [to, other, source]
    const mapping = buildRenameMapping(renames, currentFiles)

    const text = 'Link: [[folderA/dup]]'
    const links = extractLinks(text)

    const updated = rewriteNoteLinks(source, source, text, links, mapping, {
      useMarkdownLinks: false,
      newLinkFormat: 'shortest'
    })

    // Because dup.md exists in folderC, shortest must keep folderB/dup
    expect(updated).toBe('Link: [[folderB/dup]]')
  })
})
