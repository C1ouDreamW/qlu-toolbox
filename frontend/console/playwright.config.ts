import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4177' },
  webServer: {
    command: 'vite preview --host 127.0.0.1 --port 4177 --strictPort',
    url: 'http://127.0.0.1:4177',
  },
})
