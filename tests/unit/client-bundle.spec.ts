/**
 * DSH client loader contract for the built bundle.
 *
 * The DSH web boot does not evaluate a client plugin as a module. It evaluates
 * the bundle as a **classic script** and expects it to call
 * `window.__ModuleLoader__.load({ id, factory })`; the factory then receives a
 * `require` that resolves the shared runtime modules and returns the plugin's
 * exports. Two properties of that arrangement are invisible in the source and
 * only exist in the emitted file:
 *
 * 1. no top-level `import` or `export` may survive, because a classic script has
 *    no module boundary and such a statement is a syntax error;
 * 2. the factory must actually run and publish `apply`/`inject`, because nothing
 *    downstream will look for them anywhere else.
 *
 * So this spec loads the artifact the way the boot does — a stub loader in a
 * context with no `require`, no module system, and a `window` — and asserts the
 * resulting exports. The bundle is produced by `pnpm build`; when it is absent,
 * the spec fails rather than passing vacuously, because a green build is exactly
 * what the missing artifact would otherwise disguise.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const bundlePath = join(repoRoot, 'lib', 'client.js')

/** The plugin id the loader registers and the DSH patch row addresses. */
const PLUGIN_ID = 'dsh-document-selection-ask'

/**
 * Resolve a shared client module the way the DSH loader's `require` does.
 *
 * The factory receives a `require` for the shared runtime modules DSH itself
 * loads — `react` and `react/jsx-runtime` for this bundle — so the spec supplies
 * the same two from this project's own installed copies.
 */
const requireShared = createRequire(import.meta.url)

/**
 * Services the built client must declare in its runtime `inject`.
 *
 * `slots` is the renderer-owned slot registry both of this plugin's slot
 * contributions go through. `documentPreviews` is the extension-renderer registry
 * the PDF renderer registers its implementation into; the service is a Cordis
 * getter that refuses to be read before its provider has loaded, so declaring it
 * is what orders the call. Declaring either is not optional: the failure appears
 * only in a real boot, because nothing in this repository constructs the DSH
 * fiber.
 */
const REQUIRED_SERVICES = ['slots', 'documentPreviews']

interface LoaderCall {
  readonly id: string
  readonly factory: (require: (specifier: string) => unknown) => unknown
}

/**
 * Evaluate the built client bundle the way the DSH web boot does.
 *
 * The context deliberately omits `require`, `module`, `exports`, and `process`:
 * a bundle that still needs any of them is not a classic script and would fail
 * in the browser for the same reason it fails here.
 * @param source - the emitted bundle text.
 * @returns the loader calls the bundle made, in order.
 */
function evaluateAsClassicScript(source: string): readonly LoaderCall[] {
  const calls: LoaderCall[] = []
  const window = {
    __ModuleLoader__: {
      load: (call: LoaderCall) => {
        calls.push(call)
      },
    },
  }
  runInNewContext(source, { window })
  return calls
}

