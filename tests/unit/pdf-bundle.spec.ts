/**
 * The built PDF renderer's artifact contract.
 *
 * Everything here exists only in `lib/client.js`, and each assertion is a failure
 * mode the source cannot reveal:
 *
 * 1. **PDF.js is inside the artifact.** The DSH loader's `require` resolves the
 *    shared runtime modules and nothing else, so a surviving
 *    `require("pdfjs-dist")` is a runtime failure in the browser with no compiler
 *    error in front of it. `deps.alwaysBundle` is what prevents that, and these
 *    assertions are the statement that the setting is still in force.
 * 2. **The worker source is inside the artifact**, for the same reason plus one
 *    more: the renderer starts it from a `Blob`, and a `new URL(…,
 *    import.meta.url)` inside a classic-script closure would resolve against the
 *    document and request an asset the DSH web server does not serve.
 * 3. **The TextLayer CSS is inside the artifact.** Task 5 recorded that a
 *    `*.module.css` import through this bundler is dropped silently; the sheet is
 *    a string, and a string that stopped being embedded would leave the text
 *    layer unstyled and unselectable in a way no unit test sees.
 * 4. **No URL a browser could fetch.** The renderer configures PDF.js with
 *    `useWorkerFetch: false` and its own asset table; the artifact must not
 *    contradict that with a CDN default.
 * 5. **No second copy of the shared runtime.** Bundling React or the DSH client
 *    packages would give the plugin its own React and break every hook boundary
 *    in the shell.
 *
 * The artifact's size is measured and reported rather than asserted: PDF.js, its
 * worker and its three asset families are several megabytes by construction, and
 * a threshold would be a number nobody could justify.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const bundlePath = join(repoRoot, 'lib', 'client.js')

/**
 * Read the built client bundle.
 * @returns its text.
 */
function readBundle(): string {
  expect(existsSync(bundlePath), `${bundlePath} is missing; run \`pnpm build\``).toBe(true)
  return readFileSync(bundlePath, 'utf8')
}

/**
 * Every bare `require("…")` the artifact performs.
 *
 * @param source - the bundle text.
 * @returns the specifiers, deduplicated and sorted.
 */
function requiredSpecifiers(source: string): readonly string[] {
  return [...new Set([...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1] ?? ''))].sort()
}

describe('built client bundle: PDF renderer', () => {
  it('carries PDF.js inside the artifact rather than requiring it', () => {
    const source = readBundle()

    for (const specifier of ['pdfjs-dist', 'pdfjs-dist/build/pdf.mjs', 'pdfjs-dist/build/pdf.min.mjs']) {
      expect(source.includes(`require("${specifier}")`), `require("${specifier}") survived`).toBe(false)
      expect(source.includes(`from "${specifier}"`), `from "${specifier}" survived`).toBe(false)
    }

    // And the library really is there, so the assertion above cannot pass because
    // nothing was bundled at all.
    expect(source).toContain('PDFDocumentLoadingTask')
    expect(source).toContain('GetTextContent')
  })

  it('requires nothing at run time except the shared runtime, and one Node-only branch', () => {
    const source = readBundle()

    // `react` and `react/jsx-runtime` are the loader's own table. `url` belongs to
    // a branch inside PDF.js that is guarded by `if (isNodeJS)` and constructs a
    // Node canvas factory; it never runs in a browser, and it is inside the
    // artifact because PDF.js's published build contains it. Nothing else may
    // appear: any other bare specifier is a module the DSH loader cannot resolve.
    expect(requiredSpecifiers(source)).toEqual(['react', 'react/jsx-runtime', 'url'])
    expect(source).toContain('if (isNodeJS)')
  })

  it('carries the worker source as a string, and never as a package URL', () => {
    const source = readBundle()

    // The ready handshake the build appends, which exists only inside the
    // embedded worker string.
    expect(source).toContain('dsa-pdf-worker-ready')
    // The worker module's own footer, which only the embedded source carries.
    expect(source).toContain('globalThis.pdfjsWorker')
    expect(source.includes('pdf.worker.min.mjs?raw')).toBe(false)
    expect(source.includes('pdf.worker.min.mjs"')).toBe(false)
  })

  it('carries the text layer rules the selectable text depends on', () => {
    const source = readBundle()

    expect(source).toContain('.textLayer')
    expect(source).toContain('--text-scale-factor')
    expect(source).toContain('--total-scale-factor')
    expect(source).toContain('data-plugin-css')
    expect(source).toContain('dsh-document-selection-ask/pdf-renderer.css')
  })

  it('carries the CMap, standard-font and wasm families the renderer answers for', () => {
    const source = readBundle()

    // One representative asset per family, by the exact filename PDF.js asks for.
    expect(source).toContain('UniGB-UCS2-H.bcmap')
    expect(source).toContain('FoxitSerif.pfb')
    expect(source).toContain('openjpeg.wasm')
  })

  it('names no remote asset host', () => {
    const source = readBundle()

    for (const host of ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'mozilla.github.io']) {
      expect(source.includes(host), `${host} appears in the artifact`).toBe(false)
    }
    expect(source.includes('workerSrc = "http')).toBe(false)
    expect(source.includes("workerSrc = 'http")).toBe(false)
  })

  it('keeps the DSH shared runtime out of the plugin bundle', () => {
    const source = readBundle()

    for (const marker of ['@deepseek-ai/dsh-client-ui-', '@deepseek-ai/cordis']) {
      expect(source.includes(`require("${marker}`), `${marker} was bundled`).toBe(false)
    }
    // Task 9 bundles @zip.js/zip.js for OOXML preflight with 0 unresolved requires.
    expect(source).not.toMatch(/require\(["']@zip\.js\/zip\.js["']\)/)
  })

  it('reports the artifact size', () => {
    const raw = statSync(bundlePath).size
    const gzipped = gzipSync(readFileSync(bundlePath), { level: 9 }).length

    expect(raw).toBeGreaterThan(1_000_000)
    expect(gzipped).toBeGreaterThan(0)
    console.log(`[pdf-bundle] lib/client.js raw=${String(raw)} bytes gzip=${String(gzipped)} bytes`)
  })
})
