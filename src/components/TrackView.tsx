import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import type { TrackStatus } from '../app/useTrack'
import { useThemeVersion } from '../app/useTheme'
import type { FlowTemplate } from '../lib/flow/templates'
import type { Song, TrackInfo } from '../lib/store/songs'
import { Icon } from './Icon'

interface TrackViewProps {
  song: Song
  status: TrackStatus
  lyricBars: number
  activeLine: number
  trackFlows: FlowTemplate[]
  /** Track time being heard, or null. */
  playTime: number | null
  onImport(file: File): void
  /** Builds a demo beat in the browser and imports it. */
  onDemo(): Promise<void>
  onRemove(): void
  onTempo(bpm: number, refine?: boolean): void
  onShiftDownbeat(beats: number): void
  onStartBar(bar: number): void
  onSongFlow(flow: string | null): void
  onLineFlow(flow: string): void
  onPlayFrom(lyricBar: number): void
}

const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function Waveform({ track, bpm, startBar, lyricBars, playTime, onPlayFrom }: { track: TrackInfo; bpm: number; startBar: number; lyricBars: number; playTime: number | null; onPlayFrom(lyricBar: number): void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const themeVersion = useThemeVersion()
  const [width, setWidth] = useState(600)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const height = 96
    el.width = width * dpr
    el.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const css = getComputedStyle(el)
    const color = (name: string) => css.getPropertyValue(name).trim() || '#888'
    const x = (t: number) => (t / track.duration) * width
    const bar = 240 / bpm

    // Where the lyrics sit.
    const lyricStart = track.firstDownbeat + (startBar - 1) * bar
    ctx.fillStyle = color('--accent-soft')
    ctx.fillRect(x(lyricStart), 0, Math.max(2, x(lyricStart + lyricBars * bar) - x(lyricStart)), height)

    // Bar lines, stronger every 4 bars.
    ctx.font = '10px "IBM Plex Mono", monospace'
    for (let b = 0, t = track.firstDownbeat; t < track.duration; b++, t += bar) {
      const strong = b % 4 === 0
      ctx.fillStyle = color(strong ? '--line-strong' : '--line')
      ctx.fillRect(Math.round(x(t)), 0, 1, height)
      if (strong && x(bar * 4) > 26) {
        ctx.fillStyle = color('--ink-3')
        ctx.fillText(String(b + 1), Math.round(x(t)) + 3, 11)
      }
    }

    // Waveform.
    const peaks = track.peaks
    const buckets = peaks.length / 2
    const mid = height / 2 + 6
    const scale = height / 2 - 10
    ctx.fillStyle = color('--ink-2')
    for (let i = 0; i < buckets; i++) {
      const px = (i / buckets) * width
      const lo = peaks[i * 2]
      const hi = peaks[i * 2 + 1]
      ctx.fillRect(px, mid - hi * scale, Math.max(1, width / buckets - 0.4), Math.max(1, (hi - lo) * scale))
    }

    if (playTime !== null && playTime >= 0) {
      ctx.fillStyle = color('--accent')
      ctx.fillRect(Math.round(x(playTime)) - 1, 0, 2, height)
    }
  }, [track, bpm, startBar, lyricBars, playTime, width, themeVersion])

  return (
    <canvas
      ref={canvas}
      className="waveform"
      style={{ height: 96 }}
      role="img"
      aria-label={`Waveform of ${track.name}; lyrics cover bars ${startBar} to ${startBar + lyricBars - 1}. Click to play from a bar.`}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const t = ((e.clientX - rect.left) / rect.width) * track.duration
        const gridBar = Math.floor((t - track.firstDownbeat) / (240 / bpm))
        onPlayFrom(gridBar - (startBar - 1))
      }}
    />
  )
}

