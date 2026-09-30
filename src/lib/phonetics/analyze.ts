import { soundOf, type Sound, type Stress, type Vowel } from './arpabet'
import type { Lexicon } from './lexicon'
import { pronounce, type Pronunciation, type PronunciationSource } from './pronounce'
import { splitSpelling } from './spelling'
import { syllabifyPhones, type PhoneSyllable } from './syllabify'
import { tokenizeLyrics, type LineToken } from './tokenize'

export interface Syllable {
  id: number
  bar: number
  line: number
  word: number
  indexInWord: number
  wordSize: number
  /** The written chunk shown in blocks: "spa", "ghet", "ti". */
  text: string
  /** Where the syllable sits in the lyrics text (the whole token for numbers). */
  start: number
  end: number
  vowel: Vowel
  stress: Stress
  onset: string[]
  coda: string[]
  sound: Sound
  /** Function words and unstressed syllables: they ride between the beats. */
  weak: boolean
  adlib: boolean
  guessed: boolean
  wordFinal: boolean
  lineFinal: boolean
  pauseAfter: boolean
}

export interface Word {
  id: number
  text: string
  norm: string
  start: number
  end: number
  line: number
  bar: number
  syllables: number[]
  phones: string[]
  source: PronunciationSource
  adlib: boolean
  function: boolean
}

export interface Bar {
  index: number
  line: number
  section: number
  text: string
  start: number
  end: number
  /** Main-vocal syllables in order (ad-libs excluded). */
  syllables: number[]
  adlibs: number[]
  words: number[]
}

export interface Section {
  index: number
  label: string | null
  bars: number[]
}

export interface LyricsAnalysis {
  text: string
  lines: LineToken[]
  sections: Section[]
  bars: Bar[]
  words: Word[]
  syllables: Syllable[]
  /** Line index → bar index, or -1 for blank lines and headers. */
  lineToBar: number[]
}

// Words that carry grammar rather than meaning; they rarely anchor a rhyme.
const FUNCTION_WORDS = new Set(
  (
    "a an the and or but nor so if of to in on at by for from with as into onto than then is am are was were be been " +
    "it its it's i i'm i'ma im me my you your you're ya he him his she her we us our they them their this that these " +
    "those do does did have has had can could would should will 'll 'em em ain't don't won't can't just"
  ).split(' '),
)

interface WordShape {
  pron: Pronunciation
  syllables: PhoneSyllable[]
  chunks: string[]
}

// Word shapes depend only on the token and the dictionary, so re-analysis on
// every keystroke only pays for words it has not seen yet.
let cache = new Map<string, WordShape>()
let cachedFor: Lexicon | null | undefined

const SHORT_VOWELS = new Set(['AE', 'EH', 'IH', 'AA', 'AH', 'UH'])

const closedSyllables = (syllables: PhoneSyllable[]) => syllables.map((s) => s.stress > 0 && SHORT_VOWELS.has(s.vowel))

function shapeOf(text: string, lex: Lexicon | null, acronym: boolean): WordShape {
  if (cachedFor !== lex) {
    cache = new Map()
    cachedFor = lex
  }
  const key = acronym ? `#${text}` : text
  let shape = cache.get(key)
  if (!shape) {
    const pron = pronounce(text, lex, acronym)
    const syllables = syllabifyPhones(pron.phones)
    shape = { pron, syllables, chunks: chunksFor(text, pron, syllables, lex) }
    cache.set(key, shape)
  }
  return shape
}

/** Written chunks for a pronunciation, so blocks read like the lyric. */
function chunksFor(text: string, pron: Pronunciation, syllables: PhoneSyllable[], lex: Lexicon | null): string[] {
  const count = syllables.length
  if (!pron.spoken) return splitSpelling(text, count, closedSyllables(syllables))
  if (pron.source === 'letters') {
    // One chunk per letter; W takes three syllables.
    return pron.spoken.flatMap((letter) => (letter === 'W' ? [letter, '·', '·'] : [letter])).slice(0, count)
  }
  // Numbers: show the spoken words' syllables ("twen", "ty", "four").
  return pron.spoken.flatMap((w) => {
    const shape = shapeOf(w, lex, false)
    return shape.chunks.length ? shape.chunks : [w]
  })
}

export function analyzeLyrics(text: string, lex: Lexicon | null): LyricsAnalysis {
  const { lines, sections: sectionTokens } = tokenizeLyrics(text)
  const words: Word[] = []
  const syllables: Syllable[] = []
  const bars: Bar[] = []
  const lineToBar = lines.map(() => -1)
  const sections: Section[] = sectionTokens.map((s) => ({ index: s.index, label: s.label, bars: [] }))

  for (const line of lines) {
    if (line.kind !== 'lyric') continue
    const bar: Bar = {
      index: bars.length,
      line: line.index,
      section: line.section,
      text: line.text,
      start: line.start,
      end: line.end,
      syllables: [],
      adlibs: [],
      words: [],
    }
    lineToBar[line.index] = bar.index
    if (line.section >= 0) sections[line.section].bars.push(bar.index)
    bars.push(bar)

    const lastMain = line.words.findLastIndex((w) => !w.adlib)
    line.words.forEach((token, t) => {
      const { pron, syllables: phoneSyllables, chunks } = shapeOf(token.text, lex, token.acronym)
      if (phoneSyllables.length === 0) return
      const norm = token.text.toLowerCase().replace(/[’‘`]/g, "'")
      const word: Word = {
        id: words.length,
        text: token.text,
        norm,
        start: token.start,
        end: token.end,
        line: line.index,
        bar: bar.index,
        syllables: [],
        phones: pron.phones,
        source: pron.source,
        adlib: token.adlib,
        function: FUNCTION_WORDS.has(norm.replace(/^'+|'+$/g, '')) || FUNCTION_WORDS.has(norm),
      }
      words.push(word)
      bar.words.push(word.id)

      let cursor = token.start
      phoneSyllables.forEach((ps, k) => {
        const chunk = chunks[k] ?? '·'
        let start = token.start
        let end = token.end
        if (!pron.spoken) {
          start = cursor
          end = Math.min(token.end, cursor + chunk.length)
          cursor = end
        }
        const syllable: Syllable = {
          id: syllables.length,
          bar: bar.index,
          line: line.index,
          word: word.id,
          indexInWord: k,
          wordSize: phoneSyllables.length,
          text: chunk,
          start,
          end,
          vowel: ps.vowel,
          stress: ps.stress,
          onset: ps.onset,
          coda: ps.coda,
          sound: soundOf(ps.vowel, ps.stress),
          weak: word.function || ps.stress === 0,
          adlib: token.adlib,
          guessed: pron.source === 'guess',
          wordFinal: k === phoneSyllables.length - 1,
          lineFinal: !token.adlib && t === lastMain && k === phoneSyllables.length - 1,
          pauseAfter: k === phoneSyllables.length - 1 && token.pauseAfter,
        }
        syllables.push(syllable)
        word.syllables.push(syllable.id)
        if (token.adlib) bar.adlibs.push(syllable.id)
        else bar.syllables.push(syllable.id)
      })
    })
  }

  return { text, lines, sections, bars, words, syllables, lineToBar }
}
