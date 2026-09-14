import { defineConfig } from '@playwright/test'

/**
 * Browser tests exist so that selection geometry and renderer layout are
 * asserted against a real engine instead of a jsdom approximation. Task 1 has
 * no browser spec yet; the harness is fixed here so later tasks only add specs.
 */
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
})
