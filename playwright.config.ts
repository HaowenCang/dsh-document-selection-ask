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
  /**
   * One budget for every case, and it is a budget rather than a race.
   *
   * The default 30 seconds is the framework's default, not a measurement: a case
   * opens a real browser context, boots a session against a live DSH instance,
   * decodes a document in a worker and then asserts. Measured across four full
   * runs on the release-verification instance, the slowest ordinary case takes
   * about 20 seconds and `ui-release`'s locale-switching case takes 25 to 30, so a
   * 30-second limit failed that case on timing rather than on behaviour — twice,
   * on runs where every other case passed. The limit below is three times the
   * slowest observed case; it relaxes no assertion, retries nothing, and a case
   * with a real defect still fails.
   */
  timeout: 90_000,
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
