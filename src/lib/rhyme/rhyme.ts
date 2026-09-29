import type { LyricsAnalysis, Syllable } from '../phonetics/analyze'
import type { Sound } from '../phonetics/arpabet'

export interface RhymeSpan {
  id: number
  family: number
  /** Consecutive main-vocal syllables that rhyme with another span. */
  syllables: number[]
  bar: number
  lineEnd: boolean
}

export interface RhymeFamily {
  id: number
  /** The vowel run the spans share, e.g. EH·IY for heavy / ready / spaghetti. */
  sounds: Sound[]
  spans: number[]
  section: number
  /** The rhymed words, first few, for the legend. */
  examples: string[]
}

export interface RhymeStats {
  syllables: number
  rhymingSyllables: number
  /** Share of syllables that are part of a rhyme, 0..1. */
  density: number
  /** Rhyme families that span two or more syllables. */
  multis: number
  /** Rhymes inside a line rather than at its end. */
  internal: number
  /** Bars whose last word rhymes. */
  endRhymes: number
  /** Syllables in the longest multisyllabic rhyme. */
  longest: number
}

export interface RhymeAnalysis {
  /** Per syllable: the vowel sound to color it by, or null when it doesn't rhyme. */
  sound: (Sound | null)[]
  /** Per syllable: the family of its longest rhyme. */
  family: (number | null)[]
  /** Per syllable: the longest span it belongs to. */
  span: (number | null)[]
  spans: RhymeSpan[]
  families: RhymeFamily[]
  /** Per bar: the end-rhyme letter (A, B, …) or null when the line end doesn't rhyme. */
  scheme: (string | null)[]
  stats: RhymeStats
}

export interface RhymeOptions {
  /** How many bars back a rhyme partner may be. */
  reach?: number
}

const CONSONANT_CLASS: Record<string, string> = {
  P: 'stop', T: 'stop', K: 'stop', B: 'stop', D: 'stop', G: 'stop',
  F: 'fric', TH: 'fric', S: 'fric', SH: 'fric', HH: 'fric', V: 'fric', DH: 'fric', Z: 'fric', ZH: 'fric',
  CH: 'affr', JH: 'affr', M: 'nasal', N: 'nasal', NG: 'nasal', L: 'liquid', R: 'liquid', W: 'glide', Y: 'glide',
}

/** How closely two syllable endings agree: 1 for "-at"/"-at", less for "-at"/"-ack". */
export function codaSimilarity(a: string[], b: string[]): number {
  const strip = (c: string[]) => (c.length > 1 && /^(S|Z)$/.test(c[c.length - 1]) ? c.slice(0, -1) : c)
  const x = a.join(' ')
  const y = b.join(' ')
  if (x === y) return 1
  const sa = strip(a)
  const sb = strip(b)
  if (sa.join(' ') === sb.join(' ')) return 0.9
  if (!sa.length || !sb.length) return 0.3
  const lastA = sa[sa.length - 1]
  const lastB = sb[sb.length - 1]
  if (CONSONANT_CLASS[lastA] === CONSONANT_CLASS[lastB]) return 0.7
  return 0.1
}

