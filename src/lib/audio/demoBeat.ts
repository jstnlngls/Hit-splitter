import { hat, kick, snare, voice } from './synth'
import type { Vowel } from '../phonetics/arpabet'

export const DEMO_BPM = 92

/**
 * Renders a short boom-bap beat with a "rapped" syllable rhythm over its
 * second half, so the Track tab can be tried without an audio file at hand.
 */
export async function renderDemoBeat(): Promise<File> {
  const sampleRate = 22050
  const bars = 16
  const step = 60 / DEMO_BPM / 4
  const lead = 0.25
  const duration = lead + bars * 16 * step + 0.8
  const ctx = new OfflineAudioContext(1, Math.ceil(duration * sampleRate), sampleRate)
  const out = ctx.createGain()
  out.gain.value = 0.8
  out.connect(ctx.destination)

  const flow = [0, 2, 3, 6, 8, 10, 11, 14]
  const vowels: Vowel[] = ['AY', 'IY', 'IY', 'OW', 'AY', 'EH', 'IY', 'OW']
  for (let b = 0; b < bars; b++) {
    const bar = lead + b * 16 * step
    for (const s of [0, 7, 10]) kick(ctx, out, bar + s * step)
    for (const s of [4, 12]) snare(ctx, out, bar + s * step)
    for (let s = 0; s < 16; s += 2) hat(ctx, out, bar + s * step, s % 4 === 0 ? 1 : 0.6)
    if (b >= 4) {
      flow.forEach((s, k) => {
        voice(ctx, out, bar + s * step, { vowel: vowels[k], stress: k % 2 === 0 ? 1 : 0, consonant: true, duration: step * 1.6, rhyme: k === 7 })
      })
    }
  }
  const rendered = await ctx.startRendering()
  return new File([encodeWav(rendered.getChannelData(0), sampleRate)], `Demo beat (${DEMO_BPM} BPM).wav`, { type: 'audio/wav' })
}

/** 16-bit mono PCM WAV. */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let peak = 0
  for (const v of samples) peak = Math.max(peak, Math.abs(v))
  const gain = peak > 0.95 ? 0.95 / peak : 1
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i] * gain)) * 0x7fff, true)
  }
  return buffer
}
