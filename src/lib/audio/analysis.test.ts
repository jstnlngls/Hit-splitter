import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_SAMPLE_RATE,
  PEAK_BUCKETS,
  analyzeTrack,
  estimateGrid,
  extractPatterns,
  type AudioFeatures,
  type PatternAnalysis,
  type TrackAnalysis,
} from './analysis'
import { analyzeInBackground } from './analyzeClient'
import { fft, magnitudeSpectrum } from './fft'

const SR = ANALYSIS_SAMPLE_RATE
const TAU = 2 * Math.PI

// ---------------------------------------------------------------------------
// Deterministic synthesized audio

/** mulberry32: a small seeded PRNG, so every run renders identical noise. */
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rand = () => number

/** Sine sweeping ~120 → 50 Hz, decaying over ~180 ms. */
function kick(out: Float32Array, at: number, gain: number) {
  const start = Math.round(at * SR)
  let phase = 0
  for (let i = 0; i < 0.3 * SR && start + i < out.length; i++) {
    const t = i / SR
    phase += (TAU * (50 + 70 * Math.exp(-t / 0.04))) / SR
    out[start + i] += gain * Math.min(1, t / 0.002) * Math.exp(-t / 0.06) * Math.sin(phase)
  }
}

/** Noise burst plus a short 200 Hz tone, decaying over ~120 ms. */
function snare(out: Float32Array, at: number, gain: number, rand: Rand) {
  const start = Math.round(at * SR)
  for (let i = 0; i < 0.2 * SR && start + i < out.length; i++) {
    const t = i / SR
    const noise = (2 * rand() - 1) * Math.exp(-t / 0.04)
    const tone = 0.6 * Math.sin(TAU * 200 * t) * Math.exp(-t / 0.03)
    out[start + i] += gain * Math.min(1, t / 0.001) * (noise + tone)
  }
}

/** First difference of white noise (bright), decaying over ~35 ms. */
function hat(out: Float32Array, at: number, gain: number, rand: Rand) {
  const start = Math.round(at * SR)
  let previous = 0
  for (let i = 0; i < 0.08 * SR && start + i < out.length; i++) {
    const white = 2 * rand() - 1
    out[start + i] += 0.5 * gain * Math.exp(-i / SR / 0.012) * (white - previous)
    previous = white
  }
}

/** A sung syllable: fundamental plus four harmonics, ~90 ms with a ~10 ms attack. */
function syllable(out: Float32Array, at: number, gain: number, f0: number) {
  const start = Math.round(at * SR)
  const length = Math.round(0.09 * SR)
  for (let i = 0; i < length && start + i < out.length; i++) {
    const t = i / SR
    const env = Math.min(1, t / 0.01) * Math.min(1, (length - i) / (0.02 * SR))
    let s = 0
    for (let h = 1; h <= 5; h++) s += Math.sin(TAU * h * f0 * t) / h
    out[start + i] += gain * env * s
  }
}

interface Beat {
  bpm: number
  /** Leading silence in seconds. */
  offset: number
  /** Bars to render (default: fill `seconds`). */
  bars?: number
  /** Total length in seconds (default: the bars plus 0.5 s). */
  seconds?: number
  kick?: number[]
  snare?: number[]
  hat?: number[]
  /** Steps with a sung syllable. */
  vocal?: number[]
  seed?: number
}

function render(beat: Beat): Float32Array {
  const step = 60 / beat.bpm / 4
  const seconds = beat.seconds ?? beat.offset + (beat.bars ?? 0) * 16 * step + 0.5
  const out = new Float32Array(Math.round(seconds * SR))
  const bars = beat.bars ?? Math.ceil((seconds - beat.offset) / (16 * step))
  const rand = prng(beat.seed ?? 7)
  for (let bar = 0; bar < bars; bar++) {
    for (let s = 0; s < 16; s++) {
      const at = beat.offset + (bar * 16 + s) * step
      if (beat.kick?.includes(s)) kick(out, at, 0.8)
      if (beat.snare?.includes(s)) snare(out, at, 0.45, rand)
      if (beat.hat?.includes(s)) hat(out, at, s % 4 === 0 ? 0.3 : 0.22, rand)
      if (beat.vocal?.includes(s)) syllable(out, at, 0.3, 180 + 40 * rand())
    }
  }
  return out
}

