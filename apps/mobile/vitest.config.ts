import { defineConfig } from 'vitest/config'

// No generated build metadata or native signing material is needed for unit tests.
export default defineConfig({ test: { include: ['apps/mobile/src/**/*.test.ts'] } })
