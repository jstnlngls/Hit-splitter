import { analyzeTrack, type AudioFeatures, type TrackAnalysis } from './analysis'
import type { AnalysisRequest, AnalysisResponse } from './analysis.worker'

let nextId = 0

/** Main-thread fallback. It runs in one go; the yield first lets the UI paint its "analyzing" state. */
async function analyzeHere(samples: Float32Array, sampleRate: number, onProgress?: (p: number) => void) {
  await new Promise((resolve) => setTimeout(resolve))
  return analyzeTrack(samples, sampleRate, onProgress)
}

/**
 * Analyzes a track in a module worker so the page stays responsive, and falls
 * back to the main thread when a worker can't be started or fails before it
 * finishes. The samples are copied to the worker rather than transferred, so
 * the caller's array stays intact (and available to the fallback).
 */
export function analyzeInBackground(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (p: number) => void,
): Promise<{ features: AudioFeatures; analysis: TrackAnalysis }> {
  let worker: Worker
  try {
    worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return analyzeHere(samples, sampleRate, onProgress)
  }
  const id = ++nextId
  return new Promise((resolve, reject) => {
    let settled = false
    const fallBack = () => {
      if (settled) return
      settled = true
      worker.terminate()
      analyzeHere(samples, sampleRate, onProgress).then(resolve, reject)
    }
    worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
      const message = event.data
      if (settled || message.id !== id) return
      if (message.type === 'progress') {
        onProgress?.(message.value)
      } else if (message.type === 'done') {
        settled = true
        worker.terminate()
        resolve({ features: message.features, analysis: message.analysis })
      } else {
        fallBack()
      }
    }
    worker.onerror = (event) => {
      event.preventDefault()
      fallBack()
    }
    worker.onmessageerror = fallBack
    try {
      worker.postMessage({ id, samples, sampleRate } satisfies AnalysisRequest)
    } catch {
      fallBack()
    }
  })
}