const EVERY_16TH = Array.from({ length: 16 }, (_, i) => i)
const EIGHTHS = EVERY_16TH.filter((s) => s % 2 === 0)
const BOOM_BAP: Beat = { bpm: 90, bars: 16, offset: 0.37, kick: [0, 10], snare: [4, 12], hat: EIGHTHS }
const FLOW = [0, 2, 3, 6, 8, 10, 11, 14]

const memo = <T,>(make: () => T) => {
  let value: T | undefined
  return () => (value ??= make())
}
const boomBap = memo(() => analyzeTrack(render(BOOM_BAP), SR))

/** Distance between two times on a circle of the given period. */
const circular = (a: number, b: number, period: number) => {
  const d = (((a - b) % period) + period) % period
  return Math.min(d, period - d)
}

function f1(found: number[], expected: number[]) {
  const hits = found.filter((s) => expected.includes(s)).length
  return hits ? (2 * hits) / (found.length + expected.length) : 0
}

function expectSixteenSteps(patterns: PatternAnalysis) {
  for (const row of Object.values(patterns.drumPattern)) expect(row).toHaveLength(16)
  for (const bars of [...Object.values(patterns.drumBars), patterns.vocalBars]) {
    expect(bars).toHaveLength(patterns.bars)
    for (const row of bars) expect(row).toHaveLength(16)
  }
  expect(patterns.vocalDensity).toHaveLength(patterns.bars)
  for (const p of patterns.vocalPatterns) for (const s of p.steps) expect(s >= 0 && s < 16).toBe(true)
}

function expectFinite(features: AudioFeatures, analysis: TrackAnalysis) {
  const numbers = [
    analysis.bpm,
    analysis.beatOffset,
    analysis.firstDownbeat,
    analysis.confidence,
    analysis.duration,
    analysis.bars,
    ...analysis.bpmCandidates.flatMap((c) => [c.bpm, c.score]),
    ...Object.values(analysis.drumPattern).flat(),
    ...Object.values(analysis.drumBars).flat(2),
    ...analysis.vocalBars.flat(),
    ...analysis.vocalDensity,
    ...analysis.peaks,
    features.frameRate,
    features.duration,
  ]
  for (const x of numbers) expect(Number.isFinite(x)).toBe(true)
  for (const env of [features.kick, features.snare, features.hat, features.vocal, features.full]) {
    for (const x of env) expect(Number.isFinite(x) && x >= 0 && x <= 1.5).toBe(true)
  }
  expect(analysis.confidence).toBeGreaterThanOrEqual(0)
  expect(analysis.confidence).toBeLessThanOrEqual(1)
  expect(analysis.firstDownbeat).toBeGreaterThanOrEqual(0)
  expect(analysis.firstDownbeat).toBeLessThan(240 / analysis.bpm)
  expect(analysis.peaks).toHaveLength(2 * PEAK_BUCKETS)
  expectSixteenSteps(analysis)
}

// ---------------------------------------------------------------------------

