import type { Stress } from '../phonetics/arpabet'
import { slotStrength, type Grid } from './grid'

/** What placement needs to know about each syllable in a bar. */
export interface SyllableCue {
  stress: Stress
  weak: boolean
  wordStart: boolean
  pauseAfter: boolean
  rhyme: boolean
  lineEndRhyme: boolean
}

export interface BarPlacement {
  /** Slot per syllable. Negative slots are pickups; slots ≥ grid.slots spill past the bar. */
  slots: number[]
  /** Syllables the bar (or chosen flow) has room for. */
  capacity: number
  /** Syllables beyond capacity. */
  over: number
  /** Open slots left in the flow. */
  room: number
  /** Syllables that spill past the end of the bar. */
  spill: number
  /** Stressed syllables that land on a beat or an eighth note. */
  stressOnBeat: number
  stressed: number
  template: number[] | null
}

export interface PlaceOptions {
  /** Slots a flow template wants filled; null lets the syllables find their own pocket. */
  template?: number[] | null
  /** Moves the whole line later (positive) or earlier into a pickup (negative). */
  shift?: number
}

const emphasis = (c: SyllableCue) =>
  (c.stress === 1 ? 1 : c.stress === 2 ? 0.6 : 0) * (c.weak ? 0.5 : 1) + (c.rhyme && c.stress > 0 ? 0.4 : 0) + (c.lineEndRhyme ? 0.4 : 0)

/** Score for putting a syllable on a slot: stresses want strong slots, weak syllables want to stay off them. */
function slotScore(c: SyllableCue, strength: number): number {
  const e = emphasis(c)
  return e * strength - (e < 0.3 ? 0.35 * Math.max(0, strength - 2) : 0)
}

/**
 * Score for the gap before a syllable, measured in 16th notes: syllables in
 * a word stay close, a comma earns a breath, and the rhythm prefers to keep
 * a steady pulse.
 */
function gapScore(prev: SyllableCue, next: SyllableCue, gap: number, prevGap: number): number {
  let score = 0
  if (!next.wordStart) {
    if (gap > 2) score -= gap >= 4 ? 1.5 + 0.5 * (gap - 4) : 0.8
    else if (gap > 1) score -= 0.1
  } else {
    if (gap > 4) score -= 0.6 + 0.3 * (gap - 4)
    else if (gap > 3) score -= 0.4
    else if (gap > 2) score -= 0.25
    if (prev.pauseAfter) score += gap >= 2 ? 0.25 : -0.2
  }
  if (prevGap > 0) score -= 0.15 * Math.abs(gap - prevGap)
  return score
}

function summarize(cues: SyllableCue[], slots: number[], grid: Grid, capacity: number, template: number[] | null): BarPlacement {
  const n = cues.length
  const eighth = grid.perBeat % 2 === 0 ? grid.perBeat / 2 : grid.perBeat
  let stressed = 0
  let stressOnBeat = 0
  cues.forEach((c, i) => {
    if (c.stress !== 1 || c.weak) return
    stressed++
    if (slots[i] >= 0 && slots[i] < grid.slots && slots[i] % eighth === 0) stressOnBeat++
  })
  return {
    slots,
    capacity,
    over: Math.max(0, n - capacity),
    room: Math.max(0, capacity - n),
    spill: slots.filter((s) => s >= grid.slots).length,
    stressOnBeat,
    stressed,
    template,
  }
}

