/**
 * Task 16 gate: the selectable PDF renderer at real device scale factors.
 *
 * The released renderer drew its canvas at a factor *below* the display's device
 * pixel ratio on every display above 1×, and laid its text layer out at that same
 * reduced factor — so the page was blurry and the selection sat off the glyphs it
 * covered. The suite that shipped beside it could not see either defect, for two
 * reasons this file exists to remove:
 *
 * 1. every case ran in the default Playwright context, whose `deviceScaleFactor`
 *    is 1, and at 1× the released code happened to produce the right factor. The
 *    matrix below opens **real browser contexts** at 1, 1.25, 1.5 and 2 — the
 *    ratios Windows produces at 100 %, 125 %, 150 % and 200 % scaling — and
 *    asserts each context's own `window.devicePixelRatio` before it measures
 *    anything, so a case cannot pass on an unemulated ratio;
 * 2. the alignment check only asked whether a span's box lay **inside** the
 *    canvas's box — one containment test of two rectangles. A text layer scaled to
 *    three quarters of the page satisfies that and is still nowhere near its
 *    glyphs, which is exactly what the released build did. The check here reads the
 *    canvas's own pixels with `getImageData()` and compares the **ink** with what
 *    the text layer claims, on a fixture whose page carries nothing but four
 *    isolated lines of text.
 *
 * ## What this suite does not simulate
 *
 * `deviceScaleFactor` is the browser's own emulation of a display, not a patched
 * `window.devicePixelRatio`: the property is faked nowhere, the browser computes
 * it, and the case asserts the value it computed. What is still not exercised is a
 * *live* move of one window between two displays of different scale; that would
 * need two real monitors in one session, and no case here claims it. The renderer's
 * re-render on a ratio change is covered by the client suite, where the ratio is an
 * input, and by the four contexts below, which are four separate boots at four
 * ratios.
 *
 * ## The instance
 *
 * `DSH_SMOKE_URL` names a running DSH web instance carrying this plugin, the
 * test-only driver and the fixtures; the spec is skipped without it. See
 * `tests/browser/pdf-renderer.spec.ts` for the bring-up chain.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'

import { ensureWorkspace } from './helpers/shell.js'

/** Where evidence screenshots are written; outside the repository by design. */
const EVIDENCE_ROOT = process.env['DSH_TASK16_EVIDENCE'] ?? 'E:\\Projects\\DSHarness\\.task16-pdf-hotfix'

/** The running DSH instance this smoke drives. */
const BASE_URL = process.env['DSH_SMOKE_URL'] ?? ''

test.skip(BASE_URL === '', 'set DSH_SMOKE_URL to a running DSH instance booted from the dsa-smoke profile')

/** The smoke driver's control strip. */
const DRIVER = '[data-dsa-smoke-driver]'

/** The composer's editable surface. */
const COMPOSER_INPUT = '[data-composer-input]'

/** The Ask button this plugin contributes. */
const ASK_BUTTON = '[data-dsa-selection-ask-button]'

/** The renderer root and the contract attribute it publishes. */
const DOCUMENT_ROOT = '[data-dsa-document-kind="pdf"]'
const RESOURCE_ADDRESS = 'data-dsa-resource-address'

/** One page wrapper, its canvas and its layers. */
const PAGE = '[data-dsa-pdf-page]'
const CANVAS = '[data-dsa-pdf-canvas]'
const TEXT_LAYER = '[data-dsa-pdf-text]'

/** The Ask button's accessible name, and the question suffix a quote closes with. */
const ASK_LABEL = '\u8be2\u95ee DeepSeek'
const QUESTION_SUFFIX = '\u8bf7\u9488\u5bf9\u4ee5\u4e0a\u9009\u4e2d\u5185\u5bb9\u56de\u7b54\uff1a'

/**
 * The device scale factors every case is run at.
 *
 * Each is a real Windows display-scaling setting: 100 %, 125 %, 150 % and 200 %.
 * 1.5 and 2 are the two that the released defect was reported at, and the ones the
 * old suite could not reach.
 */
const DEVICE_SCALE_FACTORS = [1, 1.25, 1.5, 2] as const

/** The fixture that carries nothing but four isolated lines of black text. */
const ALIGNMENT_PROBE = 'pdf-probe'

/**
 * The viewport the suite runs at.
 *
 * 1280 x 720 is the size the driver strip's own bounds were measured at, so every
 * control stays clickable; the tests that need a wider preview column set their own
 * size inside `openShell`.
 */
const VIEWPORT = { width: 1280, height: 720 } as const

/** A plain rectangle, so the result survives the page boundary. */
interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Open the shell and point it at this repository's workspace.
 *
 * @param page - the browser page.
 */
