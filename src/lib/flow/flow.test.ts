import { describe, expect, it } from 'vitest'
import { GRIDS, slotStrength } from './grid'
import { placeBar, type SyllableCue } from './place'
import { BUILT_IN_FLOWS, flowsFromTrack, slotsForGrid } from './templates'

const cue = (over: Partial<SyllableCue> = {}): SyllableCue => ({
  stress: 1,
  weak: false,
  wordStart: true,
  pauseAfter: false,
  rhyme: false,
  lineEndRhyme: false,
  ...over,
})

const g16 = GRIDS.sixteenths

describe('grid', () => {
  it('weights beat 1, then the backbeat, then offbeats', () => {
    expect(slotStrength(g16, 0)).toBeGreaterThan(slotStrength(g16, 4))
    expect(slotStrength(g16, 4)).toBeGreaterThan(slotStrength(g16, 8))
    expect(slotStrength(g16, 8)).toBeGreaterThan(slotStrength(g16, 2))
    expect(slotStrength(g16, 2)).toBeGreaterThan(slotStrength(g16, 1))
  })
})

describe('placeBar', () => {
  it('puts four stressed words on the four beats', () => {
    expect(placeBar([cue(), cue(), cue(), cue()], g16).slots).toEqual([0, 4, 8, 12])
  })

  it('keeps syllables in order and inside the bar', () => {
    const cues = Array.from({ length: 11 }, (_, i) => cue({ stress: i % 3 === 0 ? 1 : 0, wordStart: i % 2 === 0 }))
    const { slots, spill, room } = placeBar(cues, g16)
    for (let i = 1; i < slots.length; i++) expect(slots[i]).toBeGreaterThan(slots[i - 1])
    expect(slots[0]).toBeGreaterThanOrEqual(0)
    expect(slots.at(-1)!).toBeLessThan(16)
    expect(spill).toBe(0)
    expect(room).toBe(5)
  })

  it('keeps a word\'s syllables together', () => {
    const cues = [cue(), cue({ stress: 0, wordStart: false }), cue(), cue({ stress: 0, wordStart: false })]
    const { slots } = placeBar(cues, g16)
    expect(slots[1] - slots[0]).toBeLessThanOrEqual(2)
    expect(slots[3] - slots[2]).toBeLessThanOrEqual(2)
  })

  it('takes a breath at a comma', () => {
    const cues = [cue(), cue(), cue({ pauseAfter: true }), cue(), cue(), cue()]
    const { slots } = placeBar(cues, g16)
    expect(slots[3] - slots[2]).toBeGreaterThanOrEqual(2)
  })

  it('reports syllables that spill past the bar', () => {
    const cues = Array.from({ length: 20 }, () => cue({ stress: 0 }))
    const placed = placeBar(cues, g16)
    expect(placed.spill).toBe(4)
    expect(placed.over).toBe(4)
    expect(placed.room).toBe(0)
  })

  it('fits syllables onto a flow template', () => {
    const template = BUILT_IN_FLOWS.find((f) => f.id === 'eighths')!.slots
    const placed = placeBar(Array.from({ length: 6 }, () => cue()), g16, { template })
    expect(placed.slots.every((s) => template.includes(s))).toBe(true)
    expect(placed.room).toBe(2)
    expect(placed.capacity).toBe(8)
  })

  it('flags lines with more syllables than the flow has slots', () => {
    const template = BUILT_IN_FLOWS.find((f) => f.id === 'on-beat')!.slots
    const placed = placeBar(Array.from({ length: 7 }, () => cue()), g16, { template })
    expect(placed.over).toBe(3)
    expect(placed.slots).toHaveLength(7)
  })

  it('shifts a line into a pickup', () => {
    const placed = placeBar([cue(), cue()], g16, { shift: -2 })
    expect(placed.slots[0]).toBe(-2)
  })

  it('handles triplet and double-time grids', () => {
    const cues = Array.from({ length: 12 }, () => cue({ stress: 0 }))
    expect(placeBar(cues, GRIDS.triplets).slots).toEqual(Array.from({ length: 12 }, (_, i) => i))
    const dense = placeBar(Array.from({ length: 24 }, (_, i) => cue({ stress: i % 2 ? 0 : 1 })), GRIDS.double)
    expect(dense.spill).toBe(0)
    expect(new Set(dense.slots).size).toBe(24)
  })
})

describe('templates', () => {
  it('maps a 16th pattern onto other grids', () => {
    const eighths = BUILT_IN_FLOWS.find((f) => f.id === 'eighths')!
    expect(slotsForGrid(eighths, GRIDS.double)).toEqual([0, 4, 8, 12, 16, 20, 24, 28])
  })

  it('derives flows from a track analysis', () => {
    const flows = flowsFromTrack({
      drumPattern: {
        kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
        snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
        hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      },
      vocalPatterns: [{ steps: [0, 2, 3, 6, 8, 10, 11, 14], count: 12 }],
    })
    expect(flows.map((f) => f.id)).toEqual(['track-vocal-0', 'track-drums', 'track-hats', 'track-gaps'])
    expect(flows[1].slots).toEqual([0, 4, 8, 10, 12])
  })
})
