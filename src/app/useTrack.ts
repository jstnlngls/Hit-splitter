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
interface TrackState {
  songId: string
  buffer: AudioBuffer | null
  features: AudioFeatures | null
  status: TrackStatus
}

const emptyState = (song: Song): TrackState => ({
  songId: song.id,
  buffer: null,
  features: null,
  status: { phase: song.track ? 'restoring' : 'none' },
})

export function useTrack(song: Song, updateSong: (id: string, update: (s: Song) => Song) => void) {
  const [state, setState] = useState<TrackState>(() => emptyState(song))
  const job = useRef(0)
  const hasTrack = useRef(song.track !== null)
  // State left over from another song reads as "not loaded yet" for this one.
  const current = state.songId === song.id ? state : emptyState(song)

  /** Updates the track state for one song, dropping whatever belonged to another. */
  const patch = useCallback((songId: string, change: Partial<Omit<TrackState, 'songId'>>) => {
    setState((prev) => ({
      ...(prev.songId === songId ? prev : { buffer: null, features: null, status: { phase: 'none' as const } }),
      ...change,
      songId,
    }))
  }, [])

  useEffect(() => {
    hasTrack.current = song.track !== null
  })

  // Reopen the saved audio when switching songs or reloading the page.
  // Imports set their own state, so this runs on song switches only.
  useEffect(() => {
    const id = ++job.current
    const songId = song.id
    if (!hasTrack.current) return
    loadTrack(songId)
      .then(async (stored) => {
        if (id !== job.current) return
        if (!stored) {
          patch(songId, { status: { phase: 'missing', message: 'The audio for this track isn\u2019t saved in this browser. Import it again to play along.' } })
          return
        }
        const decoded = await decodeAudio(stored.blob)
        if (id !== job.current) return
        patch(songId, { buffer: decoded, features: stored.features, status: { phase: 'ready' } })
      })
      .catch(() => {
        if (id === job.current) patch(songId, { status: { phase: 'error', message: 'The saved audio couldn\u2019t be reopened. Import the file again.' } })
      })
  }, [song.id, patch])

  const importFile = useCallback(
    async (file: File) => {
      const id = ++job.current
      const songId = song.id
      patch(songId, { buffer: null, features: null, status: { phase: 'decoding' } })
      let decoded: AudioBuffer
      try {
        decoded = await decodeAudio(file)
      } catch {
        if (id === job.current) {
          patch(songId, { status: { phase: 'error', message: `\u201c${file.name}\u201d couldn\u2019t be decoded. Try an MP3, WAV, M4A or OGG file.` } })
        }
        return
      }
      if (id !== job.current) return
      patch(songId, { buffer: decoded, status: { phase: 'analyzing', progress: 0 } })
      try {
        const signal = await toAnalysisSignal(decoded, ANALYSIS_SAMPLE_RATE)
        const result = await analyzeInBackground(signal, ANALYSIS_SAMPLE_RATE, (progress) => {
          if (id === job.current) patch(songId, { status: { phase: 'analyzing', progress } })
        })
        if (id !== job.current) return
        const info = infoFrom(file.name, result.analysis)
        updateSong(songId, (s) => ({ ...s, track: info, bpm: info.detectedBpm, startBar: 1 }))
        patch(songId, { features: result.features, status: { phase: 'ready' } })
        const saved = await saveTrack(songId, { blob: file, features: result.features })
        if (!saved && id === job.current) {
          patch(songId, { status: { phase: 'ready', message: 'Analyzed. This browser won\u2019t store the audio, so import it again after reloading.' } })
        }
      } catch {
        if (id === job.current) patch(songId, { status: { phase: 'error', message: 'Analysis failed on this file. Try another export of the track.' } })
      }
    },
    [song.id, updateSong, patch],
  )

  const removeTrack = useCallback(() => {
    job.current++
    patch(song.id, { buffer: null, features: null, status: { phase: 'none' } })
    void deleteTrack(song.id)
    updateSong(song.id, (s) => ({ ...s, track: null, startBar: 1 }))
  }, [song.id, updateSong, patch])

  const { buffer, features, status } = current

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
