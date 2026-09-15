/**
 * Smoke-profile contract: the bootstrap script, the test-only driver, and the
 * generated fixtures have to agree, and the shipping bundle must not contain any
 * of it.
 *
 * Four separate properties are checked here, and each one is a failure mode that
 * would otherwise surface as a confusing browser result:
 *
 * 1. **The driver is a well-formed DSH client plugin.** Its `dsh.client`
 *    declaration, its loader id and its `cordis.patch.yml` row are what make the
 *    profile able to carry it; a missing edge shows up as a plugin that never
 *    loads, with no error naming the reason.
 * 2. **The clone carries the driver's sources and the fixtures' writer, without
 *    requiring an ambient DSH installation.** Everything under `tests/` is
 *    tracked, so a fresh checkout can build the driver and write the fixtures.
 * 3. **The driver's own bundle contains no synthetic preview markup.** The
 *    module that opens a fixture is allowed to call one navigation service and
 *    nothing else; if it ever emitted a `data-textpreview-*` node, the smoke
 *    would be passing against markup the test wrote.
 * 4. **The shipping bundle contains none of the smoke material.** This is the
 *    isolation gate: `lib/client.js`, `lib/index.mjs` and the published `files`
 *    list must not carry the driver, its controls, or its fixture names.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/** The test-only driver package directory. */
const DRIVER_DIR = join(repoRoot, 'tests', 'browser', 'smoke-driver')

/** The shipping bundle built by `pnpm build`. */
const SHIPPED_BUNDLES = ['lib/client.js', 'lib/index.mjs']

/**
 * Markers that must never appear in a shipped artifact.
 *
 * The loader id and the control's own attribute prefix would only be present if
 * the driver had been bundled into the plugin, and the fixture path is the smoke
 * material itself. The driver's user-visible button labels are deliberately NOT
 * on this list: the driver's own bundle has to contain them, so a check that
 * flagged them would be testing the wrong artifact.
 */
const SMOKE_MARKERS = ['dsa-smoke-driver', 'data-dsa-smoke', 'task5b-smoke']

/**
 * Read a file relative to the repository root.
 * @param path - repository-relative POSIX path.
 * @returns the file's text.
 */
function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

/**
 * List the paths Git tracks, so the assertions read the checkout rather than this
 * machine's working directory.
 * @returns tracked paths, repository-relative and POSIX-separated.
 */
