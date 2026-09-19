import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  XLSX_WASM_BASE64_MAX_CHARS,
  XLSX_WASM_GZIP_MAX_BYTES,
  XLSX_WASM_PACKAGE,
  XLSX_WASM_PACKAGE_VERSION,
  XLSX_WASM_RAW_BYTES_EXPECTED,
  XLSX_WASM_SHA256_EXPECTED,
  createXlsxRuntimeAssets,
  findRemoteAddresses,
} from '../../scripts/xlsx-runtime-assets.js'

const REPO_ROOT = process.cwd()
const CLIENT_BUNDLE_PATH = join(REPO_ROOT, 'lib', 'client.js')
const HOST_BUNDLE_PATH = join(REPO_ROOT, 'lib', 'index.mjs')
const ASSETS_DIR = join(REPO_ROOT, 'lib', 'assets')
const TSDOWN_CONFIG_PATH = join(REPO_ROOT, 'tsdown.config.ts')
const PACKAGE_JSON_PATH = join(REPO_ROOT, 'package.json')
const ASSET_HELPER_PATH = join(REPO_ROOT, 'scripts', 'xlsx-runtime-assets.ts')

/**
 * Built from the exact installed package, once, and shared by the two describes
 * below. The build reads 4.4 MB and compresses it; recomputing it per case would
 * make this suite the slowest in the project for no additional evidence.
 */
const assets = createXlsxRuntimeAssets()

/** The built client bundle, read once. */
const clientBundle = existsSync(CLIENT_BUNDLE_PATH) ? readFileSync(CLIENT_BUNDLE_PATH, 'utf8') : ''

/** The engine binary's base64 — the representation this architecture forbids. */
const RAW_WASM_BASE64 = Buffer.from(
  readFileSync(join(REPO_ROOT, 'node_modules', '@extend-ai', 'react-xlsx', 'dist', 'duke_sheets_wasm_bg.wasm')),
).toString('base64')

/** How many times one literal occurs in a haystack. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/**
 * The XLSX client runtime is client-only, and this suite is where that claim is
 * checked against the artifacts rather than the sources.
 *
 * An earlier revision served the Duke engine binary and the library's worker
 * bundle from two host routes registered by `src/index.ts`. Both are gone. The
 * architecture that replaced them carries the engine **inside the one client
 * bundle** as a deterministic gzip, base64-encoded, inflated and SHA-256
 * verified on first use — the narrow exception recorded in
 * `docs/06-security-performance.md`, and only for this one binary. The raw
 * uncompressed WASM base64 remains forbidden, and the two describes below assert
 * both halves of that: the compressed payload is present exactly once, and the
 * uncompressed one is absent.
 */
