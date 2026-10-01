import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests for the main process and shared code. They never start Electron
// or the claude CLI: anything that would is replaced with a fake.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
