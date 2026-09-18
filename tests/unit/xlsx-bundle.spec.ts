import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = process.cwd()
const CLIENT_BUNDLE_PATH = join(REPO_ROOT, 'lib', 'client.js')
const WASM_ASSET_PATH = join(REPO_ROOT, 'lib', 'assets', 'duke_sheets_wasm_bg.wasm')

describe('XLSX bundle & local WASM assets', () => {
  it('bundles react-xlsx and Duke runtime into lib/client.js without bare specifiers', () => {
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

  it('contains no remote CDN URLs for WASM', () => {
    const content = readFileSync(CLIENT_BUNDLE_PATH, 'utf8')
    expect(content).not.toContain('https://cdn.jsdelivr.net')
    expect(content).not.toContain('https://unpkg.com')
  })

  it('ships local Duke WASM asset in lib/assets/duke_sheets_wasm_bg.wasm', () => {
    expect(existsSync(WASM_ASSET_PATH), 'WASM asset must exist under lib/assets/').toBe(true)
    const stat = statSync(WASM_ASSET_PATH)
    // Duke sheets wasm is ~4.4 MB
    expect(stat.size).toBeGreaterThan(4_000_000)
    expect(stat.size).toBeLessThan(6_000_000)
  })

  it('contains no leaked bare Node-only runtime modules', () => {
    const content = readFileSync(CLIENT_BUNDLE_PATH, 'utf8')
    expect(content).not.toMatch(/require\(["']fs["']\)/)
    expect(content).not.toMatch(/require\(["']node:fs["']\)/)
    expect(content).not.toMatch(/require\(["']path["']\)/)
    expect(content).not.toMatch(/require\(["']worker_threads["']\)/)
  })
})
