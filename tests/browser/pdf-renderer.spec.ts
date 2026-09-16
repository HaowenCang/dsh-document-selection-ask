/**
 * Task 7 gate: real DSH renders a real PDF with a canvas and a selectable text
 * layer.
 *
 * Nothing here mounts a component or writes renderer markup. The test-only
 * companion driver contributes one button per fixture, that button calls
 * `ctx.sidebarRight.openResource(address)` — the published navigation service —
 * and every `data-dsa-pdf-*` node and every `data-document-preview` identity below
 * is produced by DSH and by the plugin registered in it. If the plugin were
 * absent, the same address would resolve to the DSH builtin PDF renderer, which
 * draws a canvas and no text at all; that difference is what several cases below
 * rest on.
 *
 * ## What is instrumented, and why
 *
 * Three facts cannot be read from the DOM and are therefore observed through the
 * page's own platform constructors, installed before any application code runs:
 *
 * - **a native worker was created, from a blob URL** — `Worker` is wrapped and
 *   every construction recorded. The wrapper delegates to the real constructor
 *   and changes nothing about the worker's behaviour.
 * - **no PDF.js asset was requested over the network** — every request is
 *   recorded, and the spec asserts none of them is a CMap, a standard font, a
 *   wasm module or a CDN URL. Requests to DSH's own origin are counted and
 *   reported rather than forbidden, because the application fetches its own
 *   bundles.
 * - **the worker's source was released** — `URL.revokeObjectURL` is wrapped and
 *   the revoked URLs are compared with the created ones.
 *
 * ## What is not tested here
 *
 * No selection adapter exists for PDF in this task, so selecting text inside this
 * renderer must **not** raise the Ask button. That absence is asserted rather
 * than worked around: it is the correct state until Task 8 registers the adapter
 * and the page provenance that goes with it.
 *
 * ## The instance
 *
 * `DSH_SMOKE_URL` names a running DSH web instance carrying this plugin, the
 * test-only driver and the fixtures. The spec is skipped without it, so
 * `pnpm test:browser` stays usable on a machine with no DSH installed. Bring one
 * up with:
 *
 * ```text
 * pnpm build && pnpm smoke:driver
 * pnpm smoke:profile prepare
 * dsh --profile dsa-smoke --port 50111 --no-open
 * DSH_SMOKE_URL='http://127.0.0.1:50111/?token=…' pnpm playwright test tests/browser/pdf-renderer.spec.ts --workers=1
 * ```
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { ensureWorkspace } from './helpers/shell.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/** The running DSH instance this smoke drives. */
const BASE_URL = process.env['DSH_SMOKE_URL'] ?? ''

test.skip(BASE_URL === '', 'set DSH_SMOKE_URL to a running DSH instance booted from the dsa-smoke profile')

/** The smoke driver's control strip. */
const DRIVER = '[data-dsa-smoke-driver]'

/** The composer's editable surface; the driver's control only exists beside it. */
const COMPOSER_INPUT = '[data-composer-input]'

/** The Ask button this plugin contributes. */
const ASK_BUTTON = '[data-dsa-selection-ask-button]'

/** The renderer root and the contract attributes it publishes. */
const DOCUMENT_ROOT = '[data-dsa-document-kind="pdf"]'
const RESOURCE_ADDRESS = 'data-dsa-resource-address'

/** One page wrapper and its two layers, all owned by the plugin's renderer. */
const PAGE = '[data-dsa-pdf-page]'
const CANVAS = '[data-dsa-pdf-canvas]'
const TEXT_LAYER = '[data-dsa-pdf-text]'
const TEXT_SPAN = `${TEXT_LAYER} span`

/**
 * The document preview's own identity attribute, written by DSH.
 *
 * It is read through `closest()` rather than from the renderer root: the
 * attribute belongs to the preview's root element, and the plugin's renderer is a
 * child of it. Reading the nearest ancestor is also the assertion — a renderer
 * mounted outside a document preview would find nothing, which is a failure and
 * not a false pass.
 */
