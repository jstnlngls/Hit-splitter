import type { Stress, Vowel } from '../phonetics/arpabet'

/**
 * Small Web Audio instruments: an 808-ish drum kit for writing without a
 * track, a metronome, and a formant "voice" that sings each syllable's vowel
 * so you can hear a flow's rhythm and rhymes before you record it.
 */

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()

function noise(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx)
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let seed = 12345
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      data[i] = (seed / 0x7fffffff) * 2 - 1
    }
    noiseBuffers.set(ctx, buffer)
  }
  return buffer
}

function envelope(ctx: BaseAudioContext, dest: AudioNode, when: number, peak: number, attack: number, decay: number): GainNode {
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay)
  gain.connect(dest)
  return gain
}

export function kick(ctx: BaseAudioContext, dest: AudioNode, when: number, level = 1) {
  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(150, when)
  osc.frequency.exponentialRampToValueAtTime(45, when + 0.12)
  osc.connect(envelope(ctx, dest, when, 0.9 * level, 0.004, 0.32))
  osc.start(when)
  osc.stop(when + 0.4)
}

export function snare(ctx: BaseAudioContext, dest: AudioNode, when: number, level = 1) {
  const src = ctx.createBufferSource()
  src.buffer = noise(ctx)
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 1900
  band.Q.value = 0.7
  src.connect(band)
  band.connect(envelope(ctx, dest, when, 0.55 * level, 0.002, 0.16))
  src.start(when, Math.random() * 0.5)
  src.stop(when + 0.2)
  const body = ctx.createOscillator()
  body.type = 'triangle'
  body.frequency.setValueAtTime(200, when)
  body.frequency.exponentialRampToValueAtTime(150, when + 0.08)
  body.connect(envelope(ctx, dest, when, 0.35 * level, 0.002, 0.09))
  body.start(when)
  body.stop(when + 0.12)
}

export function hat(ctx: BaseAudioContext, dest: AudioNode, when: number, level = 1) {
  const src = ctx.createBufferSource()
  src.buffer = noise(ctx)
  const high = ctx.createBiquadFilter()
  high.type = 'highpass'
  high.frequency.value = 7500
  src.connect(high)
  high.connect(envelope(ctx, dest, when, 0.22 * level, 0.001, 0.045))
  src.start(when, Math.random() * 0.5)
  src.stop(when + 0.07)
}

export function click(ctx: BaseAudioContext, dest: AudioNode, when: number, accent: boolean) {
  const osc = ctx.createOscillator()
  osc.frequency.value = accent ? 1568 : 1046
  osc.connect(envelope(ctx, dest, when, accent ? 0.35 : 0.22, 0.001, 0.04))
  osc.start(when)
  osc.stop(when + 0.06)
}

// First two formants (Hz) per vowel, start → end for gliding vowels.
const FORMANTS: Record<Vowel, [number, number, number, number]> = {
  IY: [270, 2290, 270, 2290],
  IH: [390, 1990, 390, 1990],
  EH: [530, 1840, 530, 1840],
  AE: [660, 1720, 660, 1720],
  AH: [620, 1200, 620, 1200],
  AA: [730, 1090, 730, 1090],
  AO: [570, 840, 570, 840],
  UH: [440, 1020, 440, 1020],
  UW: [300, 870, 300, 870],
  ER: [490, 1350, 490, 1350],
  EY: [480, 1920, 320, 2200],
  AY: [730, 1090, 320, 2150],
  AW: [730, 1090, 400, 900],
  OY: [570, 840, 320, 2150],
  OW: [500, 900, 360, 800],
}

export interface VoiceNote {
  vowel: Vowel
  stress: Stress
  /** Starts with a consonant: adds a short burst of breath before the vowel. */
  consonant: boolean
  duration: number
  rhyme: boolean
}

export function voice(ctx: BaseAudioContext, dest: AudioNode, when: number, note: VoiceNote) {
  const length = Math.min(Math.max(note.duration * 0.85, 0.06), 0.35)
  const pitch = note.stress === 1 ? (note.rhyme ? 233 : 196) : note.stress === 2 ? 175 : 156
  const source = ctx.createOscillator()
  source.type = 'sawtooth'
  source.frequency.setValueAtTime(pitch, when)
  source.frequency.linearRampToValueAtTime(pitch * (note.stress === 1 ? 0.94 : 0.98), when + length)

  const out = envelope(ctx, dest, when, note.stress === 1 ? 0.5 : 0.32, 0.012, length)
  const [f1a, f2a, f1b, f2b] = FORMANTS[note.vowel]
  for (const [from, to, q, level] of [
    [f1a, f1b, 9, 1],
    [f2a, f2b, 12, 0.55],
  ] as const) {
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.setValueAtTime(from, when)
    band.frequency.linearRampToValueAtTime(to, when + length)
    band.Q.value = q
    const mix = ctx.createGain()
    mix.gain.value = level * 3
    source.connect(band)
    band.connect(mix)
    mix.connect(out)
  }
  source.start(when)
  source.stop(when + length + 0.05)

  if (note.consonant) {
    const breath = ctx.createBufferSource()
    breath.buffer = noise(ctx)
    const high = ctx.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = 3000
    breath.connect(high)
    high.connect(envelope(ctx, dest, when, 0.08, 0.001, 0.02))
    breath.start(when, Math.random() * 0.5)
    breath.stop(when + 0.03)
  }
}