/** Free placement: dynamic programming over (syllable, slot, previous gap). */
function placeFree(cues: SyllableCue[], grid: Grid): number[] {
  const n = cues.length
  const S = grid.slots
  if (n === 0) return []
  if (n >= S) return cues.map((_, i) => i)

  const unit = grid.perBeat / 4 // slots per 16th note
  const maxGap = Math.max(2, Math.round(8 * unit))
  const strength = Array.from({ length: S }, (_, s) => slotStrength(grid, s))
  // best[i][p][g]: best score with syllable i on slot p, reached by a gap of g slots (0 for the first).
  const NEG = -Infinity
  const best: Float64Array[][] = []
  const from: Int16Array[][] = []
  for (let i = 0; i < n; i++) {
    best.push(Array.from({ length: S }, () => new Float64Array(maxGap + 1).fill(NEG)))
    from.push(Array.from({ length: S }, () => new Int16Array(maxGap + 1).fill(-1)))
  }
  const breath = n <= S * 0.75
  for (let p = 0; p <= S - n; p++) {
    best[0][p][0] = slotScore(cues[0], strength[p]) - 0.25 * (p / unit)
  }
  for (let i = 1; i < n; i++) {
    const latest = S - (n - i)
    for (let p = i; p <= latest; p++) {
      const here = slotScore(cues[i], strength[p])
      for (let g = 1; g <= maxGap && p - g >= i - 1; g++) {
        const q = p - g
        let top = NEG
        let arg = -1
        for (let g0 = 0; g0 <= maxGap; g0++) {
          const prev = best[i - 1][q][g0]
          if (prev === NEG) continue
          const total = prev + gapScore(cues[i - 1], cues[i], g / unit, g0 / unit)
          if (total > top) {
            top = total
            arg = g0
          }
        }
        if (arg >= 0) {
          best[i][p][g] = top + here
          from[i][p][g] = arg
        }
      }
    }
  }
  let top = NEG
  let endSlot = n - 1
  let endGap = 0
  for (let p = n - 1; p < S; p++) {
    for (let g = 0; g <= maxGap; g++) {
      const score = best[n - 1][p][g] + (breath && p < S - 1 ? 0.2 : 0)
      if (score > top) {
        top = score
        endSlot = p
        endGap = g
      }
    }
  }
  const slots = new Array<number>(n)
  let p = endSlot
  let g = endGap
  for (let i = n - 1; i >= 0; i--) {
    slots[i] = p
    const g0 = from[i][p][g]
    p -= g
    g = g0
  }
  return slots
}

/** Template placement: choose which of the flow's slots each syllable takes. */
function placeOnTemplate(cues: SyllableCue[], grid: Grid, template: number[]): number[] {
  const n = cues.length
  const m = template.length
  if (n === 0) return []
  const unit = grid.perBeat / 4
  const NEG = -Infinity
  const best: number[][] = Array.from({ length: n }, () => new Array(m).fill(NEG))
  const from: number[][] = Array.from({ length: n }, () => new Array(m).fill(-1))
  for (let k = 0; k <= m - n; k++) {
    best[0][k] = slotScore(cues[0], slotStrength(grid, template[k])) - 0.3 * k
  }
  for (let i = 1; i < n; i++) {
    for (let k = i; k <= m - (n - i); k++) {
      const here = slotScore(cues[i], slotStrength(grid, template[k]))
      for (let k0 = i - 1; k0 < k; k0++) {
        if (best[i - 1][k0] === NEG) continue
        const gap = (template[k] - template[k0]) / unit
        const total = best[i - 1][k0] + gapScore(cues[i - 1], cues[i], gap, 0) - 0.3 * (k - k0 - 1) + here
        if (total > best[i][k]) {
          best[i][k] = total
          from[i][k] = k0
        }
      }
    }
  }
  let k = n - 1
  for (let j = n - 1; j < m; j++) if (best[n - 1][j] > best[n - 1][k]) k = j
  const slots = new Array<number>(n)
  for (let i = n - 1; i >= 0; i--) {
    slots[i] = template[k]
    k = from[i][k]
  }
  return slots
}

export function placeBar(cues: SyllableCue[], grid: Grid, options: PlaceOptions = {}): BarPlacement {
  const template = options.template?.length ? [...options.template].sort((a, b) => a - b) : null
  const shift = options.shift ?? 0
  const capacity = template ? template.length : grid.slots
  // A flow with too few slots still shows where the syllables would go.
  const slots = template && cues.length <= template.length ? placeOnTemplate(cues, grid, template) : placeFree(cues, grid)
  return summarize(cues, slots.map((s) => s + shift), grid, capacity, template)
}
