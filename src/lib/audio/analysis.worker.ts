import { analyzeTrack, type AudioFeatures, type TrackAnalysis } from './analysis'

export interface AnalysisRequest {
  id: number
  samples: Float32Array
  sampleRate: number
}

export type AnalysisResponse =
  | { id: number; type: 'progress'; value: number }
  | { id: number; type: 'done'; features: AudioFeatures; analysis: TrackAnalysis }
  | { id: number; type: 'error'; message: string }

declare const self: DedicatedWorkerGlobalScope

const post = (message: AnalysisResponse, transfer: Transferable[] = []) => self.postMessage(message, transfer)

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { id, samples, sampleRate } = event.data
  try {
    const { features, analysis } = analyzeTrack(samples, sampleRate, (value) => post({ id, type: 'progress', value }))
    // The envelopes are only needed on the main thread from now on, so hand their buffers over.
    const { kick, snare, hat, vocal, full } = features
    post({ id, type: 'done', features, analysis }, [kick.buffer, snare.buffer, hat.buffer, vocal.buffer, full.buffer])
  } catch (error) {
    post({ id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
