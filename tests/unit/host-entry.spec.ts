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
 *
 * The second half of the suite is the client-only architecture gate. This plugin
 * is frozen as a browser-only plugin: the host half contributes no service, no
 * route and no filesystem access, and an earlier revision of the XLSX renderer
 * broke that by registering two asset routes here. The assertions below are what
 * makes the restored baseline checkable rather than merely intended — a
 * re-introduced `webServer` lookup, a `node:fs` import or an asset path would
 * fail this suite instead of shipping.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import * as source from '../../src/index.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const hostBundle = join(repoRoot, 'lib', 'index.mjs')
const hostSource = join(repoRoot, 'src', 'index.ts')

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
    // Kept in step with `package.json`, which this round moves to the v0.1.2
    // release candidate. A consumer reading the exported constant must see the
    // version the package actually is.
    expect(source.PLUGIN_VERSION).toBe('0.1.2')
  })

  it('ships a version that matches the package manifest', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      version?: string
    }
    expect(manifest.version, 'package.json must declare a version').toBeDefined()
    expect(source.PLUGIN_VERSION, 'the exported version must equal package.json version').toBe(
      manifest.version,
    )
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

/** A host context, as a recording double. */
type ContextSpy = {
  readonly get: ReturnType<typeof vi.fn>
  readonly inject: ReturnType<typeof vi.fn>
  readonly effect: ReturnType<typeof vi.fn>
  readonly on: ReturnType<typeof vi.fn>
  readonly provide: ReturnType<typeof vi.fn>
}

/**
 * Apply the host body with a context, from a spec.
 *
 * The body's published signature takes no argument, because v1 contributes
 * nothing to the host; passing one anyway is the probe. The cast is stated here,
 * once, rather than widening the production signature to admit a context the
 * implementation has no use for.
 *
 * @param context - the recording context.
 */
function applyWithContext(context: ContextSpy | Record<string, unknown>): void {
  ;(source.apply as unknown as (ctx: unknown) => void)(context)
}

describe('host entry is inert', () => {
  it('touches no service lookup, no injection and no effect when applied', () => {
    // A host contribution has to reach the context to exist at all: it resolves
    // a service, waits for one to appear, or registers an effect. Recording
    // every one of those calls is what turns "contributes nothing" from a
    // reading of the source into an observation about the call.
    const fakeContext: ContextSpy = {
      get: vi.fn(() => undefined),
      inject: vi.fn(),
      effect: vi.fn(),
      on: vi.fn(),
      provide: vi.fn(),
    }

    expect(applyWithContext(fakeContext)).toBeUndefined()

    expect(fakeContext.get).not.toHaveBeenCalled()
    expect(fakeContext.inject).not.toHaveBeenCalled()
    expect(fakeContext.effect).not.toHaveBeenCalled()
    expect(fakeContext.on).not.toHaveBeenCalled()
    expect(fakeContext.provide).not.toHaveBeenCalled()
  })

  it('registers no route and reaches no web server', () => {
    const register = vi.fn()
    const fakeContext = {
      get: vi.fn((name: string) => (name === 'webServer' ? { register } : undefined)),
      inject: vi.fn(),
      effect: vi.fn(),
    }

    applyWithContext(fakeContext)

    expect(register).not.toHaveBeenCalled()
    expect(fakeContext.get).not.toHaveBeenCalled()
    expect(fakeContext.effect).not.toHaveBeenCalled()
  })
})

describe('host entry carries no XLSX or filesystem dependency', () => {
  const FORBIDDEN = [
    'webServer',
    'dsa-assets',
    'readFileSync',
    'node:fs',
    'xlsx-worker',
    'duke_sheets_wasm',
  ] as const

  it('keeps the source module free of host-service and asset references', () => {
    const text = readFileSync(hostSource, 'utf8')
    for (const needle of FORBIDDEN) {
      expect(text, `src/index.ts must not mention ${needle}`).not.toContain(needle)
    }
  })

  it('keeps the compiled host bundle free of host-service and asset references', () => {
    expect(existsSync(hostBundle), `${hostBundle} is missing; run \`pnpm build\``).toBe(true)
    const text = readFileSync(hostBundle, 'utf8')
    for (const needle of FORBIDDEN) {
      expect(text, `lib/index.mjs must not mention ${needle}`).not.toContain(needle)
    }
  })

  it('keeps the host bundle free of Node built-ins beyond its own envelope', () => {
    const text = readFileSync(hostBundle, 'utf8')
    for (const needle of ['node:path', "require('fs')", 'node:http', 'express']) {
      expect(text, `lib/index.mjs must not mention ${needle}`).not.toContain(needle)
    }
  })
})
