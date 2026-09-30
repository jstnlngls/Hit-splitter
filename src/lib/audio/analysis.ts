import { magnitudeSpectrum } from './fft'

export interface AudioFeatures {
  /** Onset-envelope frames per second (sampleRate / hop). */
  frameRate: number
  /** Seconds. */
  duration: number
  /** Onset strength per frame, ~0..1 (up to 1.5). */
  kick: Float32Array
  snare: Float32Array
  hat: Float32Array
  /** Harmonic, vocal-range onsets. */
  vocal: Float32Array
  /** Overall onset strength used for tempo. */
  full: Float32Array
  /** Waveform overview: [min0, max0, min1, max1, ...] for PEAK_BUCKETS buckets, rounded to 3 decimals. */
  peaks: number[]
}

export interface GridEstimate {
  /** Tempo in beats per minute (refined). */
  bpm: number
  /** Time in seconds of the first beat at or after 0. */
  beatOffset: number
  /** Time in seconds of the first bar start (beat 1) at or after 0, always < 4 beats. */
  firstDownbeat: number
  /** 0..1, how strongly onsets line up with the grid. */
  confidence: number
}

export interface VocalPattern {
  /** 16th-note step indices 0..15 where syllables land. */
  steps: number[]
  /** How many bars use (roughly) this pattern. */
  count: number
  /** Indices of those bars. */
  bars: number[]
}

export interface PatternAnalysis {
  /** Number of whole bars from firstDownbeat to the end. */
  bars: number
  /** [bar][step] strengths 0..1 (2 decimals). */
  drumBars: { kick: number[][]; snare: number[][]; hat: number[][] }
  /** 16 values: share of active bars with a hit on that step (0..1, 2 decimals). */
  drumPattern: { kick: number[]; snare: number[]; hat: number[] }
  /** [bar][step] vocal-range onset strengths 0..1 (2 decimals). */
  vocalBars: number[][]
  /** Up to 4 most common bar patterns, most common first, each used by >= 2 bars. */
  vocalPatterns: VocalPattern[]
  /** Per bar: number of steps with a vocal onset. */
  vocalDensity: number[]
}

export interface TrackAnalysis extends GridEstimate, PatternAnalysis {
  duration: number
  /** Best first; includes octave alternatives (x2, /2) when plausible; scores normalized so the best is 1. */
  bpmCandidates: { bpm: number; score: number }[]
  peaks: number[]
}

/** The app resamples to this rate before analysis; any rate >= 8000 works. */
export const ANALYSIS_SAMPLE_RATE = 22050
export const PEAK_BUCKETS = 1200

const STEPS = 16
const MIN_BPM = 60
const MAX_BPM = 200
/** Centre of the tempo prior: typical rap tempos resolve octave errors toward it. */
const PRIOR_BPM = 95
/** Octave alternatives outside this range are not offered as candidates. */
const PLAUSIBLE_MIN = 40
const PLAUSIBLE_MAX = 240
/** Weight of the half-beat taps in the tempo comb, relative to the beat taps. */
const HALF_BEAT_TAP = 0.25
/** How much better (0..1 scale) the drums must fit the double or half tempo to switch to it. */
const OCTAVE_FIT_MARGIN = 0.15
/** Log compression: log(1 + GAMMA·mag), with mag scaled so a full-scale sine reads 1. */
const GAMMA = 100
/**
 * Where an onset sits inside the analysis window of the frame that reports it,
 * as a fraction of the window. The flux between two overlapping frames peaks
 * once the onset is slightly past the window centre, so frames start a bit
 * earlier than centred; calibrated on synthetic drums to within ~1 ms.
 */
const ONSET_POSITION = 0.58
const HIT = 0.35
const ACTIVE = 0.2
/** Upper bound on the share of hat-band onset strength removed from the snare band. */
const MAX_HAT_SPILL = 0.45

