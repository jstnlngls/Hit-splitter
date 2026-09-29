/**
 * Keeps things anchored to the lyrics (highlights, per-line settings) in
 * place while the text changes. Textarea edits are one contiguous change,
 * so the common prefix and suffix of the old and new text pin it down.
 */

export interface TextEdit {
  /** Start of the changed region (same in old and new text). */
  from: number
  /** End of the changed region in the old text. */
  oldTo: number
  /** End of the changed region in the new text. */
  newTo: number
}

export function diffText(before: string, after: string): TextEdit | null {
  if (before === after) return null
  const max = Math.min(before.length, after.length)
  let from = 0
  while (from < max && before.charCodeAt(from) === after.charCodeAt(from)) from++
  let tail = 0
  while (
    tail < max - from &&
    before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)
  ) {
    tail++
  }
  return { from, oldTo: before.length - tail, newTo: after.length - tail }
}

export interface Range {
  start: number
  end: number
}

/**
 * Moves a range through an edit. Text typed right at either edge stays
 * outside the range; text replaced inside it stays inside.
 */
export function mapRange<T extends Range>(range: T, edit: TextEdit): T | null {
  const delta = edit.newTo - edit.oldTo
  const start = range.start < edit.from ? range.start : range.start >= edit.oldTo ? range.start + delta : edit.from
  const end = range.end <= edit.from ? range.end : range.end >= edit.oldTo ? range.end + delta : edit.newTo
  return end > start ? { ...range, start, end } : null
}

/**
 * Maps line numbers of the old text to the new text: lines before and
 * after the edit keep their identity, and a line edited in place keeps its
 * number. Returns null for lines that were deleted.
 */
export function mapLines(before: string, after: string): (line: number) => number | null {
  const a = before.split('\n')
  const b = after.split('\n')
  const max = Math.min(a.length, b.length)
  let head = 0
  while (head < max && a[head] === b[head]) head++
  let tail = 0
  while (tail < max - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const oldEnd = a.length - tail
  const newEnd = b.length - tail
  return (line) => {
    if (line < head) return line
    if (line >= oldEnd) return line + (b.length - a.length)
    const offset = line - head
    return head + offset < newEnd ? head + offset : null
  }
}

/** Re-keys a record indexed by line number after an edit. */
export function remapLineRecord<T>(record: Record<number, T>, before: string, after: string): Record<number, T> {
  const map = mapLines(before, after)
  const out: Record<number, T> = {}
  for (const [key, value] of Object.entries(record)) {
    const next = map(Number(key))
    if (next !== null) out[next] = value
  }
  return out
}
