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

/** Splits a line into runs that share the same rhyme color and highlighter. */
function segmentLine(
  line: string,
  lineStart: number,
  syllables: { start: number; end: number; sound: Sound | null; weak: boolean }[],
  highlights: Highlight[],
): Segment[] {
  const cuts = new Set([0, line.length])
  for (const s of syllables) {
    cuts.add(s.start)
    cuts.add(s.end)
  }
  const marks = highlights
    .filter((h) => h.end > lineStart && h.start < lineStart + line.length)
    .map((h) => ({ start: Math.max(0, h.start - lineStart), end: Math.min(line.length, h.end - lineStart), kind: h.kind }))
  for (const m of marks) {
    cuts.add(m.start)
    cuts.add(m.end)
  }
  const points = [...cuts].filter((c) => c >= 0 && c <= line.length).sort((a, b) => a - b)
  const segments: Segment[] = []
  for (let k = 0; k < points.length - 1; k++) {
    const [a, b] = [points[k], points[k + 1]]
    if (a === b) continue
    const syl = syllables.find((s) => s.start <= a && s.end >= b && s.sound !== null)
    const mark = marks.findLast((m) => m.start <= a && m.end >= b)
    segments.push({ text: line.slice(a, b), sound: syl?.sound ?? null, weak: syl?.weak ?? false, mark: mark?.kind ?? null })
  }
  return segments
}

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
  const syllablesByLine = useMemo(() => {
    const out = new Map<number, { start: number; end: number; sound: Sound | null; weak: boolean }[]>()
    if (!showRhymes) return out
    const { lyrics, rhymes } = analysis
    const current = new Map<string, number[]>()
    lines.forEach((l, i) => current.set(l, [...(current.get(l) ?? []), i]))
    const byLine = new Map<number, typeof lyrics.syllables>()
    for (const s of lyrics.syllables) byLine.set(s.line, [...(byLine.get(s.line) ?? []), s])
    for (const line of lyrics.lines) {
      if (line.kind !== 'lyric') continue
      const targets = current.get(line.text)
      if (!targets) continue
      const target = targets.includes(line.index) ? line.index : targets[0]
      out.set(
        target,
        (byLine.get(line.index) ?? []).map((s) => ({
          start: s.start - line.start,
          end: s.end - line.start,
          sound: rhymes.sound[s.id],
          weak: rhymes.sound[s.id] === 'SCHWA',
        })),
      )
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

  let offset = 0
  let barCounter = 0
  const lyricLines = analysis.lyrics.lines

  return (
    <div className="editor">
      <div className="backdrop" aria-hidden="true">
        {lines.map((line, i) => {
          const start = offset
          offset += line.length + 1
          const known = lyricLines[i]
          const isLyric = line.trim() !== '' && !(known && known.text === line && known.kind === 'header')
          // Bar numbers and counts come from the analysis when it has caught up with this line.
          const view = isLyric && known?.text === line ? barByLine.get(i) : undefined
          if (isLyric) barCounter++
          const segments = segmentLine(line, start, syllablesByLine.get(i) ?? [], highlights)
          return (
            <div key={i} className={i === activeLine ? 'bl is-active' : 'bl'} data-line={i}>
              <span className="gutter">
                {isLyric && <span>{view ? view.bar.index + 1 : barCounter}</span>}
                {view && <span className={`count ${fitClass(view)}`}>{view.cues.length}</span>}
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
              {line.length === 0 && '​'}
            </div>
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