const round = (x: number, digits: number) => {
  const f = 10 ** digits
  return Math.round(x * f) / f || 0
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

// ---------------------------------------------------------------------------
// Sorted windows for running medians. A window is the sorted run a[lo..hi).

function lowerBound(a: Float32Array, lo: number, hi: number, v: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Replaces one occurrence of `old` by `v`, sliding `v` to its sorted position. */
function sortedReplace(a: Float32Array, lo: number, hi: number, old: number, v: number) {
  let i = lowerBound(a, lo, hi, old)
  if (v > old) {
    while (i + 1 < hi && a[i + 1] < v) {
      a[i] = a[i + 1]
      i++
    }
  } else {
    while (i > lo && a[i - 1] > v) {
      a[i] = a[i - 1]
      i--
    }
  }
  a[i] = v
}

/** Inserts `v` into the run a[lo..hi), which grows to a[lo..hi]. */
function sortedInsert(a: Float32Array, lo: number, hi: number, v: number) {
  let i = hi
  while (i > lo && a[i - 1] > v) {
    a[i] = a[i - 1]
    i--
  }
  a[i] = v
}

/** Removes one occurrence of `v` from the run a[lo..hi), which shrinks to a[lo..hi-1). */
function sortedRemove(a: Float32Array, lo: number, hi: number, v: number) {
  for (let i = lowerBound(a, lo, hi, v); i < hi - 1; i++) a[i] = a[i + 1]
}

const medianOf = (a: Float32Array, lo: number, count: number) =>
  count & 1 ? a[lo + (count >> 1)] : 0.5 * (a[lo + count / 2 - 1] + a[lo + count / 2])

/** Running median across frequency (window 2·half+1, truncated at the edges). */
function frequencyMedian(src: Float32Array, off: number, n: number, half: number, scratch: Float32Array, out: Float32Array) {
  let count = 0
  for (let j = 0; j <= half && j < n; j++) sortedInsert(scratch, 0, count++, src[off + j])
  for (let k = 0; k < n; k++) {
    out[k] = medianOf(scratch, 0, count)
    const add = k + half + 1
    const drop = k - half
    if (add < n && drop >= 0) sortedReplace(scratch, 0, count, src[off + drop], src[off + add])
    else if (add < n) sortedInsert(scratch, 0, count++, src[off + add])
    else if (drop >= 0) sortedRemove(scratch, 0, count--, src[off + drop])
  }
}

// ---------------------------------------------------------------------------
// Small numeric helpers

function percentile(values: ArrayLike<number>, q: number): number {
  const n = values.length
  if (n === 0) return 0
  const sorted = Float64Array.from(values).sort()
  const pos = q * (n - 1)
  const i = Math.floor(pos)
  return i + 1 < n ? sorted[i] + (pos - i) * (sorted[i + 1] - sorted[i]) : sorted[n - 1]
}

/** Linear interpolation of a[x]; zero outside the array. */
function interp(a: ArrayLike<number>, x: number): number {
  if (!(x >= 0)) return 0
  const i = Math.floor(x)
  if (i >= a.length - 1) return i === a.length - 1 && x === i ? a[i] : 0
  const f = x - i
  return a[i] + f * (a[i + 1] - a[i])
}

/** Largest value of a within [c - half, c + half] (interpolated at c when no frame falls inside). */
function windowMax(a: ArrayLike<number>, c: number, half: number): number {
  const lo = Math.max(0, Math.ceil(c - half))
  const hi = Math.min(a.length - 1, Math.floor(c + half))
  if (lo > hi) return interp(a, c)
  let m = a[lo]
  for (let t = lo + 1; t <= hi; t++) if (a[t] > m) m = a[t]
  return m
}

/** Subtracts a centred moving average (removing slow trends) and clamps at zero, in place. */
function detrend(env: Float32Array, half: number) {
  const n = env.length
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + env[i]
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half)
    const hi = Math.min(n, i + half + 1)
    env[i] = Math.max(0, env[i] - (prefix[hi] - prefix[lo]) / (hi - lo))
  }
}

/**
 * Removes, in place, what bright hi-hats leak into the snare envelope. The leak
 * is the median snare/hat ratio at strong hat onsets (mostly hat-only moments,
 * as hats outnumber snares); the cap keeps a track without hats from losing its
 * snares to their own sizzle in the hat band.
 */
function removeHatSpill(snare: Float32Array, hat: Float32Array) {
  const strong = Math.max(percentile(hat, 0.8), 1e-4)
  const ratios: number[] = []
  for (let c = 1; c + 1 < hat.length; c++) {
    const h = hat[c]
    if (h > strong && h >= hat[c - 1] && h >= hat[c + 1]) ratios.push(snare[c] / h)
  }
  const spill = Math.min(MAX_HAT_SPILL, percentile(ratios, 0.5))
  if (spill > 0) for (let c = 0; c < snare.length; c++) snare[c] = Math.max(0, snare[c] - spill * hat[c])
}

/** Scales so the 99th percentile is ~1 (clamped at 1.5); `floor` keeps silence from being amplified. */
function normalizeEnvelope(env: Float32Array, floor: number) {
  const scale = 1 / Math.max(percentile(env, 0.99), floor)
  for (let i = 0; i < env.length; i++) env[i] = Math.min(1.5, env[i] * scale)
}

