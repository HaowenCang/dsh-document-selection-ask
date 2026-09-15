import { defineConfig } from '@playwright/test'

/**
 * Browser tests exist so that selection geometry, renderer layout and the
 * focus behaviour around the Ask button are asserted against a real engine
 * instead of a jsdom approximation.
 *
 * The suite runs serially. Its specs drive one shared external resource — a
 * running DSH web instance whose composer holds one draft and one session — so
 * two workers would type into the same composer and read each other's state. The
 * specs are also I/O-shaped rather than CPU-shaped: each one navigates a real
 * application and waits for it, and parallelism would buy nothing.
 */
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    /**
     * The primary verified runtime ships Chinese copy and this plugin's contract
     * names Chinese strings, so the browser asks for Chinese.
     *
     * This is not cosmetic. DSH resolves its own locale from the browser's
     * language list and writes the result to `<html lang>`, and this plugin reads
     * that same attribute to resolve its copy. Running with Playwright's default
     * `en-US` would put the whole application in English — a real configuration,
     * but not the one whose strings the contract specifies — and the smoke's copy
     * assertions would then be testing the English table.
     */
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
})
