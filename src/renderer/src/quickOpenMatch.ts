import type { VaultPath } from '../../core/ipc'

// Ported from Obsidian 1.15.1 app.js. Minified names: Pb, RO, lT, Gi, bX, Ep, Ki, FR.
const punctuation = /[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,\-./:;<=>?@[\]^_`{|}~]/
const space = /\s/
const cjk = /[\u0F00-\u0FFF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF66-\uFF9F]/

export type Range = [number, number]
export type Match = { score: number; matches: Range[] }
export type Suggestion = { path: VaultPath; label: string; match: Match | null }

type Query = { length: number; tokens: string[]; chars: string[] }

function parseQuery(query: string): Query {
  const text = query.toLowerCase()
  const tokens: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i)
    if (space.test(char)) {
      if (start !== i) tokens.push(text.substring(start, i))
      start = i + 1
    } else if (punctuation.test(char) || cjk.test(char)) {
      if (start !== i) tokens.push(text.substring(start, i))
      tokens.push(char)
      start = i + 1
    }
  }
  if (start !== text.length) tokens.push(text.substring(start))
  return { length: query.length, tokens, chars: text.split('').filter((char) => char !== ' ') }
}

function score(ranges: Range[], queryLength: number, targetLength: number, breaks: number): number {
  const first = ranges[0][0]
  const last = ranges[ranges.length - 1][1]
  return (
    -(ranges.length - 1) -
    breaks / 10 -
    (last - first + 1 - queryLength) / 100 -
    first / 1000 -
    targetLength / 10000
  )
}

function matchInOrder(
  parts: string[],
  queryLength: number,
  target: string,
  lower: string,
  perChar: boolean
): Match | null {
  if (parts.length === 0) return null
  let breaks = 0
  let from = 0
  const ranges: Range[] = []
  for (const part of parts) {
    const at = lower.indexOf(part, from)
    if (at === -1) return null
    const char = target.charAt(at)
    if (at > 0 && !punctuation.test(char) && !cjk.test(char)) {
      const before = target.charAt(at - 1)
      const upperAfterUpper = char.toLowerCase() !== char && before.toLowerCase() !== before
      const lowerMidWord =
        char.toUpperCase() !== char &&
        !punctuation.test(before) &&
        !space.test(before) &&
        !cjk.test(before)
      if ((upperAfterUpper || lowerMidWord) && (!perChar || at !== from)) breaks += 1
    }
    const previous = ranges[ranges.length - 1]
    if (previous && previous[1] >= at) previous[1] = at + part.length
    else ranges.push([at, at + part.length])
    from = at + part.length
  }
  return { matches: ranges, score: score(ranges, queryLength, lower.length, breaks) }
}

function matchTarget(query: Query, target: string): Match | null {
  const lower = target.toLowerCase()
  return (
    matchInOrder(query.tokens, query.length, target, lower, false) ??
    matchInOrder(query.chars, query.length, target, lower, true)
  )
}

function matchPath(query: Query, path: string): Match | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const byName = matchTarget(query, name)
  if (byName) {
    const offset = path.length - name.length
    for (const range of byName.matches) {
      range[0] += offset
      range[1] += offset
    }
    return byName
  }
  const byPath = matchTarget(query, path)
  if (byPath) byPath.score -= 1
  return byPath
}

export const label = (path: VaultPath): string => path.slice(0, -3)

export function suggest(
  notes: VaultPath[],
  recent: VaultPath[],
  input: string,
  limit = 20
): Suggestion[] {
  const text = input.trim()
  if (!text) {
    const existing = new Set(notes)
    return recent
      .filter((path) => existing.has(path))
      .slice(0, 10)
      .map((path) => ({ path, label: label(path), match: null }))
  }
  const query = parseQuery(text)
  const found: Suggestion[] = []
  for (const path of notes) {
    const shown = label(path)
    const match = matchPath(query, shown)
    if (match) found.push({ path, label: shown, match })
  }
  return found.sort((a, b) => b.match!.score - a.match!.score).slice(0, limit)
}