function waveformPeaks(samples: Float32Array): number[] {
  const out = new Array<number>(PEAK_BUCKETS * 2).fill(0)
  const n = samples.length
  if (n === 0) return out
  for (let b = 0; b < PEAK_BUCKETS; b++) {
    const lo = Math.min(n - 1, Math.floor((b * n) / PEAK_BUCKETS))
    const hi = Math.max(lo + 1, Math.floor(((b + 1) * n) / PEAK_BUCKETS))
    let min = Infinity
    let max = -Infinity
    for (let i = lo; i < hi; i++) {
      const v = samples[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    out[2 * b] = Number.isFinite(min) ? round(min, 3) : 0
    out[2 * b + 1] = Number.isFinite(max) ? round(max, 3) : 0
  }
  return out
}

/** The input with non-finite samples zeroed (copied only when needed). */
function sanitize(samples: Float32Array): Float32Array {
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) return samples.map((v) => (Number.isFinite(v) ? v : 0))
  }
  return samples
}

// ---------------------------------------------------------------------------
// Features

/**
 * STFT → harmonic/percussive separation → band-wise onset envelopes.
 *
 * Harmonic/percussive separation follows Fitzgerald (2010): in the magnitude
 * spectrogram, sustained tones are smooth along time and drum hits are smooth
 * along frequency, so a running median across time (H) keeps tones and one
 * across frequency (P) keeps hits; soft masks P²/(H²+P²) and H²/(H²+P²) split
 * each bin between the two. The spectrogram is streamed through a ring buffer
 * as wide as the time median, so memory stays small for long tracks.
 */