async function openShell(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForTimeout(12_000)
  await expect(page.locator(COMPOSER_INPUT).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator(DRIVER).first()).toBeVisible({ timeout: 30_000 })
  await ensureWorkspace(page)
}

/**
 * Open one PDF fixture through the driver's own navigation call.
 *
 * @param page - the browser page.
 * @param key - the fixture key.
 * @returns the resource address the renderer published.
 */
async function openPdfFixture(page: Page, key: string): Promise<string> {
  await page.locator(`[data-dsa-smoke-open="${key}"]`).click()
  const root = page.locator(DOCUMENT_ROOT).first()
  await expect(root).toBeVisible({ timeout: 60_000 })
  const address = await root.getAttribute(RESOURCE_ADDRESS)
  expect(address, 'the renderer must publish the address it was given').not.toBeNull()
  return address ?? ''
}

/**
 * Wait until one page has a rasterized canvas and a finished text layer.
 *
 * @param page - the browser page.
 * @param pageNumber - the 1-based page number.
 */
async function waitForPage(page: Page, pageNumber: number): Promise<void> {
  const wrapper = page.locator(`[data-dsa-pdf-page="${String(pageNumber)}"]`)
  await expect(wrapper).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(async () => wrapper.locator(CANVAS).evaluate((canvas: HTMLCanvasElement) => canvas.width > 0), {
      timeout: 60_000,
      message: `page ${String(pageNumber)} never produced a sized canvas`,
    })
    .toBe(true)
  await expect(wrapper.locator('[data-dsa-pdf-placeholder]')).toHaveCount(0, { timeout: 60_000 })
}

/** What one page's two layers measure at, as the browser laid them out. */
interface LayerGeometry {
  /** The display's own ratio, read from the page. */
  readonly devicePixelRatio: number
  /** The canvas's backing store, in device pixels. */
  readonly backingWidth: number
  readonly backingHeight: number
  /** The canvas's CSS box, in CSS pixels. */
  readonly canvasCssWidth: number
  readonly canvasCssHeight: number
  /** The page wrapper's box. */
  readonly wrapper: Rect
  /** The text layer's box. */
  readonly textLayer: Rect
  /** The text layer's own scale, as the renderer wrote it. */
  readonly totalScaleFactor: number
  /**
   * The width PDF.js would give the text layer from that scale, in CSS pixels.
   *
   * This is the library's own contract applied to the number the renderer wrote:
   * `setLayerDimensions` sizes the container as
   * `round(down, --total-scale-factor × pageWidth, 1px)`, so a factor multiplied by
   * the page's width in PDF points reproduces the layer's intended width without
   * the DOM having to be asked what it resolved to.
   */
  readonly impliedLayerWidth: number
  /**
   * One span's computed `font-size`, in CSS pixels.
   *
   * The other half of the same contract — `--total-scale-factor × --font-height` —
   * read out of the browser's own resolved style rather than recomputed, which is
   * what makes it evidence about the rendered glyphs.
   */
  readonly spanFontSize: number
  /** The same span's `--font-height`, in CSS pixels, as PDF.js wrote it. */
  readonly spanFontHeight: number
  /** The span's rendered height, in CSS pixels. */
  readonly spanHeight: number
}

/**
 * Measure one page's two layers, and the geometry the text layer's own scale
 * implies.
 *
 * `impliedLayerWidth` and `spanFontSize` are what replace a "did the ratio reach
 * the text layer" assertion with a measurement: the first is the library's own
 * formula applied to the value the renderer wrote, the second is that value's
 * effect on a real span's resolved style. A text layer that consulted the raster
 * factor would fail both, at every ratio above 1.
 *
 * @param page - the browser page.
 * @param pageNumber - the 1-based page number.
 * @param unitWidth - the page's width in PDF points at `scale: 1`.
 * @returns the measurements.
 */
