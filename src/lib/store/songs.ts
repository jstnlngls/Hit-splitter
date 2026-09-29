import type { PatternAnalysis } from '../audio/analysis'
import type { GridKind } from '../flow/grid'
import { SAMPLE_LYRICS, SAMPLE_TITLE } from '../samples/sampleVerse'

export type HighlightKind = 'favorite' | 'punchline' | 'rework'

export interface Highlight {
  id: string
  start: number
  end: number
  kind: HighlightKind
  createdAt: number
}

export interface LineSetting {
  /** Flow template id for this line; null forces free placement; undefined follows the song. */
  flow?: string | null
  /** Slots to move the line later (positive) or into a pickup (negative). */
  shift?: number
}

export interface TrackInfo {
  name: string
  duration: number
  detectedBpm: number
  bpmCandidates: { bpm: number; score: number }[]
  firstDownbeat: number
  confidence: number
  peaks: number[]
  patterns: PatternAnalysis
}

export interface Song {
  id: string
  title: string
  lyrics: string
  highlights: Highlight[]
  lineSettings: Record<number, LineSetting>
  bpm: number
  grid: GridKind
  /** Default flow template id, or null to let each line find its own pocket. */
  flow: string | null
  /** Bar of the track (1-based) where the first lyric bar starts. */
  startBar: number
  track: TrackInfo | null
  createdAt: number
  updatedAt: number
}

const SONGS_KEY = 'hit-splitter.songs.v1'
const CURRENT_KEY = 'hit-splitter.current.v1'

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export function createSong(title = 'Untitled', lyrics = ''): Song {
  const now = Date.now()
  return {
    id: newId(),
    title,
    lyrics,
    highlights: [],
    lineSettings: {},
    bpm: 90,
    grid: 'sixteenths',
    flow: null,
    startBar: 1,
    track: null,
    createdAt: now,
    updatedAt: now,
  }
}

/** The example song shown on a first visit, with a couple of highlights to show the idea. */
export function createSampleSong(): Song {
  const song = createSong(SAMPLE_TITLE, SAMPLE_LYRICS)
  const mark = (phrase: string, kind: HighlightKind) => {
    const start = SAMPLE_LYRICS.indexOf(phrase)
    if (start >= 0) song.highlights.push({ id: newId(), start, end: start + phrase.length, kind, createdAt: Date.now() })
  }
  mark('Cold flow, gold throat', 'favorite')
  mark('I own the old road', 'punchline')
  return song
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function normalize(raw: Partial<Song>): Song | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.lyrics !== 'string') return null
  const base = createSong()
  return {
    ...base,
    ...raw,
    highlights: Array.isArray(raw.highlights) ? raw.highlights : [],
    lineSettings: raw.lineSettings && typeof raw.lineSettings === 'object' ? raw.lineSettings : {},
  } as Song
}

export function loadSongs(): { songs: Song[]; currentId: string } {
  let songs: Song[] = []
  try {
    const parsed = JSON.parse(read(SONGS_KEY) ?? '[]')
    if (Array.isArray(parsed)) songs = parsed.map(normalize).filter((s): s is Song => s !== null)
  } catch {
    songs = []
  }
  if (!songs.length) songs = [createSampleSong()]
  const saved = read(CURRENT_KEY)
  const currentId = songs.some((s) => s.id === saved) ? saved! : songs[0].id
  return { songs, currentId }
}

/** Saves all songs; returns false when the browser refuses (private mode, full storage). */
export function saveSongs(songs: Song[], currentId: string): boolean {
  return write(SONGS_KEY, JSON.stringify(songs)) && write(CURRENT_KEY, currentId)
}

/** A song as a portable JSON file (the audio stays on this device). */
export function exportSong(song: Song): string {
  return JSON.stringify({ app: 'hit-splitter', version: 1, song }, null, 2)
}

export function importSong(json: string): Song | null {
  try {
    const parsed = JSON.parse(json)
    const song = normalize(parsed?.song ?? parsed)
    return song ? { ...song, id: newId(), updatedAt: Date.now() } : null
  } catch {
    return null
  }
}