export function computeFeatures(samples: Float32Array, sampleRate: number, onProgress?: (p: number) => void): AudioFeatures {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError(`Invalid sample rate: ${sampleRate}`)
  const input = sanitize(samples)
  const n = input.length
  const size = Math.max(64, 2 ** Math.round(Math.log2(0.046 * sampleRate)))
  const hop = size / 4
  const frameRate = sampleRate / hop
  const frames = Math.floor(n / hop) + 1
  const binHz = sampleRate / size
  const bins = Math.min(size / 2, Math.floor(11000 / binHz)) + 1
  const band = (lo: number, hi: number) => [Math.max(1, Math.ceil(lo / binHz)), Math.min(bins - 1, Math.floor(hi / binHz))]
  const [kickLo, kickHi] = band(30, 150)
  // Snares are broadband, but below ~1 kHz kicks and voices swamp their onsets and above
  // ~2.2 kHz bright hi-hats do, so the snare envelope listens to the band in between.
  const [snareLo, snareHi] = band(1000, 2200)
  const [hatLo, hatHi] = band(5000, 11000)
  const [vocalLo, vocalHi] = band(250, 3500)

  const [refLo, refHi] = band(300, 1000)
  const halfT = Math.max(1, Math.round((0.2 * frameRate - 1) / 2))
  const spanT = 2 * halfT + 1
  const halfF = Math.max(1, Math.round((366 / binHz - 1) / 2))
  const norm = 4 / size // 2 / Σw for a periodic Hann window
  const lead = Math.round(ONSET_POSITION * size)

  const ring = new Float32Array(spanT * bins)
  const timeWindows = new Float32Array(spanT * bins)
  const spectrum = new Float32Array(size / 2 + 1)
  const freqScratch = new Float32Array(2 * halfF + 2)
  const harm = new Float32Array(bins)
  const perc = new Float32Array(bins)
  const fluxP = new Float32Array(bins)
  let prevP = new Float32Array(bins)
  let curP = new Float32Array(bins)
  let prevH = new Float32Array(bins)
  let curH = new Float32Array(bins)

  const kick = new Float32Array(frames)
  const snare = new Float32Array(frames)
  const hat = new Float32Array(frames)
  const vocal = new Float32Array(frames)

  const bandMean = (a: Float32Array, lo: number, hi: number) => {
    if (hi < lo) return 0
    let s = 0
    for (let k = lo; k <= hi; k++) s += a[k]
    return s / (hi - lo + 1)
  }

  let count = 0
  const total = frames + halfT
  const progressEvery = Math.max(1, Math.floor(total / 100))
  for (let t = 0; t < total; t++) {
    // Frame t enters the time-median windows and frame t - spanT leaves (same ring slot).
    const leaving = t - spanT
    if (t < frames) {
      magnitudeSpectrum(input, size, t * hop - lead, spectrum)
      const slot = (t % spanT) * bins
      for (let k = 0; k < bins; k++) {
        const old = ring[slot + k]
        ring[slot + k] = spectrum[k] * norm
        const v = ring[slot + k]
        const lo = k * spanT
        if (leaving >= 0) sortedReplace(timeWindows, lo, lo + count, old, v)
        else sortedInsert(timeWindows, lo, lo + count, v)
      }
      if (leaving < 0) count++
    } else if (leaving >= 0) {
      const slot = (leaving % spanT) * bins
      for (let k = 0; k < bins; k++) sortedRemove(timeWindows, k * spanT, k * spanT + count, ring[slot + k])
      count--
    }

    const c = t - halfT
    if (c >= 0) {
      const row = (c % spanT) * bins
      for (let k = 0; k < bins; k++) harm[k] = medianOf(timeWindows, k * spanT, count)
      frequencyMedian(ring, row, bins, halfF, freqScratch, perc)
      for (let k = 1; k < bins; k++) {
        const s = ring[row + k]
        const h2 = harm[k] * harm[k]
        const p2 = perc[k] * perc[k]
        const mask = h2 + p2 > 0 ? p2 / (h2 + p2) : 0.5
        // Peakiness: how far the bin stands above the local spectral floor (the frequency
        // median). Tones (kick bodies, sung partials) are peaky, noise bursts are flat.
        const s2 = s * s
        const peaky = s2 > 0 ? s2 / (s2 + 4 * p2) : 0
        const isKick = k >= kickLo && k <= kickHi
        const lp = Math.log1p(GAMMA * s * mask * (isKick ? peaky : 1))
        curP[k] = lp
        const d = lp - prevP[k]
        fluxP[k] = d > 0 ? d : 0
        if (k >= vocalLo - 1 && k <= vocalHi + 1) {
          const h4 = h2 * h2
          const p4 = p2 * p2
          const harmonic = h4 + p4 > 0 ? h4 / (h4 + p4) : 0.5
          curH[k] = Math.log1p(GAMMA * s * harmonic * peaky)
        }
      }
      // Vocal flux compares each bin with the loudest of its neighbours in the previous
      // frame, so small pitch glides and vibrato do not register as new onsets.
      let vocalSum = 0
      for (let k = vocalLo; k <= vocalHi; k++) {
        const d = curH[k] - Math.max(prevH[k - 1], prevH[k], k + 1 < bins ? prevH[k + 1] : 0)
        if (d > 0) vocalSum += d
      }
      // Broadband hits (snares, claps) and voices also reach below 150 Hz; their share is
      // estimated from the 300-1000 Hz flux and taken off the kick.
      kick[c] = Math.max(0, bandMean(fluxP, kickLo, kickHi) - bandMean(fluxP, refLo, refHi))
      snare[c] = bandMean(fluxP, snareLo, snareHi)
      hat[c] = bandMean(fluxP, hatLo, hatHi)
      // The harmonic mask needs a few ms of a tone before it counts it, so vocal onsets
      // register about a frame late; report them one frame earlier.
      if (c > 0) vocal[c - 1] = vocalHi >= vocalLo ? vocalSum / (vocalHi - vocalLo + 1) : 0
      const swapP = prevP
      prevP = curP
      curP = swapP
      const swapH = prevH
      prevH = curH
      curH = swapH
    }
    if (onProgress && t % progressEvery === 0) onProgress((0.95 * t) / total)
  }

  removeHatSpill(snare, hat)
  const trendHalf = Math.max(1, Math.round(0.14 * frameRate))
  for (const env of [kick, snare, hat, vocal]) {
    detrend(env, trendHalf)
    normalizeEnvelope(env, 0.005)
  }
  const full = new Float32Array(frames)
  for (let i = 0; i < frames; i++) full[i] = kick[i] + snare[i] + hat[i] + 0.5 * vocal[i]
  normalizeEnvelope(full, 0.01)

  const features: AudioFeatures = {
    frameRate,
    duration: n / sampleRate,
    kick,
    snare,
    hat,
    vocal,
    full,
    peaks: waveformPeaks(input),
  }
  onProgress?.(1)
  return features
}

// ---------------------------------------------------------------------------
// Tempo

const tempoPrior = (bpm: number) => Math.exp(-0.5 * Math.log2(bpm / PRIOR_BPM) ** 2)

/** Normalized autocorrelation r[L] / r[0] of the mean-removed envelope, unbiased per lag. */
function autocorrelation(env: Float32Array, maxLag: number): Float64Array {
  const n = env.length
  const acf = new Float64Array(maxLag + 1)
  if (n === 0) return acf
  let mean = 0
  for (let i = 0; i < n; i++) mean += env[i]
  mean /= n
  const g = new Float64Array(n)
  for (let i = 0; i < n; i++) g[i] = env[i] - mean
  for (let lag = 0; lag <= maxLag && lag < n; lag++) {
    let s = 0
    for (let i = 0; i + lag < n; i++) s += g[i] * g[i + lag]
    acf[lag] = s / (n - lag)
  }
  const zero = acf[0]
  if (zero > 1e-12) for (let lag = 0; lag <= maxLag; lag++) acf[lag] /= zero
  else acf.fill(0)
  return acf
}