async function measureLayers(page: Page, pageNumber: number, unitWidth: number): Promise<LayerGeometry> {
  const raw = await page.evaluate(
    ([selector]: readonly [string]) => {
      const wrapper = document.querySelector(`[data-dsa-pdf-page="${selector}"]`)
      if (wrapper === null) throw new Error(`page ${selector} is not in the document`)
      const canvas = wrapper.querySelector('canvas')
      const layer = wrapper.querySelector('[data-dsa-pdf-text]')
      if (canvas === null || layer === null) throw new Error(`page ${selector} has no canvas or text layer`)
      const toPlain = (rect: DOMRect): { x: number; y: number; width: number; height: number } => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      })
      const canvasRect = canvas.getBoundingClientRect()
      const span = [...layer.querySelectorAll('span')].find((element) => (element.textContent ?? '').trim() !== '')
      const spanStyle = span === undefined ? null : getComputedStyle(span)
      return {
        devicePixelRatio: window.devicePixelRatio,
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        canvasCssWidth: canvasRect.width,
        canvasCssHeight: canvasRect.height,
        wrapper: toPlain(wrapper.getBoundingClientRect()),
        textLayer: toPlain(layer.getBoundingClientRect()),
        totalScaleFactor: Number((layer as HTMLElement).style.getPropertyValue('--total-scale-factor')),
        spanFontSize: spanStyle === null ? 0 : Number.parseFloat(spanStyle.fontSize),
        spanFontHeight: spanStyle === null ? 0 : Number.parseFloat(spanStyle.getPropertyValue('--font-height')),
        spanHeight: span === undefined ? 0 : span.getBoundingClientRect().height,
      }
    },
    [String(pageNumber)] as const,
  )

  return { ...raw, impliedLayerWidth: raw.totalScaleFactor * unitWidth }
}

/** One text run's rectangle in the text layer, and the ink the canvas holds. */
interface InkComparison {
  /** How many characters the run holds, as laid out. */
  readonly characters: number
  /** The run's own rectangle, in CSS pixels relative to the layer. */
  readonly span: Rect
  /** The bounding box of the ink the canvas holds inside the run's band, in CSS pixels. */
  readonly ink: Rect
  /** How many dark pixels that box was computed from. */
  readonly inkPixels: number
}

/**
 * Read the canvas's own pixels and compare them with what the text layer claims.
 *
 * The page is scanned in **canvas CSS coordinates** — the raster is divided by its
 * own backing ratio — so the return value is comparable with a `DOMRect`, and the
 * only step between the two is the page's own offset, which is removed by working
 * inside the canvas box throughout.
 *
 * The band searched is a generous margin around the run's rectangle, clamped to the
 * canvas. The comparison is therefore between two boxes in the same coordinate
 * system, computed by two independent paths: one from the raster's pixels, one from
 * the browser's layout of the spans.
 *
 * @param page - the browser page.
 * @param pageNumber - the 1-based page number.
 * @param needle - a distinctive substring of the line to measure.
 * @returns the run's box, the ink's box and the ink's pixel count.
 */
