import { isVowelPhone, splitVowelPhone, type Stress, type Vowel } from './arpabet'

export interface PhoneSyllable {
  onset: string[]
  vowel: Vowel
  stress: Stress
  coda: string[]
}

// Consonant clusters English allows at the start of a syllable.
const ONSETS = new Set([
  'P R', 'T R', 'K R', 'B R', 'D R', 'G R', 'F R', 'TH R', 'SH R',
  'P L', 'K L', 'B L', 'G L', 'F L', 'S L',
  'T W', 'K W', 'D W', 'S W', 'TH W', 'G W',
  'S P', 'S T', 'S K', 'S M', 'S N', 'S F',
  'P Y', 'B Y', 'K Y', 'F Y', 'M Y', 'V Y', 'HH Y', 'G Y', 'L Y', 'N Y',
  'S P R', 'S T R', 'S K R', 'S P L', 'S K W', 'S P Y', 'S K Y',
])

const isOnset = (cluster: string[]) =>
  cluster.length === 0 || (cluster.length === 1 ? cluster[0] !== 'NG' : ONSETS.has(cluster.join(' ')))

/**
 * Groups phones into syllables around each vowel, giving consonants between
 * vowels to the following syllable when English allows it (maximal onset).
 * A word with no vowel phone ("hmm" as HH M) becomes one weak syllable.
 */
export function syllabifyPhones(phones: string[]): PhoneSyllable[] {
  const nuclei = phones.flatMap((p, i) => (isVowelPhone(p) ? [i] : []))
  if (nuclei.length === 0) {
    return phones.length ? [{ onset: phones.slice(), vowel: 'AH', stress: 0, coda: [] }] : []
  }
  const syllables: PhoneSyllable[] = nuclei.map((index) => ({ ...splitVowelPhone(phones[index]), onset: [], coda: [] }))
  syllables[0].onset = phones.slice(0, nuclei[0])
  syllables[syllables.length - 1].coda = phones.slice(nuclei[nuclei.length - 1] + 1)
  for (let k = 0; k < nuclei.length - 1; k++) {
    const cluster = phones.slice(nuclei[k] + 1, nuclei[k + 1])
    let split = 0
    while (split < cluster.length && !isOnset(cluster.slice(split))) split++
    syllables[k].coda = cluster.slice(0, split)
    syllables[k + 1].onset = cluster.slice(split)
  }
  return syllables
}