const PREVIEW_IDENTITY_ATTRIBUTE = 'data-document-preview'

/** This plugin's renderer id, as `register.ts` publishes it. */
const PLUGIN_RENDERER = 'dsh-document-selection-ask/pdf'

/**
 * The init script that instruments the platform constructors.
 *
 * It is an ordinary page script with no access to the plugin: it wraps `Worker`,
 * `URL.createObjectURL` and `URL.revokeObjectURL`, delegates every call to the
 * real implementation, and records what it saw on `window.__dsaPdfProbe__`. A
 * wrapper that changed behaviour would make every assertion below meaningless, so
 * each one returns exactly what the original returned.
 */
const PROBE_SCRIPT = `
(() => {
  const probe = { workers: [], created: [], revoked: [], failWorker: false }
  window.__dsaPdfProbe__ = probe

  const RealWorker = window.Worker
  window.Worker = function DsaProbeWorker(url, options) {
    probe.workers.push({ url: String(url), type: options && options.type, name: options && options.name })
    if (probe.failWorker) throw new Error('probe: worker construction refused')
    return new RealWorker(url, options)
  }
  window.Worker.prototype = RealWorker.prototype
  Object.setPrototypeOf(window.Worker, RealWorker)

  const realCreate = URL.createObjectURL.bind(URL)
  const realRevoke = URL.revokeObjectURL.bind(URL)
  URL.createObjectURL = (blob) => {
    const url = realCreate(blob)
    probe.created.push(url)
    return url
  }
  URL.revokeObjectURL = (url) => {
    probe.revoked.push(String(url))
    return realRevoke(url)
  }
})()
`

/** What the probe recorded in one page. */
interface ProbeSnapshot {
  readonly workers: readonly { readonly url: string; readonly type?: string; readonly name?: string }[]
  readonly created: readonly string[]
  readonly revoked: readonly string[]
}

/** The shape the probe leaves on the page. */
declare global {
  interface Window {
    __dsaPdfProbe__?: {
      workers: { url: string; type?: string; name?: string }[]
      created: string[]
      revoked: string[]
      failWorker: boolean
    }
  }
}

/**
 * Read the fixture table out of the bootstrap script.
 *
 * The PDF fixtures are committed, so unlike the Task 5B text fixtures their
 * contents are not restated here — but their workspace paths are derived by the
 * bootstrap, and a spec that guessed them would fail for the wrong reason. The
 * table's own literal is read back and evaluated as data; importing the script
 * would run its command switch.
 *
 * @returns one entry per PDF fixture: its key and the workspace path it is copied to.
 */
function pdfFixtureTable(): readonly { key: string; path: string }[] {
  const source = readFileSync(join(repoRoot, 'scripts', 'dsh-smoke-profile.mjs'), 'utf8')
  const marker = 'const PDF_FIXTURE_SOURCES = ['
  const table = source.slice(source.indexOf(marker))
  if (table === '') throw new Error('scripts/dsh-smoke-profile.mjs has no PDF_FIXTURE_SOURCES table')
  const start = table.indexOf('[')
  let depth = 0
  let end = -1
  for (let index = start; index < table.length; index += 1) {
    if (table[index] === '[' || table[index] === '{') depth += 1
    if (table[index] === ']' || table[index] === '}') {
      depth -= 1
      if (depth === 0) {
        end = index
        break
      }
    }
  }
  if (end < 0) throw new Error('the PDF fixture table is not closed')

  const stringify = new Function(`return ${table.slice(start, end + 1)}`) as () => {
    key: string
    source: string
  }[]
  const pathOf = new Function(
    'source',
    'return source.slice(source.lastIndexOf("/") + 1).replace(/\\.pdf$/u, "")',
  ) as (source: string) => string

  return stringify().map((entry) => ({ key: entry.key, path: `smoke-fixtures/task7-${pathOf(entry.source)}.pdf` }))
}

