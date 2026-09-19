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
 * asserted separately, from two surfaces that cannot stand in for each other: the
 * picture from the image node the plugin's renderer published, including that
 * node's decoded size, decoded colour and computed style, and the chart from the
 * labelled inline SVG the viewer draws. Neither a painted canvas nor a filename
 * is accepted as evidence of either object.
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
 * A picture is *not* read from these canvases. The plugin replaces the library's
 * built-in image rendering through its documented `renderImage` hook, so an
 * embedded picture is a node in the drawing overlay rather than pixels baked into
 * a sheet canvas; {@link readEmbeddedImage} is what asserts it, and the canvas
 * sampling here is only the general "something was drawn" check it always was.
 *
 * @param content - the workbook content surface.
 * @returns canvas and image-element counts, how many canvases hold more than one
 *   colour, and the drawing overlay's structure.
 */
async function readPaintedSurfaces(content: Locator): Promise<{
  canvases: number
  images: number
  paintedCanvases: number
  drawings: { tag: string; label: string; width: number; height: number; fills: number; lines: number }[]
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

    return {
      canvases: canvases.length,
      images: root.querySelectorAll('img').length,
      paintedCanvases,
      drawings,
    }
  })
}

/** One embedded picture, as the document published it. */
interface EmbeddedImageEvidence {
  /** How many nodes the plugin's image renderer published. */
  readonly count: number
  readonly src: string
  readonly alt: string
  readonly draggable: string
  /** The browser's own decode state for the node's source. */
  readonly complete: boolean
  readonly naturalWidth: number
  readonly naturalHeight: number
  /** The laid-out box, in CSS pixels. */
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly display: string
  readonly visibility: string
  readonly opacity: string
  /** How many pixels of the *decoded node* carry the fixture's solid colour. */
  readonly redPixels: number
  /** Whether the colour read could be performed at all. */
  readonly pixelsSampled: boolean
  /** The inline style of the box the viewer positioned for the node. */
  readonly boxStyle: string
}

/**
 * Read the embedded picture the workbook published.
 *
 * The assertion this replaces could not be made stronger by looking harder at a
 * canvas: a picture baked into a sheet canvas and a picture that was never drawn
 * are told apart only by sampling, and nothing says *which* object the red pixels
 * belong to. The image is therefore read from the node the renderer published —
 * its source, its decode state, its laid-out box and its computed style — and its
 * colour is read by drawing that decoded node into an offscreen canvas, so a
 * broken `<img>` that is merely present cannot satisfy the check.
 *
 * @param content - the workbook content surface.
 * @returns the evidence, with `count: 0` when nothing was published.
 */
async function readEmbeddedImage(content: Locator): Promise<EmbeddedImageEvidence> {
  return content.evaluate((root) => {
    const nodes = [...root.querySelectorAll<HTMLImageElement>('[data-dsa-xlsx-image]')]
    const first = nodes[0]
    if (first === undefined) {
      return {
        count: 0,
        src: '',
        alt: '',
        draggable: '',
        complete: false,
        naturalWidth: 0,
        naturalHeight: 0,
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        display: '',
        visibility: '',
        opacity: '',
        redPixels: 0,
        pixelsSampled: false,
        boxStyle: '',
      }
    }

    const box = first.getBoundingClientRect()
    const computed = getComputedStyle(first)

    let redPixels = 0
    let pixelsSampled = false
    if (first.complete && first.naturalWidth > 0 && first.naturalHeight > 0) {
      const canvas = document.createElement('canvas')
      canvas.width = first.naturalWidth
      canvas.height = first.naturalHeight
      const context = canvas.getContext('2d')
      if (context !== null) {
        context.drawImage(first, 0, 0)
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data
        pixelsSampled = true
        for (let index = 0; index + 3 < data.length; index += 4) {
          if (data[index]! > 190 && data[index + 1]! < 70 && data[index + 2]! < 70) redPixels += 1
        }
      }
    }

    return {
      count: nodes.length,
      src: first.src,
      alt: first.alt,
      draggable: first.getAttribute('draggable') ?? '',
      complete: first.complete,
      naturalWidth: first.naturalWidth,
      naturalHeight: first.naturalHeight,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
      redPixels,
      pixelsSampled,
      boxStyle: first.parentElement?.getAttribute('style') ?? '',
    }
  })
}

/**
 * The outcome of decoding the published picture's own bytes.
 *
 * `undecodable` is the state that separates two findings a colour count alone
 * conflates: a renderer that published no picture, and a picture whose bytes no
 * decoder can turn into pixels. The second is a defect in the fixture, not in
 * anything that renders it, and it is named here so the suite reports which one
 * it found.
 */
interface PictureDecode {
  readonly state: 'absent' | 'pending' | 'decoded' | 'undecodable'
  readonly detail: string
}