/**
 * Tempo from onset autocorrelation: each tempo is scored by the
 * autocorrelation at 1..4 beat periods, weighted by a gentle log-normal prior
 * around PRIOR_BPM (one octave wide).
 *
 * The autocorrelation is averaged over the bands rather than taken of the
 * combined envelope, so busy 16th-note hats cannot drown out the bar-level
 * kick/snare structure. A light tap on each half beat favours tempos whose
 * off-beats also carry onsets, which rules out 3:2 readings (a 140 BPM beat
 * heard at 93) that would otherwise share most of the true tempo's taps.
 */
export function estimateTempo(
  features: AudioFeatures,
  opts: { min?: number; max?: number } = {},
): { bpm: number; candidates: { bpm: number; score: number }[] } {
  let min = opts.min ?? MIN_BPM
  let max = opts.max ?? MAX_BPM
  if (!(min > 0)) min = MIN_BPM
  if (!(max > 0)) max = MAX_BPM
  if (min > max) [min, max] = [max, min]
  const fr = features.frameRate
  const lowest = Math.min(min, PLAUSIBLE_MIN)
  const maxLag = Math.ceil((4 * 60 * fr) / lowest) + 2
  const acf = new Float64Array(maxLag + 1)
  const bands: [Float32Array, number][] = [
    [features.kick, 1],
    [features.snare, 1],
    [features.hat, 1],
    [features.vocal, 0.5],
  ]
  for (const [env, weight] of bands) {
    const band = autocorrelation(env, maxLag)
    for (let lag = 0; lag <= maxLag; lag++) acf[lag] += weight * band[lag]
  }
  const score = (bpm: number) => {
    const period = (60 * fr) / bpm
    let s = 0
    for (let k = 1; k <= 4; k++) s += interp(acf, k * period) + HALF_BEAT_TAP * interp(acf, (k - 0.5) * period)
    // The tiny prior-only term picks a sensible default when there is no periodicity at all.
    return tempoPrior(bpm) * (Math.max(0, s) + 1e-9)
  }

  const step = 0.05
  const count = Math.max(1, Math.floor((max - min) / step) + 1)
  const scores = new Float64Array(count)
  let best = 0
  for (let i = 0; i < count; i++) {
    scores[i] = score(min + i * step)
    if (scores[i] > scores[best]) best = i
  }
  let bpm = min + best * step
  if (best > 0 && best < count - 1) {
    const a = scores[best - 1]
    const b = scores[best]
    const c = scores[best + 1]
    const denom = a - 2 * b + c
    if (denom < 0) bpm += (clamp((0.5 * (a - c)) / denom, -0.5, 0.5)) * step
  }
  const top = score(bpm)

  // The comb rates a tempo and its double much alike; the drums tell them apart. At the right
  // tempo kick and snare sit on the beats in a backbeat or half-time pattern, not between them.
  const drumFit = (b: number) => {
    const period = (60 * fr) / b
    const { phase } = bestPhase(features.full, period)
    return Math.max(barFit(features, phase, period).fit, barFit(features, phase + period / 2, period).fit)
  }
  const fit = drumFit(bpm)
  for (const alt of [bpm * 2, bpm / 2]) {
    if (alt >= min && alt <= max && score(alt) >= 0.3 * top && drumFit(alt) > fit + OCTAVE_FIT_MARGIN) {
      bpm = alt
      break
    }
  }
  const ref = score(bpm)

  const candidates: { bpm: number; score: number }[] = [{ bpm, score: 1 }]
  const distinct = (b: number) => candidates.every((c) => Math.abs(Math.log2(c.bpm / b)) > 0.05)
  for (const alt of [bpm * 2, bpm / 2]) {
    if (alt >= PLAUSIBLE_MIN && alt <= PLAUSIBLE_MAX && distinct(alt)) candidates.push({ bpm: alt, score: score(alt) / ref })
  }
  // Other clear local maxima (e.g. a 3:2 feel), strongest first.
  const peaks: number[] = []
  for (let i = 1; i < count - 1; i++) if (scores[i] > scores[i - 1] && scores[i] >= scores[i + 1]) peaks.push(i)
  peaks.sort((a, b) => scores[b] - scores[a])
  for (const i of peaks) {
    if (candidates.length >= 6) break
    const b = min + i * step
    if (scores[i] / ref >= 0.3 && distinct(b)) candidates.push({ bpm: b, score: scores[i] / ref })
  }
  const [first, ...rest] = candidates
  rest.sort((a, b) => b.score - a.score)
  return {
    bpm,
    candidates: [first, ...rest].map((c) => ({ bpm: round(c.bpm, 3), score: round(Math.min(1, c.score), 3) })),
  }
}

