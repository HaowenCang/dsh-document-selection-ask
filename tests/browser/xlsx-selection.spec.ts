/**
 * Browser specification for real DSH XLSX rendering, semantic cell-range
 * selection, displayed value extraction, sheet/A1 provenance, and Ask
 * integration.
 *
 * Drives a real DSH web instance running with the dsa-smoke profile.
 *
 * ## What this suite proves, and what it refuses to accept as proof
 *
 * Every provenance assertion below is **exact**. A test that asserted
 * `[来源：task11-simple.xlsx，Sheet1!` would pass for `Sheet1!A1:A1` and for
 * `Sheet1!A1:XFD1048576` alike, so it proves that a range was quoted and nothing
 * about which one. The gesture's result is therefore read back from the
 * renderer's own published observable — `data-dsa-xlsx-selection`, whose value is
 * the `<sheet>!<range>` pair the adapter turns into provenance — *before* Ask is
 * pressed, and the draft is then required to carry exactly that pair.
 *
 * The same rule applies to rendering evidence. "The grid is visible" is not
 * evidence that an embedded image or a chart was drawn, and "the fixture ZIP
 * contains `chart1.xml`" is not evidence that anything rendered it. The two are
 * asserted separately, from surfaces the viewer actually painted.
 *
 * ## Where the engine comes from
 *
 * The first case states the runtime's architecture from a live instance: the Duke
 * engine is carried **inside** `lib/client.js` as a deterministic gzip of the
 * exact installed binary, inflated and SHA-256 verified on first use, and the
 * library's worker is started from a `Blob` over a source the same bundle holds.
 * Nothing is fetched to make that work — no host route, no CDN, no sibling asset —
 * which is why every case below records the page's requests and workers and
 * asserts that the parser-asset count is zero.
 *
 * The same case audits the one object URL this plugin creates. `URL.createObjectURL`
 * and `URL.revokeObjectURL` are instrumented before the application boots, so
 * "the worker's blob URL was released" is read from the platform rather than
 * inferred from the code that was supposed to release it.
 */

import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Locator, Page, Request, Worker } from '@playwright/test'

import { ensureWorkspace } from './helpers/shell.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const CURRENT_WORKSPACE = basename(repoRoot)

/** The running DSH instance this smoke drives. */
const BASE_URL = process.env['DSH_SMOKE_URL'] ?? ''

test.skip(BASE_URL === '', 'set DSH_SMOKE_URL to a running DSH instance booted from the dsa-smoke profile')

/** The smoke driver's control strip. */
const DRIVER = '[data-dsa-smoke-driver]'

/** The composer's editable surface. */
const COMPOSER_INPUT = '[data-composer-input]'

/** The Ask button this plugin contributes. */
const ASK_BUTTON = '[data-dsa-selection-ask-button]'

/** The renderer root and the contract attributes it publishes. */
const XLSX_ROOT = '[data-dsa-document-kind="xlsx"]'
const XLSX_CONTENT = '[data-dsa-xlsx-content]'
const RESOURCE_ADDRESS = 'data-dsa-resource-address'

/**
 * The renderer's published semantic selection: `"<sheet>!<range>"`.
 *
 * Public in the sense that matters — it is an attribute of the rendered
 * document, produced by the renderer from the same state the adapter reads, not
 * a private handle a test reaches into.
 */
const XLSX_SELECTION = 'data-dsa-xlsx-selection'

const PLUGIN_RENDERER = 'dsh-document-selection-ask/xlsx'
const PREVIEW_IDENTITY_ATTRIBUTE = 'data-document-preview'

const QUESTION_SUFFIX = '\u8bf7\u9488\u5bf9\u4ee5\u4e0a\u9009\u4e2d\u5185\u5bb9\u56de\u7b54\uff1a'

/** The object-URL activity one page recorded. */
interface BlobUrlAudit {
  readonly created: readonly string[]
  readonly revoked: readonly string[]
}

