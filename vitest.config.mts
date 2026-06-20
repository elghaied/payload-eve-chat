import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Note: do NOT include agent/** here — Eve discovers files under agent/ (e.g.
    // agent/connections/*) as agent components, and a *.test.ts there breaks Eve's
    // discovery. Tests for agent/ code live under src/ and import across the boundary.
    include: ['tests/int/**/*.int.spec.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
