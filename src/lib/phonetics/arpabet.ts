export const VOWELS = [
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW',
] as const

export type Vowel = (typeof VOWELS)[number]
export type Stress = 0 | 1 | 2

/**
 * The vowel sound a syllable is colored by. Close sounds are merged the way
 * rap rhymes treat them: "caught" (AO) rhymes with "hot" (AA), and unstressed
 * reduced vowels ("the", "-en", "-ing") collapse into one weak schwa.
 */
export const SOUNDS = [
  'AA', 'AE', 'AH', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW', 'SCHWA',
] as const

export type Sound = (typeof SOUNDS)[number]

const VOWEL_SET = new Set<string>(VOWELS)

/** True for an ARPAbet vowel token such as "AH1". */
export const isVowelPhone = (phone: string) => VOWEL_SET.has(phone.slice(0, 2)) && /[012]$/.test(phone)

export function splitVowelPhone(phone: string): { vowel: Vowel; stress: Stress } {
  return { vowel: phone.slice(0, 2) as Vowel, stress: Number(phone[2] ?? 0) as Stress }
}

export function soundOf(vowel: Vowel, stress: Stress): Sound {
  if (stress === 0 && (vowel === 'AH' || vowel === 'IH' || vowel === 'EH' || vowel === 'UH')) return 'SCHWA'
  if (vowel === 'AO') return 'AA'
  return vowel
}

/** How each sound is described to the writer, with words that carry it. */
export const SOUND_INFO: Record<Sound, { label: string; examples: string }> = {
  AA: { label: 'ah', examples: 'hot · car · thought' },
  AE: { label: 'a', examples: 'cat · back · stack' },
  AH: { label: 'uh', examples: 'cut · money · love' },
  AW: { label: 'ow', examples: 'now · out · crown' },
  AY: { label: 'eye', examples: 'night · time · fly' },
  EH: { label: 'eh', examples: 'red · ready · check' },
  ER: { label: 'er', examples: 'word · her · murder' },
  EY: { label: 'ay', examples: 'day · wait · came' },
  IH: { label: 'ih', examples: 'sit · big · this' },
  IY: { label: 'ee', examples: 'see · me · money' },
  OW: { label: 'oh', examples: 'go · hold · flow' },
  OY: { label: 'oy', examples: 'boy · noise · royal' },
  UH: { label: 'oo', examples: 'good · hood · book' },
  UW: { label: 'ooh', examples: 'blue · you · move' },
  SCHWA: { label: 'uh (soft)', examples: 'the · a · -en' },
}