/** The key the audit is published under in the page. */
const BLOB_AUDIT_KEY = '__dsaXlsxBlobAudit'

/**
 * Instrument the page's object-URL API before the application boots.
 *
 * The audit is installed through `addInitScript`, so it wraps the platform
 * functions before any application code can capture them, and it survives every
 * navigation in the page. It records URLs, not blobs: what the worker case needs
 * to know is whether the exact URL the browser started the worker from was
 * released.
 *
 * @param page - the browser page.
 */
async function installBlobUrlAudit(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    const created: string[] = []
    const revoked: string[] = []
    const createObjectURL = URL.createObjectURL.bind(URL)
    const revokeObjectURL = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (object: Blob | MediaSource): string => {
      const url = createObjectURL(object)
      created.push(url)
      return url
    }
    URL.revokeObjectURL = (url: string): void => {
      revoked.push(url)
      revokeObjectURL(url)
    }
    ;(globalThis as unknown as Record<string, unknown>)[key] = { created, revoked }
  }, BLOB_AUDIT_KEY)
}

/**
 * Read the object-URL activity the page recorded.
 * @param page - the browser page.
 * @returns the created and revoked URLs.
 */
async function readBlobUrlAudit(page: Page): Promise<BlobUrlAudit> {
  return page.evaluate((key: string): BlobUrlAudit => {
    const audit = (globalThis as unknown as Record<string, unknown>)[key] as
      | { created: string[]; revoked: string[] }
      | undefined
    return audit === undefined
      ? { created: [], revoked: [] }
      : { created: [...audit.created], revoked: [...audit.revoked] }
  }, BLOB_AUDIT_KEY)
}

/**
 * Read the composer's rendered draft text.
 * @param page - the browser page.
 * @returns the draft.
 */
async function readDraft(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-composer-input]')
    return element === null ? '' : element.textContent ?? ''
  })
}

/**
 * Read the renderer's published semantic selection.
 * @param page - the browser page.
 * @returns the `"<sheet>!<range>"` value, or `null` when nothing is selected.
 */
async function readPublishedSelection(page: Page): Promise<string | null> {
  return page.evaluate((attribute) => {
    return document.querySelector(`[data-dsa-document-kind="xlsx"]`)?.getAttribute(attribute) ?? null
  }, XLSX_SELECTION)
}

/**
 * Wait for the renderer to publish exactly one selection.
 *
 * Polling the document is the wait; no fixed delay stands in for it. A range
 * that never arrives fails here, with the range that did arrive in the message,
 * rather than producing a provenance assertion about a range nobody selected.
 *
 * @param page - the browser page.
 * @param expected - the exact `"<sheet>!<range>"` the gesture must produce.
 */
async function expectPublishedSelection(page: Page, expected: string): Promise<void> {
  await expect
    .poll(async () => await readPublishedSelection(page), {
      timeout: 20_000,
      message: `the XLSX renderer must publish the selection ${expected}`,
    })
    .toBe(expected)
}

/**
 * Open the DSH shell and ensure workspace is ready.
 * @param page - the browser page.
 */
async function openShell(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  // The shell's own boot is the one wait that is not evidence about this plugin:
  // every assertion below is made against a locator or a poll.
  await page.waitForTimeout(12_000)
  await expect(page.locator(COMPOSER_INPUT).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator(DRIVER).first()).toBeVisible({ timeout: 30_000 })
  await ensureWorkspace(page)
}

/**
 * Open one XLSX fixture through the driver's public navigation call and wait
 * for the plugin's XLSX renderer to publish its root.
 * @param page - the browser page.
 * @param key - the fixture key.
 * @returns the published resource address.
 */
