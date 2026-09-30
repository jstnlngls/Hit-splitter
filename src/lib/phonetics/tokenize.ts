export type LineKind = 'lyric' | 'blank' | 'header'

export interface WordToken {
  text: string
  start: number
  end: number
  /** Inside parentheses: an ad-lib or background vocal. */
  adlib: boolean
  /** Followed by punctuation or the end of the line: a natural place to breathe. */
  pauseAfter: boolean
  /** Spelled out letter by letter (MC, DJ, LA). */
  acronym: boolean
}

export interface LineToken {
  index: number
  start: number
  end: number
  text: string
  kind: LineKind
  words: WordToken[]
  /** Section the line belongs to; sections are split by blank lines and headers. */
  section: number
}

export interface SectionToken {
  index: number
  label: string | null
  lines: number[]
}

const BRACKET_HEADER = /^\s*\[[^\]]*\]\s*$/
const WORD_HEADER =
  /^\s*(intro|outro|verse|hook|chorus|pre-?chorus|post-?chorus|bridge|refrain|interlude|break|breakdown|skit)(\s+(\d+|[ivx]+|x\d+))?\s*:?\s*$/i
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*['’]?|['’]\p{L}+(?:['’]\p{L}+)*['’]?|&/gu
// Numbers glued to letters ("2pac", "9mm") are said as separate words; ordinals stay whole.
const PART = /\d+(?:st|nd|rd|th)?(?![a-z])|\d+|[^\d]+/giu
const PAUSE = /[,.;:!?…—–]/

export function tokenizeLyrics(text: string): { lines: LineToken[]; sections: SectionToken[] } {
  const lines: LineToken[] = []
  const sections: SectionToken[] = []
  let section: SectionToken | null = null
  let offset = 0

  for (const [index, lineText] of text.split('\n').entries()) {
    const start = offset
    offset += lineText.length + 1
    const trimmed = lineText.trim()
    let kind: LineKind = 'lyric'
    if (!trimmed) kind = 'blank'
    else if (BRACKET_HEADER.test(lineText) || WORD_HEADER.test(lineText)) kind = 'header'

    if (kind === 'blank') {
      section = null
    } else if (kind === 'header') {
      section = { index: sections.length, label: trimmed.replace(/^\[|\]$/g, '').replace(/:$/, '').trim(), lines: [] }
      sections.push(section)
    } else if (!section) {
      section = { index: sections.length, label: null, lines: [] }
      sections.push(section)
    }

    const words = kind === 'lyric' ? tokenizeLine(lineText, start) : []
    if (kind === 'lyric') section?.lines.push(index)
    lines.push({ index, start, end: start + lineText.length, text: lineText, kind, words, section: section?.index ?? -1 })
  }
  return { lines, sections }
}

function tokenizeLine(line: string, lineStart: number): WordToken[] {
  const shouting = !/\p{Ll}/u.test(line)
  const words: WordToken[] = []
  const depthAt: number[] = []
  let depth = 0
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '(') depth++
    depthAt.push(depth)
    if (line[i] === ')') depth = Math.max(0, depth - 1)
  }

  for (const match of line.matchAll(WORD)) {
    const token = match[0]
    const base = match.index
    for (const part of token.matchAll(PART)) {
      const text = part[0].replace(/^['’]+(?=\d)/, '')
      if (!/[\p{L}\p{N}&]/u.test(text)) continue
      const start = base + part.index + (part[0].length - text.length)
      words.push({
        text,
        start: lineStart + start,
        end: lineStart + start + text.length,
        adlib: depthAt[start] > 0,
        pauseAfter: false,
        acronym: !shouting && /^[A-Z]{2,3}$/.test(text),
      })
    }
  }

  for (let w = 0; w < words.length; w++) {
    const from = words[w].end - lineStart
    const to = w + 1 < words.length ? words[w + 1].start - lineStart : line.length
    const between = line.slice(from, to)
    words[w].pauseAfter = w === words.length - 1 || PAUSE.test(between) || (between.includes(')') !== between.includes('('))
  }
  return words
}