describe('XLSX client-only runtime', () => {
  it('bundles react-xlsx and the Duke runtime into lib/client.js without bare specifiers', () => {
    expect(existsSync(CLIENT_BUNDLE_PATH), 'lib/client.js must exist').toBe(true)

    // Must not contain bare require or import of react-xlsx or sheets-wasm
    expect(clientBundle).not.toMatch(/require\(["']@extend-ai\/react-xlsx["']\)/)
    expect(clientBundle).not.toMatch(/require\(["']@dukelib\/sheets-wasm["']\)/)
    expect(clientBundle).not.toMatch(/from ["']@extend-ai\/react-xlsx["']/)
    expect(clientBundle).not.toMatch(/from ["']@dukelib\/sheets-wasm["']/)

    // Must bundle XLSX renderer code
    expect(clientBundle).toContain('dsh-selectable-xlsx')
    expect(clientBundle).toContain('dsh-document-selection-ask/xlsx')

    // Must preserve classic ModuleLoader wrapper
    expect(clientBundle).toMatch(/^window\.__ModuleLoader__\.load\(/)
    expect(clientBundle).toMatch(/\}\);\s*$/)

    // React must stay external to avoid duplicate hook dispatcher
    expect(clientBundle).not.toContain('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED')
  })

  it('references no host asset path, worker file or remote CDN', () => {
    // The two host routes the XLSX renderer used to depend on.
    expect(clientBundle).not.toContain('/dsa-assets')
    expect(clientBundle).not.toContain('dsa-assets')
    expect(clientBundle).not.toContain('xlsx-worker.js')

    // The library's own relative worker URL, which the CommonJS target would
    // otherwise emit as `require("url").pathToFileURL(__filename).href`.
    expect(clientBundle).not.toContain('new URL("./xlsx-worker.js"')

    // No remote parser asset may be reachable from this bundle.
    expect(clientBundle).not.toContain('https://cdn.jsdelivr.net')
    expect(clientBundle).not.toContain('https://unpkg.com')
  })

  it('creates the library worker from a client-owned Blob instead of a URL', () => {
    // The library constructs its worker through this identifier, which the build
    // injects and which builds a self-contained Blob over the embedded source.
    // The rewritten call site is asserted exactly: the helper returns a
    // constructed `Worker`, so leaving the library's own `new Worker(...)` around
    // it would construct a worker from a worker and the browser would fetch
    // `[object Worker]` relative to the document.
    expect(clientBundle).toContain('this.worker = __dsa_xlsx_create_worker__()')
    expect(clientBundle).not.toContain('new Worker(__dsa_xlsx_create_worker__')

    // The engine module is inlined rather than left as a dynamic import that
    // would make rolldown emit a second chunk beside this file.
    expect(clientBundle).toContain('__dukelib_sheets_wasm_promise__')
    expect(clientBundle).not.toContain('import("@dukelib/sheets-wasm")')

    // The fail-closed seam of the blocked architecture is gone: it refused to
    // produce a URL, and this build produces one.
    expect(clientBundle).not.toContain('__dsa_xlsx_worker_source_url__')
  })

  it('emits no second chunk beside lib/client.js', () => {
    const libEntries = readdirFileNames(join(REPO_ROOT, 'lib'))
    expect(
      libEntries.filter((name) => name.endsWith('.js') && name !== 'client.js'),
      'an external client plugin is served as exactly one script',
    ).toEqual([])
  })

  it('ships no separate WASM or worker asset', () => {
    expect(existsSync(ASSETS_DIR), 'lib/assets must not exist in the client-only layout').toBe(false)

    const manifest = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
      files?: readonly string[]
    }
    for (const entry of manifest.files ?? []) {
      expect(entry, 'the published file list must not promise an asset directory').not.toContain(
        'assets',
      )
    }
  })

  it('keeps the host bundle free of routes, filesystem access and XLSX runtime', () => {
    expect(existsSync(HOST_BUNDLE_PATH), 'lib/index.mjs must exist').toBe(true)
    const content = readFileSync(HOST_BUNDLE_PATH, 'utf8')

    expect(content).not.toContain('webServer')
    expect(content).not.toContain('dsa-assets')
    expect(content).not.toContain('readFileSync')
    expect(content).not.toContain('node:fs')
    expect(content).not.toContain('xlsx-worker')
    expect(content).not.toContain('duke_sheets_wasm')
    expect(content).not.toContain('duke_sheets_wasm_bg.wasm')
  })

  it('keeps the build configuration free of host asset delivery', () => {
    const config = readFileSync(TSDOWN_CONFIG_PATH, 'utf8')

    // The config still *names* the library's own worker URL, because that
    // literal is the anchor the asserted rewrite matches against. What it must
    // not contain is a host path, an asset output directory, or a copy step —
    // the engine binary reaches the browser only as a string inside client.js.
    expect(config).not.toContain('dsa-assets')
    expect(config).not.toContain("'assets/xlsx-worker'")
    expect(config).not.toContain('copyFileSync')
    // The two asserted rewrites must stay in place; their absence is what would
    // let an upstream reshape silently produce a bundle with a stray chunk.
    expect(config).toContain('replaceExactlyOnce')
    expect(config).toContain('XLSX_WORKER_CONSTRUCTION')
  })

  it('contains no leaked bare Node-only runtime modules', () => {
    expect(clientBundle).not.toMatch(/require\(["']fs["']\)/)
    expect(clientBundle).not.toMatch(/require\(["']node:fs["']\)/)
    expect(clientBundle).not.toMatch(/require\(["']path["']\)/)
    expect(clientBundle).not.toMatch(/require\(["']worker_threads["']\)/)
  })
})

/**
 * The compressed-payload contract.
 *
 * Every assertion below is a build gate in its own right: the identity check
 * fails the build when the installed binary changes, the two size bounds fail it
 * when compression regresses toward the forbidden raw representation, and the
 * absence check fails it when both representations end up in the bundle.
 */
describe('XLSX client-inline runtime assets', () => {
  it('reads the exact pinned package version', () => {
    expect(assets.packageName).toBe(XLSX_WASM_PACKAGE)
    expect(assets.packageVersion).toBe(XLSX_WASM_PACKAGE_VERSION)
  })

  it('verifies the exact raw engine bytes at build time', () => {
    expect(assets.rawBytes).toBe(XLSX_WASM_RAW_BYTES_EXPECTED)
    expect(assets.sha256).toBe(XLSX_WASM_SHA256_EXPECTED)

    // The identity is computed from the bytes the build actually embedded, not
    // restated from the constants: a decompression of the embedded payload has
    // to reproduce the same digest.
    const embedded = gunzipSync(new Uint8Array(Buffer.from(assets.gzipBase64, 'base64')))
    expect(embedded.byteLength).toBe(XLSX_WASM_RAW_BYTES_EXPECTED)
    expect(createHash('sha256').update(embedded).digest('hex')).toBe(XLSX_WASM_SHA256_EXPECTED)
  })

  it('produces a deterministic gzip payload', () => {
    const first = assets.gzipBase64
    const second = createXlsxRuntimeAssets().gzipBase64
    expect(second).toBe(first)

    // The gzip header's mtime field is zero, so two builds of the same
    // dependency bytes produce the same payload.
    const header = Buffer.from(first, 'base64').subarray(0, 10)
    expect(header.readUInt32LE(4)).toBe(0)
  })

  it('keeps the compressed payload inside its hard bounds', () => {
    expect(assets.gzipBytes).toBeLessThanOrEqual(XLSX_WASM_GZIP_MAX_BYTES)
    expect(assets.gzipBase64Chars).toBeLessThanOrEqual(XLSX_WASM_BASE64_MAX_CHARS)

    // The bounds exist to keep the bundle from drifting back to the forbidden
    // representation, which is 2.6 times the compressed one.
    expect(assets.gzipBase64Chars).toBeLessThan(RAW_WASM_BASE64.length)
  })

  it('carries the compressed payload in lib/client.js exactly once', () => {
    expect(occurrences(clientBundle, assets.gzipBase64)).toBe(1)

    // The identity metadata travels with it, so an observer of the artifact can
    // state which binary it holds without running it.
    expect(clientBundle).toContain(XLSX_WASM_SHA256_EXPECTED)
  })

  it('carries no uncompressed engine binary anywhere in lib/client.js', () => {
    expect(clientBundle).not.toContain(RAW_WASM_BASE64)

    // A second, independent probe: the first 256 characters of the raw base64
    // cannot appear either, so a payload split across statements is still caught.
    expect(clientBundle).not.toContain(RAW_WASM_BASE64.slice(0, 256))

    // Nor inside the embedded worker source, which must receive the bytes
    // through `setWasmSource` rather than carrying its own copy.
    expect(assets.workerSource).not.toContain(RAW_WASM_BASE64)
    expect(assets.workerSource).not.toContain(assets.gzipBase64)
    expect(assets.workerSource).not.toContain(XLSX_WASM_SHA256_EXPECTED)
  })

  it('embeds a self-contained worker source', () => {
    // Exact bytes, not a description: the literal the build emits is the
    // literal the artifact carries.
    expect(clientBundle).toContain(JSON.stringify(assets.workerSource))
    expect(assets.workerSourceChars).toBeGreaterThan(100_000)

    // No module resolution of any kind survives: a static import, a dynamic
    // import, a `require` or an `importScripts` would each be a second file this
    // package does not ship and DSH cannot deliver.
    expect(assets.workerSource).not.toMatch(/^\s*import\s/m)
    expect(assets.workerSource).not.toMatch(/\bimport\s*\(/)
    expect(assets.workerSource).not.toContain('importScripts')
    expect(assets.workerSource).not.toMatch(/\brequire\s*\(/)
    expect(assets.workerSource).not.toContain('sourceMappingURL')

    // No absolute address may be reachable from it. OOXML namespace identifiers
    // are names rather than addresses and are excluded by the probe; the fflate
    // documentation links it also reports live on comment lines and are asserted
    // to be exactly that — comments, never a fetch target.
    const addresses = findRemoteAddresses(assets.workerSource)
    expect(addresses.code).toEqual([])
    for (const address of addresses.comments) {
      const lines = assets.workerSource.split('\n').filter((line) => line.includes(address))
      expect(lines.length).toBeGreaterThan(0)
      expect(
        lines.every((line) => /^\s*(\/\/|\*|\/\*)/.test(line)),
        `every occurrence of ${address} must be on a comment line`,
      ).toBe(true)
    }
  })

  it('rewrites exactly the expected upstream constructs', () => {
    const config = readFileSync(TSDOWN_CONFIG_PATH, 'utf8')
    const helper = readFileSync(ASSET_HELPER_PATH, 'utf8')

    // Two rewrites of the library's own code, both asserted to match once.
    expect(occurrences(config, "'the XlsxWorkerClient constructor'")).toBe(1)
    expect(occurrences(config, "'the Duke engine dynamic import'")).toBe(1)

    // And three inside the worker: the two fflate import forms and the engine
    // dynamic import, each asserted to match once by the synthesizer.
    expect(helper).toContain('XLSX_WORKER_FFLATE_IMPORTS')
    expect(helper).toContain('XLSX_WORKER_DUKE_IMPORT')
    expect(helper).toContain('XLSX_WORKER_SOURCE_MAP_COMMENT')
    expect(helper).toContain('replaceExactlyOnce')
  })

  it('states the identity and size gates in the build itself', () => {
    const helper = readFileSync(ASSET_HELPER_PATH, 'utf8')

    expect(helper).toContain(XLSX_WASM_SHA256_EXPECTED)
    // The byte count is written with a numeric separator, so the assertion is on
    // the literal the build carries rather than on its ungrouped spelling.
    expect(helper).toContain('4_412_299')
    expect(helper).toContain('XLSX WASM IDENTITY CHANGED')
    expect(helper).toContain('XLSX WASM COMPRESSION REGRESSION')

    // The compressed payload is the only binary representation the build may
    // base64. The forbidden one is `Buffer.prototype.toString('base64')` applied
    // to the uncompressed bytes, and it appears nowhere in the build.
    expect(helper).toContain('gzipSync')
    expect(helper).not.toContain("rawWasm.toString('base64')")
    expect(helper).not.toContain('rawWasm.toString("base64")')
  })

  it('records the measured payload sizes', () => {
    // The raw byte count is an identity gate and is asserted exactly. The two
    // compressed sizes are not: a compressor's minor implementation may move them
    // by a handful of bytes, and the property that matters is that the payload
    // stayed far below the forbidden representation rather than that it matched a
    // number to the byte. The measured values are recorded in
    // `docs/06-security-performance.md`.
    expect(assets.rawBytes).toBe(4_412_299)
    expect(assets.gzipBytes).toBeLessThanOrEqual(XLSX_WASM_GZIP_MAX_BYTES)
    expect(assets.gzipBase64Chars).toBeLessThanOrEqual(XLSX_WASM_BASE64_MAX_CHARS)
    expect(assets.gzipBase64Chars).toBeLessThan(RAW_WASM_BASE64.length / 2)
  })
})

/**
 * List a build output directory's file names.
 * @param path - absolute directory path.
 * @returns the names, sorted; empty when the directory does not exist.
 */
function readdirFileNames(path: string): string[] {
  if (!existsSync(path)) return []
  return readdirSync(path)
    .filter((name) => name !== 'types')
    .sort()
}
