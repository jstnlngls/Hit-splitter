/** Word → ARPAbet phones lookup backed by the CMU Pronouncing Dictionary. */
export interface Lexicon {
  get(word: string): string[] | undefined
  has(word: string): boolean
  readonly size: number
}

/** Parses the compact format produced by scripts/cmudict-plugin.ts. */
export function parseCompactDictionary(data: string): Lexicon {
  const firstBreak = data.indexOf('\n')
  const secondBreak = data.indexOf('\n', firstBreak + 1)
  const symbols = data.slice(0, firstBreak).split(' ')
  const codes = data.slice(firstBreak + 1, secondBreak)
  const decode = new Map<string, string>()
  for (let i = 0; i < codes.length; i++) decode.set(codes[i], symbols[i])

  const entries = new Map<string, string>()
  let pos = secondBreak + 1
  while (pos < data.length) {
    let end = data.indexOf('\n', pos)
    if (end < 0) end = data.length
    const space = data.indexOf(' ', pos)
    entries.set(data.slice(pos, space), data.slice(space + 1, end))
    pos = end + 1
  }

  return {
    get(word) {
      const encoded = entries.get(word)
      return encoded === undefined ? undefined : Array.from(encoded, (c) => decode.get(c) as string)
    },
    has: (word) => entries.has(word),
    size: entries.size,
  }
}

let loaded: Lexicon | null = null
let loading: Promise<Lexicon> | null = null

/** The dictionary if it has finished loading, otherwise null. */
export const getLexicon = () => loaded

/** Loads the dictionary chunk once; later calls share the same promise. */
export function loadLexicon(): Promise<Lexicon> {
  loading ??= import('virtual:cmudict').then(({ default: data }) => {
    loaded = parseCompactDictionary(data)
    return loaded
  })
  return loading
}