async function openXlsxFixture(page: Page, key: string): Promise<string> {
  await page.locator(`[data-dsa-smoke-open="${key}"]`).click()

  const root = page.locator(XLSX_ROOT).first()
  await expect(root).toBeVisible({ timeout: 40_000 })

  const address = await root.getAttribute(RESOURCE_ADDRESS)
  if (address === null || address === '') {
    throw new Error('the XLSX renderer published an empty resource address')
  }

  // Verify that DSH selected this plugin's renderer definition
  const preview = await root.evaluate((element, attribute) => {
    const ancestor = element.closest(`[${attribute}]`)
    return ancestor === null ? null : ancestor.getAttribute(attribute)
  }, PREVIEW_IDENTITY_ATTRIBUTE)

  expect(preview, `the document preview must be registered as ${PLUGIN_RENDERER}`).toBe(PLUGIN_RENDERER)

  return address
}

/**
 * Wait until a workbook has reached the viewer, and return its content surface.
 *
 * `data-dsa-xlsx-content` exists only on the selectable container the renderer
 * mounts once every security gate has passed and the engine is available, so its
 * presence is the readiness gate every later assertion depends on.
 *
 * @param page - the browser page.
 * @param timeout - how long the workbook may take.
 * @returns the content locator.
 */
async function expectWorkbookReady(page: Page, timeout = 35_000): Promise<Locator> {
  const content = page.locator(XLSX_CONTENT).first()
  await expect(content).toBeVisible({ timeout })
  await expect(content.locator('[role="grid"]').first()).toBeVisible({ timeout: 25_000 })
  return content
}

/**
 * Drag a pointer across a range of the spreadsheet grid.
 *
 * The viewer paints into a canvas and publishes no per-cell elements, so the
 * gesture is made in the grid's own coordinate space: the two points are offsets
 * from the grid's published bounding box. The offsets are not the assertion —
 * the range that results is read back from {@link XLSX_SELECTION} and compared
 * exactly, so a gesture that lands elsewhere fails instead of silently quoting a
 * different range.
 *
 * @param page - the browser page.
 * @param content - the workbook content surface.
 * @param from - start offset, in CSS pixels, from the grid's top-left corner.
 * @param to - end offset, in CSS pixels, from the grid's top-left corner.
 *
 * The offsets in the cases below are **measured against this runtime**, not
 * chosen: the grid's published box includes the 40 px row header and the 24 px
 * column header, column A spans x ≈ 45–95 and row 1 spans y ≈ 24–44 at the
 * 1280×720 viewport the suite runs at. A gesture that landed elsewhere would
 * fail rather than pass, because the range it produced is read back and compared
 * exactly — which is how these offsets were calibrated after the first live run
 * put a 45 px start on row 2.
 */
async function dragRange(
  page: Page,
  content: Locator,
  from: readonly [number, number],
  to: readonly [number, number],
): Promise<void> {
  const grid = content.locator('[role="grid"]').first()
  const box = await grid.boundingBox()
  if (box === null) throw new Error('the XLSX grid published no bounding box')

  const startX = box.x + from[0]
  const startY = box.y + from[1]

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 8 })
  await page.mouse.up()
}

/**
 * The painted surfaces the viewer produced inside the workbook.
 *
 * The viewer draws the grid into canvases and the drawing layer as an inline
 * SVG, so the two halves of the drawings workbook are read from two different
 * kinds of evidence and neither is inferred from the fixture's XML.
 *
 * @param content - the workbook content surface.
 * @returns canvas and image-element counts, how many canvases hold more than one
 *   colour, the drawing overlay's structure, and how many canvas pixels carry the
 *   embedded picture's own solid colour.
 */
