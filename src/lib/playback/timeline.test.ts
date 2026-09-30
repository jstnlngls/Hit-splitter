import { beforeAll, describe, expect, it } from 'vitest'
import { cuesForBar } from '../flow/cues'
import { GRIDS } from '../flow/grid'
import { placeBar } from '../flow/place'
import { analyzeLyrics } from '../phonetics/analyze'
import { loadLexicon, type Lexicon } from '../phonetics/lexicon'
import { analyzeRhymes } from '../rhyme/rhyme'
import { barAt, barStartTime, buildEvents, DEFAULT_DRUMS, type Timeline } from './timeline'

let lex: Lexicon
beforeAll(async () => {
  lex = await loadLexicon()
})

describe('timeline', () => {
  const t: Timeline = { bpm: 90, firstDownbeat: 0.5, startBar: 3 }

  it('maps lyric bars onto the track clock and back', () => {
    // Lyric bar 0 starts at track bar 3: 0.5 s + 2 bars of 2.667 s.
    expect(barStartTime(t, 0)).toBeCloseTo(0.5 + 2 * (240 / 90), 6)
    const { bar, progress } = barAt(t, barStartTime(t, 1) + 60 / 90)
    expect(bar).toBe(1)
    expect(progress).toBeCloseTo(0.25, 6)
  })

  it('schedules drums, clicks and one voice note per syllable', () => {
    const lyrics = analyzeLyrics('Cold flow, gold throat\nThey told me no', lex)
    const rhymes = analyzeRhymes(lyrics)
    const bars = lyrics.bars.map((b) => ({ grid: GRIDS.sixteenths, placement: placeBar(cuesForBar(lyrics, rhymes, b.index), GRIDS.sixteenths) }))
    const events = buildEvents(t, bars, lyrics, rhymes, -1, 2, { drums: DEFAULT_DRUMS, metronome: true, voice: true })
    const voice = events.filter((e) => e.type === 'voice')
    expect(voice).toHaveLength(lyrics.bars[0].syllables.length + lyrics.bars[1].syllables.length)
    expect(events.filter((e) => e.type === 'click')).toHaveLength(12)
    expect(events.filter((e) => e.type === 'snare')).toHaveLength(6)
    // "Cold" is on beat 1 of lyric bar 0.
    expect(voice[0].time).toBeCloseTo(barStartTime(t, 0), 6)
    for (let i = 1; i < events.length; i++) expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time)
    // Rhyming syllables are flagged so the voice can lift them.
    expect(voice.some((v) => v.type === 'voice' && v.rhyme)).toBe(true)
  })
})
