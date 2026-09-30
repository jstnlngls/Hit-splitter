import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { cmudict } from './scripts/cmudict-plugin.ts'

/** The desktop app bundles its fonts (src/fonts-local.css), so it skips Google Fonts. */
const offlineFonts = (): Plugin => ({
  name: 'hit-splitter:offline-fonts',
  transformIndexHtml(html) {
    if (process.env.VITE_TARGET !== 'desktop') return html
    return html.replace(/\s*<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g, '')
  },
})

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs so the build runs from any folder or static host.
  base: './',
  plugins: [react(), cmudict(), offlineFonts()],
  worker: { format: 'es' },
  // The pronunciation dictionary is one ~2 MB chunk, loaded after first paint.
  build: { chunkSizeWarningLimit: 2200 },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
