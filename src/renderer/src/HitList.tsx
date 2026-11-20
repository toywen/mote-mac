import type { HitGroup } from '../../core/ipc'
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

// One group per note, one row per hit. Clicking a row opens the note and selects the hit.
// Clicking a group's title opens the note.
export function HitList({
  groups,
  label
}: {
  groups: HitGroup[]
  label: string
}): React.JSX.Element {
  return (
    <ul className="hit-list" aria-label={label}>
      {groups.map((group) => (
        <li key={group.path} className="hit-group" data-path={group.path}>
          <button
            type="button"
            className="hit-title"
            title={group.path}
            onClick={() => void workspace.open(group.path)}
          >
            <span>{group.path.split('/').pop()?.replace(/\.md$/i, '')}</span>
            {group.count > 0 && <span className="hit-group-count">{group.count}</span>}
          </button>
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
