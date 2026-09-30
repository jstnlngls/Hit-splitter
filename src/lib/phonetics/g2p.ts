import type { Vowel } from './arpabet'

/**
 * Letter-to-sound guesses for words the dictionary does not know: slang,
 * made-up words, names, typos. The aim is the right syllable count and a
 * plausible vowel sound for rhyme matching, not a perfect transcription.
 */

type Seg = { kind: 'C'; phone: string } | { kind: 'V'; vowel: Vowel; reducible: boolean }

const SIMPLE: Record<string, string> = {
  b: 'B', d: 'D', f: 'F', j: 'JH', k: 'K', l: 'L', m: 'M', n: 'N', p: 'P', r: 'R', t: 'T', v: 'V', w: 'W', z: 'Z',
}
const LONG: Record<string, Vowel> = { a: 'EY', e: 'IY', i: 'AY', o: 'OW', u: 'UW', y: 'AY' }
const SHORT: Record<string, Vowel> = { a: 'AE', e: 'EH', i: 'IH', o: 'AA', u: 'AH', y: 'IH' }
const VOICED = new Set(['b', 'd', 'g', 'l', 'm', 'n', 'r', 'v', 'w', 'z'])
const UNSTRESSED_PREFIX = /^(be|de|re|pre|con|com|ex|un|dis|mis)[^aeiou]/

/** Whether the letter at k acts as a vowel ("y" in "shawty" does, in "you" it does not). */
export function isVowelAt(w: string, k: number): boolean {
  const c = w[k]
  if (c === undefined) return false
  if (c === 'y') return k > 0 && !'aeiou'.includes(w[k - 1])
  if (!'aeiou'.includes(c)) return false
  // The u in "quick" and "guess" is part of the consonant.
  if (c === 'u' && k > 0 && (w[k - 1] === 'q' || (w[k - 1] === 'g' && isVowelAt(w, k + 1)))) return false
  return true
}

const isConsonantAt = (w: string, k: number) => k < w.length && !isVowelAt(w, k)

/** Vowel teams, longest first. */
const TEAMS: [string, (w: string, i: number, hasVowelBefore: boolean) => Vowel[]][] = [
  ['eigh', () => ['EY']],
  ['augh', () => ['AO']],
  ['ough', () => ['AO']],
  ['igh', () => ['AY']],
  ['eau', () => ['OW']],
  ['iew', () => ['UW']],
  ['ai', () => ['EY']],
  ['ay', () => ['EY']],
  ['au', () => ['AO']],
  ['aw', () => ['AO']],
  ['ee', () => ['IY']],
  ['ei', () => ['EY']],
  ['ey', (w, i, before) => (i + 2 === w.length && before ? ['IY'] : ['EY'])],
  ['eu', () => ['UW']],
  ['ew', () => ['UW']],
  ['ie', (w, i, before) => (i + 2 === w.length && !before ? ['AY'] : ['IY'])],
  ['oa', () => ['OW']],
  ['oe', () => ['OW']],
  ['oi', () => ['OY']],
  ['oy', () => ['OY']],
  ['oo', (w, i) => (w[i + 2] === 'k' ? ['UH'] : ['UW'])],
  ['ou', () => ['AW']],
  ['ow', (w, i) => (i + 2 === w.length ? ['OW'] : ['AW'])],
  ['ue', () => ['UW']],
  ['ui', () => ['UW']],
  ['uy', () => ['AY']],
  ['ia', () => ['IY', 'AH']],
  ['io', () => ['IY', 'OW']],
  ['eo', () => ['IY', 'OW']],
]

