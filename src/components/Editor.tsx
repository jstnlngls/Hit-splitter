import { memo, useImperativeHandle, useMemo, useRef, type KeyboardEvent, type Ref } from 'react'
import type { Analysis, BarView } from '../app/useAnalysis'
import type { Sound } from '../lib/phonetics/arpabet'
import { HIGHLIGHT_KINDS, lineRange, paintHighlight, trimRange } from '../lib/store/highlights'
import type { Highlight, HighlightKind } from '../lib/store/songs'

export interface EditorHandle {
  /** Focuses the editor and selects a range of the lyrics. */
  select(start: number, end: number): void
  /** Applies a highlighter to the selection, or the caret's line when nothing is selected. */
  highlight(kind: HighlightKind | null): void
}

interface EditorProps {
  ref?: Ref<EditorHandle>
  text: string
  onText(text: string): void
  highlights: Highlight[]
  onHighlights(list: Highlight[]): void
  analysis: Analysis
  barViews: BarView[]
  activeLine: number
  onCaretLine(line: number): void
  showRhymes: boolean
}

interface Segment {
  text: string
  sound: Sound | null
  weak: boolean
  mark: HighlightKind | null
}

interface RhymeRange {
  start: number
  end: number
  sound: Sound
}

interface MarkRange {
  start: number
  end: number
  kind: HighlightKind
}

// Lines travel to the memoized backdrop rows as compact strings, so a row
// only re-renders when its own text, rhymes or highlights change.
const encodeRhymes = (ranges: RhymeRange[]) => ranges.map((r) => `${r.start}-${r.end}-${r.sound}`).join('|')
const decodeRhymes = (code: string): RhymeRange[] =>
  code
    ? code.split('|').map((part) => {
        const [start, end, sound] = part.split('-')
        return { start: Number(start), end: Number(end), sound: sound as Sound }
      })
    : []
const encodeMarks = (ranges: MarkRange[]) => ranges.map((r) => `${r.start}-${r.end}-${r.kind}`).join('|')
const decodeMarks = (code: string): MarkRange[] =>
  code
    ? code.split('|').map((part) => {
        const [start, end, kind] = part.split('-')
        return { start: Number(start), end: Number(end), kind: kind as HighlightKind }
      })
    : []

/** Splits a line into runs that share the same rhyme color and highlighter. */
function segmentLine(line: string, rhymes: RhymeRange[], marks: MarkRange[]): Segment[] {
  const cuts = new Set([0, line.length])
  for (const r of [...rhymes, ...marks]) {
    cuts.add(Math.max(0, Math.min(line.length, r.start)))
    cuts.add(Math.max(0, Math.min(line.length, r.end)))
  }
  const points = [...cuts].sort((a, b) => a - b)
  const segments: Segment[] = []
  for (let k = 0; k < points.length - 1; k++) {
    const [a, b] = [points[k], points[k + 1]]
    if (a === b) continue
    const rhyme = rhymes.find((r) => r.start <= a && r.end >= b)
    const mark = marks.findLast((m) => m.start <= a && m.end >= b)
    segments.push({ text: line.slice(a, b), sound: rhyme?.sound ?? null, weak: rhyme?.sound === 'SCHWA', mark: mark?.kind ?? null })
  }
  return segments
}

interface BackdropLineProps {
  index: number
  text: string
  active: boolean
  bar: number | null
  count: string | null
  countClass: string
  countTitle: string
  rhymes: string
  marks: string
}

const BackdropLine = memo(function BackdropLine({ index, text, active, bar, count, countClass, countTitle, rhymes, marks }: BackdropLineProps) {
  const segments = segmentLine(text, decodeRhymes(rhymes), decodeMarks(marks))
  return (
    <div className={active ? 'bl is-active' : 'bl'} data-line={index}>
      <span className="gutter">
        {bar !== null && <span>{bar}</span>}
        {count !== null && (
          <span className={`count ${countClass}`} title={countTitle}>
            {count}
          </span>
        )}
      </span>
      {segments.map((seg, k) => (
        <span
          key={k}
          className={[seg.mark && `mark mark-${seg.mark}`, seg.sound && 'rh', seg.weak && 'is-weak'].filter(Boolean).join(' ') || undefined}
          data-snd={seg.sound ?? undefined}
        >
          {seg.text}
        </span>
      ))}
      {text.length === 0 && '\u200b'}
    </div>
  )
})

function fitClass(view: BarView | undefined): string {
  if (!view) return ''
  const { placement } = view
  if (placement.over > 0 || placement.spill > 0) return 'is-over'
  if (placement.template && placement.room === 0) return 'is-fit'
  if (placement.room <= 1) return 'is-full'
  return ''
}

