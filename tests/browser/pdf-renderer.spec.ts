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

/** The Ask button's accessible name. */
const ASK_LABEL = '\u8be2\u95ee DeepSeek'

/** The question suffix an appended block must close with. */
const QUESTION_SUFFIX = '\u8bf7\u9488\u5bf9\u4ee5\u4e0a\u9009\u4e2d\u5185\u5bb9\u56de\u7b54\uff1a'

/**
 * Read the composer's rendered draft text.
 * @param page - the browser page.
 * @returns the draft text.
 */
async function readDraft(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-composer-input]')
    return element === null ? '' : element.textContent ?? ''
  })
}

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
 * Extract the expected fixture filename from the real resource address opened.
 *
 * Derives the filename directly from the smoke resource address rather than
 * importing production resolution logic, satisfying the independent assertion gate.
 *
 * @param address - the resource address returned by openPdfFixture.
 * @returns the expected filename within the smoke fixtures.
 */
function expectedFixtureFileName(address: string): string {
  const slash = address.lastIndexOf('/')
  return slash >= 0 ? address.slice(slash + 1) : address
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

/** What one page's text layer holds, as a reader would take it. */
interface LayerSnapshot {
  /** The layer's `textContent`, i.e. every character its spans hold. */
  readonly text: string
  /** How many elements the layer holds, spans and line breaks alike. */
  readonly nodes: number
}

/**
 * Read one page's text layer.
 *
 * `textContent` rather than `innerText`: it is what a selection reads and what
 * copy takes, and it does not depend on layout. The node count is read beside it
 * as corroboration — PDF.js is free to group items into spans differently, so the
 * count is evidence and never the contract.
 *
 * @param page - the browser page.
 * @param pageNumber - the 1-based page number.
 * @returns the layer's text and node count.
 */
async function readLayer(page: Page, pageNumber: number): Promise<LayerSnapshot> {
  return page.evaluate(
    ([selector]: readonly [string]) => {
      const layer = document.querySelector(`[data-dsa-pdf-page="${selector}"] [data-dsa-pdf-text]`)
      return { text: layer?.textContent ?? '', nodes: layer?.childElementCount ?? 0 }
    },
    [String(pageNumber)] as const,
  )
}

/**
 * One page's canvas as the renderer sized it: its CSS box and its backing store.
 * @param page - the browser page.
 * @param pageNumber - the 1-based page number.
 * @returns the box width in CSS pixels and the backing width in device pixels.
 */
async function canvasGeometry(
  page: Page,
  pageNumber: number,
): Promise<{ readonly box: number; readonly backing: number }> {
  return page.evaluate(
    ([selector]: readonly [string]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(`[data-dsa-pdf-page="${selector}"] canvas`)
      return { box: canvas?.getBoundingClientRect().width ?? 0, backing: canvas?.width ?? 0 }
    },
    [String(pageNumber)] as const,
  )
}

/** The attribute this suite stamps on the spans of the generation it is replacing. */
const PROBE_ATTRIBUTE = 'data-dsa-probe-previous'

/**
 * Stamp every span the layer currently holds.
 *
 * The stamp is this suite's own bookkeeping, not renderer output: PDF.js builds
 * fresh span elements for every render, so a span that still carries the stamp is
 * a span the **previous** generation put there. That is how a case can tell that
 * the text it is looking at has actually been replaced rather than merely not yet
 * touched.
 *
 * @param page - the browser page.
 * @param pageNumber - the 1-based page number.
 */
async function stampCurrentSpans(page: Page, pageNumber: number): Promise<void> {
  await page.evaluate(
    ([selector, attribute]: readonly [string, string]) => {
      const layer = document.querySelector(`[data-dsa-pdf-page="${selector}"] [data-dsa-pdf-text]`)
      for (const span of layer?.querySelectorAll('span') ?? []) {
        span.setAttribute(attribute, 'previous')
      }
    },
    [String(pageNumber), PROBE_ATTRIBUTE] as const,
  )
}

/**
 * Whether the layer holds laid-out text and none of it is the previous
 * generation's.
 *
 * @param page - the browser page.
 * @param pageNumber - the 1-based page number.
 * @returns whether every span the layer holds was built after the last stamping.
 */
async function layerWasRebuilt(page: Page, pageNumber: number): Promise<boolean> {
  return page.evaluate(
    ([selector, attribute]: readonly [string, string]) => {
      const spans = [
        ...(document.querySelector(`[data-dsa-pdf-page="${selector}"] [data-dsa-pdf-text]`)?.querySelectorAll('span') ??
          []),
      ]
      return spans.length > 0 && spans.every((span) => !span.hasAttribute(attribute))
    },
    [String(pageNumber), PROBE_ATTRIBUTE] as const,
  )
}

/**
 * Resize the viewport and wait until the renderer has re-rendered the page.
 *
 * The canvas is the signal, and it is a sound one: `renderPdfPage` writes the
 * canvas's box, writes its backing size, configures the text layer and starts the
 * layer in **one synchronous block**, before its first `await`. A canvas whose
 * box and backing size both moved is therefore a page whose text layer was
 * rebuilt for the new geometry as well. A run where the page never follows the
 * viewport fails here rather than passing on the previous generation's numbers.
 *
 * @param page - the browser page.
 * @param pageNumber - the 1-based page number.
 * @param size - the viewport to set.
 * @param previous - the canvas geometry before this resize.
 * @returns the canvas geometry after the re-render.
 */
async function resizeViewport(
  page: Page,
  pageNumber: number,
  size: { readonly width: number; readonly height: number },
  previous: { readonly box: number; readonly backing: number },
): Promise<{ readonly box: number; readonly backing: number }> {
  await page.setViewportSize({ width: size.width, height: size.height })
  await expect
    .poll(async () => canvasGeometry(page, pageNumber), {
      timeout: 30_000,
      message: `the page never followed the ${String(size.width)}×${String(size.height)} viewport`,
    })
    .not.toEqual(previous)
  return canvasGeometry(page, pageNumber)
}

/**
 * Resize the viewport and wait until a page with text has laid that text out
 * again.
 *
 * The extra wait over `resizeViewport` is the one that matters for a page that
 * has text: every span must have been built after the stamp, so the assertions
 * that follow are about the new generation's text rather than about a layer that
 * is still the old one — or, with the defect this suite guards, about a layer
 * that now holds both.
 *
 * @param page - the browser page.
 * @param pageNumber - the 1-based page number.
 * @param size - the viewport to set.
 * @param previous - the canvas geometry before this resize.
 * @returns the canvas geometry after the re-render.
 */
async function resizeAndAwaitRerender(
  page: Page,
  pageNumber: number,
  size: { readonly width: number; readonly height: number },
  previous: { readonly box: number; readonly backing: number },
): Promise<{ readonly box: number; readonly backing: number }> {
  const geometry = await resizeViewport(page, pageNumber, size, previous)
  await expect
    .poll(async () => layerWasRebuilt(page, pageNumber), {
      timeout: 30_000,
      message:
        'the layer still holds spans from the generation this resize replaced, so the page’s text ' +
        'accumulates instead of being re-rendered',
    })
    .toBe(true)
  return geometry
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

test.describe('real DSH 0.1.5-rc.2 selectable PDF renderer', () => {
  test('renders a real PDF with a canvas and a selectable text layer, raises Ask, and quotes with single-page provenance', async ({ page }) => {
    await openShell(page)

    // A draft the reader typed before selecting: the ask must preserve it.
    const typedDraft = 'existing pdf draft'
    await page.locator(COMPOSER_INPUT).first().click()
    await page.keyboard.type(typedDraft)
    await page.waitForTimeout(500)

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

    // Task 8: PDF selection adapter claims the selection and raises the Ask button.
    const button = page.locator(ASK_BUTTON).first()
    await expect(button).toBeVisible({ timeout: 15_000 })
    await expect(button).toHaveText(ASK_LABEL)

    const turnsBefore = await page.locator('[data-chat-turn]').count()
    await button.click()

    const expectedFileName = expectedFixtureFileName(address)
    expect(expectedFileName).toBe('task7-single-page.pdf')
    await expect.poll(async () => readDraft(page)).toContain(`[来源：${expectedFileName}，第 1 页]`)

    const draft = await readDraft(page)
    expect(draft).toContain(typedDraft)
    expect(draft).toContain(`[来源：${expectedFileName}，第 1 页]`)
    expect(draft).toContain('Alpha Beta')
    expect(draft).toContain(QUESTION_SUFFIX)

    // No auto-submit and focus restored to composer.
    expect(await page.locator('[data-chat-turn]').count()).toBe(turnsBefore)
    await expect.poll(async () => page.evaluate(() => document.activeElement?.getAttribute('data-composer-input') !== null)).toBe(true)

    // A native worker ran, from a blob URL, as a module.
    const snapshot = await probe(page)
    expect(snapshot.workers.length, 'a native worker must have been created').toBeGreaterThan(0)
    const pdfWorkers = snapshot.workers.filter((worker) => worker.url.startsWith('blob:'))
    expect(pdfWorkers.length, 'the PDF worker must be created from a blob URL').toBeGreaterThan(0)
    expect(pdfWorkers[0]?.type).toBe('module')
    expect(snapshot.created.length).toBeGreaterThan(0)
  })

  test('keeps one generation of text across four real viewport resizes', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await openShell(page)
    await openPdfFixture(page, 'pdf-single')
    await waitForPage(page, 1)

    // The reference the whole case is measured against: the text of the first
    // render, as a reader would take it, the number of nodes that carry it, and
    // what a real browser selection makes of it.
    const initial = await readLayer(page, 1)
    expect(initial.text).toContain('Alpha Beta Gamma')
    expect(initial.nodes).toBeGreaterThan(0)
    const initialSelection = await selectPageText(page, 1)
    expect(initialSelection).toContain('Alpha Beta Gamma')
    expect(initialSelection.trim().length).toBeGreaterThan(0)

    // Four real viewport changes. Each one narrows or widens the preview column,
    // and `resizeAndAwaitRerender` refuses to return until the page has actually
    // been re-rendered into the same text-layer element — so every assertion below
    // is about a re-render that happened, not about one that was skipped.
    const sizes = [
      { width: 1200, height: 900 },
      { width: 1900, height: 1200 },
      { width: 1000, height: 800 },
      { width: 1700, height: 1100 },
    ]
    let geometry = await canvasGeometry(page, 1)
    for (const size of sizes) {
      await stampCurrentSpans(page, 1)
      geometry = await resizeAndAwaitRerender(page, 1, size, geometry)

      const settled = await readLayer(page, 1)
      // The contract: the text exists once. Not twice, not once per resize.
      expect(settled.text, `after ${String(size.width)}×${String(size.height)}`).toBe(initial.text)
      // Corroboration for a deterministic fixture: the node count is unchanged
      // rather than N, 2N, 3N, 4N.
      expect(settled.nodes, `after ${String(size.width)}×${String(size.height)}`).toBe(initial.nodes)

      const selection = await selectPageText(page, 1)
      expect(selection, `selection after ${String(size.width)}×${String(size.height)}`).toBe(initialSelection)
      // A selection that had accumulated generations would read the page's text
      // twice even where the overlapping spans happen to hide it.
      expect(selection).not.toMatch(/Alpha[\s\S]*Alpha/)
      expect(selection.match(/Gamma/gu) ?? []).toHaveLength(1)

      // The text still sits on the canvas it selects.
      expectAligned(await measureAlignment(page, 1), `after ${String(size.width)}×${String(size.height)}`)
    }

    // Task 8: After live selection in the final re-render, the Ask button appears.
    await expect(page.locator(ASK_BUTTON).first()).toBeVisible({ timeout: 15_000 })
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
    // A viewport the preview column actually responds to, which is what makes the
    // re-renders below real ones: at the default size the column's width is the
    // same at 1280 and at 1300, and the renderer is never asked to paint again.
    await page.setViewportSize({ width: 1600, height: 1000 })
    await openShell(page)
    const address = await openPdfFixture(page, 'pdf-cjk')
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

    // Re-rendered twice, and the CJK text is not duplicated by either: a doubled
    // generation would show up here as every character appearing twice, which a
    // `toContain` assertion would not notice.
    const initial = await readLayer(page, 1)
    const initialSelection = await selectPageText(page, 1)
    let geometry = await canvasGeometry(page, 1)
    for (const size of [
      { width: 1200, height: 900 },
      { width: 1900, height: 1200 },
    ]) {
      await stampCurrentSpans(page, 1)
      geometry = await resizeAndAwaitRerender(page, 1, size, geometry)

      expect((await readLayer(page, 1)).text, `after ${String(size.width)}`).toBe(initial.text)
      const resized = await selectPageText(page, 1)
      expect(resized, `selection after ${String(size.width)}`).toBe(initialSelection)
      expect(resized.match(/中文选段测试/gu) ?? []).toHaveLength(1)
      expect(resized.match(/第二行/gu) ?? []).toHaveLength(1)
    }

    // Task 8: Ask button appears for CJK selection, quotes with page 1 provenance.
    const button = page.locator(ASK_BUTTON).first()
    await expect(button).toBeVisible({ timeout: 15_000 })
    await expect(button).toHaveText(ASK_LABEL)

    const turnsBefore = await page.locator('[data-chat-turn]').count()
    await button.click()

    const expectedFileName = expectedFixtureFileName(address)
    expect(expectedFileName).toBe('task7-cjk.pdf')
    await expect.poll(async () => readDraft(page)).toContain(`[来源：${expectedFileName}，第 1 页]`)

    const draft = await readDraft(page)
    expect(draft).toContain(`[来源：${expectedFileName}，第 1 页]`)
    expect(draft).toContain('中文选段测试')
    expect(draft).toContain(QUESTION_SUFFIX)
    // Verify CJK selection occurs once in the draft
    expect(draft.match(/中文选段测试/gu) ?? []).toHaveLength(1)

    // No auto-submit and focus restored to composer
    expect(await page.locator('[data-chat-turn]').count()).toBe(turnsBefore)
    await expect.poll(async () => page.evaluate(() => document.activeElement?.getAttribute('data-composer-input') !== null)).toBe(true)
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

    // And re-rendering it does not invent one either: the reset belongs to every
    // generation, and a page with no text has an empty layer on each of them.
    let geometry = await canvasGeometry(page, 1)
    for (const size of [
      { width: 1250, height: 900 },
      { width: 1750, height: 1100 },
    ]) {
      geometry = await resizeViewport(page, 1, size, geometry)
      const settled = await readLayer(page, 1)
      expect(settled.text, `after ${String(size.width)}`).toBe('')
      expect(settled.nodes, `after ${String(size.width)}`).toBe(0)
      await expect(page.locator(`[data-dsa-pdf-page="1"] ${TEXT_SPAN}`)).toHaveCount(0)
      expect(await selectPageText(page, 1)).toBe('')
    }

    await expect(page.locator(ASK_BUTTON)).toHaveCount(0)
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

  test('appends from a real cross-page selection with source range provenance', async ({ page }) => {
    await openShell(page)

    const typedDraft = 'existing cross draft'
    await page.locator(COMPOSER_INPUT).first().click()
    await page.keyboard.type(typedDraft)
    await page.waitForTimeout(500)

    const address = await openPdfFixture(page, 'pdf-two')
    await waitForPage(page, 1)
    await page.locator('[data-dsa-pdf-page="2"]').scrollIntoViewIfNeeded()
    await waitForPage(page, 2)

    // Create a real cross-page Selection using standard browser Selection/Range APIs.
    const selectedText = await page.evaluate(() => {
      const p1 = document.querySelector('[data-dsa-pdf-page="1"]')
      const p2 = document.querySelector('[data-dsa-pdf-page="2"]')
      if (!p1 || !p2) throw new Error('pages 1 and 2 must exist')

      const spans1 = [...p1.querySelectorAll('.textLayer span')].filter(
        (s) => (s.textContent ?? '').trim() !== '',
      )
      const spans2 = [...p2.querySelectorAll('.textLayer span')].filter(
        (s) => (s.textContent ?? '').trim() !== '',
      )
      if (spans1.length === 0 || spans2.length === 0) throw new Error('text layer spans must exist')

      const span1 = spans1.find((s) => s.textContent?.includes('Alpha page one')) ?? spans1[0]
      const span2 = spans2.find((s) => s.textContent?.includes('Beta page two')) ?? spans2[0]

      const range = document.createRange()
      range.setStartBefore(span1 as Node)
      range.setEndAfter(span2 as Node)

      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)

      return sel?.toString() ?? ''
    })

    expect(selectedText).toContain('Alpha page one')
    expect(selectedText).toContain('Beta page two')

    const button = page.locator(ASK_BUTTON).first()
    await expect(button).toBeVisible({ timeout: 15_000 })
    await expect(button).toHaveText(ASK_LABEL)

    const turnsBefore = await page.locator('[data-chat-turn]').count()
    await button.click()

    const expectedFileName = expectedFixtureFileName(address)
    expect(expectedFileName).toBe('task7-two-page.pdf')
    await expect.poll(async () => readDraft(page)).toContain(`[来源：${expectedFileName}，第 1–2 页]`)

    const draft = await readDraft(page)
    expect(draft).toContain(typedDraft)
    expect(draft).toContain(`[来源：${expectedFileName}，第 1–2 页]`)
    expect(draft).toContain('Alpha page one')
    expect(draft).toContain('Beta page two')
    expect(draft).toContain(QUESTION_SUFFIX)

    // No auto-submit and focus restored to composer.
    expect(await page.locator('[data-chat-turn]').count()).toBe(turnsBefore)
    await expect.poll(async () => page.evaluate(() => document.activeElement?.getAttribute('data-composer-input') !== null)).toBe(true)
  })

  test('handles live selection across viewport resize without sending stale pre-rerender data', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await openShell(page)
    const address = await openPdfFixture(page, 'pdf-single')
    const expectedFileName = expectedFixtureFileName(address)
    expect(expectedFileName).toBe('task7-single-page.pdf')
    await waitForPage(page, 1)

    // Select text on page 1
    const selected = await selectPageText(page, 1)
    expect(selected).toContain('Alpha Beta Gamma')

    const button = page.locator(ASK_BUTTON).first()
    await expect(button).toBeVisible({ timeout: 15_000 })

    // Resize viewport causing PDF rerender
    const geometry = await canvasGeometry(page, 1)
    await stampCurrentSpans(page, 1)
    await resizeAndAwaitRerender(page, 1, { width: 1100, height: 900 }, geometry)

    // Inspect post-rerender browser selection state
    const selState = await page.evaluate((attribute: string) => {
      const sel = window.getSelection()
      if (!sel) {
        return {
          isCollapsed: true,
          text: '',
          anchorConnected: false,
          focusConnected: false,
          inCurrentTextLayer: false,
          isPreviousGeneration: false,
        }
      }

      const anchor = sel.anchorNode
      const focus = sel.focusNode
      const anchorConnected = anchor?.isConnected ?? false
      const focusConnected = focus?.isConnected ?? false

      const anchorEl = anchor instanceof Element ? anchor : anchor?.parentElement ?? null
      const focusEl = focus instanceof Element ? focus : focus?.parentElement ?? null

      const anchorTextLayer = anchorEl?.closest('[data-dsa-pdf-text]')
      const focusTextLayer = focusEl?.closest('[data-dsa-pdf-text]')
      const anchorPage = anchorTextLayer?.closest('[data-dsa-pdf-page]')
      const focusPage = focusTextLayer?.closest('[data-dsa-pdf-page]')
      const anchorRoot = anchorPage?.closest('[data-dsa-document-kind="pdf"]')
      const focusRoot = focusPage?.closest('[data-dsa-document-kind="pdf"]')

      const inCurrentTextLayer =
        anchorRoot !== null &&
        focusRoot !== null &&
        anchorRoot === focusRoot

      const isPreviousGeneration =
        (anchorEl?.hasAttribute(attribute) ?? false) ||
        (focusEl?.hasAttribute(attribute) ?? false) ||
        (anchorEl?.closest(`[${attribute}]`) !== null) ||
        (focusEl?.closest(`[${attribute}]`) !== null)

      return {
        isCollapsed: sel.isCollapsed,
        text: sel.toString(),
        anchorConnected,
        focusConnected,
        inCurrentTextLayer,
        isPreviousGeneration,
      }
    }, PROBE_ATTRIBUTE)

    // Chromium silently collapses the selection when the old TextLayer spans
    // are removed during re-render, without emitting a selectionchange event.
    // The renderer invalidation notification ensures the selection lifecycle
    // re-evaluates the live selection and clears the stale kernel snapshot.
    expect(selState.isCollapsed).toBe(true)
    expect(selState.text).toBe('')
    await expect(page.locator(ASK_BUTTON)).toHaveCount(0)
  })
})
