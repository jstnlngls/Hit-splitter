import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { cmudict } from './scripts/cmudict-plugin.ts'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs so the build runs from any folder or static host.
  base: './',
  plugins: [react(), cmudict()],
  worker: { format: 'es' },
  // The pronunciation dictionary is one ~2 MB chunk, loaded after first paint.
  build: { chunkSizeWarningLimit: 2200 },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