function trackedFiles(): readonly string[] {
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

describe('smoke profile tooling', () => {
  it('declares the driver as a DSH client plugin with its own loader row', () => {
    const manifest = JSON.parse(read('tests/browser/smoke-driver/package.json')) as {
      name: string
      private: boolean
      dsh: { bundle: { patch: string }; client: { platform: string; inject: string[] } }
      exports: Record<string, { default?: string }>
    }

    expect(manifest.name).toBe('@dsh-smoke/dsa-smoke-driver')
    // A test-only package must not be publishable, and must not be listed in the
    // shipping package's `files`.
    expect(manifest.private).toBe(true)
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')

    // The graph edges the browser halves have to arrive through. `sidebarRight`
    // is the navigation service the control calls; the conversation package
    // declares the session-scoped slot it occupies.
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-sidebar-right')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-conversation')

    // Both halves must point at files the driver's build produces, because the
    // loader imports `exports "."` for the host row.
    for (const subpath of ['.', './client'] as const) {
      const declared = manifest.exports[subpath]?.default
      expect(declared, `${subpath} must declare a default`).toBeTypeOf('string')
      expect(existsSync(join(DRIVER_DIR, (declared ?? '').replace(/^\.\//, '')))).toBe(true)
    }

    const patch = read('tests/browser/smoke-driver/cordis.patch.yml')
    expect(patch).toContain('- id: dsa-smoke-driver')
    expect(patch).toContain("name: '@dsh-smoke/dsa-smoke-driver'")
  })

  it('keeps generated smoke material out of version control', () => {
    const files = trackedFiles()

    // Build output is regenerated, never committed.
    expect(files.some((path) => path.startsWith('tests/browser/smoke-driver/lib/'))).toBe(false)
    // Fixtures are generated per run, and the smoke's own scratch directory —
    // probe scripts, screenshots — is disposable.
    expect(files.some((path) => path.startsWith('smoke-fixtures/'))).toBe(false)
    expect(files.some((path) => path.startsWith('.smoke-run/'))).toBe(false)

    // The driver's sources and the build config this project provides for it are
    // the tree's own files; the config lives at the root because tsdown resolves
    // entries against the repository, and its existence is asserted from disk
    // rather than from the index so the check does not depend on staging order.
    expect(existsSync(join(repoRoot, 'tsdown.smoke-driver.config.ts'))).toBe(true)
    expect(existsSync(join(repoRoot, 'scripts', 'dsh-smoke-profile.mjs'))).toBe(true)
    expect(existsSync(join(DRIVER_DIR, 'src', 'client', 'index.tsx'))).toBe(true)
    expect(existsSync(join(DRIVER_DIR, 'src', 'client', 'SmokeDriverControl.tsx'))).toBe(true)
    expect(existsSync(join(DRIVER_DIR, 'src', 'client', 'fixtures.ts'))).toBe(true)
    expect(existsSync(join(repoRoot, 'tests', 'browser', 'real-dsh-textpreview.spec.ts'))).toBe(true)

    // And the ignore rules really do cover them, which is the property a fresh
    // clone depends on.
    for (const path of ['tests/browser/smoke-driver/lib/client.js', 'smoke-fixtures/task5b-smoke.txt']) {
      expect(() => execFileSync('git', ['check-ignore', '--quiet', path], { cwd: repoRoot })).not.toThrow()
    }
  })

  it('finds no synthetic preview markup anywhere in the driver', () => {
    // The driver may WAIT for these attributes; it must never create them. The
    // check is over the source, because a bundle would only restate the same
    // strings.
    const markers = ['data-textpreview-state', 'data-textpreview-url', 'data-document-preview', 'data-textpreview-body']
    const sourceDir = join(DRIVER_DIR, 'src')
    const sources = readdirSync(sourceDir, { recursive: true, encoding: 'utf8' })
      .map((entry) => entry.split('\\').join('/'))
      .filter((entry) => /\.tsx?$/.test(entry))
    // A guard that silently scans nothing would pass forever.
    expect(sources.length).toBeGreaterThan(0)

    for (const path of sources) {
      const source = readFileSync(join(sourceDir, path), 'utf8')
      for (const marker of markers) {
        expect(source.includes(marker), `${path} must not name ${marker}`).toBe(false)
      }
    }
  })

  it('opens resources through the public navigation service only', () => {
    const control = read('tests/browser/smoke-driver/src/client/SmokeDriverControl.tsx')

    // One navigation call, and it is the published one.
    expect(control).toContain('ctx.sidebarRight.openResource(')
    // And none of the routes the DSH boundary excludes.
    for (const forbidden of ['querySelector', 'dispatchEvent', 'createElement', 'innerHTML', 'ReactDOM']) {
      expect(control.includes(forbidden), `the control must not use ${forbidden}`).toBe(false)
    }

    const entry = read('tests/browser/smoke-driver/src/client/index.tsx')
    // The runtime service key, which is a different statement from the module
    // dependency edge in `package.json`.
    expect(entry).toContain("export const inject: string[] = ['slots', 'sidebarRight']")
    // No import of the plugin under test: a driver that borrowed its kernel would
    // not be an independent observation.
    for (const forbidden of ['selection-ask', 'SelectionKernel', 'SelectionAskOverlay', 'createDshTextAdapter']) {
      expect(entry.includes(forbidden), `the driver entry must not reference ${forbidden}`).toBe(false)
    }
  })

  it('keeps the smoke out of the shipping bundle and out of the published file list', () => {
    const manifest = JSON.parse(read('package.json')) as { files: string[] }
    for (const marker of SMOKE_MARKERS) {
      expect(manifest.files.some((entry) => entry.includes(marker))).toBe(false)
    }

    for (const bundle of SHIPPED_BUNDLES) {
      const path = join(repoRoot, bundle)
      expect(existsSync(path), `${bundle} is missing; run \`pnpm build\``).toBe(true)
      const source = readFileSync(path, 'utf8')
      for (const marker of SMOKE_MARKERS) {
        expect(source.includes(marker), `${bundle} must not contain ${marker}`).toBe(false)
      }
    }
  })

  it('keeps the driver out of the published package entirely', () => {
    const files = trackedFiles()
    // No published-artifact path may reach into the test tree.
    const manifest = JSON.parse(read('package.json')) as { files: string[]; exports: Record<string, unknown> }
    for (const entry of manifest.files) {
      expect(entry.startsWith('tests/'), `files entry ${entry} points into the test tree`).toBe(false)
    }
    expect(Object.keys(manifest.exports).some((key) => key.includes('smoke'))).toBe(false)

    // And the driver never becomes a runtime dependency of the shipping package.
    const dependencies = (JSON.parse(read('package.json')) as { dependencies?: Record<string, string> })
      .dependencies
    expect(dependencies?.['@dsh-smoke/dsa-smoke-driver']).toBeUndefined()
    expect(files).not.toContain('node_modules/@dsh-smoke/dsa-smoke-driver/package.json')
  })
})
