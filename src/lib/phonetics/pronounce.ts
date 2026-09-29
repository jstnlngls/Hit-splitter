import { guessPhones } from './g2p'
import type { Lexicon } from './lexicon'
import { numberToWords } from './numbers'
import { SLANG } from './slang'

export type PronunciationSource = 'dictionary' | 'slang' | 'number' | 'letters' | 'guess'

export interface Pronunciation {
  phones: string[]
  source: PronunciationSource
  /** The words actually said, when they differ from the spelling ("24" → twenty four). */
  spoken?: string[]
}

const LETTER_NAMES: Record<string, string> = {
  a: 'EY1', b: 'B IY1', c: 'S IY1', d: 'D IY1', e: 'IY1', f: 'EH1 F', g: 'JH IY1', h: 'EY1 CH', i: 'AY1',
  j: 'JH EY1', k: 'K EY1', l: 'EH1 L', m: 'EH1 M', n: 'EH1 N', o: 'OW1', p: 'P IY1', q: 'K Y UW1', r: 'AA1 R',
  s: 'EH1 S', t: 'T IY1', u: 'Y UW1', v: 'V IY1', w: 'D AH1 B AH0 L Y UW0', x: 'EH1 K S', y: 'W AY1', z: 'Z IY1',
}

const VOICELESS = new Set(['P', 'T', 'K', 'F', 'TH'])
const SIBILANT = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'JH'])

const split = (pron: string) => pron.split(' ')

function direct(word: string, lex: Lexicon | null): string[] | undefined {
  const slang = SLANG[word]
  if (slang) return split(slang)
  return lex?.get(word)
}

/** Adds a plural/possessive "s": Z after voiced sounds, S after voiceless, IH Z after sibilants. */
function withS(phones: string[]): string[] {
  const last = phones[phones.length - 1].replace(/\d$/, '')
  if (SIBILANT.has(last)) return [...phones, 'IH0', 'Z']
  return [...phones, VOICELESS.has(last) ? 'S' : 'Z']
}

function withEd(phones: string[]): string[] {
  const last = phones[phones.length - 1].replace(/\d$/, '')
  if (last === 'T' || last === 'D') return [...phones, 'IH0', 'D']
  return [...phones, VOICELESS.has(last) || SIBILANT.has(last) ? 'T' : 'D']
}

/** Stems a verb ending might hang off: "vib" → vibe, "shott" → shot. */
function stems(base: string): string[] {
  const out = [base, `${base}e`]
  if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) out.push(base.slice(0, -1))
  if (base.endsWith('i')) out.push(`${base.slice(0, -1)}y`)
  return out
}

const SUFFIXES: [RegExp, (phones: string[]) => string[]][] = [
  [/'s$/, withS],
  [/'ll$/, (p) => [...p, 'AH0', 'L']],
  [/'d$/, (p) => [...p, 'D']],
  [/'ve$/, (p) => [...p, 'AH0', 'V']],
  [/'re$/, (p) => [...p, 'ER0']],
  [/in'?$/, (p) => [...p, 'IH0', 'N']],
  [/ing$/, (p) => [...p, 'IH0', 'NG']],
  [/ed$/, withEd],
  [/es$/, withS],
  [/s$/, withS],
  [/z$/, (p) => [...p, 'Z']],
  [/ers?$/, (p) => [...p, 'ER0']],
  [/a$/, (p) => [...p, 'AH0']],
  [/est$/, (p) => [...p, 'AH0', 'S', 'T']],
  [/ly$/, (p) => [...p, 'L', 'IY0']],
  [/ness$/, (p) => [...p, 'N', 'AH0', 'S']],
  [/less$/, (p) => [...p, 'L', 'AH0', 'S']],
  [/y$/, (p) => [...p, 'IY0']],
]

function withSuffix(word: string, lex: Lexicon | null): string[] | undefined {
  for (const [pattern, attach] of SUFFIXES) {
    const match = pattern.exec(word)
    if (!match) continue
    const base = word.slice(0, match.index)
    if (base.replace(/'/g, '').length < 2) continue
    for (const stem of stems(base)) {
      const phones = direct(stem, lex)
      if (phones) return attach(phones)
    }
  }
  return undefined
}

/** Two known words run together: "trapstar", "beatmaker". */
function compound(word: string, lex: Lexicon | null): string[] | undefined {
  if (!lex || word.length < 6) return undefined
  let best: string[] | undefined
  let bestScore = 0
  for (let cut = 3; cut <= word.length - 3; cut++) {
    const left = direct(word.slice(0, cut), lex)
    const right = direct(word.slice(cut), lex)
    if (!left || !right) continue
    const score = Math.min(cut, word.length - cut)
    if (score > bestScore) {
      bestScore = score
      best = [...left, ...right.map((p) => p.replace(/1$/, '2'))]
    }
  }
  return best
}

export function pronounce(raw: string, lex: Lexicon | null, acronym = false): Pronunciation {
  const word = raw.toLowerCase().replace(/[’‘`]/g, "'")

  if (word === '&') return { phones: direct('and', lex) ?? ['AE1', 'N', 'D'], source: 'dictionary', spoken: ['and'] }

  if (/^'?\d/.test(word)) {
    const spoken = numberToWords(word)
    if (spoken.length) {
      return { phones: spoken.flatMap((w) => direct(w, lex) ?? guessPhones(w)), source: 'number', spoken }
    }
  }

  if (acronym && /^[a-z]+$/.test(word)) {
    // Letters are stressed on the last one: em-SEE, dee-JAY.
    const phones = [...word].flatMap((letter, i) =>
      split(LETTER_NAMES[letter]).map((p) => (i < word.length - 1 ? p.replace(/1$/, '2') : p)),
    )
    return { phones, source: 'letters', spoken: [...word].map((l) => l.toUpperCase()) }
  }

  const bare = word.replace(/^'+|'+$/g, '')
  const plain = bare.replace(/'/g, '')
  for (const candidate of [word, bare, plain]) {
    if (!candidate) continue
    if (SLANG[candidate]) return { phones: split(SLANG[candidate]), source: 'slang' }
    const phones = lex?.get(candidate)
    if (phones) return { phones, source: 'dictionary' }
  }

  // Dropped g: "hustlin'" is said like "hustling" but ends on N.
  if (/in'?$/.test(word) && lex) {
    const full = lex.get(`${word.replace(/'$/, '')}g`)
    if (full && full[full.length - 1] === 'NG') return { phones: [...full.slice(0, -1), 'N'], source: 'dictionary' }
  }

  const derived = withSuffix(bare, lex) ?? compound(plain, lex)
  if (derived) return { phones: derived, source: 'dictionary' }

  return { phones: guessPhones(plain), source: 'guess' }
}