describe('built client bundle', () => {
  it('ships the artifact the loader entry points at', () => {
    expect(existsSync(bundlePath), `${bundlePath} is missing; run \`pnpm build\``).toBe(true)
  })

  it('advertises the same file through the client export and the tarball list', () => {
    // The host resolves `./client` from `exports` and serves the physical file
    // it names; packaging inspects `files`. A plugin whose export points at
    // something `files` omits installs as a package with no client half, and the
    // failure appears only in a real DSH boot.
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, { default?: string }>
      files: string[]
      dsh: { client: { platform: string } }
    }
    const declared = manifest.exports['./client']?.default
    expect(declared).toBe('./lib/client.js')
    const relative = (declared ?? '').replace(/^\.\//, '')
    expect(existsSync(join(repoRoot, relative)), `${declared} does not exist`).toBe(true)
    expect(manifest.files).toContain('lib/client.js')
    expect(manifest.dsh.client.platform).toBe('web')
  })

  it('registers exactly one loader entry under the plugin id', () => {
    const calls = evaluateAsClassicScript(readFileSync(bundlePath, 'utf8'))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.id).toBe(PLUGIN_ID)
    expect(typeof calls[0]?.factory).toBe('function')
  })

  it('contains no surviving module syntax', () => {
    const source = readFileSync(bundlePath, 'utf8')
    // A classic script cannot parse either form; the CommonJS output is what
    // keeps the bundle loadable inside the factory.
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/^\s*export\s/m)
    expect(source).toContain('window.__ModuleLoader__.load(')
  })

  it('publishes apply and inject when the factory runs', () => {
    const calls = evaluateAsClassicScript(readFileSync(bundlePath, 'utf8'))
    const factory = calls[0]?.factory
    expect(factory).toBeDefined()
    const exports = factory?.(requireShared) as { apply?: unknown; inject?: unknown }
    expect(typeof exports.apply).toBe('function')
    expect(Array.isArray(exports.inject)).toBe(true)
  })

  it('declares every runtime service the plugin injects through', () => {
    const calls = evaluateAsClassicScript(readFileSync(bundlePath, 'utf8'))
    const exports = calls[0]?.factory?.(requireShared) as { inject?: unknown }

    // A service reached through `ctx` without being declared here is the failure
    // this assertion exists for: the DSH fiber would apply the plugin before the
    // service exists, and `ctx.slots.inject` would throw in the browser with
    // nothing in the build output to warn about it.
    expect(exports.inject).toEqual(REQUIRED_SERVICES)
  })

  it('requires no DSH module at load time, only the shared runtime', () => {
    const requested: string[] = []
    const calls = evaluateAsClassicScript(readFileSync(bundlePath, 'utf8'))
    const factory = calls[0]?.factory
    factory?.((specifier: string) => {
      requested.push(specifier)
      return requireShared(specifier)
    })

    // The plugin's DSH dependencies are services and types, not runtime modules:
    // requiring one would mean the boot had to have loaded that package before
    // this bundle, which is a load-order contract nothing here can verify.
    expect(requested.length).toBeGreaterThan(0)
    for (const specifier of requested) {
      expect(specifier.startsWith('@deepseek-ai/'), `${specifier} must not be required`).toBe(false)
    }
  })

  it('registers through the fiber effect hook and owes the fiber a disposer', () => {
    const calls = evaluateAsClassicScript(readFileSync(bundlePath, 'utf8'))
    const exports = calls[0]?.factory?.(requireShared) as { apply: (ctx: unknown) => void }
    // `effect` is the fiber's own lifecycle contract: a contribution is made
    // inside the effect body and its teardown is what the body returns. The hook
    // is stubbed because the bundle runs outside a DSH fiber here, and the
    // assertion is on that boundary rather than on the body's contents.
    const bodies: (() => (() => void) | void)[] = []
    const ctx = {
      effect: (execute: () => (() => void) | void): (() => void) => {
        bodies.push(execute)
        return () => undefined
      },
      slots: {
        inject: (_key: string, callback: () => (() => void) | void): (() => void) => {
          const produced = callback()
          return typeof produced === 'function' ? produced : () => undefined
        },
        register: (): (() => void) => () => undefined,
      },
    }

    expect(() => {
      exports.apply(ctx)
    }).not.toThrow()
    expect(bodies.length).toBeGreaterThan(0)

    // Every body has to produce a real disposer: one that returns nothing would
    // leave the fiber with nothing to unload, and `Fiber.effect` rejects that
    // shape with a `TypeError`.
    for (const body of bodies) {
      const produced = body()
      expect(typeof produced).toBe('function')
      expect(() => {
        produced?.()
      }).not.toThrow()
    }
  })

  it('fails on the shapes the loader cannot accept', () => {
    // Control for the checks above: the evaluator must reject module syntax and
    // a bundle that registers nothing, or those checks would prove nothing.
    // The thrown error belongs to the script's own realm, so the assertion is
    // on its shape rather than on `instanceof` against this realm's class.
    expect(() => evaluateAsClassicScript('export function apply() {}\n')).toThrowError(
      /SyntaxError|Unexpected token 'export'/,
    )
    expect(() => evaluateAsClassicScript('import "react"\n')).toThrowError(/SyntaxError|Cannot use import/)
    expect(evaluateAsClassicScript('globalThis.__nothing = true\n')).toEqual([])
  })
})
