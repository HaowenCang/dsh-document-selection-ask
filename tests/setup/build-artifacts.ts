/**
 * Deterministic pre-test build for artifact assertions.
 *
 * Two specs read the built output rather than the sources — the client bundle
 * must be a classic script that registers through `window.__ModuleLoader__`, and
 * the host bundle must export a loadable plugin. Both properties exist only
 * after bundling, so on a fresh clone (`pnpm install && pnpm test`) those specs
 * would otherwise fail for the wrong reason: no artifact at all, rather than a
 * broken one.
 *
 * Building here makes `pnpm test` self-contained instead of order-dependent.
 * Failing the build fails the run, so an artifact that cannot be produced is
 * still reported rather than skipped.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))

/**
 * Run `pnpm build` synchronously, streaming nothing and reporting failures.
 * @returns nothing; throws when the build exits non-zero.
 */
export default function setup(): void {
  const result = spawnSync('pnpm', ['build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    throw new Error(`vitest global setup: \`pnpm build\` failed with exit code ${result.status}`)
  }
}
