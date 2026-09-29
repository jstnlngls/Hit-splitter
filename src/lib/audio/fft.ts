/** A buffer the FFT can transform in place. */
export type FftArray = Float32Array | Float64Array

interface Tables {
  /** Bit-reversal permutation. */
  rev: Uint32Array
  /** cos(2πk/n) and sin(2πk/n) for k < n/2. */
  cos: Float64Array
  sin: Float64Array
}

const tableCache = new Map<number, Tables>()
const windowCache = new Map<number, Float64Array>()

export const isPowerOfTwo = (n: number) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0

function tablesFor(n: number): Tables {
  const cached = tableCache.get(n)
  if (cached) return cached
  const bits = Math.round(Math.log2(n))
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1)
    rev[i] = r
  }
  const half = n >> 1
  const cos = new Float64Array(half)
  const sin = new Float64Array(half)
  for (let k = 0; k < half; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n)
    sin[k] = Math.sin((2 * Math.PI * k) / n)
  }
  const tables = { rev, cos, sin }
  tableCache.set(n, tables)
  return tables
}

/**
 * In-place iterative radix-2 FFT of the complex signal (re, im), whose length
 * must be a power of two. With `inverse` it computes the inverse transform,
 * including the 1/n scaling.
 */
export function fft(re: FftArray, im: FftArray, inverse = false): void {
  const n = re.length
  if (im.length !== n || !isPowerOfTwo(n)) throw new RangeError(`FFT needs two equal power-of-two lengths, got ${n} and ${im.length}`)
  if (n === 1) return
  const { rev, cos, sin } = tablesFor(n)
  for (let i = 0; i < n; i++) {
    const j = rev[i]
    if (j > i) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  const sign = inverse ? 1 : -1
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const stride = n / size
    for (let k = 0; k < half; k++) {
      const wr = cos[k * stride]
      const wi = sign * sin[k * stride]
      for (let a = k; a < n; a += size) {
        const b = a + half
        const tr = re[b] * wr - im[b] * wi
        const ti = re[b] * wi + im[b] * wr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}

/** Periodic Hann window of length n (the STFT-friendly variant), cached per size. Do not modify it. */
export function hannWindow(n: number): Float64Array {
  const cached = windowCache.get(n)
  if (cached) return cached
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  windowCache.set(n, w)
  return w
}

interface RealScratch {
  re: Float64Array
  im: Float64Array
}

const scratchCache = new Map<number, RealScratch>()

/**
 * Magnitude spectrum |X[k]|, k = 0..size/2, of the Hann-windowed real frame of
 * `size` samples that starts at index `start` of `signal` (samples outside the
 * signal count as zero, so frames may hang over either end).
 *
 * The frame is transformed with one complex FFT of half the size: even samples
 * go into the real part and odd samples into the imaginary part, and the two
 * interleaved spectra are separated afterwards using conjugate symmetry.
 */
export function magnitudeSpectrum(
  signal: ArrayLike<number>,
  size = signal.length,
  start = 0,
  out = new Float32Array(size / 2 + 1),
): Float32Array {
  if (!isPowerOfTwo(size) || size < 2) throw new RangeError(`Frame size must be a power of two >= 2, got ${size}`)
  const half = size >> 1
  const window = hannWindow(size)
  let scratch = scratchCache.get(size)
  if (!scratch) {
    scratch = { re: new Float64Array(half), im: new Float64Array(half) }
    scratchCache.set(size, scratch)
  }
  const { re, im } = scratch
  const len = signal.length
  if (start >= 0 && start + size <= len) {
    for (let m = 0, i = start; m < half; m++, i += 2) {
      re[m] = signal[i] * window[2 * m]
      im[m] = signal[i + 1] * window[2 * m + 1]
    }
  } else {
    for (let m = 0; m < half; m++) {
      const i = start + 2 * m
      re[m] = i >= 0 && i < len ? signal[i] * window[2 * m] : 0
      im[m] = i + 1 >= 0 && i + 1 < len ? signal[i + 1] * window[2 * m + 1] : 0
    }
  }
  fft(re, im)
  // X[k] = E[k] + e^(-2πik/size)·O[k], with E and O the spectra of the even and odd samples.
  const { cos, sin } = tablesFor(size)
  out[0] = Math.abs(re[0] + im[0])
  out[half] = Math.abs(re[0] - im[0])
  for (let k = 1; k < half; k++) {
    const ar = re[k]
    const ai = im[k]
    const br = re[half - k]
    const bi = im[half - k]
    const er = 0.5 * (ar + br)
    const ei = 0.5 * (ai - bi)
    const or = 0.5 * (ai + bi)
    const oi = 0.5 * (br - ar)
    const c = cos[k]
    const s = sin[k]
    const xr = er + c * or + s * oi
    const xi = ei + c * oi - s * or
    out[k] = Math.sqrt(xr * xr + xi * xi)
  }
  return out
}
