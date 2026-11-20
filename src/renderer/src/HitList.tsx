import type { Hit, VaultPath } from '../../core/ipc'
import { workspace } from './workspace'

export type Range = [number, number]

export function Highlighted({
  text,
  ranges
}: {
  text: string
  ranges: Range[]
}): React.JSX.Element {
  const parts: React.ReactNode[] = []
  let at = 0
  for (const [from, to] of ranges) {
    if (from > at) parts.push(text.slice(at, from))
    parts.push(<mark key={from}>{text.slice(from, to)}</mark>)
    at = to
  }
  parts.push(text.slice(at))
  return <>{parts}</>
}

type HitGroup = { path: VaultPath; hits: Hit[] }

// Groups hits that are already ordered by note.
function groupHits(hits: Hit[]): HitGroup[] {
  const groups: HitGroup[] = []
  for (const hit of hits) {
    const last = groups.at(-1)
    if (last?.path === hit.path) last.hits.push(hit)
    else groups.push({ path: hit.path, hits: [hit] })
  }
  return groups
}

// One group per note, one row per hit. Clicking a row opens the note and selects the hit.
export function HitList({ hits, label }: { hits: Hit[]; label: string }): React.JSX.Element {
  return (
    <ul className="hit-list" aria-label={label}>
      {groupHits(hits).map((group) => (
        <li key={group.path} className="hit-group" data-path={group.path}>
          <div className="hit-title" title={group.path}>
            {group.path.split('/').pop()?.replace(/\.md$/i, '')}
          </div>
          <ul>
            {group.hits.map((hit) => (
              <li key={hit.from}>
                <button
                  type="button"
                  className="hit"
                  data-path={hit.path}
                  data-from={hit.from}
                  onClick={() => void workspace.open(hit.path, hit)}
                >
                  <Highlighted
                    text={hit.preview.text}
                    ranges={[[hit.preview.from, hit.preview.to]]}
                  />
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}
