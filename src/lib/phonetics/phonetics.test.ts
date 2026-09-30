import { beforeAll, describe, expect, it } from 'vitest'
import { analyzeLyrics } from './analyze'
import { guessPhones } from './g2p'
import { loadLexicon, type Lexicon } from './lexicon'
import { numberToWords } from './numbers'
import { pronounce } from './pronounce'
import { splitSpelling } from './spelling'
import { syllabifyPhones } from './syllabify'
import { tokenizeLyrics } from './tokenize'

let lex: Lexicon

beforeAll(async () => {
  lex = await loadLexicon()
})

const syllableCount = (word: string, acronym = false) => syllabifyPhones(pronounce(word, lex, acronym).phones).length

describe('dictionary', () => {
  it('loads the packed CMU dictionary', () => {
    expect(lex.size).toBeGreaterThan(120_000)
    expect(lex.get('money')).toEqual(['M', 'AH1', 'N', 'IY0'])
  })

  it('prefers the everyday form of words like "fire", "our" and "hustling"', () => {
    expect(syllableCount('fire')).toBe(1)
    expect(syllableCount('our')).toBe(1)
    expect(syllableCount('jewels')).toBe(1)
    expect(syllableCount('struggling')).toBe(2)
    expect(syllableCount('every')).toBe(3)
    expect(syllableCount('trying')).toBe(2)
    expect(syllableCount('didn\'t')).toBe(2)
  })
})

describe('syllable counts', () => {
  const cases: [string, number][] = [
    ['money', 2], ['spaghetti', 3], ['already', 3], ['hustlin\'', 2], ['gettin\'', 2], ['nothin', 2],
    ['tryna', 2], ['y\'all', 1], ['\'cause', 1], ['skrrt', 1], ['shawty', 2], ['homies', 2],
    ['vibin', 2], ['drippin', 2], ['trapstar', 2], ['brr', 1], ['hmm', 1], ['didn\'t', 2],
    ['24', 3], ['1996', 5], ['\'96', 3], ['3rd', 1], ['&', 1], ['flexin\'', 2], ['finessed', 2],
  ]
  for (const [word, count] of cases) {
    it(`${word} → ${count}`, () => expect(syllableCount(word)).toBe(count))
  }

  it('spells short all-caps words letter by letter', () => {
    expect(syllableCount('MC', true)).toBe(2)
    expect(syllableCount('DJ', true)).toBe(2)
    expect(pronounce('LA', lex, true).source).toBe('letters')
  })
})

describe('letter-to-sound guesses', () => {
  const vowels = (word: string) => guessPhones(word).filter((p) => /\d$/.test(p))
  it('finds long and short vowels', () => {
    expect(vowels('blorp')).toEqual(['AO1'])
    expect(vowels('snake')).toEqual(['EY1'])
    expect(vowels('glizzy')).toEqual(['IH1', 'IY0'])
    expect(vowels('drako')).toEqual(['AE1', 'OW0'])
    expect(vowels('skeet')).toEqual(['IY1'])
  })

  it('gives vowel-less words one syllable', () => {
    expect(vowels('psst')).toHaveLength(1)
    expect(vowels('grrr')).toEqual(['ER1'])
  })
})

