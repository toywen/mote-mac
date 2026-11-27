import { describe, expect, it } from 'vitest'
import type { VaultPath } from './ipc.ts'
import { dailyDate, dailyNotesIn, resolveScopePaths, thisWeek } from './ai.ts'

const p = (path: string): VaultPath => path as VaultPath

describe('dailyNotesIn', () => {
  const paths = [
    p('Daily/2026/2026-11/2026-11-27.md'),
    p('Daily/2026/2026-11/2026-11-23.md'),
    p('Daily/2026/2026-11/2026-11-25.md'),
    p('Daily/2026/2026-11/2026-11-22.md'),
    p('Projects/2026-11-24.md'),
    p('Daily/2026/2026-11/2026-11-24 meeting.md')
  ]

  it('picks daily notes in the range, both ends included, oldest first', () => {
    expect(dailyNotesIn(paths, 'Daily', '2026-11-23', '2026-11-27')).toEqual([
      'Daily/2026/2026-11/2026-11-23.md',
      'Daily/2026/2026-11/2026-11-25.md',
      'Daily/2026/2026-11/2026-11-27.md'
    ])
  })

  it('counts dated notes anywhere when the vault names no daily folder', () => {
    expect(dailyNotesIn(paths, '', '2026-11-24', '2026-11-24')).toEqual(['Projects/2026-11-24.md'])
  })

  it('reads the folder with or without slashes around it', () => {
    expect(dailyDate(p('Daily/2026-11-25.md'), '/Daily/')).toBe('2026-11-25')
    expect(dailyDate(p('Dailyish/2026-11-25.md'), 'Daily')).toBeNull()
  })
})

describe('thisWeek', () => {
  it('runs from Monday to today', () => {
    expect(thisWeek(new Date(2026, 10, 27))).toEqual({ from: '2026-11-23', to: '2026-11-27' })
    expect(thisWeek(new Date(2026, 10, 23))).toEqual({ from: '2026-11-23', to: '2026-11-23' })
    expect(thisWeek(new Date(2026, 10, 29))).toEqual({ from: '2026-11-23', to: '2026-11-29' })
  })
})

describe('resolveScopePaths', () => {
  const all = [
    p('项目/架构.md'),
    p('项目/同步.md'),
    p('项目归档/旧.md'),
    p('阅读/读书.md'),
    p('日记/2026-11-27.md')
  ]

  it('mixes folders, notes, tags, daily ranges and deduplicates in order', () => {
    const out = resolveScopePaths({
      items: [
        { kind: 'folder', path: p('项目') },
        { kind: 'note', path: p('项目/架构.md') },
        { kind: 'tag', tag: '#读书' },
        { kind: 'daily', from: '2026-11-23', to: '2026-11-27' }
      ],
      notes: all,
      dailyFolder: '日记',
      notesWithTag: (tag) => (tag === '#读书' ? [p('阅读/读书.md'), p('项目/同步.md')] : [])
    })
    expect(out).toEqual(['项目/架构.md', '项目/同步.md', '阅读/读书.md', '日记/2026-11-27.md'])
    expect(out).not.toContain('项目归档/旧.md')
  })

  it('includes every note for the whole vault', () => {
    const out = resolveScopePaths({
      items: [{ kind: 'vault' }],
      notes: all,
      dailyFolder: '日记',
      notesWithTag: () => []
    })
    expect(out).toHaveLength(5)
  })
})