/**
 * Decode the published picture through the browser's own bitmap decoder.
 *
 * `fetch` is called on the node's own source, which is a `blob:` URL the viewer
 * created in this page: nothing leaves the machine, and `createImageBitmap` is
 * the same decoder the browser uses to paint the node. A node whose header parses
 * but whose compressed pixel data does not decode reports `undecodable` here —
 * which is a broken picture, not a rendered one, however plausible its
 * `naturalWidth` looks.
 *
 * @param content - the workbook content surface.
 * @returns the decode state and a human-readable detail.
 */
async function readPictureDecode(content: Locator): Promise<PictureDecode> {
  return content.evaluate(async (root): Promise<PictureDecode> => {
    const node = root.querySelector<HTMLImageElement>('[data-dsa-xlsx-image]')
    if (node === null) return { state: 'absent', detail: 'no image node was published' }
    if (!node.complete) return { state: 'pending', detail: 'the node has not finished loading' }
    try {
      const response = await fetch(node.src)
      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)
      const detail = `${blob.size} bytes of ${blob.type} decoded as ${bitmap.width}x${bitmap.height}`
      bitmap.close()
      return { state: 'decoded', detail }
    } catch (error) {
      const scheme = /^([a-z][a-z0-9+.-]*):/u.exec(node.src)?.[1] ?? 'unknown'
      return { state: 'undecodable', detail: `${String(error)} over a ${scheme}: source` }
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
    await installBlobUrlAudit(page)

    const pageErrors: string[] = []
    const failedImageRequests: string[] = []
    page.on('pageerror', (error: Error) => {
      pageErrors.push(error.message)
    })
    page.on('requestfailed', (request: Request) => {
      if (request.resourceType() === 'image') failedImageRequests.push(request.url())
    })

    await openShell(page)
    await openXlsxFixture(page, 'xlsx-chart-image')
    const content = await expectWorkbookReady(page)

    // Selecting the category cell keeps the workbook parsed and the drawing
    // layer mounted while the surfaces are read. The ordinary grid is still a
    // grid: the picture the plugin publishes does not take cell selection away.
    await dragRange(page, content, [75, 40], [75, 40])
    await expectPublishedSelection(page, 'Sheet1!A1')

    // The workbook's own content proves nothing about its rendering, so each of
    // the two drawing objects is read from what the renderer published *for that
    // object*, and the two are asserted separately. They are not
    // interchangeable: the picture is a node carrying the viewer's own image
    // source, and the chart is an inline SVG the viewer labels. Neither assertion
    // can be satisfied by the other object, and neither is a filename or an XML
    // part.
    await expect
      .poll(async () => (await readEmbeddedImage(content)).count, {
        timeout: 20_000,
        message: 'the workbook’s embedded picture must be published as an image node',
      })
      .toBeGreaterThanOrEqual(1)

    const picture = await readEmbeddedImage(content)
    expect(picture.count).toBeGreaterThanOrEqual(1)

    // Local resource only: the picture comes from the viewer's own object URL,
    // never from a network origin, a plugin route or a file path.
    expect(picture.src.startsWith('blob:')).toBe(true)

    // A real, laid-out node rather than a placeholder: the viewer's rectangle
    // sizes it, its computed style leaves it visible, and it carries the
    // workbook's own alt text.
    expect(picture.complete).toBe(true)
    expect(picture.naturalWidth).toBe(64)
    expect(picture.naturalHeight).toBe(64)
    expect(picture.width).toBeGreaterThan(0)
    expect(picture.height).toBeGreaterThan(0)
    expect(picture.display).not.toBe('none')
    expect(picture.visibility).not.toBe('hidden')
    expect(picture.opacity).not.toBe('0')

    // Read-only presentation: the node is not draggable, and it is positioned by
    // the viewer's own box rather than by anything this plugin computed.
    expect(picture.draggable).toBe('false')
    expect(picture.boxStyle).toContain('position: absolute')

    await expect
      .poll(async () => (await readPictureDecode(content)).state, {
        timeout: 20_000,
        message: 'the published picture must finish loading its own source',
      })
      .not.toBe('pending')

    // The picture's bytes must decode into pixels. `naturalWidth` is read out of
    // the PNG header, so it is satisfied by a file whose compressed pixel data is
    // unusable; this assertion is what tells a rendered picture apart from a node
    // that merely claims a size.
    const decode = await readPictureDecode(content)
    expect(
      decode.state,
      `the embedded picture’s own bytes must decode into pixels: ${decode.detail}; ` +
        `the node reports ${picture.naturalWidth}x${picture.naturalHeight} in a ` +
        `${Math.round(picture.width)}x${Math.round(picture.height)} box at ` +
        `${Math.round(picture.left)},${Math.round(picture.top)}`,
    ).toBe('decoded')

    await expect
      .poll(async () => (await readEmbeddedImage(content)).redPixels, {
        timeout: 20_000,
        message:
          'the published image node must decode to the fixture’s solid-red picture; ' +
          'a node whose source never loaded would carry no colour at all',
      })
      .toBeGreaterThan(0)

    // The colour read was actually performed: drawing the decoded node into a
    // canvas and reading the pixels back. No text is interpreted from them.
    expect(picture.pixelsSampled).toBe(true)

    // The picture's own object URL was allocated by the controller in this page,
    // and it is the only allocation for that picture: the plugin consumes the
    // source it is handed instead of minting a second resource for the same
    // bytes.
    const auditAfterRender = await readBlobUrlAudit(page)
    expect(auditAfterRender.created).toContain(picture.src)
    expect(auditAfterRender.created.filter((url) => url === picture.src)).toHaveLength(1)
    expect(auditAfterRender.revoked).not.toContain(picture.src)

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

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('[来源：task11-chart-image.xlsx，Sheet1!A1]')
    expect(draft).toContain('Category')

    // The picture is presentation, not an editing surface. The gesture below is
    // a real pointer drag across the picture, and what it must leave behind is
    // the geometry the viewer published: the anchor is not moved, the box is not
    // resized, and no resize handle appears. The comparison is against the
    // viewer's own published box rather than against a stored anchor, so it
    // reports a persistent move wherever one came from.
    const beforeDrag = await readEmbeddedImage(content)
    await page.mouse.move(beforeDrag.left + beforeDrag.width / 2, beforeDrag.top + beforeDrag.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      beforeDrag.left + beforeDrag.width / 2 + 90,
      beforeDrag.top + beforeDrag.height / 2 + 60,
      { steps: 10 },
    )
    await page.mouse.up()
    await page.waitForTimeout(500)

    const afterDrag = await readEmbeddedImage(content)
    expect(afterDrag.count).toBeGreaterThanOrEqual(1)
    expect(afterDrag.src).toBe(beforeDrag.src)
    expect(afterDrag.boxStyle).toBe(beforeDrag.boxStyle)
    expect(Math.round(afterDrag.left)).toBe(Math.round(beforeDrag.left))
    expect(Math.round(afterDrag.top)).toBe(Math.round(beforeDrag.top))
    expect(Math.round(afterDrag.width)).toBe(Math.round(beforeDrag.width))
    expect(Math.round(afterDrag.height)).toBe(Math.round(beforeDrag.height))

    // A picture that failed to load is not a passing case: a broken source raises
    // an image request failure in this page, and an unreadable scheme raises a
    // page error.
    expect(failedImageRequests).toEqual([])
    expect(pageErrors, 'rendering the picture must raise no page error').toEqual([])

    expect(runtime.parserAssetRequests()).toEqual([])
    expect(runtime.remoteRequests()).toEqual([])
  })

  test('6a. control: the plain workbook publishes no image node at all', async ({ page }) => {
    // The picture assertion above is only evidence if nothing else can satisfy
    // it. This case is the control: the workbook without a drawing part publishes
    // no image node, no drawing overlay, and no decoded picture colour.
    await openShell(page)
    await openXlsxFixture(page, 'xlsx-simple')
    const content = await expectWorkbookReady(page)

    await dragRange(page, content, [75, 30], [75, 30])
    await expectPublishedSelection(page, 'Sheet1!A1')

    const picture = await readEmbeddedImage(content)
    expect(picture.count).toBe(0)
    expect(picture.redPixels).toBe(0)

    const surfaces = await readPaintedSurfaces(content)
    expect(surfaces.drawings).toEqual([])
  })

  test('6b. embedded picture lifecycle: the viewer’s own object URL is released when the resource is switched', async ({ page }) => {
    await installBlobUrlAudit(page)

    const pageErrors: string[] = []
    page.on('pageerror', (error: Error) => {
      pageErrors.push(error.message)
    })

    await openShell(page)
    await openXlsxFixture(page, 'xlsx-chart-image')
    const content = await expectWorkbookReady(page)

    await expect
      .poll(async () => (await readEmbeddedImage(content)).count, {
        timeout: 20_000,
        message: 'the workbook’s embedded picture must be published as an image node',
      })
      .toBeGreaterThanOrEqual(1)

    const picture = await readEmbeddedImage(content)
    const auditBeforeSwitch = await readBlobUrlAudit(page)

    // The URL the picture renders from belongs to the controller: it was created
    // by the platform on the controller's behalf, and it is still live while the
    // workbook is open.
    expect(auditBeforeSwitch.created).toContain(picture.src)
    expect(auditBeforeSwitch.revoked).not.toContain(picture.src)

    // Switching resources releases the whole viewer session, this picture's
    // resource included. The plugin never revokes it — the URL is not the
    // plugin's to release — so a revoked URL here is the controller cleaning up
    // after itself rather than the renderer reaching for the platform.
    await page.locator(`[data-dsa-smoke-open="docx-paragraphs"]`).click()
    await expect(page.locator(XLSX_CONTENT)).toHaveCount(0, { timeout: 20_000 })

    await expect
      .poll(async () => (await readBlobUrlAudit(page)).revoked, {
        timeout: 20_000,
        message: 'the embedded picture’s object URL must be released with the workbook',
      })
      .toContain(picture.src)

    expect(pageErrors, 'releasing a workbook with a picture must raise no page error').toEqual([])
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
