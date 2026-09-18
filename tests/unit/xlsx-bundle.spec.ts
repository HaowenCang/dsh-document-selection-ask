import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = process.cwd()
const CLIENT_BUNDLE_PATH = join(REPO_ROOT, 'lib', 'client.js')
const HOST_BUNDLE_PATH = join(REPO_ROOT, 'lib', 'index.mjs')
const ASSETS_DIR = join(REPO_ROOT, 'lib', 'assets')
const TSDOWN_CONFIG_PATH = join(REPO_ROOT, 'tsdown.config.ts')
const PACKAGE_JSON_PATH = join(REPO_ROOT, 'package.json')

/**
 * The XLSX client runtime is client-only, and this suite is where that claim is
 * checked against the artifacts rather than the sources.
 *
 * An earlier revision served the Duke engine binary and the library's worker
 * bundle from two host routes registered by `src/index.ts`. Both are gone: the
 * host half contributes nothing, and the browser half must reach neither a host
 * path, a document-relative path, nor a CDN. What remains is a bundle whose XLSX
 * runtime fails closed, because DSH exposes no public client-only contract for
 * delivering a second file beside `lib/client.js`.
 */
describe('XLSX client-only runtime', () => {
  it('bundles react-xlsx and the Duke runtime into lib/client.js without bare specifiers', () => {
    expect(existsSync(CLIENT_BUNDLE_PATH), 'lib/client.js must exist').toBe(true)
    const content = readFileSync(CLIENT_BUNDLE_PATH, 'utf8')

    // Must not contain bare require or import of react-xlsx or sheets-wasm
    expect(content).not.toMatch(/require\(["']@extend-ai\/react-xlsx["']\)/)
    expect(content).not.toMatch(/require\(["']@dukelib\/sheets-wasm["']\)/)
    expect(content).not.toMatch(/from ["']@extend-ai\/react-xlsx["']/)
    expect(content).not.toMatch(/from ["']@dukelib\/sheets-wasm["']/)

    // Must bundle XLSX renderer code
    expect(content).toContain('dsh-selectable-xlsx')
    expect(content).toContain('dsh-document-selection-ask/xlsx')

    // Must preserve classic ModuleLoader wrapper
    expect(content).toMatch(/^window\.__ModuleLoader__\.load\(/)
    expect(content).toMatch(/\}\);\s*$/)

    // React must stay external to avoid duplicate hook dispatcher
    expect(content).not.toContain('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED')
  })

  it('references no host asset path, worker file or remote CDN', () => {
    const content = readFileSync(CLIENT_BUNDLE_PATH, 'utf8')

    // The two host routes the XLSX renderer used to depend on.
    expect(content).not.toContain('/dsa-assets')
    expect(content).not.toContain('dsa-assets')
    expect(content).not.toContain('xlsx-worker.js')

    // The library's own relative worker URL, which the CommonJS target would
    // otherwise emit as `require("url").pathToFileURL(__filename).href`.
    expect(content).not.toContain('new URL("./xlsx-worker.js"')

    // No remote parser asset may be reachable from this bundle.
    expect(content).not.toContain('https://cdn.jsdelivr.net')
    expect(content).not.toContain('https://unpkg.com')
  })

  it('carries the fail-closed worker seam instead of a worker URL', () => {
    const content = readFileSync(CLIENT_BUNDLE_PATH, 'utf8')

    // The library constructs its worker through this identifier, which the
    // build injects and which refuses to produce a URL.
    expect(content).toContain('__dsa_xlsx_worker_source_url__')
    expect(content).toContain('new Worker(__dsa_xlsx_worker_source_url__()')

    // The engine module is inlined rather than left as a dynamic import that
    // would make rolldown emit a second chunk beside this file.
    expect(content).toContain('__dukelib_sheets_wasm_promise__')
    expect(content).not.toContain('import("@dukelib/sheets-wasm")')
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
    // not contain is a host path, an asset output directory, or the engine
    // binary — those are what a delivery mechanism would have to add.
    expect(config).not.toContain('dsa-assets')
    expect(config).not.toContain('/dsa-assets')
    expect(config).not.toContain("'assets/xlsx-worker'")
    expect(config).not.toContain('duke_sheets_wasm_bg.wasm')
    expect(config).not.toContain('copyFileSync')
    // The two asserted rewrites must stay in place; their absence is what would
    // let an upstream reshape silently produce a bundle with a stray chunk.
    expect(config).toContain('replaceExactlyOnce')
    expect(config).toContain('XLSX_WORKER_CONSTRUCTION')
  })

  it('contains no leaked bare Node-only runtime modules', () => {
    const content = readFileSync(CLIENT_BUNDLE_PATH, 'utf8')
    expect(content).not.toMatch(/require\(["']fs["']\)/)
    expect(content).not.toMatch(/require\(["']node:fs["']\)/)
    expect(content).not.toMatch(/require\(["']path["']\)/)
    expect(content).not.toMatch(/require\(["']worker_threads["']\)/)
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
