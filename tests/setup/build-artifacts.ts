/**
 * Deterministic pre-test build for artifact assertions.
 *
 * Three specs read built output rather than the sources — the client bundle must
 * be a classic script that registers through `window.__ModuleLoader__`, the host
 * bundle must export a loadable plugin, and the test-only smoke driver's two
 * declared entry points must exist on disk. Every one of those properties exists
 * only after bundling, so on a fresh clone (`pnpm install && pnpm test`) those
 * specs would otherwise fail for the wrong reason: no artifact at all, rather than
 * a broken one.
 *
 * Both builds run here, and the driver's is the second because the first does not
 * produce it: `pnpm build` bundles `src/` for the shipping package, while
 * `pnpm smoke:driver` bundles `tests/browser/smoke-driver/` separately (it is a
 * private, test-only package with its own loader envelope). Leaving the driver out
 * made `pnpm test` order-dependent in exactly the way the shipping build was fixed
 * for: the smoke-profile spec asserted the driver's declared entry points exist,
 * and on a fresh checkout they did not.
 *
 * Building here makes `pnpm test` self-contained instead of order-dependent.
 * Failing either build fails the run, so an artifact that cannot be produced is
 * still reported rather than skipped.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))

/**
 * Run one pnpm script synchronously, streaming nothing and reporting failures.
 * @param script - the `package.json` script name.
 * @returns nothing; throws when the script exits non-zero.
 */
function runScript(script: string): void {
  const result = spawnSync('pnpm', [script], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    throw new Error(`vitest global setup: \`pnpm ${script}\` failed with exit code ${result.status}`)
  }
}

/**
 * Build the shipping artifacts and the test-only smoke driver.
 * @returns nothing; throws when either build fails.
 */
export default function setup(): void {
  runScript('build')
  runScript('smoke:driver')
}