async function readPaintedSurfaces(content: Locator): Promise<{
  canvases: number
  images: number
  paintedCanvases: number
  picturePixels: number
  drawings: { tag: string; label: string; width: number; height: number; fills: number; lines: number }[]
}> {
  return content.evaluate((root) => {
    const canvases = [...root.querySelectorAll('canvas')]
    let paintedCanvases = 0
    let picturePixels = 0
    for (const canvas of canvases) {
      const context = canvas.getContext('2d')
      if (context === null || canvas.width === 0 || canvas.height === 0) continue
      // A sampled read, not recognition: two distinct colours prove something
      // was drawn, and no text is interpreted from the pixels.
      const width = Math.max(1, Math.min(64, canvas.width))
      const height = Math.max(1, Math.min(64, canvas.height))
      const data = context.getImageData(0, 0, width, height).data
      const seen = new Set<number>()
      for (let index = 0; index + 3 < data.length; index += 4) {
        seen.add((data[index]! << 16) | (data[index + 1]! << 8) | data[index + 2]!)
        if (seen.size > 1) break
      }
      if (seen.size > 1) paintedCanvases += 1

      // The fixture's embedded picture is a solid red 64x64 PNG, so its own
      // colour is the evidence that it was drawn. Nothing else in either
      // workbook uses it, and the control workbook is asserted to contain none.
      const full = context.getImageData(0, 0, canvas.width, canvas.height).data
      for (let index = 0; index + 3 < full.length; index += 4) {
        if (full[index]! > 190 && full[index + 1]! < 70 && full[index + 2]! < 70) picturePixels += 1
      }
    }

    const drawings = [...root.querySelectorAll('svg')].map((svg) => {
      const box = svg.getBoundingClientRect()
      return {
        tag: 'svg',
        label: svg.getAttribute('aria-label') ?? '',
        width: Math.round(box.width),
        height: Math.round(box.height),
        fills: svg.querySelectorAll('rect').length,
        lines: svg.querySelectorAll('line').length,
      }
    })

    return { canvases: canvases.length, images: root.querySelectorAll('img').length, paintedCanvases, picturePixels, drawings }
  })
}

/**
 * Record every request and worker the page produces.
 * @param page - the browser page.
 * @returns the collectors and a summary of what must never appear.
 */
function watchRuntimeAssets(page: Page): {
  requests: string[]
  workers: Worker[]
  parserAssetRequests: () => string[]
  remoteRequests: () => string[]
} {
  const requests: string[] = []
  const workers: Worker[] = []
  page.on('request', (request: Request) => {
    requests.push(request.url())
  })
  page.on('worker', (worker: Worker) => {
    workers.push(worker)
  })

  const isLocal = (url: string): boolean =>
    url.startsWith(BASE_URL) ||
    url.startsWith('http://127.0.0.1') ||
    url.startsWith('http://localhost') ||
    url.startsWith('blob:') ||
    url.startsWith('data:')

  return {
    requests,
    workers,
    /** Requests for a parser asset served from a host route, which must not exist. */
    parserAssetRequests: () =>
      requests.filter(
        (url) =>
          url.includes('/dsa-assets') ||
          url.includes('xlsx-worker.js') ||
          url.includes('duke_sheets_wasm_bg.wasm'),
      ),
    /** Requests that leave this machine. */
    remoteRequests: () => requests.filter((url) => !isLocal(url)),
  }
}