function DrumMachine({ pattern }: { pattern: TrackInfo['patterns']['drumPattern'] }) {
  const rows: [string, 'kick' | 'snare' | 'hat'][] = [
    ['Kick', 'kick'],
    ['Snare', 'snare'],
    ['Hats', 'hat'],
  ]
  return (
    <div className="drum-machine" role="table" aria-label="Typical drum pattern per bar">
      <span />
      {Array.from({ length: 16 }, (_, s) => (
        <span key={s} className="step-no">
          {s % 4 === 0 ? s / 4 + 1 : '·'}
        </span>
      ))}
      {rows.map(([label, key]) => (
        <div key={key} style={{ display: 'contents' }} role="row">
          <span className="row-label">{label}</span>
          {pattern[key].map((level, s) => (
            <span
              key={s}
              className={`pad pad-${key}`}
              style={{ '--level': Math.max(0.05, level) } as CSSProperties}
              title={`${label}, step ${s + 1}: in ${Math.round(level * 100)}% of bars`}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function MiniSteps({ slots, cols = 16 }: { slots: number[]; cols?: number }) {
  const set = new Set(slots)
  const perBeat = cols / 4
  const beatColors = ['--beat-1', '--beat-2', '--beat-3', '--beat-4']
  return (
    <div className="mini-steps" style={{ '--cols': cols } as CSSProperties} aria-hidden="true">
      {Array.from({ length: cols }, (_, s) => (
        <i
          key={s}
          className={[set.has(s) && 'on', s % perBeat === 0 && 'beat'].filter(Boolean).join(' ')}
          style={s % perBeat === 0 ? ({ '--beat-color': `var(${beatColors[s / perBeat]})` } as CSSProperties) : undefined}
        />
      ))}
    </div>
  )
}

/**
 * The vocal-range rhythm of the whole track: each column is a bar, each row
 * a 16th step, darker where a syllable-like onset lands. Repeating flows show
 * up as repeating column shapes; the shaded band is where your lyrics sit.
 */
function VocalMap({ bars, startBar, lyricBars, onPlayFrom }: { bars: number[][]; startBar: number; lyricBars: number; onPlayFrom(lyricBar: number): void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const themeVersion = useThemeVersion()
  const [width, setWidth] = useState(600)
  const height = 16 * 6

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx || !bars.length) return
    const dpr = window.devicePixelRatio || 1
    el.width = width * dpr
    el.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const css = getComputedStyle(el)
    const color = (name: string) => css.getPropertyValue(name).trim() || '#888'
    const w = width / bars.length
    ctx.fillStyle = color('--accent-soft')
    ctx.fillRect((startBar - 1) * w, 0, lyricBars * w, height)
    ctx.fillStyle = color('--ink')
    bars.forEach((steps, b) =>
      steps.forEach((level, s) => {
        if (level < 0.2) return
        ctx.globalAlpha = Math.min(1, level)
        ctx.fillRect(b * w + (w > 3 ? 0.5 : 0), s * 6 + 0.5, Math.max(1, w - (w > 3 ? 1 : 0)), 5)
      }),
    )
    ctx.globalAlpha = 1
    ctx.fillStyle = color('--line-strong')
    for (const beat of [4, 8, 12]) ctx.fillRect(0, beat * 6, width, 1)
  }, [bars, startBar, lyricBars, width, height, themeVersion])

  if (!bars.length) return null
  return (
    <canvas
      ref={canvas}
      className="vocal-map"
      style={{ height }}
      role="img"
      aria-label="Vocal rhythm map: one column per bar, one row per sixteenth note. Click a bar to play from it."
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const bar = Math.floor(((e.clientX - rect.left) / rect.width) * bars.length)
        onPlayFrom(bar - (startBar - 1))
      }}
    />
  )
}

export function TrackView(props: TrackViewProps) {
  const { song, status, lyricBars, trackFlows, playTime } = props
  const input = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [demoPending, setDemoPending] = useState(false)
  const busy = status.phase === 'decoding' || status.phase === 'analyzing' || status.phase === 'restoring'
  const track = song.track

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files[0]
    if (file) props.onImport(file)
  }

  const picker = (
    <input
      ref={input}
      id="track-file"
      type="file"
      accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
      className="sr-only"
      onChange={(e) => {
        const file = e.target.files?.[0]
        if (file) props.onImport(file)
        e.target.value = ''
      }}
    />
  )

  if (!track || status.phase === 'decoding' || (status.phase === 'analyzing' && !track)) {
    return (
      <div
        className={dragOver ? 'dropzone is-over' : 'dropzone'}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {picker}
        {busy ? (
          <>
            <strong>{status.phase === 'decoding' ? 'Opening the file…' : `Listening for the rhythm… ${Math.round((status.progress ?? 0) * 100)}%`}</strong>
            <div className="progress" style={{ width: 'min(320px, 80%)' }}>
              <i style={{ width: `${Math.round((status.progress ?? 0.05) * 100)}%` }} />
            </div>
          </>
        ) : (
          <>
            <strong>Import a beat or a song</strong>
            <p>
              Hit Splitter finds the tempo, where each bar starts, the drum pattern, and the syllable rhythms in the vocal range, then turns them into flows
              you can write to. The audio stays in this browser.
            </p>
            <span className="control">
              <button type="button" className="btn btn-primary" onClick={() => input.current?.click()}>
                <Icon name="upload" /> Choose audio file
              </button>
              <button
                type="button"
                className="btn"
                disabled={demoPending}
                onClick={() => {
                  setDemoPending(true)
                  props.onDemo().finally(() => setDemoPending(false))
                }}
              >
                {demoPending ? 'Building the demo…' : 'Try a demo beat'}
              </button>
            </span>
            <p className="hint">MP3, WAV, M4A, OGG or FLAC. Drop a file here too. Until then, play writes over a built-in boom-bap loop at {song.bpm} BPM.</p>
          </>
        )}
        {status.message && <p className="error-note">{status.message}</p>}
      </div>
    )
  }

  const bar = 240 / song.bpm
  const lyricEndBar = song.startBar + lyricBars - 1
  const candidates = track.bpmCandidates.filter((c) => Math.abs(c.bpm - song.bpm) > 0.3).slice(0, 3)

  return (
    <div>
      {picker}
      <div className="track-summary">
        <span className="track-name">{track.name}</span>
        <span className="hint">
          {formatTime(track.duration)} · detected {track.detectedBpm} BPM · grid confidence {Math.round(track.confidence * 100)}%
        </span>
        <span className="control" style={{ marginLeft: 'auto' }}>
          <button type="button" className="btn btn-small" onClick={() => input.current?.click()}>
            <Icon name="upload" /> Replace
          </button>
          <button type="button" className="btn btn-small btn-ghost" onClick={props.onRemove}>
            <Icon name="trash" /> Remove
          </button>
        </span>
      </div>

      {status.phase === 'restoring' && <p className="hint">Reopening the saved audio…</p>}
      {status.phase === 'analyzing' && (
        <div className="progress" aria-label="Analyzing">
          <i style={{ width: `${Math.round((status.progress ?? 0) * 100)}%` }} />
        </div>
      )}
      {status.message && <p className={status.phase === 'ready' ? 'hint' : 'error-note'}>{status.message}</p>}

      <Waveform track={track} bpm={song.bpm} startBar={song.startBar} lyricBars={lyricBars} playTime={playTime} onPlayFrom={props.onPlayFrom} />
      <p className="hint" style={{ marginTop: 6 }}>
        Shaded: your lyrics (bars {song.startBar}–{Math.max(song.startBar, lyricEndBar)}). Tap the waveform to play from that bar.
      </p>

      <div className="track-grid">
        <div className="control-row">
          <span className="field-label">Tempo</span>
          <span className="control">
            <button type="button" className="btn btn-small" onClick={() => props.onTempo(song.bpm / 2)}>
              ÷2
            </button>
            <button type="button" className="btn btn-small" onClick={() => props.onTempo(song.bpm * 2)}>
              ×2
            </button>
            {candidates.map((c) => (
              <button type="button" key={c.bpm} className="btn btn-small btn-ghost" onClick={() => props.onTempo(c.bpm, true)} title={`Alternative tempo (score ${c.score})`}>
                {c.bpm}
              </button>
            ))}
            <button type="button" className="btn btn-small btn-ghost" onClick={() => props.onTempo(track.detectedBpm, true)} title="Back to the detected tempo">
              Reset
            </button>
          </span>
        </div>
        <div className="control-row">
          <span className="field-label">Beat 1</span>
          <span className="control">
            <button type="button" className="btn btn-small" onClick={() => props.onShiftDownbeat(-1)}>
              <Icon name="left" /> A beat earlier
            </button>
            <button type="button" className="btn btn-small" onClick={() => props.onShiftDownbeat(1)}>
              A beat later <Icon name="right" />
            </button>
          </span>
          <span className="hint">First bar starts at {track.firstDownbeat.toFixed(2)} s</span>
        </div>
        <div className="control-row">
          <span className="field-label">Lyrics start</span>
          <span className="stepper">
            <button type="button" aria-label="Start lyrics a bar earlier" onClick={() => props.onStartBar(Math.max(1, song.startBar - 1))}>
              −
            </button>
            <output aria-live="polite">bar {song.startBar}</output>
            <button type="button" aria-label="Start lyrics a bar later" onClick={() => props.onStartBar(song.startBar + 1)}>
              +
            </button>
          </span>
          <span className="hint">
            {song.startBar > 1 ? `${formatTime(track.firstDownbeat + (song.startBar - 1) * bar)} into the track` : 'from the first bar'}
          </span>
        </div>

        <div>
          <h3 className="section-label">Drum pattern</h3>
          <DrumMachine pattern={track.patterns.drumPattern} />
          <p className="hint" style={{ marginTop: 6 }}>
            Brighter pads hit in more bars. Snares usually mark beats 2 and 4 — land punchlines there.
          </p>
        </div>

        <div>
          <h3 className="section-label">Flows from this track</h3>
          {trackFlows.length === 0 ? (
            <p className="hint">No steady syllable rhythm found in the vocal range. The built-in flows still work with this beat.</p>
          ) : (
            <div className="patterns">
              {trackFlows.map((flow) => {
                const current = song.flow === flow.id
                return (
                  <div className={current ? 'pattern-card is-current' : 'pattern-card'} key={flow.id}>
                    <div className="pattern-head">
                      <span className="pattern-name">{flow.name}</span>
                      <span className="pattern-meta">{flow.slots.length} syllables</span>
                    </div>
                    <MiniSteps slots={flow.slots} />
                    <span className="hint">{flow.description}</span>
                    <span className="control">
                      <button type="button" className="btn btn-small" aria-pressed={current} onClick={() => props.onSongFlow(current ? null : flow.id)}>
                        {current ? 'Song flow ✓' : 'Use for song'}
                      </button>
                      <button type="button" className="btn btn-small btn-ghost" onClick={() => props.onLineFlow(flow.id)}>
                        Use on current line
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <h3 className="section-label">Vocal rhythm map</h3>
          <VocalMap bars={track.patterns.vocalBars} startBar={song.startBar} lyricBars={lyricBars} onPlayFrom={props.onPlayFrom} />
          <p className="hint" style={{ marginTop: 6 }}>
            Each column is a bar, each row a sixteenth (beats 1–4 top to bottom). Dark cells are onsets between 250 Hz and 3.5 kHz: a rapper's syllables on a
            full song or acapella, the melody's rhythm on a beat. Click a bar to play from it.
          </p>
        </div>
      </div>
    </div>
  )
}