/** The PDF fixtures, by key. */
const PDF_FIXTURES = pdfFixtureTable()

/**
 * The workspace path of one PDF fixture.
 * @param key - the fixture key, e.g. `pdf-single`.
 * @returns the repository-relative path inside the session workspace.
 */
function pdfFixturePath(key: string): string {
  const found = PDF_FIXTURES.find((entry) => entry.key === key)
  if (found === undefined) throw new Error(`the smoke profile declares no ${key} fixture`)
  return found.path
}

/**
 * Open the DSH shell, install the probe and point it at this repository.
 *
 * The composer is the anchor: the driver's control occupies a session-scoped
 * slot, so it exists only once a session is on screen.
 *
 * @param page - the browser page.
 */
async function openShell(page: Page): Promise<void> {
  await page.addInitScript(PROBE_SCRIPT)
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForTimeout(12_000)
  await expect(page.locator(COMPOSER_INPUT).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator(DRIVER).first()).toBeVisible({ timeout: 30_000 })
  await ensureWorkspace(page)
}

/**
 * Open one PDF fixture through the driver's public navigation call and wait for
 * the plugin's renderer to publish its root.
 *
 * The wait is on the renderer root rather than on the preview's own container:
 * what has to be proved is that this plugin rendered the file, and the builtin
 * renderer would produce the preview container without it.
 *
 * @param page - the browser page.
 * @param key - the fixture key.
 * @returns the resource address the renderer published.
 */
async function openPdfFixture(page: Page, key: string): Promise<string> {
  const path = pdfFixturePath(key)
  await page.locator(`[data-dsa-smoke-open="${key}"]`).click()

  const root = page.locator(DOCUMENT_ROOT).first()
  await expect(root).toBeVisible({ timeout: 60_000 })

  const address = await root.getAttribute(RESOURCE_ADDRESS)
  expect(address, 'the renderer must publish the address it was given').not.toBeNull()
  expect(address).toContain(path)
  // The address is the public `props.resourceAddress` copied verbatim, not
  // something inferred from the shell.
  expect(address).toMatch(/^dsh-resource:\/\/file\/session\/[^/]+\/smoke-fixtures\/task7-.+\.pdf$/)
  return address ?? ''
}

/**
 * Wait until one page of the renderer has a canvas at its final size and a text
 * layer that has finished laying spans out.
 *
 * @param page - the browser page.
 * @param pageNumber - the 1-based page number.
 */
async function waitForPage(page: Page, pageNumber: number): Promise<void> {
  const wrapper = page.locator(`[data-dsa-pdf-page="${String(pageNumber)}"]`)
  await expect(wrapper).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(
      async () =>
        wrapper.locator(CANVAS).evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0),
      { timeout: 60_000, message: `page ${String(pageNumber)} never produced a sized canvas` },
    )
    .toBe(true)
  // The placeholder the renderer shows until the first render settles is the
  // renderer's own signal that the canvas and the text layer have both finished.
  await expect(wrapper.locator('[data-dsa-pdf-placeholder]')).toHaveCount(0, { timeout: 60_000 })
}

/**
 * Read the probe's snapshot from the page.
 * @param page - the browser page.
 * @returns what the probe recorded.
 */
async function probe(page: Page): Promise<ProbeSnapshot> {
  return page.evaluate(() => ({
    workers: window.__dsaPdfProbe__?.workers ?? [],
    created: window.__dsaPdfProbe__?.created ?? [],
    revoked: window.__dsaPdfProbe__?.revoked ?? [],
  }))
}

