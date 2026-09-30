const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function below100(n: number): string[] {
  if (n < 20) return [ONES[n]]
  const tens = TENS[Math.floor(n / 10)]
  return n % 10 ? [tens, ONES[n % 10]] : [tens]
}

function below1000(n: number): string[] {
  if (n < 100) return below100(n)
  const rest = n % 100
  return [ONES[Math.floor(n / 100)], 'hundred', ...(rest ? below100(rest) : [])]
}

function cardinal(n: number): string[] {
  if (n < 1000) return below1000(n)
  const words: string[] = []
  for (const [size, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']] as const) {
    if (n >= size) {
      words.push(...below1000(Math.floor(n / size)), name)
      n %= size
    }
  }
  if (n) words.push(...below1000(n))
  return words
}

const ORDINAL: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
}

function ordinal(words: string[]): string[] {
  const last = words[words.length - 1]
  const ord = ORDINAL[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`)
  return [...words.slice(0, -1), ord]
}

/**
 * Spells a numeric token the way it is usually said in a verse:
 * "1996" → nineteen ninety six, "'96" → ninety six, "3rd" → third, "007" → oh oh seven.
 */
export function numberToWords(token: string): string[] {
  const clean = token.replace(/^['’]/, '').toLowerCase()
  const ord = /^(\d+)(st|nd|rd|th)$/.exec(clean)
  if (ord) return ordinal(numberToWords(ord[1]))
  if (!/^\d+$/.test(clean)) return []
  if (clean.length > 1 && clean.startsWith('0')) {
    return Array.from(clean, (d) => (d === '0' ? 'oh' : ONES[Number(d)]))
  }
  if (clean.length > 10) return Array.from(clean, (d) => ONES[Number(d)])
  const n = Number(clean)
  if (clean.length === 4 && n >= 1100 && n < 2100 && n % 1000 !== 0) {
    if (n >= 2000 && n < 2010) return cardinal(n)
    const high = Math.floor(n / 100)
    const low = n % 100
    if (low === 0) return [...below100(high), 'hundred']
    return [...below100(high), ...(low < 10 ? ['oh', ONES[low]] : below100(low))]
  }
  return cardinal(n)
}
