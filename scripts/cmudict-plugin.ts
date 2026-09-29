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

const syllableCount = (pron: string) => pron.split(' ').filter((p) => /\d$/.test(p)).length

// A few entries carry trailing notes such as "# place, danish".
const stripNote = (pron: string) => pron.split('#')[0].trim()

export function buildCompactDictionary(dictionary: Record<string, string>): string {
  const codeFor = new Map(SYMBOLS.map((s, i) => [s, CODES[i]]))
  const lines = [SYMBOLS.join(' '), CODES.slice(0, SYMBOLS.length)]
  for (const word of Object.keys(dictionary)) {
    if (!WORD.test(word)) continue
    // Keep the canonical pronunciation, except for short words like "fire",
    // "our" and "hour" where a variant drops a syllable the way most people
    // say (and rap) them.
    let pron = stripNote(dictionary[word])
    if (syllableCount(pron) <= 2) {
      for (let i = 2; dictionary[`${word}(${i})`]; i++) {
        const alt = dictionary[`${word}(${i})`]
        if (alt.includes('#')) continue // regional or foreign variant
        if (syllableCount(alt) < syllableCount(pron)) pron = alt
      }
    }
    let encoded = ''
    for (const phone of pron.split(' ')) {
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