// ---------------------------------------------------------------------------
// Grid

/** Mean of env at phase + n·period for all beats inside the envelope. */
function beatMean(env: ArrayLike<number>, phase: number, period: number): number {
  const last = env.length - 1
  let s = 0
  let count = 0
  for (let n = 0; ; n++) {
    const x = phase + n * period
    if (x > last) break
    const i = Math.floor(x)
    s += i < last ? env[i] + (x - i) * (env[i + 1] - env[i]) : env[i]
    count++
  }
  return count ? s / count : 0
}

/** Best phase in [0, period) at a fixed period, searched at `step` frames then refined parabolically. */
function bestPhase(env: ArrayLike<number>, period: number, step = 0.25): { phase: number; score: number } {
  const count = Math.max(1, Math.ceil(period / step))
  const scores = new Float64Array(count)
  let best = 0
  for (let i = 0; i < count; i++) {
    scores[i] = beatMean(env, i * step, period)
    if (scores[i] > scores[best]) best = i
  }
  const a = scores[(best - 1 + count) % count]
  const b = scores[best]
  const c = scores[(best + 1) % count]
  const denom = a - 2 * b + c
  let phase = best * step
  if (denom < 0) phase += clamp((0.5 * (a - c)) / denom, -0.5, 0.5) * step
  phase = ((phase % period) + period) % period
  return { phase, score: b }
}

/** Light [1, 2, 1] smoothing so the coarse grid search tolerates sub-frame misalignment. */
function smooth(env: Float32Array): Float32Array {
  const n = env.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = 0.25 * (env[Math.max(0, i - 1)] + 2 * env[i] + env[Math.min(n - 1, i + 1)])
  return out
}

/**
 * Joint search of tempo (±1 %) and phase maximizing the mean envelope at the
 * beats over the whole track: coarse (0.005 BPM, 1 frame) then fine (0.0005 BPM,
 * 0.05 frame) around the winner. A 0.1 BPM error would drift by ~0.2 s over
 * three minutes, so the fine stage matters for long tracks.
 */
function refineGrid(env: Float32Array, bpm: number, fr: number): { bpm: number; phase: number } {
  const soft = smooth(env)
  let best = { bpm, phase: 0, score: -1 }
  const coarse = 0.005
  const span = Math.ceil((0.01 * bpm) / coarse)
  for (let i = -span; i <= span; i++) {
    const b = bpm + i * coarse
    const period = (60 * fr) / b
    for (let phase = 0; phase < period; phase++) {
      const s = beatMean(soft, phase, period)
      if (s > best.score) best = { bpm: b, phase, score: s }
    }
  }
  const center = best
  for (let i = -10; i <= 10; i++) {
    const b = center.bpm + i * (coarse / 10)
    const period = (60 * fr) / b
    for (let j = -20; j <= 20; j++) {
      const phase = center.phase + j * 0.05
      const s = beatMean(soft, ((phase % period) + period) % period, period)
      if (s > best.score) best = { bpm: b, phase: ((phase % period) + period) % period, score: s }
    }
  }
  return { bpm: best.bpm, phase: best.phase }
}

const sanitizeBpm = (bpm: number) => (Number.isFinite(bpm) && bpm > 0 ? clamp(bpm, 20, 400) : PRIOR_BPM)

/**
 * Beat grid for a tempo: the phase where the full envelope peaks on the beats
 * (with `refine`, also fine-tuning the tempo within ±1 %), the bar phase from
 * kick/snare placement, and a confidence.
 */
export function estimateGrid(features: AudioFeatures, bpm: number, opts: { refine?: boolean } = {}): GridEstimate {
  const fr = features.frameRate
  const env = features.full
  let tempo = sanitizeBpm(bpm)
  let phase: number
  if (opts.refine ?? true) ({ bpm: tempo, phase } = refineGrid(env, tempo, fr))
  else phase = bestPhase(env, (60 * fr) / tempo).phase
  const period = (60 * fr) / tempo

  const bar = barFit(features, phase, period).beat
  const overall = env.length ? env.reduce((a, b) => a + b, 0) / env.length : 0
  const ratio = overall > 1e-9 ? beatMean(env, phase, period) / overall : 0
  const confidence = 1 - Math.exp(-Math.max(0, ratio - 1) / 2)
  return {
    bpm: round(tempo, 3),
    beatOffset: round(phase / fr, 4),
    firstDownbeat: round((phase + bar * period) / fr, 4),
    confidence: round(confidence, 3),
  }
}

