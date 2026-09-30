/// <reference types="vite/client" />

declare module 'virtual:cmudict' {
  /** Compact CMU Pronouncing Dictionary; see scripts/cmudict-plugin.ts for the format. */
  const data: string
  export default data
}

interface ImportMetaEnv {
  /** "desktop" for the Mac app, "artifact" for the build published as a claude.ai preview. */
  readonly VITE_TARGET?: string
}