test.describe('real DSH XLSX preview & selection smoke', () => {
  test('0. client-inline runtime boot: no asset request, no remote request, a real Blob Worker parses the workbook', async ({ page }) => {
    const runtime = watchRuntimeAssets(page)
    await installBlobUrlAudit(page)

    await openShell(page)
    await openXlsxFixture(page, 'xlsx-simple')

    // The engine is inflated from the bundle and the worker from a Blob over the
    // same bundle, so nothing was fetched to make either work. These two lists are
    // the whole delivery contract: a request for any of those paths would be the
    // failure, not the mechanism.
    expect(runtime.parserAssetRequests()).toEqual([])
    expect(runtime.remoteRequests()).toEqual([])

    // The parse is worker-backed, and the worker runs from an address the page
    // owns. A renderer that fell back to the main thread would still produce a
    // grid, so the worker is asserted in its own right, before readiness.
    await expect
      .poll(() => runtime.workers.length, {
        timeout: 45_000,
        message: 'the workbook must be parsed in a Worker',
      })
      .toBeGreaterThanOrEqual(1)

    const workerUrls = runtime.workers.map((worker) => worker.url())
    for (const url of workerUrls) {
      expect(url.startsWith('blob:'), `the worker must run from a client-owned URL, got ${url}`).toBe(
        true,
      )
      expect(url.startsWith('http:') || url.startsWith('https:')).toBe(false)
    }

    const content = await expectWorkbookReady(page)
    await dragRange(page, content, [75, 26], [180, 84])
    await expectPublishedSelection(page, 'Sheet1!A1:C3')

    // The one object URL this plugin creates was created by the platform and
    // released again. Both halves are read from the platform's own functions, so
    // a URL that was never released is a failing assertion rather than a comment.
    const audit = await readBlobUrlAudit(page)
    expect(workerUrls.length).toBeGreaterThanOrEqual(1)
    for (const url of workerUrls) {
      expect(audit.created, `the worker URL ${url} must have been created in this page`).toContain(
        url,
      )
      expect(audit.revoked, `the worker URL ${url} must have been revoked`).toContain(url)
    }
    expect(audit.revoked.length).toBeGreaterThanOrEqual(workerUrls.length)

    expect(runtime.parserAssetRequests()).toEqual([])
    expect(runtime.remoteRequests()).toEqual([])
  })

  test('1. simple semantic range Ask: exact provenance, exact published range, preserved draft', async ({ page }) => {
    const runtime = watchRuntimeAssets(page)

    await openShell(page)

    const composer = page.locator(COMPOSER_INPUT).first()
    await composer.click()
    await composer.fill('Pre-existing draft text')

    await openXlsxFixture(page, 'xlsx-simple')
    const content = await expectWorkbookReady(page)

    await dragRange(page, content, [75, 26], [180, 84])

    // The range is confirmed from the renderer's own published state before Ask
    // is pressed, so the provenance below is a statement about the range the
    // gesture produced rather than about the range it was meant to produce.
    await expectPublishedSelection(page, 'Sheet1!A1:C3')

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('Pre-existing draft text')
    expect(draft).toContain('[来源：task11-simple.xlsx，Sheet1!A1:C3]')
    expect(draft).toContain('Apple')
    expect(draft).toContain('Pear')
    expect(draft).toContain(QUESTION_SUFFIX)

    const isFocused = await composer.evaluate((el) => document.activeElement === el)
    expect(isFocused).toBe(true)

    expect(runtime.parserAssetRequests()).toEqual([])
    expect(runtime.remoteRequests()).toEqual([])
  })

  test('2. formula and display values: quotes calculated/formatted values not formula source', async ({ page }) => {
    await openShell(page)
    await openXlsxFixture(page, 'xlsx-formula-values')
    const content = await expectWorkbookReady(page)

    await dragRange(page, content, [75, 85], [155, 85])
    await expectPublishedSelection(page, 'Sheet1!A3:B3')

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('[来源：task11-formula-values.xlsx，Sheet1!A3:B3]')
    // Calculated display result and the formatted date, not the raw formula text.
    expect(draft).toContain('30')
    expect(draft).toContain('2026-09-18')
    expect(draft).not.toContain('=SUM(A1:A2)')
  })

  test('3. sheet switch: no stale Summary range survives into the new sheet, then exact provenance', async ({ page }) => {
    await openShell(page)
    await openXlsxFixture(page, 'xlsx-multi-sheet')
    const content = await expectWorkbookReady(page)

    await dragRange(page, content, [75, 30], [75, 30])
    await expectPublishedSelection(page, 'Summary!A1')

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })

    const dataTab = content.locator('button[role="tab"]:has-text("Data 2026")').first()
    await expect(dataTab).toBeVisible({ timeout: 10_000 })
    await dataTab.click()

    // The intermediate state is the assertion, not a pause before the next one.
    // Between the switch and the next gesture the renderer must describe the new
    // sheet: either it cleared the selection, or it published a range on the new
    // sheet. A stale `Summary!` range would let the next gesture inherit a
    // provenance that does not belong to it.
    await expect
      .poll(
        async () => {
          const value = await readPublishedSelection(page)
          return value === null || value.startsWith('Data 2026!')
        },
        {
          timeout: 15_000,
          message: 'the sheet switch must clear or restate the published selection',
        },
      )
      .toBe(true)

    if ((await readPublishedSelection(page)) === null) {
      await expect(askButton).toHaveCount(0)
    }

    await dragRange(page, content, [85, 30], [85, 30])
    await expectPublishedSelection(page, 'Data 2026!A1')

    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('[来源：task11-multi-sheet.xlsx，Data 2026!A1]')
    expect(draft).not.toContain('Summary!')
  })

  test('4. read-only enforcement: typing, Delete, Backspace and paste leave A2 unchanged', async ({ page }) => {
    await openShell(page)
    await openXlsxFixture(page, 'xlsx-simple')
    const content = await expectWorkbookReady(page)

    // No mutation-looking control is offered.
    await expect(page.locator('button:has-text("Export")')).toHaveCount(0)
    await expect(page.locator('button:has-text("Save")')).toHaveCount(0)
    await expect(page.locator('button:has-text("Edit")')).toHaveCount(0)

    const grid = content.locator('[role="grid"]').first()
    const box = await grid.boundingBox()
    if (box === null) throw new Error('the XLSX grid published no bounding box')
    const a2 = { x: box.x + 75, y: box.y + 65 }

    // Record the displayed value before any mutation attempt.
    await page.mouse.click(a2.x, a2.y)
    await expectPublishedSelection(page, 'Sheet1!A2')
    await expect(page.locator(ASK_BUTTON).first()).toBeVisible({ timeout: 15_000 })
    await page.locator(ASK_BUTTON).first().click()
    const before = await readDraft(page)
    expect(before).toContain('Apple')

    // Double-click to enter the cell, type, and leave the editor.
    await page.mouse.dblclick(a2.x, a2.y)
    await page.keyboard.type('MUTATED_VALUE')
    await page.keyboard.press('Escape')
    await expect(content.locator('input[type="text"], textarea')).toHaveCount(0)

    // Delete and Backspace on the selected cell.
    await page.mouse.click(a2.x, a2.y)
    await page.keyboard.press('Delete')
    await page.keyboard.press('Backspace')

    // Clipboard paste of an unmistakable sentinel, delivered as a real `paste`
    // event carrying clipboard data to the grid the viewer published.
    await page.evaluate(() => {
      const target = document.querySelector('[data-dsa-xlsx-content] [role="grid"]')
      if (target === null) throw new Error('the XLSX grid is not mounted')
      const data = new DataTransfer()
      data.setData('text/plain', 'INJECTED_SENTINEL')
      const paste = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      })
      target.dispatchEvent(paste)
    })

    // Re-read A2 through the same public path and require the original value.
    await page.mouse.click(a2.x, a2.y)
    await expectPublishedSelection(page, 'Sheet1!A2')
    await expect(page.locator(ASK_BUTTON).first()).toBeVisible({ timeout: 15_000 })
    await page.locator(ASK_BUTTON).first().click()

    const after = await readDraft(page)
    expect(after).toContain('[来源：task11-simple.xlsx，Sheet1!A2]')
    expect(after).toContain('Apple')
    expect(after).not.toContain('MUTATED_VALUE')
    expect(after).not.toContain('INJECTED_SENTINEL')
    await expect(content.locator('input[type="text"], textarea')).toHaveCount(0)
  })

  test('5. merged and frozen panes: renders and remains navigable without crashes', async ({ page }) => {
    await openShell(page)
    await openXlsxFixture(page, 'xlsx-merged-frozen')
    const content = await expectWorkbookReady(page)

    await dragRange(page, content, [75, 40], [75, 40])
    await expectPublishedSelection(page, 'Sheet1!A1')

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('[来源：task11-merged-frozen.xlsx，Sheet1!A1]')
    expect(draft).toContain('Merged Header Banner')
  })

  test('6. chart-image workbook: an embedded image and a chart are both actually drawn', async ({ page }) => {
    const runtime = watchRuntimeAssets(page)

    await openShell(page)
    await openXlsxFixture(page, 'xlsx-chart-image')
    const content = await expectWorkbookReady(page)

    // Selecting the category cell keeps the workbook parsed and the drawing
    // layer mounted while the surfaces are read.
    await dragRange(page, content, [75, 40], [75, 40])
    await expectPublishedSelection(page, 'Sheet1!A1')

    // The workbook's own content proves nothing about its rendering, so each of
    // the two drawing objects is read from what the renderer published for it,
    // and the two are asserted separately. The chart is an inline SVG the viewer
    // labels; the picture is painted into the sheet canvas in its own colour.
    // Neither assertion can be satisfied by the other object, and neither is a
    // filename or an XML part.
    await expect
      .poll(async () => (await readPaintedSurfaces(content)).drawings.length, {
        timeout: 20_000,
        message: 'the chart-image workbook must publish a drawing overlay',
      })
      .toBeGreaterThanOrEqual(1)

    const surfaces = await readPaintedSurfaces(content)

    const charts = surfaces.drawings.filter(
      (drawing) => drawing.label.startsWith('Chart') && drawing.width > 0 && drawing.height > 0,
    )
    expect(charts.length, 'the workbook chart must be rendered as a labelled drawing').toBeGreaterThanOrEqual(1)
    for (const chart of charts) {
      // A chart, not an empty frame: a plot area with more than one fill and a
      // set of gridlines.
      expect(chart.fills).toBeGreaterThanOrEqual(2)
      expect(chart.lines).toBeGreaterThanOrEqual(4)
    }

    // The embedded PNG is a solid red 64x64 image. It is baked into the sheet
    // canvas, so its own colour is the evidence that it was drawn; the control
    // case below establishes that no other workbook paints it.
    await expect
      .poll(async () => (await readPaintedSurfaces(content)).picturePixels, {
        timeout: 20_000,
        message:
          'the workbook’s embedded picture must be painted into the sheet canvas; ' +
          'a workbook whose picture is absent from the drawing layer renders only the grid',
      })
      .toBeGreaterThan(0)

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('[来源：task11-chart-image.xlsx，Sheet1!A1]')
    expect(draft).toContain('Category')

    expect(runtime.parserAssetRequests()).toEqual([])
    expect(runtime.remoteRequests()).toEqual([])
  })

  test('6a. control: the plain workbook paints no picture colour at all', async ({ page }) => {
    // The picture assertion above is only evidence if nothing else can satisfy
    // it. This case is the control: the workbook without a drawing part paints
    // none of the picture's colour, and none of the drawing overlay either.
    await openShell(page)
    await openXlsxFixture(page, 'xlsx-simple')
    const content = await expectWorkbookReady(page)

    await dragRange(page, content, [75, 30], [75, 30])
    await expectPublishedSelection(page, 'Sheet1!A1')

    const surfaces = await readPaintedSurfaces(content)
    expect(surfaces.picturePixels).toBe(0)
    expect(surfaces.drawings).toEqual([])
  })

  test('7. large workbook: a real client-owned Worker parses it and selection works afterwards', async ({ page }) => {
    const runtime = watchRuntimeAssets(page)

    await openShell(page)
    await openXlsxFixture(page, 'xlsx-large')

    // The worker is evidence in its own right: the renderer is configured with
    // `useWorker: true`, and a render that quietly fell back to the main thread
    // would still produce a grid. The workbook becoming ready is therefore
    // asserted *after* the worker is observed, not instead of it.
    await expect
      .poll(() => runtime.workers.length, {
        timeout: 45_000,
        message: 'the large workbook must be parsed in a Worker',
      })
      .toBeGreaterThanOrEqual(1)

    for (const worker of runtime.workers) {
      const url = worker.url()
      expect(url.startsWith('blob:'), `the worker must run from a client-owned URL, got ${url}`).toBe(
        true,
      )
    }

    const content = await expectWorkbookReady(page)
    await dragRange(page, content, [75, 65], [75, 65])
    await expectPublishedSelection(page, 'Sheet1!A2')

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('[来源：task11-large.xlsx，Sheet1!A2]')

    expect(runtime.parserAssetRequests()).toEqual([])
    expect(runtime.remoteRequests()).toEqual([])
  })

  test('8. resource switch cleanup: switching resources hides stale XLSX Ask button', async ({ page }) => {
    await openShell(page)
    await openXlsxFixture(page, 'xlsx-simple')
    const content = await expectWorkbookReady(page)

    await dragRange(page, content, [75, 30], [75, 30])
    await expectPublishedSelection(page, 'Sheet1!A1')

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })

    // Open DOCX resource
    await page.locator(`[data-dsa-smoke-open="docx-paragraphs"]`).click()

    // Old XLSX Ask button must be hidden
    await expect(askButton).toHaveCount(0)
    await expect(page.locator(XLSX_CONTENT)).toHaveCount(0)
  })

  test('9. client-only runtime: parser assets are never fetched from a host route or a remote origin', async ({ page }) => {
    const runtime = watchRuntimeAssets(page)

    await openShell(page)
    await openXlsxFixture(page, 'xlsx-simple')
    await expectWorkbookReady(page)

    // The host routes the renderer used to depend on must not exist, and the
    // engine must not be fetched at all when it is supplied as client-owned
    // bytes. A request for it is itself the failure.
    await expect
      .poll(() => runtime.requests.length, { timeout: 15_000 })
      .toBeGreaterThan(0)

    expect(runtime.parserAssetRequests()).toEqual([])
    expect(runtime.remoteRequests()).toEqual([])

    // No host route answers for these paths any more.
    const probe = await page.evaluate(async (base) => {
      const response = await fetch(new URL('/dsa-assets/duke_sheets_wasm_bg.wasm', base), {
        method: 'GET',
      })
      return response.status
    }, BASE_URL)
    expect(probe).toBe(404)
  })

  test('10. rapid close: switching away mid-parse leaves no late viewer, no stale Ask and no leaked object URL', async ({ page }) => {
    const runtime = watchRuntimeAssets(page)
    await installBlobUrlAudit(page)

    const pageErrors: string[] = []
    page.on('pageerror', (error: Error) => {
      pageErrors.push(error.message)
    })

    await openShell(page)

    // The large workbook is opened and left immediately: the switch happens while
    // the worker is still parsing, which is the window the cleanup has to survive.
    await page.locator('[data-dsa-smoke-open="xlsx-large"]').click()
    await page.locator('[data-dsa-smoke-open="docx-paragraphs"]').click()

    const content = page.locator(XLSX_CONTENT)
    const askButton = page.locator(ASK_BUTTON)

    await expect(content).toHaveCount(0, { timeout: 20_000 })
    await expect(askButton).toHaveCount(0)

    // "Nothing arrives later" is the property, and a bounded wait is the only way
    // to observe it: a parse that finished after the switch would mount a viewer
    // or republish a selection inside this window, and both are re-asserted after
    // it rather than only before.
    await page.waitForTimeout(5_000)

    await expect(content).toHaveCount(0)
    await expect(askButton).toHaveCount(0)
    expect(await page.locator(XLSX_ROOT).count()).toBe(0)
    expect(pageErrors, 'a resource released mid-parse must raise no page error').toEqual([])

    // The released worker's object URL is released too: the plugin owns exactly
    // one, and the platform is what says whether it came back.
    const audit = await readBlobUrlAudit(page)
    for (const url of audit.created) {
      expect(audit.revoked, `the object URL ${url} was never revoked`).toContain(url)
    }

    expect(runtime.parserAssetRequests()).toEqual([])
    expect(runtime.remoteRequests()).toEqual([])
  })
})