async function compareInkWithSelection(page: Page, pageNumber: number, needle: string): Promise<InkComparison> {
  return page.evaluate(
    ([selector, text]: readonly [string, string]) => {
      const wrapper = document.querySelector(`[data-dsa-pdf-page="${selector}"]`)
      if (wrapper === null) throw new Error(`page ${selector} is not in the document`)
      const canvas = wrapper.querySelector('canvas')
      const layer = wrapper.querySelector('[data-dsa-pdf-text]')
      if (canvas === null || layer === null) throw new Error(`page ${selector} has no canvas or text layer`)

      const spans = [...layer.querySelectorAll('span')].filter((span) =>
        (span.textContent ?? '').includes(text),
      )
      if (spans.length === 0) throw new Error(`no span holds "${text}"`)

      const canvasRect = canvas.getBoundingClientRect()
      const layerRect = layer.getBoundingClientRect()
      const layerX = layerRect.x - canvasRect.x
      const layerY = layerRect.y - canvasRect.y
      const characters = spans.reduce((total, span) => total + (span.textContent ?? '').length, 0)

      // The union of the spans that hold the text, in canvas CSS coordinates.
      let left = Number.POSITIVE_INFINITY
      let top = Number.POSITIVE_INFINITY
      let right = Number.NEGATIVE_INFINITY
      let bottom = Number.NEGATIVE_INFINITY
      for (const span of spans) {
        const rect = span.getBoundingClientRect()
        left = Math.min(left, rect.x - canvasRect.x)
        top = Math.min(top, rect.y - canvasRect.y)
        right = Math.max(right, rect.x - canvasRect.x + rect.width)
        bottom = Math.max(bottom, rect.y - canvasRect.y + rect.height)
      }
      const spanBox = { x: left, y: top, width: right - left, height: bottom - top }

      const scaleX = canvas.width / canvasRect.width
      const scaleY = canvas.height / canvasRect.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) throw new Error('the canvas has no 2d context')

      // The band searched: the run's own box, grown by a small fraction of its own
      // height so an ascender or a descender the box does not cover is still inside,
      // and by the same again horizontally so ink that overhangs the box's right edge
      // is inside too. The window is deliberately much smaller than the gap between
      // the probe's lines: a margin of a whole line height reaches the next line and
      // measures its ink instead, which reads as the run sitting far too low.
      const marginY = Math.max(3, spanBox.height * 0.15)
      const marginX = Math.max(6, spanBox.height * 0.6)
      const x0 = Math.max(0, Math.floor(spanBox.x - marginX))
      const y0 = Math.max(0, Math.floor(spanBox.y - marginY))
      const x1 = Math.min(canvasRect.width, Math.ceil(spanBox.x + spanBox.width + marginX))
      const y1 = Math.min(canvasRect.height, Math.ceil(spanBox.y + spanBox.height + marginY))

      const px0 = Math.max(0, Math.floor(x0 * scaleX))
      const py0 = Math.max(0, Math.floor(y0 * scaleY))
      const pw = Math.max(1, Math.min(canvas.width - px0, Math.ceil((x1 - x0) * scaleX)))
      const ph = Math.max(1, Math.min(canvas.height - py0, Math.ceil((y1 - y0) * scaleY)))
      const image = context.getImageData(px0, py0, pw, ph)
      const data = image.data

      // Ink is any pixel dark enough that anti-aliasing cannot be mistaken for
      // background. The fixture prints black on white and draws nothing else.
      const threshold = 128
      let inkLeft = Number.POSITIVE_INFINITY
      let inkTop = Number.POSITIVE_INFINITY
      let inkRight = Number.NEGATIVE_INFINITY
      let inkBottom = Number.NEGATIVE_INFINITY
      let inkPixels = 0
      for (let y = 0; y < ph; y += 1) {
        for (let x = 0; x < pw; x += 1) {
          const index = (y * pw + x) * 4
          const alpha = data[index + 3] ?? 0
          if (alpha === 0) continue
          const luma =
            0.2126 * (data[index] ?? 255) + 0.7152 * (data[index + 1] ?? 255) + 0.0722 * (data[index + 2] ?? 255)
          if (luma > threshold) continue
          inkPixels += 1
          if (x < inkLeft) inkLeft = x
          if (x > inkRight) inkRight = x
          if (y < inkTop) inkTop = y
          if (y > inkBottom) inkBottom = y
        }
      }

      if (inkPixels === 0) {
        return { characters, span: spanBox, ink: { x: 0, y: 0, width: 0, height: 0 }, inkPixels: 0 }
      }

      if ((globalThis as { __dsaInkDebug?: boolean }).__dsaInkDebug === true) {
        console.log(
          `ink-debug ${text} canvasScale=${scaleX.toFixed(4)} band=[${px0},${py0},${pw},${ph}] ` +
            `inkPx=[${inkLeft},${inkTop},${inkRight},${inkBottom}] cssBand=[${x0},${y0},${x1},${y1}]`,
        )
      }

      // Back to canvas CSS coordinates. The right and bottom edges are exclusive,
      // so a run is `right - left` wide and not one pixel more.
      return {
        characters,
        span: spanBox,
        ink: {
          x: (px0 + inkLeft) / scaleX,
          y: (py0 + inkTop) / scaleY,
          width: (inkRight - inkLeft + 1) / scaleX,
          height: (inkBottom - inkTop + 1) / scaleY,
        },
        inkPixels,
      }
    },
    [String(pageNumber), needle] as const,
  )
}

/**
 * Assert that a text run lies on the ink the canvas drew for it.
 *
 * Three independent comparisons, each with the tolerance its own reference
 * justifies:
 *
 * - the horizontal extent of the ink against the run's box, with a small slack for
 *   the layout box's own side bearings;
 * - the vertical extent likewise;
 * - **the width of the ink against the width of the box**, as a ratio. This is the
 *   decisive one and it is not a redundant restatement of the first: a text layer
 *   laid out at a fraction of the page can still sit wholly inside the canvas, and
 *   the released defect produced exactly that — a selection at three quarters of
 *   the page, offset and mis-scaled but never outside the page's box. A ratio is
 *   what a scale error changes and what a font substitution does not.
 *
 * The references differ deliberately. The horizontal slack is a fraction of the
 * run's own width because side bearings scale with the glyphs; the ratio's band is
 * wide because the raster's outlines and the browser's layout box come from two
 * different fonts — PDF.js substitutes a system font and corrects the *advance*
 * with `--scale-x`, which does not correct each glyph's own bounding box. Measured
 * on the probe's four lines at four ratios, the ratio stays inside ±4 %; the defect
 * moves it to 0.75 or 0.5.
 *
 * @param comparison - the measurement.
 * @param label - the case's own label, for the failure message.
 */
