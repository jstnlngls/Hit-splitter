import { memo, useEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { Analysis, BarView } from '../app/useAnalysis'
import type { PlayheadState } from '../app/usePlayback'
import type { FlowTemplate } from '../lib/flow/templates'
import { SOUND_INFO, type Sound } from '../lib/phonetics/arpabet'
import type { LyricsAnalysis } from '../lib/phonetics/analyze'
import type { Highlight, HighlightKind } from '../lib/store/songs'
import { Icon } from './Icon'

interface FlowViewProps {
  analysis: Analysis
  barViews: BarView[]
  highlights: Highlight[]
  flows: FlowTemplate[]
  activeLine: number
  playhead: PlayheadState | null
  follow: boolean
  onSelectLine(line: number): void
  onLineFlow(line: number, flow: string | null | undefined): void
  onLineShift(line: number, shift: number): void
}

/** Which highlighter (if any) covers each syllable. */
function marksBySyllable(lyrics: LyricsAnalysis, highlights: Highlight[]): Map<number, HighlightKind> {
  const out = new Map<number, HighlightKind>()
  if (!highlights.length) return out
  for (const s of lyrics.syllables) {
    const hit = highlights.find((h) => h.start < s.end && h.end > s.start)
    if (hit) out.set(s.id, hit.kind)
  }
  return out
}

export function fitLabel(view: BarView): { text: string; tone: 'room' | 'fits' | 'tight' | 'over' } {
  const { placement, cues } = view
  const n = cues.length
  if (n === 0) return { text: 'rest bar', tone: 'room' }
  if (placement.spill > 0) return { text: `${placement.spill} over the bar`, tone: 'over' }
  if (placement.over > 0) return { text: `${placement.over} over the flow`, tone: 'over' }
  if (placement.template) {
    if (placement.room === 0) return { text: 'fits the flow', tone: 'fits' }
    return { text: `room for ${placement.room}`, tone: 'room' }
  }
  if (placement.room <= 2) return { text: placement.room === 0 ? 'packed' : `room for ${placement.room}`, tone: 'tight' }
  return { text: `room for ${placement.room}`, tone: 'room' }
}

interface BarRowProps {
  view: BarView
  /** Syllables in the bar this one answers (the first line of its couplet), if any. */
  partner: { index: number; count: number } | null
  lyrics: LyricsAnalysis
  sounds: (Sound | null)[]
  marks: Map<number, HighlightKind>
  flows: FlowTemplate[]
  active: boolean
  nowSlot: number
  onSelectLine(line: number): void
  onLineFlow(line: number, flow: string | null | undefined): void
  onLineShift(line: number, shift: number): void
}

const BarRow = memo(function BarRow({ view, partner, lyrics, sounds, marks, flows, active, nowSlot, onSelectLine, onLineFlow, onLineShift }: BarRowProps) {
  const { bar, grid, placement, shift, customFlow, flow } = view
  const S = grid.slots
  const occupant = new Array<number>(S).fill(-1)
  const outside: { id: number; slot: number }[] = []
  placement.slots.forEach((slot, i) => {
    if (slot >= 0 && slot < S) occupant[slot] = bar.syllables[i]
    else outside.push({ id: bar.syllables[i], slot })
  })
  const room = new Set(placement.template ?? [])
  const fit = fitLabel(view)
  const n = view.cues.length
  const narrowCols = S === 32 ? 8 : S / 2

  return (
    <div className={['bar', active && 'is-active', nowSlot >= 0 && 'is-playing'].filter(Boolean).join(' ')} data-bar={bar.index}>
      <div className="bar-head">
        <span className="bar-no">{String(bar.index + 1).padStart(2, '0')}</span>
        <button type="button" className="bar-text" onClick={() => onSelectLine(bar.line)} title="Show this line in the editor">
          {bar.text.trim() || '(rest)'}
        </button>
        <span className={`fit fit-${fit.tone}`} title={`${n} syllables in a ${placement.capacity}-slot ${flow ? 'flow' : 'bar'}`}>
          {n}/{placement.capacity} · {fit.text}
        </span>
        {partner && n > 0 && Math.abs(n - partner.count) >= 3 && (
          <span className="pair-note" title={`Bar ${partner.index + 1} has ${partner.count} syllables. Couplets usually land closer together.`}>
            {n > partner.count ? '+' : '−'}
            {Math.abs(n - partner.count)} vs bar {partner.index + 1}
          </span>
        )}
        <span className="bar-tools">
          <label className="sr-only" htmlFor={`flow-${bar.line}`}>
            Flow for bar {bar.index + 1}
          </label>
          <select
            id={`flow-${bar.line}`}
            className="select"
            value={customFlow ? (flow?.id ?? 'free') : 'song'}
            onChange={(e) => {
              const v = e.target.value
              onLineFlow(bar.line, v === 'song' ? undefined : v === 'free' ? null : v)
            }}
          >
            <option value="song">Song flow</option>
            <option value="free">Free placement</option>
            {flows.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-ghost btn-icon btn-small" onClick={() => onLineShift(bar.line, shift - 1)} title="Start one slot earlier">
            <Icon name="left" label="Earlier" />
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-small" onClick={() => onLineShift(bar.line, shift + 1)} title="Start one slot later">
            <Icon name="right" label="Later" />
          </button>
          {shift !== 0 && (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => onLineShift(bar.line, 0)} title="Reset timing">
              {shift > 0 ? `+${shift}` : shift}
            </button>
          )}
        </span>
      </div>
      <div className="cells" style={{ '--cols': S, '--cols-narrow': narrowCols } as CSSProperties}>
        {occupant.map((id, slot) => {
          const beat = slot % grid.perBeat === 0 ? slot / grid.perBeat + 1 : 0
          const syl = id >= 0 ? lyrics.syllables[id] : null
          const sound = syl ? sounds[syl.id] : null
          const mark = syl ? marks.get(syl.id) : undefined
          const cls = [
            'cell',
            beat && `is-beat is-beat-${beat}`,
            syl && 'has-syl',
            !syl && room.has(slot) && 'is-room',
            syl && syl.stress === 1 && !syl.weak && 'is-stressed',
            mark && `is-marked is-marked-${mark}`,
            slot === nowSlot && 'is-now',
          ]
            .filter(Boolean)
            .join(' ')
          const title = syl
            ? `${syl.text} · ${syl.stress ? 'stressed' : 'unstressed'}${sound ? ` · rhymes on “${SOUND_INFO[sound].label}”` : ''}${mark ? ` · ${mark}` : ''}`
            : room.has(slot)
              ? 'Open slot in this flow'
              : undefined
          return (
            <div key={slot} className={cls} data-snd={sound ?? undefined} title={title}>
              {syl && <span className="cell-text">{syl.text}</span>}
            </div>
          )
        })}
      </div>
      {(outside.length > 0 || bar.adlibs.length > 0) && (
        <div className="overflow-row">
          {outside.some((o) => o.slot < 0) && <span>Pickup:</span>}
          {outside
            .filter((o) => o.slot < 0)
            .map((o) => (
              <span key={o.id} className="chip">
                {lyrics.syllables[o.id].text}
              </span>
            ))}
          {outside.some((o) => o.slot >= S) && <span>Spills past the bar:</span>}
          {outside
            .filter((o) => o.slot >= S)
            .map((o) => (
              <span key={o.id} className="chip is-spill">
                {lyrics.syllables[o.id].text}
              </span>
            ))}
          {bar.adlibs.length > 0 && (
            <span className="adlibs">Ad-libs: ({bar.adlibs.map((id) => lyrics.syllables[id].text).join('·')})</span>
          )}
        </div>
      )}
    </div>
  )
})

export function FlowView({ analysis, barViews, highlights, flows, activeLine, playhead, follow, onSelectLine, onLineFlow, onLineShift }: FlowViewProps) {
  const { lyrics, rhymes } = analysis
  const marks = useMemo(() => marksBySyllable(lyrics, highlights), [lyrics, highlights])
  const root = useRef<HTMLDivElement>(null)
  const activeBar = lyrics.lineToBar[activeLine] ?? -1
  const playingBar = playhead?.bar ?? -1

  useEffect(() => {
    if (playingBar < 0 || !follow) return
    root.current?.querySelector(`[data-bar="${playingBar}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [playingBar, follow])

  useEffect(() => {
    if (activeBar < 0 || playingBar >= 0) return
    root.current?.querySelector(`[data-bar="${activeBar}"]`)?.scrollIntoView({ block: 'nearest' })
    // Only when the caret moves to another bar, not on every playhead tick.
  }, [activeBar])

  if (!barViews.length) {
    return <p className="empty-note">Write a line in the editor and it shows up here, split into syllables on a 16-step bar.</p>
  }

  return (
    <div ref={root}>
      {lyrics.sections.map((section) => (
        <section key={section.index}>
          <h3 className="section-label">{section.label ?? (lyrics.sections.length > 1 ? `Section ${section.index + 1}` : 'Bars')}</h3>
          <div className="bars">
            {section.bars.map((b, k) => {
              const view = barViews[b]
              if (!view) return null
              // Second line of each couplet in the section answers the first.
              const answer = k % 2 === 1 ? barViews[section.bars[k - 1]] : undefined
              const partner = answer && answer.cues.length ? { index: answer.bar.index, count: answer.cues.length } : null
              const nowSlot = playingBar === b && playhead ? Math.floor(playhead.progress * view.grid.slots) : -1
              return (
                <BarRow
                  key={b}
                  view={view}
                  partner={partner}
                  lyrics={lyrics}
                  sounds={rhymes.sound}
                  marks={marks}
                  flows={flows}
                  active={b === activeBar}
                  nowSlot={nowSlot}
                  onSelectLine={onSelectLine}
                  onLineFlow={onLineFlow}
                  onLineShift={onLineShift}
                />
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
