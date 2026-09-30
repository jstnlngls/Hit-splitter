import { HIGHLIGHT_KINDS } from '../lib/store/highlights'
import type { Highlight } from '../lib/store/songs'
import { Icon } from './Icon'

interface FavoritesProps {
  text: string
  /** Line index → bar index (-1 for headers and blank lines). */
  lineToBar: number[]
  highlights: Highlight[]
  onJump(start: number, end: number): void
  onRemove(id: string): void
}

const LABEL = Object.fromEntries(HIGHLIGHT_KINDS.map((k) => [k.kind, k.label]))

export function Favorites({ text, lineToBar, highlights, onJump, onRemove }: FavoritesProps) {
  if (!highlights.length) {
    return (
      <p className="empty-note">
        Select words (or just put the cursor on a line) and hit a highlighter above. Shortcuts: Alt+1 favorite, Alt+2 punchline, Alt+3 needs work, Alt+0 erase.
      </p>
    )
  }
  return (
    <div className="favorites">
      {HIGHLIGHT_KINDS.flatMap(({ kind }) =>
        highlights
          .filter((h) => h.kind === kind)
          .map((h) => {
            const line = text.slice(0, h.start).split('\n').length - 1
            const bar = lineToBar[line] ?? -1
            return (
              <div className="fav" key={h.id}>
                <span className={`swatch swatch-${h.kind}`} title={LABEL[h.kind]} />
                <span>
                  <span className="fav-text">{text.slice(h.start, h.end)}</span>
                  <span className="fav-meta">
                    {' '}
                    · {LABEL[h.kind]}
                    {bar >= 0 ? ` · bar ${bar + 1}` : ''}
                  </span>
                </span>
                <span className="control">
                  <button type="button" className="btn btn-ghost btn-icon btn-small" onClick={() => onJump(h.start, h.end)} title="Show in the lyrics" aria-label="Show in the lyrics">
                    <Icon name="jump" />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon btn-small" onClick={() => onRemove(h.id)} title="Remove highlight" aria-label="Remove highlight">
                    <Icon name="close" />
                  </button>
                </span>
              </div>
            )
          }),
      )}
    </div>
  )
}
