import { isVowelAt } from './g2p'

/**
 * Splits a written word into `count` readable chunks ("spa", "ghet", "ti")
 * that line up with its spoken syllables. The count comes from the
 * pronunciation; the spelling only decides where the cuts look natural.
 */

const DIGRAPHS = new Set(['ch', 'sh', 'th', 'ph', 'wh', 'gh', 'ck', 'ng', 'qu'])
const ONSET_BLENDS = new Set([
  'bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'sc', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw',
  'tr', 'tw', 'wr', 'scr', 'spl', 'spr', 'str', 'thr', 'shr', 'chr', 'phr', 'squ',
])
// Vowel pairs that are usually said as two syllables: li-on, vi-a, po-em, sci-ence.
const HIATUS = ['io', 'ia', 'eo', 'iu', 'ua', 'ui', 'ue', 'oe', 'ie', 'ea', 'ei', 'oi', 'ai', 'yi', 'ya', 'yo', 'ye', 'oa', 'ao', 'eu']

type Group = [start: number, end: number]

/**
 * `closed[k]` marks a stressed short vowel in syllable k: a single consonant
 * after it stays in that syllable ("sweat-er", "mon-ey"), otherwise it
 * starts the next one ("ba-by", "mo-ment").
 */
export function splitSpelling(word: string, count: number, closed: boolean[] = []): string[] {
  if (count <= 1) return [word]
  const w = word.toLowerCase()
  const groups: Group[] = []
  for (let k = 0; k < w.length; k++) {
    if (!isVowelAt(w, k)) continue
    const last = groups[groups.length - 1]
    if (last && last[1] === k) last[1] = k + 1
    else groups.push([k, k + 1])
  }
  if (groups.length === 0) return evenSplit(word, count)

  while (groups.length > count) mergeGroups(w, groups)
  while (groups.length < count) {
    if (!splitGroup(w, groups)) return evenSplit(word, count)
  }

  const cuts = groups.slice(1).map((group, g) => cutBetween(w, groups[g][1], group[0], group, closed[g] ?? false))
  const chunks: string[] = []
  let from = 0
  for (const cut of cuts) {
    chunks.push(word.slice(from, cut))
    from = cut
  }
  chunks.push(word.slice(from))
  return chunks.some((c) => !/[a-z0-9]/i.test(c)) ? evenSplit(word, count) : chunks
}

/** Drops a silent final "e" ("make", "vibes") or joins the two closest vowel groups. */
function mergeGroups(w: string, groups: Group[]) {
  const last = groups[groups.length - 1]
  const tail = w.slice(last[0]).replace(/'+$/, '')
  if (/^e[sd]?$/.test(tail) && last[0] > 0 && !isVowelAt(w, last[0] - 1) && !/[^aeiou]le$/.test(w)) {
    groups.pop()
    return
  }
  let best = 1
  for (let g = 2; g < groups.length; g++) {
    if (groups[g][0] - groups[g - 1][1] < groups[best][0] - groups[best - 1][1]) best = g
  }
  groups[best - 1] = [groups[best - 1][0], groups[best][1]]
  groups.splice(best, 1)
}

/** Finds one more syllable: "go-ing", "did-n't", "li-on", "rhy-thm". */
function splitGroup(w: string, groups: Group[]): boolean {
  // -ing after a vowel: going, seeing, flying.
  for (let g = groups.length - 1; g >= 0; g--) {
    const [start, end] = groups[g]
    if (end - start >= 2 && w[end - 1] === 'i' && w.slice(end, end + 2) === 'ng') {
      groups.splice(g, 1, [start, end - 1], [end - 1, end])
      return true
    }
  }
  // Syllabic n in "didn't", "couldn't", "wasn't".
  const nt = w.search(/[a-z]n'?t$/)
  if (nt >= 0 && groups[groups.length - 1][1] <= nt) {
    groups.push([nt + 1, nt + 1])
    return true
  }
  // A vowel pair said as two sounds.
  for (const pair of HIATUS) {
    for (let g = 0; g < groups.length; g++) {
      const [start, end] = groups[g]
      const at = w.slice(start, end).indexOf(pair)
      if (at >= 0 && !(pair === 'ue' && end === w.length) && !(pair === 'ie' && end === w.length)) {
        groups.splice(g, 1, [start, start + at + 1], [start + at + 1, end])
        return true
      }
    }
  }
  // Syllabic l/m/n/r after the last vowel: rhythm, prism.
  const last = groups[groups.length - 1]
  for (let k = w.length - 1; k > last[1]; k--) {
    if ('lmnr'.includes(w[k]) && !isVowelAt(w, k - 1)) {
      const start = DIGRAPHS.has(w.slice(k - 2, k)) ? k - 2 : k
      groups.push([start, start])
      return true
    }
  }
  // Last resort: split the longest vowel group.
  let longest = -1
  groups.forEach(([s, e], g) => {
    if (e - s >= 2 && (longest < 0 || e - s > groups[longest][1] - groups[longest][0])) longest = g
  })
  if (longest < 0) return false
  const [s, e] = groups[longest]
  const mid = s + Math.floor((e - s) / 2)
  groups.splice(longest, 1, [s, mid], [mid, e])
  return true
}

/** Where the next chunk starts, given the consonants between two vowel groups. */
function cutBetween(w: string, from: number, to: number, next: Group, closed: boolean): number {
  // An empty group marks a syllabic consonant: cut right before it (did-n't).
  if (next[0] === next[1]) return next[0]
  if (to <= from) return to
  // Consonant + le at the end stay together: hus-tle, bot-tle, ta-ble.
  if (next[0] === w.length - 1 && w[next[0]] === 'e' && w[to - 1] === 'l' && to - from >= 2) return to - 2

  const units: [number, string][] = []
  for (let k = from; k < to; ) {
    const pair = w.slice(k, k + 2)
    if (k + 1 < to && DIGRAPHS.has(pair)) {
      units.push([k, pair])
      k += 2
    } else {
      units.push([k, w[k]])
      k += 1
    }
  }
  const letters = units.filter(([, u]) => u !== "'")
  if (letters.length <= 1) {
    const only = letters[0]?.[1]
    if (only === 'x' || only === 'ck' || only === 'ng' || (closed && only !== undefined)) return to
    return letters[0]?.[0] ?? to
  }
  for (let take = Math.min(letters.length - 1, 3); take >= 1; take--) {
    const onset = letters.slice(letters.length - take)
    const spelled = onset.map(([, u]) => u).join('')
    const valid = take === 1 ? !['ng', 'ck', 'x'].includes(spelled) : ONSET_BLENDS.has(spelled)
    if (valid) return onset[0][0]
  }
  return letters[letters.length - 1][0]
}

function evenSplit(word: string, count: number): string[] {
  const chunks: string[] = []
  for (let i = 0; i < count; i++) {
    chunks.push(word.slice(Math.round((i * word.length) / count), Math.round(((i + 1) * word.length) / count)))
  }
  return chunks
}
