import { beforeAll, describe, expect, it } from 'vitest'
import { analyzeLyrics } from '../phonetics/analyze'
import { loadLexicon, type Lexicon } from '../phonetics/lexicon'
import { SAMPLE_LYRICS } from '../samples/sampleVerse'
import { analyzeRhymes, codaSimilarity } from './rhyme'

let lex: Lexicon

beforeAll(async () => {
  lex = await loadLexicon()
})

const run = (text: string) => {
  const lyrics = analyzeLyrics(text, lex)
  return { lyrics, rhymes: analyzeRhymes(lyrics) }
}

/** The family whose examples include every given word, if any. */
const familyWith = (r: ReturnType<typeof run>, ...words: string[]) =>
  r.rhymes.families.find((f) => words.every((w) => f.examples.some((e) => e.includes(w))))

describe('codaSimilarity', () => {
  it('ranks exact, plural and same-class endings', () => {
    expect(codaSimilarity(['T'], ['T'])).toBe(1)
    expect(codaSimilarity(['M', 'Z'], ['M'])).toBe(0.9)
    expect(codaSimilarity(['T'], ['K'])).toBe(0.7)
    expect(codaSimilarity(['T'], ['M'])).toBeLessThan(0.5)
    expect(codaSimilarity([], [])).toBe(1)
  })
})

describe('analyzeRhymes', () => {
  it('links a multisyllabic chain across lines', () => {
    const r = run('My pockets heavy, I been ready\nStay steady, eatin\' spaghetti')
    const fam = familyWith(r, 'heavy', 'ready', 'steady', 'ghetti')
    expect(fam?.sounds).toEqual(['EH', 'IY'])
    expect(r.rhymes.scheme).toEqual(['A', 'A'])
    expect(r.rhymes.stats.multis).toBeGreaterThanOrEqual(1)
  })

  it('finds internal perfect rhymes', () => {
    const r = run('I\'m the man with the plan in the van')
    const fam = familyWith(r, 'man', 'plan', 'van')
    expect(fam?.sounds).toEqual(['AE'])
    expect(r.rhymes.stats.internal).toBeGreaterThanOrEqual(2)
  })

  it('treats vowel-matching line endings as end rhymes', () => {
    const r = run('I been up all night\nWorking on my time')
    expect(r.rhymes.scheme).toEqual(['A', 'A'])
  })

  it('does not color unrelated lines', () => {
    const r = run('I like the way you move\nWe can talk about it later')
    expect(r.rhymes.stats.rhymingSyllables).toBe(0)
    expect(r.rhymes.scheme).toEqual([null, null])
  })

  it('skips plain repetition but keeps the rhyme around it', () => {
    const r = run('Take the money\nMake the money')
    expect(familyWith(r, 'take', 'make')).toBeTruthy()
    const moneyIds = r.lyrics.syllables.filter((s) => /^(mon|ey)$/i.test(s.text)).map((s) => s.id)
    expect(moneyIds.every((id) => r.rhymes.sound[id] === null)).toBe(true)
  })

  it('maps the sample verse', () => {
    const r = run(SAMPLE_LYRICS)
    expect(familyWith(r, 'sessions', 'blessing')?.sounds).toEqual(['EH', 'SCHWA'])
    expect(familyWith(r, 'paper', 'hater')?.sounds.slice(-2)).toEqual(['EY', 'ER'])
    expect(familyWith(r, 'rhythm', 'wisdom')?.sounds).toEqual(['IH', 'SCHWA'])
    expect(familyWith(r, 'fever', 'leader')?.sounds).toEqual(['IY', 'ER'])
    expect(r.rhymes.scheme.slice(0, 4)).toEqual(['A', 'A', 'B', 'B'])
    expect(r.rhymes.stats.density).toBeGreaterThan(0.4)
  })

  it('keeps rhymes inside their section', () => {
    const r = run('I been on the grind\n\nAll the time')
    expect(r.rhymes.scheme).toEqual([null, null])
  })
})
