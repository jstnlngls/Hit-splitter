export type GridKind = 'sixteenths' | 'triplets' | 'double'

export interface Grid {
  kind: GridKind
  /** Slots in one 4/4 bar. */
  slots: number
  /** Slots per beat. */
  perBeat: number
  label: string
  hint: string
}

export const GRIDS: Record<GridKind, Grid> = {
  sixteenths: { kind: 'sixteenths', slots: 16, perBeat: 4, label: '16ths', hint: 'Four slots per beat — most rap sits here' },
  triplets: { kind: 'triplets', slots: 12, perBeat: 3, label: 'Triplets', hint: 'Three slots per beat — the rolling trap cadence' },
  double: { kind: 'double', slots: 32, perBeat: 8, label: 'Double time', hint: 'Eight slots per beat — for rapid-fire bars' },
}

export const GRID_KINDS = Object.keys(GRIDS) as GridKind[]

/**
 * How strong a slot is in the bar. Beat 1 is strongest, then the backbeat
 * (2 and 4, where the snare usually hits), then beat 3, then the offbeats.
 */
export function slotStrength(grid: Grid, slot: number): number {
  const p = grid.perBeat
  const beat = Math.floor(slot / p) % 4
  const sub = ((slot % p) + p) % p
  if (sub === 0) return beat === 0 ? 4 : beat === 2 ? 3 : 3.3
  if (p === 4) return sub === 2 ? 2 : 1
  if (p === 3) return sub === 1 ? 1.3 : 1.1
  if (sub === 4) return 2
  return sub % 2 === 0 ? 1.4 : 0.8
}

/** Beat number (1–4) a slot falls in, or 0 for a pickup before the bar. */
export const beatOf = (grid: Grid, slot: number) => (slot < 0 ? 0 : Math.floor(slot / grid.perBeat) + 1)

/** Seconds per slot at a tempo. */
export const slotSeconds = (grid: Grid, bpm: number) => 60 / bpm / grid.perBeat