describe('fft', () => {
  it('matches a direct DFT', () => {
    const rand = prng(3)
    const n = 64
    const signal = Array.from({ length: n }, () => 2 * rand() - 1)
    const re = Float64Array.from(signal)
    const im = new Float64Array(n)
    fft(re, im)
    for (const k of [0, 1, 5, 31, 32, 63]) {
      let sr = 0
      let si = 0
      for (let t = 0; t < n; t++) {
        sr += signal[t] * Math.cos((TAU * k * t) / n)
        si -= signal[t] * Math.sin((TAU * k * t) / n)
      }
      expect(re[k]).toBeCloseTo(sr, 9)
      expect(im[k]).toBeCloseTo(si, 9)
    }
    fft(re, im, true)
    for (let t = 0; t < n; t++) expect(re[t]).toBeCloseTo(signal[t], 12)
  })

  it('computes the magnitude spectrum of a Hann-windowed frame, zero-padding past the ends', () => {
    const rand = prng(4)
    const n = 32
    const signal = Array.from({ length: 40 }, () => 2 * rand() - 1)
    for (const start of [0, 5, -7, 20]) {
      const spectrum = magnitudeSpectrum(signal, n, start)
      for (let k = 0; k <= n / 2; k++) {
        let sr = 0
        let si = 0
        for (let t = 0; t < n; t++) {
          const x = (signal[start + t] ?? 0) * (0.5 - 0.5 * Math.cos((TAU * t) / n))
          sr += x * Math.cos((TAU * k * t) / n)
          si -= x * Math.sin((TAU * k * t) / n)
        }
        expect(spectrum[k]).toBeCloseTo(Math.hypot(sr, si), 5)
      }
    }
  })
})

describe('analyzeTrack', () => {
  it('finds tempo, downbeat and drum pattern of a boom-bap beat', { timeout: 30_000 }, () => {
    const { analysis } = boomBap()
    expect(Math.abs(analysis.bpm - 90)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(analysis.firstDownbeat - 0.37)).toBeLessThanOrEqual(0.03)
    expect(analysis.bars).toBe(16)
    expect(analysis.confidence).toBeGreaterThan(0.5)
    const { kick, snare, hat } = analysis.drumPattern
    expect(kick[0]).toBeGreaterThanOrEqual(0.8)
    expect(kick[10]).toBeGreaterThanOrEqual(0.8)
    expect(kick[4]).toBeLessThanOrEqual(0.3)
    expect(snare[4]).toBeGreaterThanOrEqual(0.8)
    expect(snare[12]).toBeGreaterThanOrEqual(0.8)
    for (const s of EIGHTHS) expect(hat[s]).toBeGreaterThanOrEqual(0.6)
  })

  it('reads a half-time trap beat at 140 or 70 BPM with the other octave as a candidate', { timeout: 30_000 }, () => {
    const offset = 0.21
    const { analysis } = analyzeTrack(render({ bpm: 140, bars: 16, offset, kick: [0, 3, 7], snare: [8], hat: EVERY_16TH }), SR)
    const fast = Math.abs(analysis.bpm - 140) <= 0.7
    const slow = Math.abs(analysis.bpm - 70) <= 0.35
    expect(fast || slow).toBe(true)
    const other = fast ? 70 : 140
    expect(analysis.bpmCandidates.some((c) => Math.abs(c.bpm - other) <= 0.01 * other)).toBe(true)
    // A bar at the reported tempo spans one or two identical trap bars; either way beat 1 is a trap bar start.
    expect(analysis.firstDownbeat).toBeLessThan(240 / analysis.bpm)
    expect(circular(analysis.firstDownbeat, offset, 240 / 140)).toBeLessThanOrEqual(0.03)
  })

  it('pins the tempo of a long track to a few hundredths of a BPM', { timeout: 30_000 }, () => {
    const { analysis } = analyzeTrack(render({ ...BOOM_BAP, bpm: 93.5, bars: 64, offset: 0.12 }), SR)
    expect(Math.abs(analysis.bpm - 93.5)).toBeLessThan(0.05)
    expect(Math.abs(analysis.firstDownbeat - 0.12)).toBeLessThanOrEqual(0.03)
  })

  it('finds the recurring syllable rhythm of a vocal over the beat', { timeout: 30_000 }, () => {
    const { analysis } = analyzeTrack(render({ ...BOOM_BAP, vocal: FLOW }), SR)
    expect(Math.abs(analysis.bpm - 90)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(analysis.firstDownbeat - 0.37)).toBeLessThanOrEqual(0.03)
    const [top] = analysis.vocalPatterns
    expect(top).toBeDefined()
    expect(f1(top.steps, FLOW)).toBeGreaterThanOrEqual(0.8)
    expect(top.count).toBeGreaterThanOrEqual(10)
    expect(top.bars).toHaveLength(top.count)
  })

  it('does not throw on silence or very short input, and returns finite numbers', () => {
    const short = render({ bpm: 120, bars: 1, offset: 0.05, kick: [0], snare: [4], hat: EIGHTHS, seconds: 0.5 })
    const noisy = render({ ...BOOM_BAP, bars: 2 })
    noisy[1000] = Number.NaN
    noisy[2000] = Number.POSITIVE_INFINITY
    for (const samples of [new Float32Array(3 * SR), short, new Float32Array(0), new Float32Array(10), noisy]) {
      const { features, analysis } = analyzeTrack(samples, SR)
      expectFinite(features, analysis)
    }
  })

  it('analyzes a three-minute mix well within budget', { timeout: 60_000 }, () => {
    const samples = render({ ...BOOM_BAP, bpm: 87, offset: 0.25, vocal: FLOW, seconds: 180 })
    const t0 = performance.now()
    const { features, analysis } = analyzeTrack(samples, SR)
    const seconds = (performance.now() - t0) / 1000
    const t1 = performance.now()
    const grid = estimateGrid(features, analysis.bpm * 2, { refine: false })
    extractPatterns(features, grid)
    const regrid = performance.now() - t1
    console.log(`analyzeTrack: 180 s mix in ${seconds.toFixed(2)} s; re-grid + patterns in ${regrid.toFixed(1)} ms`)
    expect(seconds).toBeLessThan(15)
    expect(regrid).toBeLessThan(250)
    expect(Math.abs(analysis.bpm - 87)).toBeLessThanOrEqual(0.5)
  })
})