export const Editor = memo(function Editor({
  ref,
  text,
  onText,
  highlights,
  onHighlights,
  analysis,
  barViews,
  activeLine,
  onCaretLine,
  showRhymes,
}: EditorProps) {
  const area = useRef<HTMLTextAreaElement>(null)

  const applyHighlight = (kind: HighlightKind | null) => {
    const el = area.current
    if (!el) return
    const { selectionStart, selectionEnd } = el
    const range = selectionEnd > selectionStart ? trimRange(text, selectionStart, selectionEnd) : lineRange(text, selectionStart)
    if (range.end <= range.start) return
    onHighlights(paintHighlight(highlights, range.start, range.end, kind))
  }

  useImperativeHandle(ref, () => ({
    select(start, end) {
      const el = area.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.setSelectionRange(start, end)
      const line = text.slice(0, start).split('\n').length - 1
      onCaretLine(line)
      el.closest('.pane-scroll, .editor-wrap')
        ?.querySelector(`[data-line="${line}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    highlight: applyHighlight,
  }))

  const lines = useMemo(() => text.split('\n'), [text])

  // Rhyme underlines come from the (possibly one frame older) analysis; only
  // use them on lines whose text is unchanged so they always line up.
  const rhymeCodes = useMemo(() => {
    const out = new Map<number, string>()
    if (!showRhymes) return out
    const { lyrics, rhymes } = analysis
    const current = new Map<string, number[]>()
    lines.forEach((l, i) => current.set(l, [...(current.get(l) ?? []), i]))
    const byLine = new Map<number, RhymeRange[]>()
    for (const s of lyrics.syllables) {
      const sound = rhymes.sound[s.id]
      if (!sound) continue
      const line = lyrics.lines[s.line]
      byLine.set(s.line, [...(byLine.get(s.line) ?? []), { start: s.start - line.start, end: s.end - line.start, sound }])
    }
    for (const [lineIndex, ranges] of byLine) {
      const line = lyrics.lines[lineIndex]
      const targets = current.get(line.text)
      if (!targets) continue
      out.set(targets.includes(lineIndex) ? lineIndex : targets[0], encodeRhymes(ranges))
    }
    return out
  }, [analysis, lines, showRhymes])

  const barByLine = useMemo(() => new Map(barViews.map((view) => [view.bar.line, view])), [barViews])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return
    const code = event.code.replace('Digit', '')
    const match = HIGHLIGHT_KINDS.find((k) => k.key === code)
    if (match || code === '0') {
      event.preventDefault()
      applyHighlight(match ? match.kind : null)
    }
  }

  const syncCaret = () => {
    const el = area.current
    if (!el) return
    const line = el.value.slice(0, el.selectionStart).split('\n').length - 1
    if (line !== activeLine) onCaretLine(line)
  }

  const lyricLines = analysis.lyrics.lines
  // Where each line starts in the text, and the running bar number of lyric lines.
  const layout = useMemo(() => {
    const out: { start: number; isLyric: boolean; barNumber: number }[] = []
    for (let i = 0, offset = 0, bars = 0; i < lines.length; offset += lines[i].length + 1, i++) {
      const known = lyricLines[i]
      const isLyric = lines[i].trim() !== '' && !(known && known.text === lines[i] && known.kind === 'header')
      if (isLyric) bars++
      out.push({ start: offset, isLyric, barNumber: bars })
    }
    return out
  }, [lines, lyricLines])

  return (
    <div className="editor">
      <div className="backdrop" aria-hidden="true">
        {lines.map((line, i) => {
          const { start, isLyric, barNumber } = layout[i]
          // Bar numbers and counts come from the analysis when it has caught up with this line.
          const view = isLyric && lyricLines[i]?.text === line ? barByLine.get(i) : undefined
          const marks = highlights
            .filter((h) => h.end > start && h.start < start + line.length)
            .map((h) => ({ start: h.start - start, end: h.end - start, kind: h.kind }))
          const template = view?.placement.template
          return (
            <BackdropLine
              key={i}
              index={i}
              text={line}
              active={i === activeLine}
              bar={isLyric ? (view ? view.bar.index + 1 : barNumber) : null}
              count={view ? (template ? `${view.cues.length}/${view.placement.capacity}` : String(view.cues.length)) : null}
              countClass={fitClass(view)}
              countTitle={view ? (template ? `${view.cues.length} of ${view.placement.capacity} flow slots` : `${view.cues.length} syllables`) : ''}
              rhymes={rhymeCodes.get(i) ?? ''}
              marks={encodeMarks(marks)}
            />
          )
        })}
      </div>
      <textarea
        ref={area}
        id="lyrics"
        className="editor-text"
        value={text}
        spellCheck={false}
        autoCapitalize="sentences"
        aria-label="Lyrics"
        placeholder={'[Verse 1]\nWrite one bar per line…'}
        onChange={(e) => onText(e.target.value)}
        onSelect={syncCaret}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onKeyDown={onKeyDown}
      />
    </div>
  )
})