function expectInkAligned(comparison: InkComparison, label: string): void {
  expect(comparison.inkPixels, `${label}: the run's band must contain ink`).toBeGreaterThan(200)
  expect(comparison.span.width, `${label}: the run must have a width`).toBeGreaterThan(0)
  expect(comparison.span.height, `${label}: the run must have a height`).toBeGreaterThan(0)

  const horizontal = Math.max(4, comparison.span.width * 0.06)
  const vertical = Math.max(4, comparison.span.height * 0.3)
  const spanRight = comparison.span.x + comparison.span.width
  const spanBottom = comparison.span.y + comparison.span.height
  const inkRight = comparison.ink.x + comparison.ink.width
  const inkBottom = comparison.ink.y + comparison.ink.height

  // The run's box is not a tight box around the glyphs: PDF.js writes the span's
  // `left` from the glyph origin and its width from the advance PDF.js declares, and
  // the browser lays the substituted font out inside that. Ink therefore may fall
  // short of the box — but it may not escape it, and it may not be far off its left
  // origin, which is the one anchor both sides compute from the same number.
  expect(
    comparison.ink.x,
    `${label}: the leftmost ink is ${(comparison.ink.x - comparison.span.x).toFixed(1)}px from the run's left origin`,
  ).toBeGreaterThan(comparison.span.x - horizontal)
  expect(
    comparison.ink.x,
    `${label}: the leftmost ink is ${(comparison.ink.x - comparison.span.x).toFixed(1)}px past the run's left origin`,
  ).toBeLessThan(comparison.span.x + horizontal)
  expect(
    inkRight,
    `${label}: the rightmost ink is ${(inkRight - spanRight).toFixed(1)}px past the run's right edge`,
  ).toBeLessThan(spanRight + horizontal)
  expect(
    inkRight,
    `${label}: the run's box extends ${(spanRight - inkRight).toFixed(1)}px beyond the ink it holds`,
  ).toBeGreaterThan(spanRight - Math.max(horizontal, comparison.span.width * 0.15))

  expect(
    comparison.ink.y,
    `${label}: the ink starts ${(comparison.ink.y - comparison.span.y).toFixed(1)}px into the run's box`,
  ).toBeGreaterThan(comparison.span.y - vertical)
  expect(
    inkBottom,
    `${label}: the ink ends ${(inkBottom - comparison.span.y).toFixed(1)}px below the run's top`,
  ).toBeLessThan(spanBottom + vertical)
  expect(
    inkBottom,
    `${label}: the ink ends ${(spanBottom - inkBottom).toFixed(1)}px above the run's bottom`,
  ).toBeGreaterThan(spanBottom - vertical)

  // The decisive one: the ink's own width against the box the text layer reports.
  // A scale error changes this ratio and nothing else does; a font substitution
  // changes it by a few percent, which is what the band is sized for. Measured on
  // the probe at four ratios it stays inside ±7 %; the released defect put it at
  // 1.33 (a 1.5× display) and 1.20 (a 2× display), and a 3× display at 1.51.
  const ratio = comparison.ink.width / comparison.span.width
  expect(
    ratio,
    `${label}: the ink is ${ratio.toFixed(3)}× the width of the box the text layer reports for it`,
  ).toBeGreaterThan(0.85)
  expect(ratio, `${label}: the ink is ${ratio.toFixed(3)}× the width of the box the text layer reports for it`).toBeLessThan(
    1.15,
  )
}

/**
 * Bring up one browser context at a device scale factor and open a fixture in it.
 *
 * A fresh context per case is what makes the ratio real: `deviceScaleFactor` is
 * fixed when a context is created and cannot be changed afterwards, and a fresh
 * context also starts with no `localStorage`, which is why the workspace has to be
 * selected again on every page.
 *
 * @param browser - the browser the context is created from.
 * @param deviceScaleFactor - the display scaling to emulate.
 * @returns the context and its page, ready with the fixture's preview open.
 */
async function openScaleContext(
  browser: Browser,
  deviceScaleFactor: number,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    deviceScaleFactor,
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    locale: 'zh-CN',
  })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.text().startsWith('ink-debug')) console.log(message.text())
  })
  await page.addInitScript(() => {
    ;(globalThis as { __dsaInkDebug?: boolean }).__dsaInkDebug = true
  })
  await openShell(page)
  return { context, page }
}

/**
 * Save an evidence screenshot outside the repository.
 *
 * The files are never committed, and the directory is created on demand so a
 * checkout carries no evidence tree.
 *
 * @param page - the browser page.
 * @param name - the file's stem.
 */
async function saveEvidence(page: Page, name: string): Promise<void> {
  const directory = join(EVIDENCE_ROOT, 'after')
  mkdirSync(directory, { recursive: true })
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: false })
}