describe('spelling split', () => {
  const cases: [string, number, string][] = [
    ['spaghetti', 3, 'spa-ghet-ti'],
    ['already', 3, 'al-rea-dy'],
    ['money', 2, 'mo-ney'],
    ['baby', 2, 'ba-by'],
    ['hustle', 2, 'hus-tle'],
    ['going', 2, 'go-ing'],
    ['flying', 2, 'fly-ing'],
    ['didn\'t', 2, 'did-n\'t'],
    ['rhythm', 2, 'rhy-thm'],
    ['lion', 2, 'li-on'],
    ['mister', 2, 'mis-ter'],
    ['believe', 2, 'be-lieve'],
    ['wanted', 2, 'wan-ted'],
    ['gettin\'', 2, 'get-tin\''],
    ['Hustlin\'', 2, 'Hust-lin\''],
    ['beautiful', 3, 'beau-ti-ful'],
  ]
  for (const [word, count, expected] of cases) {
    it(`${word} → ${expected}`, () => expect(splitSpelling(word, count).join('-')).toBe(expected))
  }

  it('keeps a consonant with a stressed short vowel', () => {
    expect(splitSpelling('money', 2, [true, false]).join('-')).toBe('mon-ey')
    expect(splitSpelling('sweater', 2, [true, false]).join('-')).toBe('sweat-er')
    expect(splitSpelling('spaghetti', 3, [false, true, false]).join('-')).toBe('spa-ghet-ti')
  })

  it('always returns the requested number of chunks', () => {
    for (const word of ['a', 'I', 'hmm', 'strengths', 'queueing', 'xyz']) {
      for (let n = 1; n <= 4; n++) expect(splitSpelling(word, n)).toHaveLength(n)
    }
  })
})

describe('numbers', () => {
  it('reads numbers the way they are rapped', () => {
    expect(numberToWords('24')).toEqual(['twenty', 'four'])
    expect(numberToWords('1996')).toEqual(['nineteen', 'ninety', 'six'])
    expect(numberToWords('2005')).toEqual(['two', 'thousand', 'five'])
    expect(numberToWords('2024')).toEqual(['twenty', 'twenty', 'four'])
    expect(numberToWords('100')).toEqual(['one', 'hundred'])
    expect(numberToWords('3rd')).toEqual(['third'])
    expect(numberToWords('40th')).toEqual(['fortieth'])
    expect(numberToWords('007')).toEqual(['oh', 'oh', 'seven'])
  })
})

describe('tokenizer', () => {
  it('splits sections, headers, ad-libs and pauses', () => {
    const text = '[Verse 1]\nI been on the grind (yeah), no sleep\nMC in the booth\n\nHook:\n2pac on the speaker'
    const { lines, sections } = tokenizeLyrics(text)
    expect(lines.map((l) => l.kind)).toEqual(['header', 'lyric', 'lyric', 'blank', 'header', 'lyric'])
    expect(sections.map((s) => s.label)).toEqual(['Verse 1', 'Hook'])
    expect(sections[0].lines).toEqual([1, 2])
    const words = lines[1].words
    expect(words.map((w) => w.text)).toEqual(['I', 'been', 'on', 'the', 'grind', 'yeah', 'no', 'sleep'])
    expect(words.find((w) => w.text === 'yeah')?.adlib).toBe(true)
    expect(words.find((w) => w.text === 'grind')?.pauseAfter).toBe(true)
    expect(words.find((w) => w.text === 'no')?.pauseAfter).toBe(false)
    expect(lines[2].words[0].acronym).toBe(true)
    expect(lines[5].words.map((w) => w.text)).toEqual(['2', 'pac', 'on', 'the', 'speaker'])
    for (const line of lines) {
      for (const w of line.words) expect(text.slice(w.start, w.end)).toBe(w.text)
    }
  })
})

describe('analyzeLyrics', () => {
  it('turns lines into bars of syllables with source offsets', () => {
    const text = 'Spaghetti on my sweater, already\nMoney talk (ayy)'
    const a = analyzeLyrics(text, lex)
    expect(a.bars).toHaveLength(2)
    const first = a.bars[0].syllables.map((id) => a.syllables[id].text)
    expect(first).toEqual(['Spa', 'ghet', 'ti', 'on', 'my', 'sweat', 'er', 'al', 'read', 'y'])
    expect(a.bars[1].adlibs).toHaveLength(1)
    const last = a.syllables[a.bars[0].syllables.at(-1)!]
    expect(last.lineFinal).toBe(true)
    expect(last.sound).toBe('IY')
    for (const s of a.syllables) expect(text.slice(s.start, s.end).toLowerCase()).toBe(s.text.toLowerCase())
  })

  it('marks function words as weak', () => {
    const a = analyzeLyrics('the money in the bag', lex)
    const weak = a.syllables.map((s) => s.weak)
    expect(weak).toEqual([true, false, true, true, true, false])
  })
})
