/**
 * Host half contract.
 *
 * The DSH loader activates the package's `exports "."` module and accepts only a
 * function or an object carrying `apply`; anything else fails the loader entry
 * with `invalid plugin, expect function or object with an "apply" method`. That
 * failure is not cosmetic — it removes the entry, and with it the plugin's
 * browser half, so a host entry that only exports identity constants makes the
 * whole plugin unloadable while `pnpm build` still reports success.
 *
 * The check runs against both the source module and the built bundle, because
 * the two can diverge: bundling decides which exports survive.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as source from '../../src/index.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const hostBundle = join(repoRoot, 'lib', 'index.mjs')

/** The plugin shape the Cordis loader accepts. */
interface HostPlugin {
  readonly name?: unknown
  readonly inject?: unknown
  readonly apply?: unknown
}

/**
 * Assert one module satisfies the loader's plugin contract.
 * @param module - the namespace object exported by the host entry.
 * @param label - the module the namespace came from, for failure messages.
 */
function expectLoadablePlugin(module: HostPlugin, label: string): void {
  const candidate = (module as { default?: HostPlugin }).default ?? module
  const apply =
    typeof candidate === 'function' ? candidate : (candidate as { apply?: unknown }).apply
  expect(typeof apply, `${label}: the loader needs a function or an object with apply`).toBe(
    'function',
  )
}

describe('host entry', () => {
  it('exposes the plugin identity', () => {
    expect(source.PLUGIN_NAME).toBe('dsh-document-selection-ask')
    expect(source.PLUGIN_VERSION).toBe('0.1.0')
  })

  it('is a loadable plugin and needs no host service', () => {
    expectLoadablePlugin(source as HostPlugin, 'src/index.ts')
    expect(source.inject).toEqual([])
  })

  it('contributes nothing host-side', () => {
    // Inert is the contract: a host contribution would make disabling the
    // plugin a host operation as well as a client one.
    expect(source.apply()).toBeUndefined()
  })

  it('keeps the built bundle loadable', async () => {
    expect(existsSync(hostBundle), `${hostBundle} is missing; run \`pnpm build\``).toBe(true)
    const built = (await import(pathToFileURL(hostBundle).href)) as HostPlugin
    expectLoadablePlugin(built, 'lib/index.mjs')
  })
})