export function guessPhones(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return []
  if (!/[aeiouy]/.test(w) || ![...w].some((_, k) => isVowelAt(w, k))) return noVowelWord(w)

  const segs: Seg[] = []
  const silent = new Set<number>()
  const hasVowel = () => segs.some((s) => s.kind === 'V')
  const vowel = (v: Vowel, reducible = true) => segs.push({ kind: 'V', vowel: v, reducible })
  const cons = (...phones: string[]) => phones.forEach((phone) => segs.push({ kind: 'C', phone }))

  let i = 0
  while (i < w.length) {
    if (silent.has(i)) {
      i++
      continue
    }
    const rest = w.slice(i)
    const c = w[i]

    if (isVowelAt(w, i)) {
      // Endings first.
      if (rest === 'ous') {
        vowel('AH')
        cons('S')
        break
      }
      if (c === 'e' && i === w.length - 1) {
        if (!hasVowel()) vowel('IY', false) // me, we, she
        break
      }
      if (c === 'e' && i === w.length - 2 && (w[i + 1] === 's' || w[i + 1] === 'd')) {
        const before = w.slice(Math.max(0, i - 2), i)
        const syllabic = w[i + 1] === 's' ? /(s|x|z|ch|sh)$/.test(before) : /[td]$/.test(before)
        if (syllabic) vowel('IH')
        i++
        continue
      }
      if (rest.startsWith('ear')) {
        if (isConsonantAt(w, i + 3)) {
          vowel('ER', false) // earn, heard
          i += 3
        } else {
          vowel('IH', false) // fear, clear
          i += 2
        }
        continue
      }
      const team = TEAMS.find(([spelling]) => rest.startsWith(spelling))
      if (team) {
        const vowels = team[1](w, i, hasVowel())
        vowels.forEach((v, k) => vowel(v, k > 0 || vowels.length > 1))
        i += team[0].length
        continue
      }
      // R-controlled: car, for, her, bird, turn.
      if (w[i + 1] === 'r' && w[i + 2] !== 'r' && !isVowelAt(w, i + 2)) {
        if (c === 'a' || c === 'o') {
          vowel(c === 'a' ? 'AA' : 'AO', false)
          i++
        } else {
          vowel('ER', false)
          i += 2
        }
        continue
      }
      // Silent-e words: make, vibe, smoke, flute, and fire/care/more/sure/here.
      const e = i + 2
      const magic =
        isConsonantAt(w, i + 1) &&
        !'wxy'.includes(w[i + 1]) &&
        w[e] === 'e' &&
        (e === w.length - 1 || (e === w.length - 2 && 'sd'.includes(w[e + 1])) || /^(ly|ful|ment|ness)$/.test(w.slice(e + 1)))
      if (magic && c !== 'y') {
        silent.add(e)
        if (w[i + 1] === 'r') {
          const rVowel: Record<string, Vowel> = { a: 'EH', e: 'IH', i: 'AY', o: 'AO', u: 'UH' }
          vowel(rVowel[c], false)
        } else if (w[i + 1] === 'v' && (c === 'o' || c === 'i')) {
          vowel(c === 'o' ? 'AH' : 'IH') // love, give
        } else {
          vowel(LONG[c], false)
        }
        i++
        continue
      }
      if (i === w.length - 1) {
        const before = hasVowel()
        const final: Record<string, Vowel> = {
          a: before ? 'AH' : 'AA',
          i: before ? 'IY' : 'AY',
          o: 'OW',
          u: 'UW',
          y: before ? 'IY' : 'AY',
        }
        vowel(final[c], c === 'a')
        break
      }
      // Open "o" is usually long: homie, promo, solo, over.
      if (c === 'o' && isConsonantAt(w, i + 1) && isVowelAt(w, i + 2) && w[i + 1] !== w[i + 2]) {
        vowel('OW', false)
        i++
        continue
      }
      vowel(SHORT[c])
      i++
      continue
    }

    // Consonants.
    if (rest.startsWith('tch')) {
      cons('CH')
      i += 3
    } else if (rest.startsWith('sch')) {
      cons('S', 'K')
      i += 3
    } else if (/^(tion|sion)/.test(rest)) {
      cons(c === 's' && i > 0 && isVowelAt(w, i - 1) ? 'ZH' : 'SH')
      vowel('AH')
      cons('N')
      i += 4
    } else if (/^(cial|tial)/.test(rest)) {
      cons('SH')
      vowel('AH')
      cons('L')
      i += 4
    } else if (/^(cious|tious)/.test(rest)) {
      cons('SH')
      vowel('AH')
      cons('S')
      i += 5
    } else if (rest.startsWith('ture')) {
      cons('CH')
      vowel('ER')
      i += 4
    } else if (rest.startsWith('dge')) {
      cons('JH')
      i += 3
    } else if (rest === 'le' && i > 0 && !isVowelAt(w, i - 1)) {
      vowel('AH') // bottle, hustle
      cons('L')
      break
    } else if (i === 0 && /^(kn|wr|gn|ps)/.test(rest)) {
      cons(rest.startsWith('wr') ? 'R' : rest.startsWith('ps') ? 'S' : 'N')
      i += 2
    } else if (rest === 'mb') {
      cons('M')
      break
    } else if (/^(ch|sh|th|ph|wh|ck|qu|ng|nk|gh)/.test(rest)) {
      const pair = rest.slice(0, 2)
      const map: Record<string, string[]> = {
        ch: ['CH'], sh: ['SH'], th: ['TH'], ph: ['F'], wh: ['W'], ck: ['K'], qu: ['K', 'W'], ng: ['NG'], nk: ['NG', 'K'],
        gh: i === 0 ? ['G'] : [],
      }
      cons(...map[pair])
      i += 2
    } else {
      const doubled = w[i + 1] === c && c !== 'c'
      if (c === 'c') cons(/[eiy]/.test(w[i + 1] ?? '') ? 'S' : 'K')
      else if (c === 'g') cons(/^g(e|i|y)$/.test(rest) ? 'JH' : 'G')
      else if (c === 's') cons(!doubled && i === w.length - 1 && i > 0 && (isVowelAt(w, i - 1) || VOICED.has(w[i - 1])) ? 'Z' : 'S')
      else if (c === 'x') cons(...(i === 0 ? ['Z'] : ['K', 'S']))
      else if (c === 'y') cons('Y')
      else if (c === 'h') {
        if (i === 0 || isVowelAt(w, i + 1)) cons('HH')
      } else if (SIMPLE[c]) cons(SIMPLE[c])
      i += doubled ? 2 : 1
    }
  }

  return withStress(segs, w)
}

