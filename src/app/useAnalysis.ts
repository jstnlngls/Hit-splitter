import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { cueKey, cuesForBar } from '../lib/flow/cues'
import { GRIDS, type Grid } from '../lib/flow/grid'
import { placeBar, type BarPlacement, type SyllableCue } from '../lib/flow/place'
import { slotsForGrid, type FlowTemplate } from '../lib/flow/templates'
import { analyzeLyrics, type Bar, type LyricsAnalysis } from '../lib/phonetics/analyze'
import { getLexicon, loadLexicon, type Lexicon } from '../lib/phonetics/lexicon'
import { analyzeRhymes, type RhymeAnalysis } from '../lib/rhyme/rhyme'
import type { Song } from '../lib/store/songs'

export function useLexicon() {
  const [lexicon, setLexicon] = useState<Lexicon | null>(getLexicon)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (lexicon) return
    let live = true
    loadLexicon().then(
      (lex) => live && setLexicon(lex),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [lexicon])
  return { lexicon, failed }
}

export interface Analysis {
  /** The text the analysis was computed from (may trail the editor by a frame while typing). */
  text: string
  lyrics: LyricsAnalysis
  rhymes: RhymeAnalysis
}

export function useLyricsAnalysis(text: string, lexicon: Lexicon | null, reach: number): Analysis {
  const deferred = useDeferredValue(text)
  const lyrics = useMemo(() => analyzeLyrics(deferred, lexicon), [deferred, lexicon])
  const rhymes = useMemo(() => analyzeRhymes(lyrics, { reach }), [lyrics, reach])
  return { text: deferred, lyrics, rhymes }
}

export interface BarView {
  bar: Bar
  grid: Grid
  cues: SyllableCue[]
  placement: BarPlacement
  /** The flow template this bar uses, if any. */
  flow: FlowTemplate | null
  /** Whether the bar overrides the song's default flow. */
  customFlow: boolean
  shift: number
}

const placements = new Map<string, BarPlacement>()

function place(cues: SyllableCue[], grid: Grid, template: number[] | null, shift: number): BarPlacement {
  const key = `${grid.kind}|${template?.join('.') ?? '-'}|${shift}|${cueKey(cues)}`
  let placed = placements.get(key)
  if (!placed) {
    if (placements.size > 4000) placements.clear()
    placed = placeBar(cues, grid, { template, shift })
    placements.set(key, placed)
  }
  return placed
}

export function useBarViews(analysis: Analysis, song: Song, flows: FlowTemplate[]): BarView[] {
  const { lyrics, rhymes } = analysis
  const { grid: gridKind, flow: songFlow, lineSettings } = song
  return useMemo(() => {
    const byId = new Map(flows.map((f) => [f.id, f]))
    return lyrics.bars.map((bar) => {
      const setting = lineSettings[bar.line]
      const customFlow = setting?.flow !== undefined
      const flowId = customFlow ? (setting?.flow ?? null) : songFlow
      const flow = (flowId && byId.get(flowId)) || null
      const grid = flow ? GRIDS[flow.grid] : GRIDS[gridKind]
      const template = flow ? slotsForGrid(flow, grid) : null
      const cues = cuesForBar(lyrics, rhymes, bar.index)
      const shift = setting?.shift ?? 0
      return { bar, grid, cues, placement: place(cues, grid, template, shift), flow, customFlow, shift }
    })
  }, [lyrics, rhymes, gridKind, songFlow, lineSettings, flows])
}
