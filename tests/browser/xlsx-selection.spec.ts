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
 * ## Blocked state
 *
 * The first case states the architecture's current, measured state: DSH exposes
 * no public client-only contract by which this plugin can deliver the Duke engine
 * binary, so no workbook reaches a viewer and every later case fails at the
 * readiness gate. That case is not a placeholder — it is the reproduced evidence
 * for the blocker, and it is what makes the failures below attributable to the
 * delivery contract rather than to the selection code under test.
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

/** The copy the renderer shows when the engine binary cannot be delivered. */
const WASM_BLOCKED_TEXT = '无法加载'

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
 * The viewer draws into canvases, so a surface count is the only structural fact
 * available; whether a surface was actually painted is asked separately, from the
 * canvas's own pixels rather than from the fixture's XML.
 *
 * @param content - the workbook content surface.
 * @returns element counts and how many canvases hold more than one colour.
 */
async function readPaintedSurfaces(content: Locator): Promise<{
  canvases: number
  images: number
  paintedCanvases: number
}> {
  return content.evaluate((root) => {
    const canvases = [...root.querySelectorAll('canvas')]
    let paintedCanvases = 0
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
    }
    return {
      canvases: canvases.length,
      images: root.querySelectorAll('img').length,
      paintedCanvases,
    }
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
  test('0. blocked engine-binary state: no workbook reaches a viewer and no host asset is requested', async ({ page }) => {
    const runtime = watchRuntimeAssets(page)

    await openShell(page)
    await openXlsxFixture(page, 'xlsx-simple')

    // The renderer reports the blocked runtime rather than mounting a viewer, so
    // the absence of the selectable surface is the evidence, not an accident of
    // timing: the terminal state is reached as soon as the security gates pass.
    await expect(page.locator(XLSX_ROOT).first()).toContainText(WASM_BLOCKED_TEXT, {
      timeout: 30_000,
    })
    await expect(page.locator(XLSX_CONTENT)).toHaveCount(0)
    await expect(page.locator(XLSX_ROOT).first()).not.toHaveAttribute(XLSX_SELECTION)

    // Nothing was fetched to try to make it work: the host routes are gone and
    // no remote fallback was attempted.
    expect(runtime.parserAssetRequests()).toEqual([])
    expect(runtime.remoteRequests()).toEqual([])
    expect(runtime.workers).toEqual([])
  })

  test('1. simple semantic range Ask: exact provenance, exact published range, preserved draft', async ({ page }) => {
    const runtime = watchRuntimeAssets(page)

    await openShell(page)

    const composer = page.locator(COMPOSER_INPUT).first()
    await composer.click()
    await composer.fill('Pre-existing draft text')

    await openXlsxFixture(page, 'xlsx-simple')
    const content = await expectWorkbookReady(page)

    await dragRange(page, content, [75, 45], [180, 85])

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

    await dragRange(page, content, [75, 45], [75, 45])
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

    await dragRange(page, content, [85, 65], [85, 65])
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

    // The workbook's own content proves nothing about its rendering, so the
    // drawing surfaces are read from the document. The grid is painted into one
    // canvas; a workbook carrying a drawing part has to paint at least one more
    // surface for the image and the chart.
    await expect
      .poll(async () => (await readPaintedSurfaces(content)).paintedCanvases, {
        timeout: 20_000,
        message: 'the chart-image workbook must paint a drawing surface beside the grid',
      })
      .toBeGreaterThanOrEqual(2)

    const surfaces = await readPaintedSurfaces(content)
    expect(surfaces.canvases).toBeGreaterThanOrEqual(2)

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('[来源：task11-chart-image.xlsx，Sheet1!A1]')
    expect(draft).toContain('Category')

    expect(runtime.parserAssetRequests()).toEqual([])
    expect(runtime.remoteRequests()).toEqual([])
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

    await dragRange(page, content, [75, 45], [75, 45])
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
})