/**
 * Select a run of one page's text-layer spans with a real DOM range.
 *
 * `Selection.addRange` is the platform's own selection mechanism, not a
 * renderer-side substitute: the browser reports the selection through
 * `window.getSelection().toString()` exactly as it would after a drag, and every
 * case below asserts that value rather than reading `textContent`. A drag is
 * unreliable here for a measured reason — the column animates in — and a drag
 * that landed on the wrong glyph would test the animation, not the renderer.
 *
 * @param page - the browser page.
 * @param pageNumber - the page whose text is selected.
 * @returns the selected text.
 */
async function selectPageText(page: Page, pageNumber: number): Promise<string> {
  return page.evaluate(
    ([selector, pageAttr]: readonly [string, string]) => {
      const wrapper = document.querySelector(`[${pageAttr}="${selector}"]`)
      if (wrapper === null) return ''
      const spans = [...wrapper.querySelectorAll('.textLayer span')].filter(
        (span) => (span.textContent ?? '').trim() !== '',
      )
      if (spans.length === 0) return ''

      const range = document.createRange()
      range.setStartBefore(spans[0] as Node)
      range.setEndAfter(spans[spans.length - 1] as Node)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return selection?.toString() ?? ''
    },
    [String(pageNumber), 'data-dsa-pdf-page'] as const,
  )
}

/**
 * The rectangle of the first text span on a page that has text, and the canvas
 * box it must sit inside.
 *
 * @param page - the browser page.
 * @param pageNumber - the page to measure.
 * @returns the two rectangles in CSS pixels, or `null` when the page has no text.
 */
