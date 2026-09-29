import type { PlayEvent } from '../audio/player'
import type { BarPlacement } from '../flow/place'
import type { Grid } from '../flow/grid'
import type { LyricsAnalysis } from '../phonetics/analyze'
import type { RhymeAnalysis } from '../rhyme/rhyme'

export interface DrumPattern {
  kick: number[]
  snare: number[]
  hat: number[]
}

/** A straight boom-bap loop for writing before a track is imported. */
export const DEFAULT_DRUMS: DrumPattern = {
  kick: [1, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0.9, 0, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.25],
  hat: [0.9, 0, 0.5, 0, 0.8, 0, 0.5, 0, 0.9, 0, 0.5, 0, 0.8, 0, 0.5, 0.35],
}

export interface TimelineBar {
  grid: Grid
  placement: BarPlacement
}

export interface Timeline {
  bpm: number
  /** Track time of the first downbeat (0 without a track). */
  firstDownbeat: number
  /** Track bar (1-based) where lyric bar 0 starts. */
  startBar: number
}

export const barSeconds = (bpm: number) => 240 / bpm

/** Track-clock time where a lyric bar starts. */
export const barStartTime = (t: Timeline, bar: number) => t.firstDownbeat + (t.startBar - 1 + bar) * barSeconds(t.bpm)

/** Which lyric bar is sounding at a time, and how far through it (0..1). */
export function barAt(t: Timeline, time: number): { bar: number; progress: number } {
  const position = (time - t.firstDownbeat) / barSeconds(t.bpm) - (t.startBar - 1)
  const bar = Math.floor(position)
  return { bar, progress: position - bar }
}

export interface EventOptions {
  drums: DrumPattern | null
  metronome: boolean
  voice: boolean
}

/**
 * Everything to play between two lyric bars: drums and clicks on the
 * 16th-note clock, and one voice note per placed syllable.
 */
export function buildEvents(
  t: Timeline,
  bars: TimelineBar[],
  lyrics: LyricsAnalysis,
  rhymes: RhymeAnalysis | null,
  fromBar: number,
  toBar: number,
  options: EventOptions,
): PlayEvent[] {
  const events: PlayEvent[] = []
  const bar = barSeconds(t.bpm)
  const step = bar / 16

  for (let b = fromBar; b < toBar; b++) {
    const start = barStartTime(t, b)
    for (let s = 0; s < 16; s++) {
      const time = start + s * step
      if (options.drums) {
        const { kick, snare, hat } = options.drums
        if (kick[s] > 0.35) events.push({ time, type: 'kick', level: Math.min(1, kick[s] + 0.2) })
        if (snare[s] > 0.35) events.push({ time, type: 'snare', level: Math.min(1, snare[s] + 0.2) })
        if (hat[s] > 0.3) events.push({ time, type: 'hat', level: Math.min(1, hat[s] + 0.1) })
      }
      if (options.metronome && s % 4 === 0) events.push({ time, type: 'click', accent: s === 0 })
    }

    const lyricBar = bars[b]
    if (!options.voice || !lyricBar || b < 0) continue
    const { grid, placement } = lyricBar
    const slot = bar / grid.slots
    const ids = lyrics.bars[b]?.syllables ?? []
    placement.slots.forEach((position, i) => {
      const syllable = lyrics.syllables[ids[i]]
      if (!syllable) return
      const next = placement.slots[i + 1] ?? position + grid.perBeat
      events.push({
        time: start + position * slot,
        type: 'voice',
        vowel: syllable.vowel,
        stress: syllable.stress,
        consonant: syllable.onset.length > 0,
        duration: Math.max(1, next - position) * slot,
        rhyme: rhymes?.sound[syllable.id] != null,
      })
    })
  }
  return events.sort((a, b) => a.time - b.time)
}
