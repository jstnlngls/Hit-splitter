import { useCallback, useEffect, useRef, useState } from 'react'
import { ANALYSIS_SAMPLE_RATE, estimateGrid, extractPatterns, type AudioFeatures, type TrackAnalysis } from '../lib/audio/analysis'
import { analyzeInBackground } from '../lib/audio/analyzeClient'
import { decodeAudio, toAnalysisSignal } from '../lib/audio/decode'
import type { Song, TrackInfo } from '../lib/store/songs'
import { deleteTrack, loadTrack, saveTrack } from '../lib/store/trackStore'

export type TrackPhase = 'none' | 'restoring' | 'decoding' | 'analyzing' | 'ready' | 'missing' | 'error'

export interface TrackStatus {
  phase: TrackPhase
  progress?: number
  message?: string
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places

function infoFrom(name: string, analysis: TrackAnalysis): TrackInfo {
  const { bars, drumBars, drumPattern, vocalBars, vocalPatterns, vocalDensity } = analysis
  return {
    name,
    duration: analysis.duration,
    detectedBpm: round(analysis.bpm),
    bpmCandidates: analysis.bpmCandidates.map((c) => ({ bpm: round(c.bpm), score: round(c.score) })),
    firstDownbeat: analysis.firstDownbeat,
    confidence: analysis.confidence,
    peaks: analysis.peaks,
    patterns: { bars, drumBars, drumPattern, vocalBars, vocalPatterns, vocalDensity },
  }
}

/**
 * The imported track for the current song: decoded audio for playback,
 * analysis features for re-gridding, and persistence in IndexedDB.
 */
export function useTrack(song: Song, updateSong: (id: string, update: (s: Song) => Song) => void) {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [features, setFeatures] = useState<AudioFeatures | null>(null)
  const [status, setStatus] = useState<TrackStatus>({ phase: song.track ? 'restoring' : 'none' })
  const job = useRef(0)
  const hasTrack = song.track !== null

  // Reopen the saved audio when switching songs or reloading the page.
  useEffect(() => {
    const id = ++job.current
    setBuffer(null)
    setFeatures(null)
    if (!hasTrack) {
      setStatus({ phase: 'none' })
      return
    }
    setStatus({ phase: 'restoring' })
    loadTrack(song.id)
      .then(async (stored) => {
        if (id !== job.current) return
        if (!stored) {
          setStatus({ phase: 'missing', message: 'The audio for this track isn’t saved in this browser. Import it again to play along.' })
          return
        }
        const decoded = await decodeAudio(stored.blob)
        if (id !== job.current) return
        setBuffer(decoded)
        setFeatures(stored.features)
        setStatus({ phase: 'ready' })
      })
      .catch(() => {
        if (id === job.current) setStatus({ phase: 'error', message: 'The saved audio couldn’t be reopened. Import the file again.' })
      })
    // Only on song switch: imports set the buffer themselves.
  }, [song.id])

  const importFile = useCallback(
    async (file: File) => {
      const id = ++job.current
      const songId = song.id
      setStatus({ phase: 'decoding' })
      let decoded: AudioBuffer
      try {
        decoded = await decodeAudio(file)
      } catch {
        if (id === job.current) {
          setStatus({ phase: 'error', message: `“${file.name}” couldn’t be decoded. Try an MP3, WAV, M4A or OGG file.` })
        }
        return
      }
      if (id !== job.current) return
      setBuffer(decoded)
      setStatus({ phase: 'analyzing', progress: 0 })
      try {
        const signal = await toAnalysisSignal(decoded, ANALYSIS_SAMPLE_RATE)
        const result = await analyzeInBackground(signal, ANALYSIS_SAMPLE_RATE, (progress) => {
          if (id === job.current) setStatus({ phase: 'analyzing', progress })
        })
        if (id !== job.current) return
        setFeatures(result.features)
        const info = infoFrom(file.name, result.analysis)
        updateSong(songId, (s) => ({ ...s, track: info, bpm: info.detectedBpm, startBar: 1 }))
        setStatus({ phase: 'ready' })
        const saved = await saveTrack(songId, { blob: file, features: result.features })
        if (!saved && id === job.current) {
          setStatus({ phase: 'ready', message: 'Analyzed. This browser won’t store the audio, so import it again after reloading.' })
        }
      } catch {
        if (id === job.current) setStatus({ phase: 'error', message: 'Analysis failed on this file. Try another export of the track.' })
      }
    },
    [song.id, updateSong],
  )

  const removeTrack = useCallback(() => {
    job.current++
    setBuffer(null)
    setFeatures(null)
    setStatus({ phase: 'none' })
    void deleteTrack(song.id)
    updateSong(song.id, (s) => ({ ...s, track: null, startBar: 1 }))
  }, [song.id, updateSong])

  /** Re-grids the track at a new tempo (from ×2, ÷2, a candidate, or typing). */
  const setTempo = useCallback(
    (bpm: number, refine = false) => {
      if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) return
      updateSong(song.id, (s) => {
        if (!s.track || !features) return { ...s, bpm: round(bpm) }
        const grid = estimateGrid(features, bpm, { refine })
        const patterns = extractPatterns(features, { bpm: grid.bpm, firstDownbeat: grid.firstDownbeat })
        return {
          ...s,
          bpm: round(grid.bpm),
          track: { ...s.track, firstDownbeat: grid.firstDownbeat, confidence: grid.confidence, patterns },
        }
      })
    },
    [song.id, updateSong, features],
  )

  /** Moves beat 1 earlier or later by whole beats when the detected downbeat is off. */
  const shiftDownbeat = useCallback(
    (beats: number) => {
      updateSong(song.id, (s) => {
        if (!s.track) return s
        const beat = 60 / s.bpm
        const bar = beat * 4
        const firstDownbeat = (((s.track.firstDownbeat + beats * beat) % bar) + bar) % bar
        const patterns = features ? extractPatterns(features, { bpm: s.bpm, firstDownbeat }) : s.track.patterns
        return { ...s, track: { ...s.track, firstDownbeat, patterns } }
      })
    },
    [song.id, updateSong, features],
  )

  return { buffer, features, status, importFile, removeTrack, setTempo, shiftDownbeat }
}
