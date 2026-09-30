import { memo, useMemo } from 'react'
import type { Analysis } from '../app/useAnalysis'
import { SOUND_INFO, SOUNDS, type Sound } from '../lib/phonetics/arpabet'
import type { Bar, LyricsAnalysis } from '../lib/phonetics/analyze'
import type { RhymeAnalysis } from '../lib/rhyme/rhyme'

interface RhymeViewProps {
  analysis: Analysis
  activeLine: number
  onSelectLine(line: number): void
}

function Stats({ rhymes, bars }: { rhymes: RhymeAnalysis; bars: number }) {
  const { stats } = rhymes
  return (
    <div className="stat-row">
      <div className="stat">
        <b>{Math.round(stats.density * 100)}%</b>
        <span>Syllables rhyming</span>
      </div>
      <div className="stat">
        <b>{stats.multis}</b>
        <span>Multi rhymes</span>
      </div>
      <div className="stat">
        <b>{stats.internal}</b>
        <span>Internal rhymes</span>
      </div>
      <div className="stat">
        <b>
          {stats.endRhymes}/{bars}
        </b>
        <span>Lines end on a rhyme</span>
      </div>
      <div className="stat">
        <b>{stats.longest || '–'}</b>
        <span>Longest multi</span>
      </div>
    </div>
  )
}

/** Every bar as a strip of syllable squares: the song's rhyme structure at a glance. */
const RhymeMap = memo(function RhymeMap({ lyrics, rhymes, activeBar, onSelectLine }: { lyrics: LyricsAnalysis; rhymes: RhymeAnalysis; activeBar: number; onSelectLine(line: number): void }) {
  return (
    <div className="rhyme-map" role="list" aria-label="Rhyme map">
      {lyrics.sections.map((section) =>
        section.bars.map((b, k) => {
          const bar = lyrics.bars[b]
          return (
            <button
              type="button"
              role="listitem"
              key={b}
              className={b === activeBar ? 'map-row is-active' : 'map-row'}
              style={k === 0 && section.index > 0 ? { marginTop: 8 } : undefined}
              onClick={() => onSelectLine(bar.line)}
              title={bar.text}
            >
              <span className="map-no">{b + 1}</span>
              {bar.syllables.map((id) => {
                const s = lyrics.syllables[id]
                return <i key={id} className={s.indexInWord === 0 && id !== bar.syllables[0] ? 'map-cell is-gap' : 'map-cell'} data-snd={rhymes.sound[id] ?? undefined} />
              })}
              {rhymes.scheme[b] && <span className="map-letter">{rhymes.scheme[b]}</span>}
            </button>
          )
        }),
      )}
    </div>
  )
})

function BlockRow({ bar, lyrics, rhymes, onSelectLine }: { bar: Bar; lyrics: LyricsAnalysis; rhymes: RhymeAnalysis; onSelectLine(line: number): void }) {
  const words = bar.words.filter((w) => !lyrics.words[w].adlib)
  const last = bar.syllables[bar.syllables.length - 1]
  const letter = rhymes.scheme[bar.index]
  return (
    <div className="block-row">
      <button type="button" className="bar-no bar-text" onClick={() => onSelectLine(bar.line)} title="Show in editor">
        {bar.index + 1}
      </button>
      <div className="blocks">
        {words.length === 0 && <span className="hint">(rest)</span>}
        {words.map((w) => (
          <span className="word-group" key={w}>
            {lyrics.words[w].syllables.map((id) => {
              const s = lyrics.syllables[id]
              const spanId = rhymes.span[id]
              const span = spanId !== null && rhymes.spans[spanId].syllables.length > 1 ? rhymes.spans[spanId] : null
              const cls = [
                'block',
                s.stress === 1 && !s.weak && 'is-stressed',
                span && 'in-span',
                span && span.syllables[0] === id && 'span-start',
                span && span.syllables[span.syllables.length - 1] === id && 'span-end',
              ]
                .filter(Boolean)
                .join(' ')
              const sound = rhymes.sound[id]
              return (
                <span key={id} className={cls} data-snd={sound ?? undefined} title={sound ? `Rhymes on “${SOUND_INFO[sound].label}”` : undefined}>
                  {s.text}
                </span>
              )
            })}
          </span>
        ))}
      </div>
      <span className="scheme-letter" data-snd={letter && last !== undefined ? (rhymes.sound[last] ?? undefined) : undefined} title={letter ? `End rhyme ${letter}` : 'Line end does not rhyme'}>
        {letter ?? '·'}
      </span>
    </div>
  )
}

export function RhymeView({ analysis, activeLine, onSelectLine }: RhymeViewProps) {
  const { lyrics, rhymes } = analysis
  const activeBar = lyrics.lineToBar[activeLine] ?? -1

  const soundsUsed = useMemo(() => {
    const used = new Set<Sound>()
    for (const s of rhymes.sound) if (s && s !== 'SCHWA') used.add(s)
    return SOUNDS.filter((s) => used.has(s))
  }, [rhymes])

  const families = useMemo(
    () =>
      rhymes.families
        .filter((f) => f.spans.length >= 2)
        .sort((a, b) => b.sounds.length - a.sounds.length || b.spans.length - a.spans.length)
        .slice(0, 14),
    [rhymes],
  )

  if (!lyrics.bars.length) {
    return <p className="empty-note">Rhymes show up here as colored blocks once you write a couple of lines.</p>
  }

  return (
    <div>
      <Stats rhymes={rhymes} bars={lyrics.bars.length} />
      <h3 className="section-label">Rhyme map</h3>
      <RhymeMap lyrics={lyrics} rhymes={rhymes} activeBar={activeBar} onSelectLine={onSelectLine} />
      {soundsUsed.length > 0 && (
        <div className="sound-key" aria-label="Sound colors">
          {soundsUsed.map((s) => (
            <span key={s} data-snd={s} title={SOUND_INFO[s].examples}>
              <i />
              {SOUND_INFO[s].label} <small>({SOUND_INFO[s].examples.split(' · ')[0]})</small>
            </span>
          ))}
        </div>
      )}
      {lyrics.sections.map((section) => (
        <section key={section.index}>
          <h3 className="section-label">{section.label ?? (lyrics.sections.length > 1 ? `Section ${section.index + 1}` : 'Blocks')}</h3>
          <div className="block-rows">
            {section.bars.map((b) => (
              <BlockRow key={b} bar={lyrics.bars[b]} lyrics={lyrics} rhymes={rhymes} onSelectLine={onSelectLine} />
            ))}
          </div>
        </section>
      ))}
      {families.length > 0 && (
        <>
          <h3 className="section-label">Rhyme families</h3>
          <div className="families">
            {families.map((f) => (
              <div className="family" key={f.id}>
                <span className="family-sounds">
                  {f.sounds.map((s, k) => (
                    <span key={k} data-snd={s}>
                      {SOUND_INFO[s].label}
                    </span>
                  ))}
                </span>
                <span className="family-words">{f.examples.join(' · ')}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