/**
 * Which of the 4 beats after `phase` starts a bar, and how well the drums fit
 * such bars (about 0..1). Per-beat kick and snare strengths, averaged over the
 * track, are matched against two templates scaled so a perfect match scores 1:
 * backbeat (kick on 1 and a bit on 3, snare on 2 and 4) and half-time (kick on
 * 1, snare on 3).
 */
function barFit(features: AudioFeatures, phase: number, period: number): { beat: number; fit: number } {
  const { kick, snare, full } = features
  const beats = Math.floor((kick.length - 1 - phase) / period) + 1
  if (!(beats > 0)) return { beat: 0, fit: 0 }
  const k = new Float64Array(4)
  const s = new Float64Array(4)
  const f = new Float64Array(4)
  const counts = new Float64Array(4)
  const half = 0.1 * period
  for (let b = 0; b < beats; b++) {
    const c = phase + b * period
    k[b % 4] += windowMax(kick, c, half)
    s[b % 4] += windowMax(snare, c, half)
    f[b % 4] += windowMax(full, c, half)
    counts[b % 4]++
  }
  for (let m = 0; m < 4; m++) {
    if (!counts[m]) continue
    k[m] /= counts[m]
    s[m] /= counts[m]
    f[m] /= counts[m]
  }
  let beat = 0
  let fit = 0
  let bestScore = -Infinity
  for (let j = 0; j < 4; j++) {
    const K = (m: number) => k[(j + m) % 4]
    const S = (m: number) => s[(j + m) % 4]
    const backbeat = (K(0) + 0.5 * K(2) + S(1) + S(3) - 0.5 * (K(1) + K(3) + S(0) + S(2))) / 3.5
    const halfTime = (K(0) + S(2) - 0.5 * (K(2) + S(0))) / 2
    const match = Math.max(backbeat, halfTime)
    // The overall onset strength on the beat only breaks near-ties.
    const score = match + 0.03 * f[j]
    if (score > bestScore + 1e-9) {
      bestScore = score
      beat = j
      fit = match
    }
  }
  return { beat, fit: Math.max(0, fit) }
}

// ---------------------------------------------------------------------------
// Patterns

/** Per bar and step, the envelope maximum within ±40 % of a step (only local peaks when `peaksOnly`). */
function stepStrengths(env: Float32Array, bars: number, startFrame: number, stepFrames: number, peaksOnly: boolean): Float64Array {
  const out = new Float64Array(bars * STEPS)
  const half = 0.4 * stepFrames
  const last = env.length - 1
  for (let i = 0; i < out.length; i++) {
    const c = startFrame + i * stepFrames
    if (!peaksOnly) {
      out[i] = windowMax(env, c, half)
      continue
    }
    const lo = Math.max(0, Math.ceil(c - half))
    const hi = Math.min(last, Math.floor(c + half))
    let m = 0
    for (let t = lo; t <= hi; t++) {
      const v = env[t]
      if (v > m && (t === 0 || v >= env[t - 1]) && (t === last || v > env[t + 1])) m = v
    }
    out[i] = m
  }
  return out
}

/**
 * Scales strengths by their 95th percentile (clamped at 1). The divisor is at
 * least half the maximum so a band with only a few hits does not blow its
 * noise floor up to full strength.
 */
function normalizeSteps(raw: Float64Array): Float64Array {
  let max = 0
  for (const v of raw) if (v > max) max = v
  const denom = Math.max(percentile(raw, 0.95), 0.5 * max)
  return denom > 1e-9 ? raw.map((v) => Math.min(1, v / denom)) : new Float64Array(raw.length)
}

const toBars = (values: Float64Array, bars: number) =>
  Array.from({ length: bars }, (_, b) => Array.from(values.subarray(b * STEPS, (b + 1) * STEPS), (v) => round(v, 2)))

function drumPatternOf(values: Float64Array, bars: number): number[] {
  const hits = new Array<number>(STEPS).fill(0)
  let active = 0
  for (let b = 0; b < bars; b++) {
    const row = values.subarray(b * STEPS, (b + 1) * STEPS)
    if (Math.max(...row) < ACTIVE) continue
    active++
    for (let s = 0; s < STEPS; s++) if (row[s] >= HIT) hits[s]++
  }
  return hits.map((h) => (active ? round(h / active, 2) : 0))
}

const popcount = (x: number) => {
  let c = 0
  for (; x; x &= x - 1) c++
  return c
}

