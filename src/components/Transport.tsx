import { useEffect, useRef, useState } from 'react'
import { GRID_KINDS, GRIDS, type GridKind } from '../lib/flow/grid'
import type { FlowTemplate } from '../lib/flow/templates'
import { Icon } from './Icon'

export interface PlayToggles {
  beat: boolean
  voice: boolean
  click: boolean
  loop: boolean
  follow: boolean
}

interface TransportProps {
  playing: boolean
  onPlay(): void
  position: string
  bpm: number
  onBpm(bpm: number): void
  grid: GridKind
  onGrid(grid: GridKind): void
  flow: string | null
  flows: FlowTemplate[]
  onFlow(flow: string | null): void
  toggles: PlayToggles
  onToggle(key: keyof PlayToggles): void
  hasTrack: boolean
}

const TOGGLE_LABELS: [keyof PlayToggles, string, string][] = [
  ['beat', 'Beat', 'Play the track (or the built-in drum loop)'],
  ['voice', 'Voice', 'Sing each syllable’s vowel where it lands, so you can hear the flow'],
  ['click', 'Click', 'Metronome on every beat'],
  ['loop', 'Loop line', 'Repeat the line the cursor is on'],
  ['follow', 'Follow', 'Scroll the bars along with playback'],
]

export function Transport(props: TransportProps) {
  const { playing, bpm, grid, flow, flows, toggles } = props
  const [draft, setDraft] = useState(String(bpm))
  const taps = useRef<number[]>([])

  useEffect(() => setDraft(String(bpm)), [bpm])

  const commit = () => {
    const value = Number(draft)
    if (Number.isFinite(value) && value >= 40 && value <= 240) props.onBpm(value)
    else setDraft(String(bpm))
  }

  const tap = () => {
    const now = performance.now()
    const recent = taps.current.filter((t) => now - t < 2500)
    recent.push(now)
    taps.current = recent.slice(-6)
    if (recent.length >= 3) {
      const gaps = recent.slice(1).map((t, i) => t - recent[i])
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
      props.onBpm(Math.round((60000 / avg) * 10) / 10)
    }
  }

  const builtIn = flows.filter((f) => f.source === 'built-in')
  const fromTrack = flows.filter((f) => f.source === 'track')

  return (
    <div className="transport">
      <button type="button" className="play-btn" onClick={props.onPlay} aria-label={playing ? 'Stop' : 'Play from the current line'} title={playing ? 'Stop (Space)' : 'Play from the current line (Space)'}>
        <Icon name={playing ? 'stop' : 'play'} />
      </button>
      <span className="position" aria-live="off">
        {props.position}
      </span>

      <div className="transport-group">
        <label className="lcd" htmlFor="bpm">
          <input
            id="bpm"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            aria-label="Tempo in BPM"
          />
          <small>BPM</small>
        </label>
        <button type="button" className="btn btn-small" onClick={tap} title="Tap along to set the tempo">
          Tap
        </button>
        {!props.hasTrack && (
          <>
            <button type="button" className="btn btn-small btn-ghost hide-narrow" onClick={() => props.onBpm(Math.round(bpm * 5) / 10)} title="Half tempo">
              ÷2
            </button>
            <button type="button" className="btn btn-small btn-ghost hide-narrow" onClick={() => props.onBpm(Math.min(240, bpm * 2))} title="Double tempo">
              ×2
            </button>
          </>
        )}
      </div>

      <div className="transport-group" role="group" aria-label="Grid">
        <span className="segmented">
          {GRID_KINDS.map((kind) => (
            <button type="button" key={kind} aria-pressed={grid === kind} onClick={() => props.onGrid(kind)} title={GRIDS[kind].hint}>
              {GRIDS[kind].label}
            </button>
          ))}
        </span>
      </div>

      <div className="transport-group">
        <label className="field-label" htmlFor="song-flow">
          Flow
        </label>
        <select id="song-flow" className="select" value={flow ?? ''} onChange={(e) => props.onFlow(e.target.value || null)}>
          <option value="">Free — find the pocket</option>
          <optgroup label="Built-in flows">
            {builtIn.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </optgroup>
          {fromTrack.length > 0 && (
            <optgroup label="From your track">
              {fromTrack.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="transport-group" role="group" aria-label="Playback options">
        {TOGGLE_LABELS.map(([key, label, title]) => (
          <button type="button" key={key} className={`btn btn-small${key === 'follow' || key === 'click' ? ' hide-narrow' : ''}`} aria-pressed={toggles[key]} onClick={() => props.onToggle(key)} title={title}>
            {key === 'loop' && <Icon name="loop" />}
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