class UnionFind {
  private parent = new Map<string, string>()
  find(key: string): string {
    let root = this.parent.get(key) ?? key
    if (root !== key) {
      root = this.find(root)
      this.parent.set(key, root)
    }
    return root
  }
  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const WEAK_SOUNDS = new Set<Sound>(['SCHWA', 'IH', 'AH', 'EH', 'UH'])

/**
 * The sound a syllable rhymes on. Short vowels in weak positions blur
 * together, so the "it" in "got it" matches the "-et" in "pocket".
 */
export function rhymeSoundOf(s: Syllable, isFunction: boolean): Sound {
  return (s.stress === 0 || isFunction) && WEAK_SOUNDS.has(s.sound) ? 'SCHWA' : s.sound
}

export function analyzeRhymes(lyrics: LyricsAnalysis, options: RhymeOptions = {}): RhymeAnalysis {
  const reach = options.reach ?? 4
  const syl = lyrics.syllables
  const words = lyrics.words
  const uf = new UnionFind()
  const nodes = new Map<string, { start: number; length: number; stream: number[]; section: number }>()

  const isContent = (s: Syllable) => !words[s.word].function
  const rs = syl.map((s) => rhymeSoundOf(s, words[s.word].function))
  // Rhymes start on a stressed syllable of a content word ("me" may close a line).
  const anchor = (s: Syllable) => s.stress > 0 && rs[s.id] !== 'SCHWA' && (isContent(s) || s.lineFinal)

  // Streams: the main-vocal syllables of each section, in order.
  const streams = lyrics.sections
    .map((section) => ({ section: section.index, ids: section.bars.flatMap((b) => lyrics.bars[b].syllables) }))
    .filter((s) => s.ids.length > 0)

  for (const { section, ids } of streams) {
    const covered = new Set<string>()
    for (let i = 0; i < ids.length; i++) {
      const a = syl[ids[i]]
      if (!anchor(a)) continue
      for (let j = i - 1; j >= 0; j--) {
        const b = syl[ids[j]]
        if (b.bar < a.bar - reach) break
        if (b.word === a.word || !anchor(b) || rs[b.id] !== rs[a.id]) continue
        if (covered.has(`${i}:${j}`)) continue
        // The same word twice ("already" / "already") is repetition, not rhyme.
        if (sameWordAt(lyrics, ids[j], ids[i])) continue

        // Extend the match forward while the vowels keep lining up.
        let length = 1
        while (
          i + length < ids.length &&
          j + length < i &&
          syl[ids[i + length]].bar === a.bar &&
          syl[ids[j + length]].bar === b.bar &&
          rs[ids[i + length]] === rs[ids[j + length]]
        ) {
          length++
        }
        length = trimSpan(lyrics, ids, j, i, length)
        if (length === 0) continue

        const spanA = ids.slice(j, j + length)
        const spanB = ids.slice(i, i + length)
        if (!acceptPair(spanA.map((id) => syl[id]), spanB.map((id) => syl[id]), isContent)) continue

        for (let k = 1; k < length; k++) covered.add(`${i + k}:${j + k}`)
        const keyA = `${ids[j]}:${length}`
        const keyB = `${ids[i]}:${length}`
        nodes.set(keyA, { start: j, length, stream: ids, section })
        nodes.set(keyB, { start: i, length, stream: ids, section })
        uf.union(keyA, keyB)
      }
    }
  }

  // Collect families and give each syllable its longest rhyme.
  const byRoot = new Map<string, string[]>()
  for (const key of nodes.keys()) {
    const root = uf.find(key)
    byRoot.set(root, [...(byRoot.get(root) ?? []), key])
  }

  const spans: RhymeSpan[] = []
  const families: RhymeFamily[] = []
  const sound: (Sound | null)[] = syl.map(() => null)
  const family: (number | null)[] = syl.map(() => null)
  const span: (number | null)[] = syl.map(() => null)
  const spanLength = syl.map(() => 0)

  // Families in order of first appearance; same-sounding families in one section share an entry.
  const groups = [...byRoot.values()]
    .map((keys) => keys.map((k) => nodes.get(k)!).sort((x, y) => x.stream[x.start] - y.stream[y.start]))
    .sort((x, y) => x[0].stream[x[0].start] - y[0].stream[y[0].start])
  const familyBySignature = new Map<string, RhymeFamily>()

  for (const members of groups) {
    const first = members[0]
    const sounds = first.stream.slice(first.start, first.start + first.length).map((id) => rs[id])
    const signature = `${first.section}|${sounds.join(' ')}`
    let fam = familyBySignature.get(signature)
    if (!fam) {
      fam = { id: families.length, sounds, spans: [], section: first.section, examples: [] }
      families.push(fam)
      familyBySignature.set(signature, fam)
    }
    for (const member of members) {
      const ids = member.stream.slice(member.start, member.start + member.length)
      const last = syl[ids[ids.length - 1]]
      const rhymeSpan: RhymeSpan = { id: spans.length, family: fam.id, syllables: ids, bar: last.bar, lineEnd: last.lineFinal }
      spans.push(rhymeSpan)
      fam.spans.push(rhymeSpan.id)
      const text = spanText(lyrics, ids)
      if (fam.examples.length < 6 && !fam.examples.includes(text)) fam.examples.push(text)
      for (const id of ids) {
        sound[id] = rs[id]
        if (member.length > spanLength[id]) {
          spanLength[id] = member.length
          family[id] = fam.id
          span[id] = rhymeSpan.id
        }
      }
    }
  }

  const scheme = endScheme(lyrics, spans, span, rs)
  const counted = lyrics.bars.flatMap((b) => b.syllables)
  const rhyming = counted.filter((id) => sound[id] !== null).length
  const stats: RhymeStats = {
    syllables: counted.length,
    rhymingSyllables: rhyming,
    density: counted.length ? rhyming / counted.length : 0,
    multis: families.filter((f) => f.sounds.length >= 2).length,
    internal: spans.filter((s) => !s.lineEnd).length,
    endRhymes: scheme.filter((l) => l !== null).length,
    longest: spans.reduce((max, s) => Math.max(max, s.syllables.length), 0),
  }
  return { sound, family, span, spans, families, scheme, stats }
}

/**
 * Shortens a matched pair of spans until each ends cleanly: on a word end,
 * not on paired filler words ("got the / bar a" → "got / bar"), and without
 * trailing repeated words ("take the money / make the money" rhymes on
 * take / make).
 */
function trimSpan(lyrics: LyricsAnalysis, ids: number[], j: number, i: number, length: number): number {
  const syl = lyrics.syllables
  for (;;) {
    const before = length
    while (length > 0 && (!syl[ids[j + length - 1]].wordFinal || !syl[ids[i + length - 1]].wordFinal)) length--
    if (length === 0) return 0
    const endA = syl[ids[j + length - 1]]
    const endB = syl[ids[i + length - 1]]
    const size = endB.indexInWord + 1
    if (size < length && sameWordAt(lyrics, endA.id, endB.id)) length -= size
    else if (length > 1 && lyrics.words[endA.word].function && lyrics.words[endB.word].function) length--
    if (length === before) return length
  }
}

function sameWordAt(lyrics: LyricsAnalysis, a: number, b: number): boolean {
  const wa = lyrics.words[lyrics.syllables[a].word]
  const wb = lyrics.words[lyrics.syllables[b].word]
  return wa.norm === wb.norm
}

function acceptPair(a: Syllable[], b: Syllable[], isContent: (s: Syllable) => boolean): boolean {
  if (!a.some(isContent) || !b.some(isContent)) return false
  // Two or more syllables whose vowels line up from a stressed start: a multi.
  if (a.length >= 2) return true
  // One syllable: both words must end there, and either close out both lines
  // (night / time) or sound alike to the last consonant (man / plan).
  const [x] = a
  const [y] = b
  if (!x.wordFinal || !y.wordFinal) return false
  return (x.lineFinal && y.lineFinal) || codaSimilarity(x.coda, y.coda) >= 0.9
}

function spanText(lyrics: LyricsAnalysis, ids: number[]): string {
  let text = ''
  ids.forEach((id, k) => {
    const s = lyrics.syllables[id]
    if (k > 0 && s.indexInWord === 0) text += ' '
    text += s.text.toLowerCase()
  })
  return text
}

/** Letters for line endings, restarting at A in each section. */
function endScheme(lyrics: LyricsAnalysis, spans: RhymeSpan[], spanOf: (number | null)[], rs: Sound[]): (string | null)[] {
  const scheme: (string | null)[] = lyrics.bars.map(() => null)
  for (const section of lyrics.sections) {
    const letters = new Map<string, string>()
    for (const b of section.bars) {
      const ids = lyrics.bars[b].syllables
      const last = ids[ids.length - 1]
      if (last === undefined || spanOf[last] === null) continue
      // Key on the rhyme from its last stressed, meaningful syllable: "got it" and "promise" → AA SCHWA.
      const members = spans[spanOf[last]!].syllables
      let from = members.length - 1
      for (let k = members.length - 1; k >= 0; k--) {
        const s = lyrics.syllables[members[k]]
        if (s.stress > 0 && rs[s.id] !== 'SCHWA') {
          from = k
          break
        }
      }
      const key = members.slice(from).map((id) => rs[id]).join(' ')
      if (!letters.has(key)) letters.set(key, LETTERS[letters.size % LETTERS.length])
      scheme[b] = letters.get(key)!
    }
  }
  return scheme
}
