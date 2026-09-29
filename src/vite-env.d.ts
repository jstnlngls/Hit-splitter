/// <reference types="vite/client" />

declare module 'virtual:cmudict' {
  /** Compact CMU Pronouncing Dictionary; see scripts/cmudict-plugin.ts for the format. */
  const data: string
  export default data
}
