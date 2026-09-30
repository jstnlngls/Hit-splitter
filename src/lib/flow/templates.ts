import type { GridKind } from './grid'

export interface FlowTemplate {
  id: string
  name: string
  description: string
  grid: GridKind
  /** Slots (within one bar of the grid) where syllables land. */
  slots: number[]
  source: 'built-in' | 'track'
}

const steps = (pattern: string) => [...pattern].flatMap((c, i) => (c === 'x' ? [i] : []))

export const BUILT_IN_FLOWS: FlowTemplate[] = [
  {
    id: 'on-beat',
    name: 'On the beat',
    description: 'One syllable per beat. Chants, hooks and big statements.',
    grid: 'sixteenths',
    slots: steps('x...x...x...x...'),
    source: 'built-in',
  },
  {
    id: 'eighths',
    name: 'Straight 8ths',
    description: 'Even eighth notes. The steady, classic cadence.',
    grid: 'sixteenths',
    slots: steps('x.x.x.x.x.x.x.x.'),
    source: 'built-in',
  },
  {
    id: 'boom-bap',
    name: 'Boom-bap pocket',
    description: 'Eighths with quick pickups into the snare on 2 and 4.',
    grid: 'sixteenths',
    slots: steps('x.xxx.x.x.xxx.x.'),
    source: 'built-in',
  },
  {
    id: 'syncopated',
    name: 'Syncopated',
    description: 'Lands on the "and-a" offbeats for a bouncing, off-center feel.',
    grid: 'sixteenths',
    slots: steps('x.xx.xx.x.xx.xx.'),
    source: 'built-in',
  },
  {
    id: 'bounce',
    name: '3-3-2 bounce',
    description: 'Accents grouped 3+3+2, the pulse under a lot of modern flows.',
    grid: 'sixteenths',
    slots: steps('xx.xx.x.xx.xx.x.'),
    source: 'built-in',
  },
  {
    id: 'stop-start',
    name: 'Stop-start',
    description: 'A burst, then space. Good for setting up a punchline.',
    grid: 'sixteenths',
    slots: steps('xxxxxx..xxxxxx..'),
    source: 'built-in',
  },
  {
    id: 'triplets',
    name: 'Triplet flow',
    description: 'Three syllables per beat, rolling over the bar.',
    grid: 'triplets',
    slots: steps('xxxxxxxxxxxx'),
    source: 'built-in',
  },
  {
    id: 'sixteenths',
    name: 'Straight 16ths',
    description: 'A syllable on every sixteenth. Fast and relentless.',
    grid: 'sixteenths',
    slots: steps('xxxxxxxxxxxxxxxx'),
    source: 'built-in',
  },
  {
    id: 'double',
    name: 'Double time',
    description: 'Thirty-two slots per bar for rapid-fire lines.',
    grid: 'double',
    slots: steps('x'.repeat(32)),
    source: 'built-in',
  },
]

/** Maps a 16-step pattern onto another grid, keeping slots in the same place in time. */
export function slotsForGrid(template: FlowTemplate, grid: { kind: GridKind; slots: number }): number[] {
  const from = template.grid === 'triplets' ? 12 : template.grid === 'double' ? 32 : 16
  if (from === grid.slots) return template.slots
  const mapped = template.slots.map((s) => Math.round((s * grid.slots) / from))
  return [...new Set(mapped)].filter((s) => s < grid.slots)
}

export interface TrackPatterns {
  drumPattern: { kick: number[]; snare: number[]; hat: number[] }
  vocalPatterns: { steps: number[]; count: number }[]
}

/** Flows drawn from an imported track: its vocal rhythms and its drum pattern. */
export function flowsFromTrack(track: TrackPatterns): FlowTemplate[] {
  const flows: FlowTemplate[] = []
  const letters = 'ABCD'
  track.vocalPatterns.forEach((p, i) => {
    if (p.steps.length < 3) return
    flows.push({
      id: `track-vocal-${i}`,
      name: `Track rhythm ${letters[i]}`,
      description: `Syllable rhythm heard in ${p.count} bars of the track (${p.steps.length} syllables).`,
      grid: 'sixteenths',
      slots: p.steps,
      source: 'track',
    })
  })
  const { kick, snare, hat } = track.drumPattern
  const kickLock = steps16((s) => kick[s] >= 0.5 || snare[s] >= 0.5 || s % 4 === 0)
  if (kickLock.length >= 4) {
    flows.push({
      id: 'track-drums',
      name: 'Ride the drums',
      description: 'Syllables on the kick and snare hits (plus each beat).',
      grid: 'sixteenths',
      slots: kickLock,
      source: 'track',
    })
  }
  const hats = steps16((s) => hat[s] >= 0.5)
  if (hats.length >= 6) {
    flows.push({
      id: 'track-hats',
      name: 'Ride the hi-hats',
      description: 'A syllable on every hi-hat hit.',
      grid: 'sixteenths',
      slots: hats,
      source: 'track',
    })
  }
  const gaps = steps16((s) => kick[s] < 0.3 && snare[s] < 0.3)
  if (gaps.length >= 4 && gaps.length <= 12) {
    flows.push({
      id: 'track-gaps',
      name: 'Fill the gaps',
      description: 'Syllables where the kick and snare rest, trading space with the beat.',
      grid: 'sixteenths',
      slots: gaps,
      source: 'track',
    })
  }
  return flows
}

const steps16 = (keep: (s: number) => boolean) => Array.from({ length: 16 }, (_, s) => s).filter(keep)