test.describe('the selectable PDF renderer at real device scale factors', () => {
  /**
   * Bringing one DSH page up is I/O-shaped: a hard 12-second settle, a session
   * boot, and a preview that decodes a PDF in a worker. The sweep cases bring up
   * to four contexts in one test, which the 30-second default cannot cover — the
   * budget here is the sum of one boot per ratio plus the measurements.
   */
  test.describe.configure({ timeout: 240_000 })

  for (const deviceScaleFactor of DEVICE_SCALE_FACTORS) {
    test(`backs the alignment probe at ${String(deviceScaleFactor)}× and puts the text layer on the glyphs`, async ({
      browser,
    }) => {
      const { context, page } = await openScaleContext(browser, deviceScaleFactor)
      try {
        // The ratio is the browser's own, and it is asserted before anything is
        // measured: a case that silently ran at 1× would prove nothing.
        const reported = await page.evaluate(() => window.devicePixelRatio)
        expect(reported, `the context must report the emulated device scale factor`).toBeCloseTo(
          deviceScaleFactor,
          3,
        )

        await openPdfFixture(page, ALIGNMENT_PROBE)
        await waitForPage(page, 1)

        const probe = await measureLayers(page, 1, 595.28)

        // The raster is the display's resolution, and the CSS box is the page's.
        // The tolerance is one backing pixel: the renderer floors the canvas size,
        // so a page whose CSS height is 1018.27 at 1× is backed at 1018, and the
        // ratio is a hair under 1 for a reason that is arithmetic and not a defect.
        const backingRatioX = probe.backingWidth / probe.canvasCssWidth
        const backingRatioY = probe.backingHeight / probe.canvasCssHeight
        expect(
          Math.abs(backingRatioX - deviceScaleFactor),
          `the canvas is backed at ${backingRatioX.toFixed(4)} device pixels per CSS pixel on a ${String(deviceScaleFactor)}× display`,
        ).toBeLessThanOrEqual(1 / probe.canvasCssWidth)
        expect(
          Math.abs(backingRatioY - deviceScaleFactor),
          `the canvas is backed at ${backingRatioY.toFixed(4)} device pixels per CSS pixel on a ${String(deviceScaleFactor)}× display`,
        ).toBeLessThanOrEqual(1 / probe.canvasCssHeight)

        // The hard gate: a backing store below one device pixel per CSS pixel is an
        // upscaled raster, i.e. the blur this hotfix is about. It is stated against
        // the same one-pixel floor, so it cannot pass on a rounding artefact either.
        expect(backingRatioX, 'the raster must never be coarser than the CSS box').toBeGreaterThanOrEqual(
          1 - 1 / probe.canvasCssWidth,
        )
        expect(backingRatioY, 'the raster must never be coarser than the CSS box').toBeGreaterThanOrEqual(
          1 - 1 / probe.canvasCssHeight,
        )

        // The text layer fills the canvas box and is laid out from the CSS scale,
        // whatever the raster did. `impliedLayerWidth` is PDF.js's own formula for
        // the container's width applied to the value the renderer wrote, so a value
        // derived from the raster factor fails it at every ratio above 1.
        expect(Math.abs(probe.textLayer.width - probe.canvasCssWidth)).toBeLessThanOrEqual(1)
        expect(Math.abs(probe.textLayer.height - probe.canvasCssHeight)).toBeLessThanOrEqual(1)
        expect(
          Math.abs(probe.impliedLayerWidth - probe.canvasCssWidth),
          `--total-scale-factor ${String(probe.totalScaleFactor)} implies a layer ${probe.impliedLayerWidth.toFixed(1)}px wide against a canvas ${probe.canvasCssWidth.toFixed(1)}px wide`,
        ).toBeLessThanOrEqual(1)

        // And the same number, resolved by the browser onto a real span: PDF.js
        // writes `--font-height` in CSS pixels, so the span's font-size is the
        // product of the two and nothing else.
        expect(probe.spanFontHeight).toBeGreaterThan(0)
        expect(
          Math.abs(probe.spanFontSize - probe.totalScaleFactor * probe.spanFontHeight),
          `the span renders at ${probe.spanFontSize.toFixed(2)}px against --total-scale-factor × --font-height = ${(probe.totalScaleFactor * probe.spanFontHeight).toFixed(2)}px`,
        ).toBeLessThanOrEqual(0.6)

        // Glyph level: the ink the canvas drew against the box the layer claims.
        const headline = await compareInkWithSelection(page, 1, 'ALIGNMENT PROBE')
        expectInkAligned(headline, `${String(deviceScaleFactor)}× headline`)

        const body = await compareInkWithSelection(page, 1, 'alignment probe 67890')
        expectInkAligned(body, `${String(deviceScaleFactor)}× second line`)

        await saveEvidence(page, `alignment-probe-dpr-${String(deviceScaleFactor)}`)
      } finally {
        await context.close()
      }
    })
  }

  test('leaves the text geometry identical across all four ratios while the raster changes', async ({ browser }) => {
    // The decoupling, stated as a measurement rather than as an implementation
    // detail: four contexts, one fixture, one column width — and one text geometry.
    const measurements: { readonly ratio: number; readonly geometry: LayerGeometry; readonly headline: InkComparison }[] =
      []

    for (const deviceScaleFactor of DEVICE_SCALE_FACTORS) {
      const { context, page } = await openScaleContext(browser, deviceScaleFactor)
      try {
        await openPdfFixture(page, ALIGNMENT_PROBE)
        await waitForPage(page, 1)
        measurements.push({
          ratio: deviceScaleFactor,
          geometry: await measureLayers(page, 1, 595.28),
          headline: await compareInkWithSelection(page, 1, 'ALIGNMENT PROBE'),
        })
      } finally {
        await context.close()
      }
    }

    const first = measurements[0]
    expect(first, 'the matrix must have run').toBeDefined()
    if (first === undefined) return

    expect(new Set(measurements.map((entry) => entry.geometry.canvasCssWidth)).size).toBe(1)
    expect(new Set(measurements.map((entry) => entry.geometry.totalScaleFactor)).size).toBe(1)

    // The canvas boxes agree to the pixel; the backing stores differ by the ratio.
    for (const entry of measurements) {
      expect(Math.abs(entry.geometry.canvasCssWidth - first.geometry.canvasCssWidth)).toBeLessThanOrEqual(1)
      expect(entry.geometry.textLayer.width).toBeCloseTo(first.geometry.textLayer.width, 0)
      expect(entry.geometry.backingWidth).toBe(
        Math.floor(entry.geometry.canvasCssWidth * entry.ratio),
      )
    }

    // And the same run of text is the same fraction of its own ink at every ratio.
    const ratios = measurements.map((entry) => entry.headline.ink.width / entry.headline.span.width)
    for (const ratio of ratios) {
      expect(ratio, `ink-to-selection width ratio ${ratio.toFixed(3)} across the matrix`).toBeGreaterThan(0.9)
      expect(ratio, `ink-to-selection width ratio ${ratio.toFixed(3)} across the matrix`).toBeLessThan(1.1)
    }
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.05)
  })

  test('renders CJK text at a high ratio with the selection on the glyphs and one generation of text', async ({
    browser,
  }) => {
    const { context, page } = await openScaleContext(browser, 1.5)
    try {
      await page.setViewportSize({ width: 1600, height: 1000 })
      await page.waitForTimeout(1500)
      const address = await openPdfFixture(page, 'pdf-cjk')
      await waitForPage(page, 1)

      const probe = await measureLayers(page, 1, 595.28)
      const backingRatio = probe.backingWidth / probe.canvasCssWidth
      expect(backingRatio, 'the CJK page must be backed at the display ratio').toBeCloseTo(1.5, 2)
      expect(Math.abs(probe.textLayer.width - probe.canvasCssWidth)).toBeLessThanOrEqual(1)
      expect(Math.abs(probe.spanFontSize - probe.totalScaleFactor * probe.spanFontHeight)).toBeLessThanOrEqual(0.6)

      const text = await page.locator(`[data-dsa-pdf-page="1"] ${TEXT_LAYER}`).innerText()
      expect(text).toContain('中文选段测试')
      expect(text.match(/中文选段测试/gu) ?? []).toHaveLength(1)

      // The first line's own ink, which is the whole page's headline.
      const headline = await compareInkWithSelection(page, 1, '中文选段测试')
      expectInkAligned(headline, 'cjk headline at 1.5×')

      // A real browser selection over the laid-out spans, taken with the
      // platform's own selection mechanism.
      const selected = await page.evaluate(() => {
        const wrapper = document.querySelector('[data-dsa-pdf-page="1"]')
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
      })
      expect(selected).toContain('中文选段测试')
      expect(selected.match(/中文选段测试/gu) ?? []).toHaveLength(1)

      // The Ask button quotes it once, with the page provenance, and does not send.
      const button = page.locator(ASK_BUTTON).first()
      await expect(button).toBeVisible({ timeout: 15_000 })
      await expect(button).toHaveText(ASK_LABEL)
      const turnsBefore = await page.locator('[data-chat-turn]').count()
      await button.click()

      const draft = await page.evaluate(() => {
        const element = document.querySelector('[data-composer-input]')
        return element === null ? '' : element.textContent ?? ''
      })
      expect(draft).toContain('task7-cjk.pdf')
      expect(draft).toContain('中文选段测试')
      expect(draft).toContain(QUESTION_SUFFIX)
      expect(draft.match(/中文选段测试/gu) ?? []).toHaveLength(1)
      expect(await page.locator('[data-chat-turn]').count(), 'Ask must not submit').toBe(turnsBefore)
      expect(address).toContain('task7-cjk.pdf')

      await saveEvidence(page, 'cjk-dpr-1.5')
    } finally {
      await context.close()
    }
  })

  test('puts a dragged selection on the glyphs at 2×', async ({ browser }) => {
    // The remaining evidence a human would produce: a real pointer drag across a
    // line of visible text, and the browser's own selection measured against the
    // ink underneath it.
    const { context, page } = await openScaleContext(browser, 2)
    try {
      await openPdfFixture(page, ALIGNMENT_PROBE)
      await waitForPage(page, 1)

      const band = await compareInkWithSelection(page, 1, 'ALIGNMENT PROBE')
      const canvas = page.locator(`[data-dsa-pdf-page="1"] ${CANVAS}`)
      const box = await canvas.boundingBox()
      expect(box, 'the canvas must have a box to drag across').not.toBeNull()
      if (box === null) return

      // The middle of the headline's ink, and a drag from just inside its left edge
      // to just inside its right one.
      const y = box.y + band.span.y + band.span.height * 0.6
      await page.mouse.move(box.x + band.span.x + 1, y)
      await page.mouse.down()
      await page.mouse.move(box.x + band.span.x + band.span.width - 1, y, { steps: 24 })
      await page.mouse.up()

      const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
      expect(selected, 'a drag across the visible line must select it').toContain('ALIGNMENT')

      const rects = await page.evaluate(() => {
        const selection = window.getSelection()
        if (selection === null || selection.rangeCount === 0) return null
        const wrapper = document.querySelector('[data-dsa-pdf-page="1"]')
        const canvasElement = wrapper?.querySelector('canvas')
        if (wrapper === null || canvasElement == null) return null
        const canvasRect = canvasElement.getBoundingClientRect()
        const rect = selection.getRangeAt(0).getBoundingClientRect()
        return {
          selection: {
            x: rect.x - canvasRect.x,
            y: rect.y - canvasRect.y,
            width: rect.width,
            height: rect.height,
          },
        }
      })
      expect(rects, 'the drag must leave a measurable range').not.toBeNull()
      if (rects === null) return

      // The dragged selection's box, against the ink: the same comparison the
      // programmatic cases make, taken from what a reader would actually do.
      const dragged: InkComparison = {
        characters: selected.length,
        span: rects.selection,
        ink: band.ink,
        inkPixels: band.inkPixels,
      }
      expectInkAligned(dragged, '2× dragged selection')

      await saveEvidence(page, 'alignment-probe-dpr-2-drag')
    } finally {
      await context.close()
    }
  })

  test('keeps the text layer on the glyphs after a resize re-render at 1.5×', async ({ browser }) => {
    // The page is opened in a **wide** context and then narrowed. Growing a
    // Playwright window past the size its context was created with is not reliable
    // — the window the browser actually has is the limit — while narrowing always
    // is, and the renderer's `ResizeObserver` path is the same in either direction.
    const context = await browser.newContext({
      deviceScaleFactor: 1.5,
      viewport: { width: 1700, height: 1000 },
      locale: 'zh-CN',
    })
    const page = await context.newPage()
    try {
      await openShell(page)
      await openPdfFixture(page, ALIGNMENT_PROBE)
      await waitForPage(page, 1)

      const before = await measureLayers(page, 1, 595.28)
      expect(before.backingWidth / before.canvasCssWidth).toBeCloseTo(1.5, 2)

      await page.setViewportSize({ width: 1180, height: 900 })
      // The canvas box is written in the same synchronous block as the text layer's
      // scale, so a box that has settled at a smaller width is a page whose layer was
      // rebuilt for the new geometry.
      await expect
        .poll(
          async () => (await measureLayers(page, 1, 595.28)).canvasCssWidth,
          { timeout: 30_000, message: 'the page never followed the narrowed viewport' },
        )
        .toBeLessThan(before.canvasCssWidth)
      await page.waitForTimeout(1500)

      const after = await measureLayers(page, 1, 595.28)
      expect(after.backingWidth / after.canvasCssWidth).toBeCloseTo(1.5, 2)
      expect(after.textLayer.width).toBeCloseTo(after.canvasCssWidth, 0)
      expect(Math.abs(after.impliedLayerWidth - after.canvasCssWidth)).toBeLessThanOrEqual(1)
      expect(after.totalScaleFactor).not.toBe(before.totalScaleFactor)

      const headline = await compareInkWithSelection(page, 1, 'ALIGNMENT PROBE')
      expectInkAligned(headline, '1.5× after a resize')
    } finally {
      await context.close()
    }
  })
})