describe('estimateGrid and extractPatterns', () => {
  it('keeps a user-chosen tempo exactly and re-grids after moving the downbeat', { timeout: 30_000 }, () => {
    const { features, analysis } = boomBap()
    const grid = estimateGrid(features, 180, { refine: false })
    expect(grid.bpm).toBe(180)
    expect(grid.firstDownbeat).toBeGreaterThanOrEqual(0)
    expect(grid.firstDownbeat).toBeLessThan(240 / 180)
    expect(grid.beatOffset).toBeLessThan(60 / 180)
    expect(grid.confidence).toBeGreaterThanOrEqual(0)
    expect(grid.confidence).toBeLessThanOrEqual(1)
    expectSixteenSteps(extractPatterns(features, grid))

    const beat = 60 / analysis.bpm
    const shifted = (analysis.firstDownbeat + beat) % (4 * beat)
    const patterns = extractPatterns(features, { bpm: analysis.bpm, firstDownbeat: shifted })
    expectSixteenSteps(patterns)
    // One beat later, the snare lands on steps 0 and 8.
    expect(patterns.drumPattern.snare[0]).toBeGreaterThanOrEqual(0.8)
    expect(patterns.drumPattern.snare[8]).toBeGreaterThanOrEqual(0.8)
  })

  it('keeps the detected tempo when not refining', { timeout: 30_000 }, () => {
    const { features, analysis } = boomBap()
    const grid = estimateGrid(features, analysis.bpm, { refine: false })
    expect(grid.bpm).toBe(analysis.bpm)
    expect(circular(grid.firstDownbeat, analysis.firstDownbeat, 240 / analysis.bpm)).toBeLessThanOrEqual(0.02)
  })
})

describe('analyzeInBackground', () => {
  it('falls back to the main thread where workers are unavailable', { timeout: 30_000 }, async () => {
    const samples = render({ ...BOOM_BAP, bars: 4 })
    const progress: number[] = []
    const result = await analyzeInBackground(samples, SR, (p) => progress.push(p))
    expect(result.analysis).toEqual(analyzeTrack(samples, SR).analysis)
    expect(progress.at(-1)).toBe(1)
  })
})