async function measureAlignment(
  page: Page,
  pageNumber: number,
): Promise<{ span: DOMRectLike; canvas: DOMRectLike } | null> {
  return page.evaluate(
    ([selector]: readonly [string]) => {
      const wrapper = document.querySelector(`[data-dsa-pdf-page="${selector}"]`)
      if (wrapper === null) return null
      const canvas = wrapper.querySelector('canvas')
      const spans = [...wrapper.querySelectorAll('.textLayer span')].filter(
        (span) => (span.textContent ?? '').trim() !== '',
      )
      if (canvas === null || spans.length === 0) return null
      const toPlain = (rect: DOMRect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      return { span: toPlain(spans[0]!.getBoundingClientRect()), canvas: toPlain(canvas.getBoundingClientRect()) }
    },
    [String(pageNumber)] as const,
  )
}

/** A plain rectangle, so the result survives the page boundary. */
interface DOMRectLike {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Assert one span's rectangle lies inside the canvas box.
 *
 * No pixel comparison is attempted — the target is the gross misalignment a text
 * layer laid out against the backing raster rather than the CSS viewport would
 * produce, which shows up as an offset or a scale factor, not as a sub-pixel
 * difference.
 *
 * @param measured - the two rectangles.
 * @param label - the case's own label, for the failure message.
 */
function expectAligned(measured: { span: DOMRectLike; canvas: DOMRectLike } | null, label: string): void {
  expect(measured, `${label}: the page must have a canvas and at least one text span`).not.toBeNull()
  const span = measured!.span
  const canvas = measured!.canvas

  expect(span.width, `${label}: the span must have a width`).toBeGreaterThan(0)
  expect(span.height, `${label}: the span must have a height`).toBeGreaterThan(0)
  // A generous tolerance: what is being excluded is a span laid out at the
  // backing scale, which is off by the device pixel ratio rather than by pixels.
  const slack = 4
  expect(span.x, `${label}: the span starts left of the canvas`).toBeGreaterThanOrEqual(canvas.x - slack)
  expect(span.y, `${label}: the span starts above the canvas`).toBeGreaterThanOrEqual(canvas.y - slack)
  expect(span.x + span.width, `${label}: the span ends right of the canvas`).toBeLessThanOrEqual(
    canvas.x + canvas.width + slack,
  )
  expect(span.y + span.height, `${label}: the span ends below the canvas`).toBeLessThanOrEqual(
    canvas.y + canvas.height + slack,
  )
}

test.describe('real DSH 0.1.5-rc.1 selectable PDF renderer', () => {
  test('renders a real PDF with a canvas and a selectable text layer, and raises no Ask', async ({ page }) => {
    await openShell(page)
    const address = await openPdfFixture(page, 'pdf-single')

    // The renderer DSH selected is this plugin's, at the extension band, and the
    // address names the fixture the driver asked for. `data-document-preview` is
    // the preview's own identity attribute, written by DSH on the preview root —
    // of which this renderer's root is a child — and it names the *renderer*,
    // which is what proves the registry ranked this implementation above the DSH
    // builtin one rather than merely mounting some preview.
    const rankedRenderer = await page.evaluate(
      ([selector, attribute]: readonly [string, string]) => {
        const root = document.querySelector(selector)
        return root?.closest(`[${attribute}]`)?.getAttribute(attribute) ?? null
      },
      [DOCUMENT_ROOT, PREVIEW_IDENTITY_ATTRIBUTE] as const,
    )
    expect(rankedRenderer).toBe(PLUGIN_RENDERER)
    expect(address).toContain(pdfFixturePath('pdf-single'))

    await waitForPage(page, 1)
    await expect(page.locator(PAGE)).toHaveCount(1)

    // A real canvas with a real backing size, and a text layer over it whose
    // spans are real DOM text.
    const canvas = await page.locator(`[data-dsa-pdf-page="1"] ${CANVAS}`).evaluate((element: HTMLCanvasElement) => {
      const box = element.getBoundingClientRect()
      return {
        width: element.width,
        height: element.height,
        cssWidth: box.width,
        cssHeight: box.height,
        devicePixelRatio: window.devicePixelRatio,
      }
    })
    expect(canvas.width).toBeGreaterThan(0)
    expect(canvas.height).toBeGreaterThan(0)
    expect(canvas.cssWidth).toBeGreaterThan(0)
    // The raster is at least one device pixel per CSS pixel, which is the floor
    // the backing-scale rule exists to keep.
    expect(canvas.width).toBeGreaterThanOrEqual(Math.floor(canvas.cssWidth) - 1)

    const text = await page.locator(`[data-dsa-pdf-page="1"] ${TEXT_LAYER}`).innerText()
    expect(text).toContain('Alpha Beta Gamma')

    // Alignment: the selectable text sits on the page it selects.
    expectAligned(await measureAlignment(page, 1), 'single page')

    // A real browser selection over that text.
    const selected = await selectPageText(page, 1)
    expect(selected).toContain('Alpha Beta Gamma')
    expect(selected.trim().length).toBeGreaterThan(0)

    // Task boundary: no PDF selection adapter exists yet, so selecting this text
    // must not raise the Ask button. A button here would mean an adapter had
    // claimed a renderer that cannot yet supply page provenance.
    await page.waitForTimeout(1200)
    expect(await page.locator(ASK_BUTTON).count()).toBe(0)

    // A native worker ran, from a blob URL, as a module.
    const snapshot = await probe(page)
    expect(snapshot.workers.length, 'a native worker must have been created').toBeGreaterThan(0)
    const pdfWorkers = snapshot.workers.filter((worker) => worker.url.startsWith('blob:'))
    expect(pdfWorkers.length, 'the PDF worker must be created from a blob URL').toBeGreaterThan(0)
    expect(pdfWorkers[0]?.type).toBe('module')
    expect(snapshot.created.length).toBeGreaterThan(0)
  })

  test('renders later pages only after they are scrolled to', async ({ page }) => {
    await openShell(page)
    await openPdfFixture(page, 'pdf-two')

    // Every page wrapper exists from the first frame: the geometry is read with
    // the document, so the scroll height is correct before any later page
    // renders. This is what keeps a page from oscillating in and out of the
    // observer's range as it renders.
    await waitForPage(page, 1)
    await expect(page.locator(PAGE)).toHaveCount(6)

    // The furthest page has not rendered yet: it keeps its box, and its own
    // placeholder is still standing in for the raster. That placeholder is the
    // renderer's own signal, which is what makes this a statement about laziness
    // rather than about a canvas's default size.
    //
    // Which pages are out of reach is a property of the observer's margin, and
    // the margin is a fixed distance rather than a percentage — see
    // `LAZY_ROOT_MARGIN` in `SelectablePdfBody.tsx` for why a percentage would
    // observe a box its own output changes. Page 6 is 4100 CSS pixels down, well
    // beyond the 1200-pixel lookahead, and the fixture carries six A2 pages so
    // that such a page exists at all.
    await expect(page.locator('[data-dsa-pdf-page="6"] [data-dsa-pdf-placeholder]')).toHaveCount(1)
    const beforeScroll = await page
      .locator('[data-dsa-pdf-page="6"] canvas')
      .evaluate((element: HTMLCanvasElement) => element.width)
    // 300 is a canvas element's default width, i.e. one this renderer never
    // sized: the page has not been rasterized.
    expect(beforeScroll, 'page 6 must not have been rasterized before it was reached').toBe(300)

    await page.locator('[data-dsa-pdf-page="6"]').scrollIntoViewIfNeeded()
    await waitForPage(page, 6)

    const text = await page.locator('[data-dsa-pdf-page="6"] .textLayer').innerText()
    expect(text).toContain('Zeta page six')
    // And the page that was already rendered was not re-rendered into this slot:
    // the two pages carry different text.
    expect(await page.locator('[data-dsa-pdf-page="1"] .textLayer').innerText()).toContain('Alpha page one')

    const selected = await selectPageText(page, 6)
    expect(selected).toContain('Zeta page six')
  })

  test('renders CJK text that a real browser selection can take', async ({ page }) => {
    await openShell(page)
    await openPdfFixture(page, 'pdf-cjk')
    await waitForPage(page, 1)

    const text = await page.locator(`[data-dsa-pdf-page="1"] ${TEXT_LAYER}`).innerText()
    expect(text).toContain('中文选段测试')
    expect(text).toContain('可以在预览中选择这段文字')

    // The real check: the browser's own selection over the laid-out spans, not the
    // layer's `textContent`.
    const selected = await selectPageText(page, 1)
    expect(selected).toContain('中文选段测试')
    expect(selected).toContain('第二行')

    expectAligned(await measureAlignment(page, 1), 'cjk page')

    // No adapter yet, so still no Ask.
    await page.waitForTimeout(1200)
    expect(await page.locator(ASK_BUTTON).count()).toBe(0)
  })

  test('draws an image-only PDF and invents no selectable text', async ({ page }) => {
    await openShell(page)
    await openPdfFixture(page, 'pdf-image')
    await waitForPage(page, 1)

    const canvas = await page
      .locator(`[data-dsa-pdf-page="1"] ${CANVAS}`)
      .evaluate((element: HTMLCanvasElement) => ({ width: element.width, height: element.height }))
    expect(canvas.width).toBeGreaterThan(0)
    expect(canvas.height).toBeGreaterThan(0)

    // The decisive assertion: no text node was produced for a page that has no
    // text. No OCR, no filename, no placeholder.
    await expect(page.locator(`[data-dsa-pdf-page="1"] ${TEXT_SPAN}`)).toHaveCount(0)
    expect(await page.locator(`[data-dsa-pdf-page="1"] ${TEXT_LAYER}`).innerText()).toBe('')
    expect(await selectPageText(page, 1)).toBe('')

    await page.waitForTimeout(1200)
    expect(await page.locator(ASK_BUTTON).count()).toBe(0)
  })

  test('keeps the canvas and the text layer aligned across a real viewport resize', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await openShell(page)
    await openPdfFixture(page, 'pdf-single')
    await waitForPage(page, 1)

    const before = await page
      .locator(`[data-dsa-pdf-page="1"] ${CANVAS}`)
      .evaluate((element: HTMLCanvasElement) => element.getBoundingClientRect().width)
    expectAligned(await measureAlignment(page, 1), 'before resize')

    // A real viewport change, not a synthetic `resize` dispatch: the shell's
    // layout responds to the window, and the renderer's observer responds to the
    // layout.
    await page.setViewportSize({ width: 1100, height: 900 })
    await expect
      .poll(
        async () =>
          page
            .locator(`[data-dsa-pdf-page="1"] ${CANVAS}`)
            .evaluate((element: HTMLCanvasElement) => element.getBoundingClientRect().width),
        { timeout: 30_000, message: 'the page never followed the narrowed column' },
      )
      .not.toBe(before)

    await page.waitForTimeout(2500)
    expectAligned(await measureAlignment(page, 1), 'after resize')

    // Selection still lands on the glyphs after the re-render.
    const selected = await selectPageText(page, 1)
    expect(selected).toContain('Alpha Beta Gamma')
  })

  test('requests no PDF.js asset over the network while opening a document', async ({ page }) => {
    const requested: string[] = []
    page.on('request', (request) => {
      requested.push(request.url())
    })

    await openShell(page)
    await openPdfFixture(page, 'pdf-single')
    await waitForPage(page, 1)
    await page.waitForTimeout(1500)

    const assetLike = requested.filter((url) =>
      /pdf\.worker|\.bcmap|standard_fonts|Foxit|Liberation|\.wasm|cdnjs|jsdelivr|unpkg/i.test(url),
    )
    expect(assetLike, `PDF.js asset requests: ${assetLike.join(', ')}`).toEqual([])

    // Every request that was made went to the instance itself. Two schemes have
    // to be understood rather than filtered away: the main document is an
    // `about:blank`-style no-op Playwright records, and the worker itself is
    // loaded from a `blob:` URL — which is a local object URL this plugin created
    // and revoked, not a fetch. Anything else would be a request leaving the
    // instance.
    const origin = new URL(BASE_URL).origin
    const foreign = requested.filter(
      (url) => !url.startsWith(origin) && !url.startsWith('blob:') && url !== 'about:blank',
    )
    expect(foreign, `requests left the DSH origin: ${foreign.join(', ')}`).toEqual([])

    // And the blob URLs that were used were the plugin's own worker sources.
    const blobRequests = requested.filter((url) => url.startsWith('blob:'))
    const snapshot = await probe(page)
    for (const url of blobRequests) {
      expect(snapshot.created, `${url} is not a URL this plugin created`).toContain(url)
    }
    expect(snapshot.workers.some((worker) => worker.url.startsWith('blob:'))).toBe(true)
  })

  test('fails visibly when the worker cannot start, and does not parse on the main thread', async ({ page }) => {
    await openShell(page)
    await page.evaluate(() => {
      if (window.__dsaPdfProbe__ !== undefined) window.__dsaPdfProbe__.failWorker = true
    })

    await page.locator('[data-dsa-smoke-open="pdf-single"]').click()

    // The renderer reports a failure. What matters is that it is *visible*: the
    // project's frozen rule is that a worker failure is never absorbed into a
    // quieter main-thread parse.
    const notice = page.locator('[data-dsa-pdf-notice]').first()
    await expect(notice).toBeVisible({ timeout: 60_000 })
    await expect(notice).toContainText('PDF')

    // And nothing was rendered: no page wrapper exists at all, because there is
    // no document, and there is no fallback that would produce one.
    await page.waitForTimeout(2000)
    expect(await page.locator(PAGE).count()).toBe(0)

    const snapshot = await probe(page)
    // The blob URL the worker would have used was created and then released, so
    // the failure did not leak it.
    expect(snapshot.created.length).toBeGreaterThan(0)
    for (const url of snapshot.created) {
      expect(snapshot.revoked, `${url} was never released`).toContain(url)
    }
  })
})