function withStress(segs: Seg[], w: string): string[] {
  const vowelCount = segs.filter((s) => s.kind === 'V').length
  const primary = vowelCount > 1 && UNSTRESSED_PREFIX.test(w) ? 1 : 0
  let k = 0
  return segs.map((seg) => {
    if (seg.kind === 'C') return seg.phone
    const stressed = k++ === primary
    if (stressed) return `${seg.vowel}1`
    if (seg.reducible && ['AE', 'AA', 'AH', 'UH'].includes(seg.vowel)) return 'AH0'
    if (seg.reducible && ['EH', 'IH'].includes(seg.vowel)) return 'IH0'
    return `${seg.vowel}0`
  })
}

/** "hmm", "brr", "skrrt", "shh": one syllable carried by a consonant. */
function noVowelWord(w: string): string[] {
  const letters = w.replace(/(.)\1+/g, '$1')
  const phones: string[] = []
  for (let i = 0; i < letters.length; i++) {
    const pair = letters.slice(i, i + 2)
    if (pair === 'sh' || pair === 'ch' || pair === 'th') {
      phones.push(pair.toUpperCase())
      i++
    } else if (letters[i] === 'h') phones.push('HH')
    else if (letters[i] === 'r') phones.push('ER1')
    else if (SIMPLE[letters[i]]) phones.push(SIMPLE[letters[i]])
    else if (letters[i] === 'c' || letters[i] === 'q') phones.push('K')
    else if (letters[i] === 's' || letters[i] === 'x') phones.push('S')
    else if (letters[i] === 'g') phones.push('G')
  }
  if (phones.includes('ER1')) {
    // Keep a single r-vowel: "skrrt" → S K ER T.
    const first = phones.indexOf('ER1')
    return phones.filter((p, k) => p !== 'ER1' || k === first)
  }
  const sonorant = phones.findIndex((p) => p === 'M' || p === 'N' || p === 'L')
  if (sonorant >= 0) phones.splice(sonorant, 0, 'AH1')
  else phones.push('AH1')
  return phones
}
