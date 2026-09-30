import type { Plugin } from 'vite'

/**
 * Serves the CMU Pronouncing Dictionary to the app as `virtual:cmudict`,
 * packed into a compact text format so the lazily-loaded chunk stays small.
 *
 * Format (newline separated):
 *   line 0: the phoneme symbols, space separated, in code order
 *   line 1: the one-character codes, in the same order
 *   rest:   "<word> <codes>" — one code character per phoneme
 */
const VIRTUAL_ID = 'virtual:cmudict'
const RESOLVED_ID = '\0' + VIRTUAL_ID

const VOWELS = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']
const CONSONANTS = [
  'B', 'CH', 'D', 'DH', 'F', 'G', 'HH', 'JH', 'K', 'L', 'M', 'N', 'NG',
  'P', 'R', 'S', 'SH', 'T', 'TH', 'V', 'W', 'Y', 'Z', 'ZH',
]
const SYMBOLS = [...VOWELS.flatMap((v) => [`${v}0`, `${v}1`, `${v}2`]), ...CONSONANTS]
const CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,-./:;<=>?@[]^_{|}~'

const WORD = /^'?[a-z][a-z']*$/

// A few entries carry trailing notes such as "# place, danish".
const stripNote = (pron: string) => pron.split('#')[0].trim()

const LONG_VOWEL = /^(AY|AW|UW|AO|OW|OY)1$/

/**
 * Whether `alt` is the everyday contraction of `first` that rappers use:
 * "fire" F AY1 ER0 → F AY1 R, "jewel" JH UW1 AH0 L → JH UW1 L,
 * "hustling" HH AH1 S AH0 L IH0 NG → HH AH1 S L IH0 NG.
 */
export function isEverydayVariant(first: string[], alt: string[]): boolean {
  const target = alt.join(' ')
  for (let i = 1; i < first.length; i++) {
    if (first[i] === 'ER0' && LONG_VOWEL.test(first[i - 1])) {
      if ([...first.slice(0, i), 'R', ...first.slice(i + 1)].join(' ') === target) return true
    }
    if (first[i] === 'AH0' && first[i + 1] === 'L') {
      const ending = first.slice(i + 2).join(' ')
      if (LONG_VOWEL.test(first[i - 1]) || /^(IH0 NG|ER0)( Z)?$/.test(ending)) {
        if ([...first.slice(0, i), ...first.slice(i + 1)].join(' ') === target) return true
      }
    }
  }
  return false
}

export function buildCompactDictionary(dictionary: Record<string, string>): string {
  const codeFor = new Map(SYMBOLS.map((s, i) => [s, CODES[i]]))
  const lines = [SYMBOLS.join(' '), CODES.slice(0, SYMBOLS.length)]
  for (const word of Object.keys(dictionary)) {
    if (!WORD.test(word)) continue
    // Keep the canonical pronunciation unless the dictionary also lists the
    // contracted form most people say (and rap).
    let pron = stripNote(dictionary[word])
    for (let i = 2; dictionary[`${word}(${i})`]; i++) {
      const alt = dictionary[`${word}(${i})`]
      if (!alt.includes('#') && isEverydayVariant(pron.split(' '), alt.split(' '))) {
        pron = alt
        break
      }
    }
    // A final "-y" is unstressed ("probably", "nobody"); a few entries mark it
    // with secondary stress, which would make it look like a rhyme anchor.
    const phones = pron.split(' ')
    const last = phones.findLastIndex((p) => /\d$/.test(p))
    if (/(y|ey|ie)$/.test(word) && phones[last] === 'IY2' && phones.filter((p) => /\d$/.test(p)).length > 1) phones[last] = 'IY0'
    let encoded = ''
    for (const phone of phones) {
      const code = codeFor.get(phone)
      if (!code) throw new Error(`Unknown phoneme ${phone} in "${word}"`)
      encoded += code
    }
    lines.push(`${word} ${encoded}`)
  }
  return lines.join('\n')
}

export function cmudict(): Plugin {
  return {
    name: 'hit-splitter:cmudict',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined
    },
    async load(id) {
      if (id !== RESOLVED_ID) return undefined
      const { dictionary } = await import('cmu-pronouncing-dictionary')
      return `export default ${JSON.stringify(buildCompactDictionary(dictionary))}`
    },
  }
}
