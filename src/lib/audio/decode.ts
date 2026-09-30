/** Decoding happens on the main thread (Web Audio isn't available in workers). */

let sharedContext: AudioContext | null = null

/** One AudioContext for the whole app; browsers limit how many can exist. */
export function audioContext(): AudioContext {
  sharedContext ??= new AudioContext({ latencyHint: 'interactive' })
  return sharedContext
}

export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const bytes = await blob.arrayBuffer()
  return audioContext().decodeAudioData(bytes)
}

/** Mixes to mono and resamples for analysis. */
export async function toAnalysisSignal(buffer: AudioBuffer, sampleRate: number): Promise<Float32Array> {
  const length = Math.max(1, Math.ceil(buffer.duration * sampleRate))
  const offline = new OfflineAudioContext(1, length, sampleRate)
  const source = offline.createBufferSource()
  source.buffer = buffer
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0).slice()
}
