import { newId, type Highlight, type HighlightKind } from './songs'

export const HIGHLIGHT_KINDS: { kind: HighlightKind; label: string; key: string }[] = [
  { kind: 'favorite', label: 'Favorite', key: '1' },
  { kind: 'punchline', label: 'Punchline', key: '2' },
  { kind: 'rework', label: 'Needs work', key: '3' },
]

/** Shrinks a selection to the text inside it, dropping spaces at either end. */
export function trimRange(text: string, start: number, end: number): { start: number; end: number } {
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  return { start, end }
}

/** The line around a caret, without surrounding spaces. */
export function lineRange(text: string, caret: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', caret - 1) + 1
  const next = text.indexOf('\n', caret)
  return trimRange(text, start, next < 0 ? text.length : next)
}

/**
 * Paints a range like a highlighter: existing marks under it are replaced
 * (or cut back to what's outside it); a null kind erases.
 */
export function paintHighlight(list: Highlight[], start: number, end: number, kind: HighlightKind | null): Highlight[] {
  const out: Highlight[] = []
  for (const h of list) {
    if (h.end <= start || h.start >= end) {
      out.push(h)
      continue
    }
    if (h.start < start) out.push({ ...h, end: start })
    if (h.end > end) out.push({ ...h, id: h.start < start ? newId() : h.id, start: end })
  }
  if (kind && end > start) out.push({ id: newId(), start, end, kind, createdAt: Date.now() })
  return out.sort((a, b) => a.start - b.start)
}