/**
 * Greedy clustering of binarized bar masks: distinct masks in order of
 * frequency either join the nearest cluster whose centre is within Hamming
 * distance 2 or start a new one; a cluster's steps are the majority vote of
 * its members.
 */
function vocalPatternsOf(masks: number[]): VocalPattern[] {
  const byMask = new Map<number, number[]>()
  masks.forEach((mask, bar) => {
    if (popcount(mask) < 3) return
    const list = byMask.get(mask)
    if (list) list.push(bar)
    else byMask.set(mask, [bar])
  })
  const distinct = [...byMask].sort((a, b) => b[1].length - a[1].length || a[1][0] - b[1][0])
  const clusters: { centre: number; bars: number[] }[] = []
  for (const [mask, bars] of distinct) {
    let target: { centre: number; bars: number[] } | undefined
    let bestDistance = 3
    for (const cluster of clusters) {
      const d = popcount(cluster.centre ^ mask)
      if (d < bestDistance) {
        bestDistance = d
        target = cluster
      }
    }
    if (target) target.bars.push(...bars)
    else clusters.push({ centre: mask, bars: [...bars] })
  }
  return clusters
    .filter((c) => c.bars.length >= 2)
    .sort((a, b) => b.bars.length - a.bars.length || Math.min(...a.bars) - Math.min(...b.bars))
    .slice(0, 4)
    .map(({ centre, bars }) => {
      const steps: number[] = []
      for (let s = 0; s < STEPS; s++) {
        const votes = bars.reduce((v, bar) => v + ((masks[bar] >> s) & 1), 0)
        if (2 * votes > bars.length || (2 * votes === bars.length && (centre >> s) & 1)) steps.push(s)
      }
      return { steps, count: bars.length, bars: bars.sort((a, b) => a - b) }
    })
}

/**
 * 16-step drum and vocal patterns per bar on the grid given by `bpm` and
 * `firstDownbeat`.
 */
export function extractPatterns(features: AudioFeatures, grid: { bpm: number; firstDownbeat: number }): PatternAnalysis {
  const fr = features.frameRate
  const stepSec = 60 / sanitizeBpm(grid.bpm) / 4
  const start = Number.isFinite(grid.firstDownbeat) ? grid.firstDownbeat : 0
  const bars = Math.max(0, Math.floor((features.duration - start) / (STEPS * stepSec) + 1e-6))
  const startFrame = start * fr
  const stepFrames = stepSec * fr

  const kick = normalizeSteps(stepStrengths(features.kick, bars, startFrame, stepFrames, false))
  const snare = normalizeSteps(stepStrengths(features.snare, bars, startFrame, stepFrames, false))
  const hat = normalizeSteps(stepStrengths(features.hat, bars, startFrame, stepFrames, false))
  const vocal = normalizeSteps(stepStrengths(features.vocal, bars, startFrame, stepFrames, true))

  const masks: number[] = []
  for (let b = 0; b < bars; b++) {
    let mask = 0
    for (let s = 0; s < STEPS; s++) if (vocal[b * STEPS + s] >= HIT) mask |= 1 << s
    masks.push(mask)
  }
  return {
    bars,
    drumBars: { kick: toBars(kick, bars), snare: toBars(snare, bars), hat: toBars(hat, bars) },
    drumPattern: { kick: drumPatternOf(kick, bars), snare: drumPatternOf(snare, bars), hat: drumPatternOf(hat, bars) },
    vocalBars: toBars(vocal, bars),
    vocalPatterns: vocalPatternsOf(masks),
    vocalDensity: masks.map(popcount),
  }
}

// ---------------------------------------------------------------------------
// Whole track

/** Full analysis: features, tempo (with alternatives), refined grid, and patterns. */
export function analyzeTrack(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (p: number) => void,
): { features: AudioFeatures; analysis: TrackAnalysis } {
  const features = computeFeatures(samples, sampleRate, onProgress && ((p) => onProgress(0.9 * p)))
  const tempo = estimateTempo(features)
  onProgress?.(0.93)
  const grid = estimateGrid(features, tempo.bpm)
  onProgress?.(0.97)
  const patterns = extractPatterns(features, grid)
  onProgress?.(1)
  // Candidates follow the refined tempo, so octave alternatives stay exact multiples of it.
  const ratio = grid.bpm / tempo.bpm
  const bpmCandidates = tempo.candidates.map((c, i) => ({ bpm: i === 0 ? grid.bpm : round(c.bpm * ratio, 3), score: c.score }))
  return {
    features,
    analysis: { ...grid, ...patterns, duration: features.duration, bpmCandidates, peaks: features.peaks },
  }
}
