import type { LyricsAnalysis } from '../phonetics/analyze'
import type { RhymeAnalysis } from '../rhyme/rhyme'
import type { SyllableCue } from './place'

/** Placement cues for one bar's main-vocal syllables. */
export function cuesForBar(lyrics: LyricsAnalysis, rhymes: RhymeAnalysis | null, bar: number): SyllableCue[] {
  return lyrics.bars[bar].syllables.map((id) => {
    const s = lyrics.syllables[id]
    const rhyme = rhymes?.sound[id] != null
    return {
      stress: s.stress,
      weak: s.weak,
      wordStart: s.indexInWord === 0,
      pauseAfter: s.pauseAfter,
      rhyme,
      lineEndRhyme: rhyme && s.lineFinal,
    }
  })
}

/** A stable key for a bar's cues, used to memoize placements. */
export const cueKey = (cues: SyllableCue[]) =>
  cues
    .map((c) => `${c.stress}${c.weak ? 'w' : ''}${c.wordStart ? 's' : ''}${c.pauseAfter ? 'p' : ''}${c.rhyme ? 'r' : ''}${c.lineEndRhyme ? 'e' : ''}`)
    .join(',')
