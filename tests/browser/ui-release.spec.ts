/**
 * Production UI release audit for the Ask surface and the four byte renderers.
 *
 * **What this suite is for.** Tasks 1–15 proved the *behaviour*: the quote that is
 * appended, the provenance that is written, the resources that are released. This
 * suite audits the surface a reader actually touches — where the Ask button lands,
 * whether a press reaches it, whether the copy is legible, whether the notice can
 * be announced, whether the renderer shells clip what they show — against a real
 * DSH instance rather than a jsdom approximation.
 *
 * **What it asserts, and why not pixels.** Every gate below is a measurement a
 * machine can decide on its own: bounding boxes against the viewport,
 * `elementFromPoint` hit tests, computed styles, contrast ratios derived from the
 * resolved colours, the accessibility tree, and Playwright's own unforced
 * actionability check. Screenshots are written only when `T15U_SHOT_DIR` names a
 * directory, and they are evidence for a human rather than an assertion: a
 * `toHaveScreenshot()` baseline would encode this machine's font rasteriser and
 * GPU into the release gate, which is the failure mode the audit brief names.
 *
 * **Two conventions this file keeps.** Nothing is clicked with `force`, and no
 * selection is manufactured through test-only DOM — the geometry gates drive real
 * drags over the shell's own rendered documents, because the whole question is
 * where a real selection puts the button. The one synthetic box in the file is
 * read-only: {@link scrollPreview} sets `scrollTop` on the scrollport DSH itself
 * publishes, which is a scroll a reader performs with the wheel.
 *
 * The instance is external: `DSH_SMOKE_URL` names a running DSH web server with
 * this plugin mounted, and the cases are skipped without it so that
 * `pnpm test:browser` stays usable on a machine with no DSH installed.
 */

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { ensureWorkspace } from './helpers/shell.js'

/** The running DSH instance this suite drives. */
const BASE_URL = process.env['DSH_SMOKE_URL'] ?? ''

test.skip(BASE_URL === '', 'set DSH_SMOKE_URL to a running DSH instance with this plugin mounted')

/** Where screenshots are written, when a human wants them. Never committed. */
const SHOT_DIR = process.env['T15U_SHOT_DIR'] ?? ''

/** The composer's editable surface. */
const COMPOSER_INPUT = '[data-composer-input]'

/** The composer's card, which owns the editable surface and its controls. */
const COMPOSER_CARD = '[data-composer-card]'

/** The Ask button this plugin contributes. */
const ASK_BUTTON = '[data-dsa-selection-ask-button]'

/** The always-mounted live region that carries a refusal notice. */
const NOTICE_REGION = '[data-dsa-selection-error-region]'

/** The refusal notice itself, present only while there is something to report. */
const NOTICE = '[data-dsa-selection-error]'

/** The smoke driver's fixture strip. */
const DRIVER = '[data-dsa-smoke-driver]'

/** The shell's public preview scrollport, published by DSH's own preview. */
const PREVIEW_BODY = '[data-textpreview-body]'

/**
 * The root DSH's own plain-text preview publishes.
 *
 * The text renderer belongs to the product rather than to this plugin, so it
 * carries the product's `data-textpreview-*` attributes instead of the plugin's
 * `data-dsa-document-kind`. The geometry cases select inside it because it is the
 * one preview whose rows are a stable, addressable run of text.
 */
const TEXT_PREVIEW = '[data-textpreview-body]'

/** The minimum contrast ratio WCAG requires for text at these sizes. */
const MIN_TEXT_CONTRAST = 4.5

/** The minimum target size the audit requires, in CSS pixels. */
const MIN_TARGET_SIZE = 24

/** The minimum gap the overlay must keep from a viewport edge, in CSS pixels. */
const VIEWPORT_MARGIN = 8

/** The viewports the release audit requires, in the order the brief lists them. */
const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const

/** A measured rectangle in viewport coordinates. */
interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** An `rgb()`/`rgba()` colour resolved to components. */
interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/**
 * Parse a computed `rgb()`/`rgba()` colour.
 * @param value - the computed colour string.
 * @returns the components, or `null` when the value is not a colour.
 */
function parseColor(value: string): Rgba | null {
  const match = /rgba?\(([^)]+)\)/.exec(value)
  if (match === null || match[1] === undefined) return null

  const parts = match[1].split(/[,\s/]+/).filter((part) => part !== '').map(Number)
  const [r, g, b, a] = parts
  if (r === undefined || g === undefined || b === undefined) return null
  return { r, g, b, a: a === undefined ? 1 : a }
}

/**
 * Composite a possibly translucent colour over an opaque one.
 * @param foreground - the upper colour.
 * @param background - the opaque lower colour.
 * @returns the composited colour.
 */
function composite(foreground: Rgba, background: Rgba): Rgba {
  const a = foreground.a
  return {
    r: foreground.r * a + background.r * (1 - a),
    g: foreground.g * a + background.g * (1 - a),
    b: foreground.b * a + background.b * (1 - a),
    a: 1,
  }
}

/**
 * The relative luminance of an opaque colour, as WCAG defines it.
 * @param color - the colour.
 * @returns the luminance in `[0, 1]`.
 */
function luminance(color: Rgba): number {
  const channel = (value: number): number => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/**
 * The contrast ratio between two opaque colours.
 * @param foreground - the text colour.
 * @param background - the background colour.
 * @returns the ratio, at least 1.
 */
function contrastRatio(foreground: Rgba, background: Rgba): number {
  const first = luminance(foreground)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/**
 * Describe a box and a colour pair for a failure message.
 * @param box - the measured box.
 * @returns a one-line description.
 */
function describeBox(box: Box): string {
  return `x=${box.x.toFixed(1)} y=${box.y.toFixed(1)} w=${box.width.toFixed(1)} h=${box.height.toFixed(1)}`
}

/**
 * The area two boxes share.
 * @param a - one box.
 * @param b - the other box.
 * @returns the overlap area in square CSS pixels, zero when they are disjoint.
 */
function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

/**
 * Write a screenshot when a human asked for one.
 *
 * Temporary evidence only: the directory is outside the repository, and nothing
 * here writes into the package's published surface.
 *
 * @param page - the page to capture.
 * @param name - the file name, without extension.
 */
async function shot(page: Page, name: string): Promise<void> {
  if (SHOT_DIR === '') return
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` })
}

/**
 * Open the DSH shell and point it at this repository.
 *
 * The composer is the anchor: it exists in the hero state and in an open session
 * alike, and the driver's control strip occupies a session-scoped slot that only
 * exists once a session is on screen.
 *
 * @param page - the browser page.
 */
async function openShell(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  // The shell's own boot is the one fixed wait, and it is not evidence about this
  // plugin: every assertion below is made against a locator, a box or a poll.
  await page.waitForTimeout(12_000)
  await expect(page.locator(COMPOSER_INPUT).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator(DRIVER).first()).toBeVisible({ timeout: 30_000 })
  await ensureWorkspace(page)
}

/**
 * Open one fixture through the driver's own public navigation call.
 *
 * @param page - the browser page.
 * @param key - the fixture key.
 * @param root - the selector the plugin's renderer root publishes.
 */
async function openFixture(page: Page, key: string, root: string): Promise<void> {
  const control = page.locator(`[data-dsa-smoke-open="${key}"]`)
  await expect(control, `the driver must publish a control for ${key}`).toBeVisible({ timeout: 20_000 })
  await control.click()
  await expect(page.locator(root).first(), `${key} must mount its renderer`).toBeVisible({ timeout: 45_000 })
}

/**
 * The box of a locator, failing with the locator's own description when absent.
 * @param target - the locator to measure.
 * @param what - what the locator is, for the failure message.
 * @returns the measured box.
 */
async function boxOf(target: Locator, what: string): Promise<Box> {
  const box = await target.boundingBox()
  expect(box, `${what} must publish a bounding box`).not.toBeNull()
  if (box === null) throw new Error(`${what} published no bounding box`)
  return box
}

/**
 * Select a run of rendered rows with a real pointer gesture.
 *
 * The anchor press lands inside the first row's own text and the extension is a
 * real Shift-held click, because a drag anchored on a row's leading edge can snap
 * to the nearest character instead of the row.
 *
 * @param page - the browser page.
 * @param rows - the rows, in document order.
 * @param fromIndex - the first row to include.
 * @param toIndex - the last row to include.
 * @returns the selected text as the browser reports it.
 */
async function selectRows(page: Page, rows: Locator, fromIndex: number, toIndex: number): Promise<string> {
  const first = await boxOf(rows.nth(fromIndex), `row ${fromIndex}`)
  const last = await boxOf(rows.nth(toIndex), `row ${toIndex}`)

  await page.mouse.move(first.x + 2, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(150)

  await page.keyboard.down('Shift')
  await page.mouse.move(last.x + Math.max(2, last.width - 2), last.y + last.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await page.waitForTimeout(700)

  return page.evaluate(() => document.getSelection()?.toString() ?? '')
}

/**
 * Select text inside a plain-text preview and require the gesture to have taken.
 *
 * A single attempt can land while the document column is still animating in, so
 * the same real gesture is retried with a longer settle. The final attempt's
 * answer is what the caller sees, so a genuine failure still fails.
 *
 * @param page - the browser page.
 * @param fromIndex - the first rendered row to include.
 * @param toIndex - the last rendered row to include.
 * @returns the selected text.
 */
async function selectTextLines(page: Page, fromIndex: number, toIndex: number): Promise<string> {
  const lines = page.locator('[data-textpreview-line]')
  await expect(lines.first()).toBeVisible({ timeout: 30_000 })

  let selected = ''
  for (const settle of [0, 700, 1500]) {
    if (settle > 0) await page.waitForTimeout(settle)
    selected = await selectRows(page, lines, fromIndex, toIndex)
    if (selected.trim() !== '') return selected
  }
  return selected
}

/** Everything this suite needs to know about the Ask button's current state. */
interface AskState {
  readonly present: boolean
  readonly box: Box | null
  readonly text: string
  readonly color: string
  readonly background: string
  readonly outlineStyle: string
  readonly outlineWidth: string
  readonly outlineColor: string
  readonly outlineOffset: string
  readonly hitIsAsk: boolean
  readonly hitTag: string
}

/**
 * Measure the Ask button and hit-test its own centre.
 *
 * The hit test is the property Task 5C exists for: a button that is visible and
 * painted over is not a button a reader can press, and only
 * `document.elementFromPoint` at the button's own centre can tell the two apart.
 *
 * @param page - the browser page.
 * @returns the measured state, or `present: false` when there is no button.
 */
async function readAsk(page: Page): Promise<AskState> {
  return page.evaluate((selector) => {
    const button = document.querySelector(selector)
    if (button === null) {
      return {
        present: false,
        box: null,
        text: '',
        color: '',
        background: '',
        outlineStyle: '',
        outlineWidth: '',
        outlineColor: '',
        outlineOffset: '',
        hitIsAsk: false,
        hitTag: '',
      }
    }

    const rect = button.getBoundingClientRect()
    const style = getComputedStyle(button)
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)

    return {
      present: true,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      text: (button.textContent ?? '').trim(),
      color: style.color,
      background: style.backgroundColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
      hitIsAsk: hit === button || (hit !== null && button.contains(hit)),
      hitTag: hit === null ? 'null' : hit.tagName,
    }
  }, ASK_BUTTON)
}

/**
 * Require a box to lie inside the viewport, naming every bound that failed.
 * @param box - the measured box.
 * @param viewport - the viewport size.
 * @param what - what was measured, for the failure message.
 * @param margin - the smallest gap required from every edge.
 */
function expectInsideViewport(
  box: Box,
  viewport: { width: number; height: number },
  what: string,
  margin: number,
): void {
  const bounds = `${what} must lie inside the ${viewport.width}x${viewport.height} viewport with a ${margin}px margin; its box is ${describeBox(box)}`
  expect(box.x, bounds).toBeGreaterThanOrEqual(margin)
  expect(box.y, bounds).toBeGreaterThanOrEqual(margin)
  expect(box.x + box.width, bounds).toBeLessThanOrEqual(viewport.width - margin)
  expect(box.y + box.height, bounds).toBeLessThanOrEqual(viewport.height - margin)
}

/**
 * Read the composer's published draft.
 * @param page - the browser page.
 * @returns the draft text.
 */
async function readDraft(page: Page): Promise<string> {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector)
    return element === null ? '' : element.textContent ?? ''
  }, COMPOSER_INPUT)
}

/**
 * Read every status surface a byte renderer publishes, as it appears.
 *
 * A MutationObserver is installed before the fixture is opened rather than a
 * sleep being guessed at, because the loading state of a fixture that is already
 * in the server's cache lasts a few hundred milliseconds: polling alone could
 * miss it and would then report a contrast failure that never happened. The live
 * selector is read as well, so the gate holds whichever of the two observes the
 * state first.
 *
 * @param page - the browser page.
 */
async function observeStatusSurfaces(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = globalThis as unknown as { __t15uStatus?: unknown[] }
    store.__t15uStatus = []

    const SELECTOR = '[data-dsa-pptx-status],[data-dsa-docx-status],[data-dsa-xlsx-status],[data-dsa-pdf-notice]'
    const record = (element: Element): void => {
      const style = getComputedStyle(element)
      store.__t15uStatus?.push({
        text: (element.textContent ?? '').trim(),
        color: style.color,
        ownBackground: style.backgroundColor,
      })
    }

    const observer = new MutationObserver((records) => {
      for (const record_ of records) {
        for (const node of record_.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          if (node.matches(SELECTOR)) record(node)
          for (const inner of node.querySelectorAll(SELECTOR)) record(inner)
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
}

/** One status surface, measured while it was on screen. */
interface StatusSurface {
  readonly text: string
  readonly color: string
  readonly background: string
  readonly ownBackgroundAlpha: number
}

/**
 * Measure one status selector as it stands, including its effective background.
 *
 * The effective background is composited from the element's ancestors, because a
 * status block that paints nothing of its own inherits the renderer root's desk —
 * which is exactly the grey-on-grey case this audit measured.
 *
 * @param page - the browser page.
 * @param selector - the status selector to measure.
 * @returns the measurement, or `null` while the surface is absent or empty.
 */
async function measureStatus(page: Page, selector: string): Promise<StatusSurface | null> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel)
    if (element === null) return null

    const text = (element.textContent ?? '').trim()
    if (text === '') return null

    const parse = (value: string): { r: number; g: number; b: number; a: number } | null => {
      const match = /rgba?\(([^)]+)\)/.exec(value)
      if (match === null || match[1] === undefined) return null
      const parts = match[1].split(/[,\s/]+/).filter((part) => part !== '').map(Number)
      const [r, g, b, a] = parts
      if (r === undefined || g === undefined || b === undefined) return null
      return { r, g, b, a: a === undefined ? 1 : a }
    }
    const over = (
      foreground: { r: number; g: number; b: number; a: number },
      background: { r: number; g: number; b: number; a: number },
    ): { r: number; g: number; b: number; a: number } => ({
      r: foreground.r * foreground.a + background.r * (1 - foreground.a),
      g: foreground.g * foreground.a + background.g * (1 - foreground.a),
      b: foreground.b * foreground.a + background.b * (1 - foreground.a),
      a: 1,
    })

    let accumulated: { r: number; g: number; b: number; a: number } | null = null
    let node: Element | null = element
    while (node !== null) {
      const colour = parse(getComputedStyle(node).backgroundColor)
      if (colour !== null && colour.a > 0) {
        accumulated = accumulated === null ? colour : over(accumulated, colour)
        if (accumulated.a >= 0.999) break
      }
      node = node.parentElement
    }
    const background = accumulated ?? { r: 255, g: 255, b: 255, a: 1 }
    const own = parse(getComputedStyle(element).backgroundColor)

    return {
      text,
      color: getComputedStyle(element).color,
      background: `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`,
      ownBackgroundAlpha: own === null ? 0 : own.a,
    }
  }, selector)
}

/**
 * Wait for a status surface to appear, reading the live DOM and the observer.
 *
 * @param page - the browser page.
 * @param selector - the status selector to wait for.
 * @param timeoutMs - how long to keep looking.
 * @returns the first non-empty measurement, or `null` when none appeared.
 */
async function captureStatusSurface(
  page: Page,
  selector: string,
  timeoutMs: number,
): Promise<StatusSurface | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const live = await measureStatus(page, selector)
    if (live !== null) return live

    const observed = await page.evaluate(() => {
      const store = globalThis as unknown as {
        __t15uStatus?: { text: string; color: string; ownBackground: string }[]
      }
      const records = store.__t15uStatus ?? []
      return records.find((record) => record.text !== '') ?? null
    })
    if (observed !== null) {
      const own = parseColor(observed.ownBackground)
      return {
        text: observed.text,
        color: observed.color,
        background: observed.ownBackground,
        ownBackgroundAlpha: own === null ? 0 : own.a,
      }
    }

    await page.waitForTimeout(40)
  }
  return null
}

/**
 * Require a status surface's copy to reach the text contrast threshold.
 *
 * @param surface - the measurement to check.
 * @param what - the state being checked, for the failure message.
 * @param requireOwnBackground - whether the surface must paint its own background.
 */
function expectReadableStatus(surface: StatusSurface, what: string, requireOwnBackground: boolean): void {
  const foreground = parseColor(surface.color)
  const background = parseColor(surface.background)
  expect(foreground, `${what}: the copy colour must resolve: ${surface.color}`).not.toBeNull()
  expect(background, `${what}: the background must resolve: ${surface.background}`).not.toBeNull()
  if (foreground === null || background === null) return

  if (requireOwnBackground) {
    expect(
      surface.ownBackgroundAlpha,
      `${what}: the status surface must paint its own background rather than sit on the renderer's desk; it painted nothing`,
    ).toBeGreaterThan(0.999)
  }

  const ratio = contrastRatio(foreground, background)
  expect(
    ratio,
    `${what}: "${surface.text}" must reach ${MIN_TEXT_CONTRAST}:1; ${surface.color} on ${surface.background} measures ${ratio.toFixed(2)}:1`,
  ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
}

/**
 * Scroll the shell's own preview scrollport.
 *
 * The scrollport is the element DSH publishes as `data-textpreview-body`; setting
 * its `scrollTop` is the same scroll a wheel performs, and the `scroll` event it
 * dispatches is the one the plugin's lifecycle listens for.
 *
 * @param page - the browser page.
 * @param delta - the scroll distance in CSS pixels.
 * @returns the scrollport's box, for the caller's own assertions.
 */
async function scrollPreview(page: Page, delta: number): Promise<Box | null> {
  return page.evaluate(
    (args) => {
      const scroller = document.querySelector(args.selector)
      if (scroller === null) return null
      scroller.scrollTop = args.delta
      const rect = scroller.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    },
    { selector: PREVIEW_BODY, delta },
  )
}

/**
 * The two halves of the placement contract, read in one turn.
 *
 * The browser's live selection and the Ask button are read inside a single
 * `evaluate` so that no animation frame can land between them: the contract is
 * about a *pair* of states, and two separate round trips would let the pair be
 * assembled from two different moments.
 */
interface PlacementState {
  /** The live browser selection's text, trimmed; empty when it is collapsed or gone. */
  readonly selection: string
  /** The live selection's client rectangles, as the browser reports them now. */
  readonly rects: readonly Box[]
  /** Whether the Ask button is in the DOM. */
  readonly present: boolean
  /** The button's box, or `null` when it is absent or publishes no geometry. */
  readonly box: Box | null
  /** Whether a hit test at the button's own centre reaches it. */
  readonly hitIsAsk: boolean
  /** What that hit test reached instead. */
  readonly hitTag: string
}

/**
 * Read the live browser selection and the Ask button together.
 *
 * @param page - the browser page.
 * @returns the observed pair.
 */
async function readPlacement(page: Page): Promise<PlacementState> {
  return page.evaluate((selector) => {
    const selection = document.getSelection()
    const live = selection === null ? '' : selection.toString().trim()
    const rects =
      selection === null || selection.rangeCount === 0
        ? []
        : [...selection.getRangeAt(0).getClientRects()].map((rect) => ({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          }))

    const button = document.querySelector(selector)
    if (button === null) {
      return { selection: live, rects, present: false, box: null, hitIsAsk: false, hitTag: '' }
    }

    const rect = button.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return {
      selection: live,
      rects,
      present: true,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      hitIsAsk: hit === button || (hit !== null && button.contains(hit)),
      hitTag: hit === null ? 'null' : hit.tagName,
    }
  }, ASK_BUTTON)
}

/**
 * Whether two reads describe the same place.
 *
 * Sub-pixel tolerance only: the button's own left/top are set from the measured
 * anchor, so a genuine re-placement moves it by whole pixels while a re-render of
 * unchanged geometry may differ in the last fraction.
 *
 * @param a - one read.
 * @param b - the other read.
 * @returns true when both describe the same surface in the same place.
 */
function samePlacement(a: PlacementState, b: PlacementState): boolean {
  if (a.selection !== b.selection || a.present !== b.present) return false
  if (a.box === null || b.box === null) return a.box === b.box
  return Math.abs(a.box.x - b.box.x) <= 0.5 && Math.abs(a.box.y - b.box.y) <= 0.5
}

/**
 * Wait until the Ask surface and the browser selection agree and stop moving.
 *
 * Two things have to be waited for, and they are different.
 *
 * The plugin recaptures the live selection on the animation frame *after* a
 * scroll or a resize (`src/client/selection/browser-lifecycle.ts` coalesces into
 * one frame), so for the first frames after a perturbation the button still
 * describes the previous geometry — present, agreeing with the live selection,
 * and in the wrong place. Two frames is the boundary the lifecycle publishes on,
 * and it is waited for as a boundary rather than as a duration.
 *
 * What follows is a stability window rather than a single sample: the state must
 * repeat across two reads at least 250 ms apart. Without it this helper would
 * return the frame-zero reading, and the placement assertions after it would be
 * deciding a question the plugin had not answered yet — which is exactly how the
 * first version of this gate let a button sit at its pre-scroll coordinate.
 *
 * A persistent disagreement between the two halves is the defect; every distinct
 * pair observed is carried into the failure message so it names itself.
 *
 * @param page - the browser page.
 * @param what - the perturbation being judged, for the failure message.
 * @returns the settled state.
 * @throws Error when no settled, agreeing state is reached within the window.
 */
async function settlePlacement(page: Page, what: string): Promise<PlacementState> {
  await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve(true)
          })
        })
      }),
  )

  const deadline = Date.now() + 20_000
  const mismatches: string[] = []
  let previous: PlacementState | null = null
  let previousAt = 0

  while (Date.now() < deadline) {
    const state = await readPlacement(page)

    if ((state.selection !== '') !== state.present) {
      const line = `selection=${JSON.stringify(state.selection.slice(0, 24))} ask=${state.present ? 'present' : 'absent'}`
      if (mismatches[mismatches.length - 1] !== line) mismatches.push(line)
      previous = null
    } else if (previous === null || !samePlacement(previous, state)) {
      previous = state
      previousAt = Date.now()
    } else if (Date.now() - previousAt >= 250) {
      return state
    }

    await page.waitForTimeout(120)
  }

  throw new Error(
    `${what}: the Ask surface never settled into agreement with the browser selection. A live ` +
      `selection must publish the button and a cleared selection must remove it; observed ${
        mismatches.length === 0 ? 'a surface that never stopped moving' : mismatches.join(', then ')
      }`,
  )
}

/**
 * The button's box, failing rather than skipping when it has none.
 *
 * @param state - the settled state.
 * @param what - the perturbation being judged, for the failure message.
 * @returns the measured box.
 */
function requireAskBox(state: PlacementState, what: string): Box {
  expect(state.present, `${what}: a live selection must publish the Ask button`).toBe(true)
  expect(state.box, `${what}: the Ask button must publish a bounding box`).not.toBeNull()
  if (state.box === null) throw new Error(`${what}: the Ask button published no box`)
  return state.box
}

/**
 * Require the button to be absent, which is the only shape a cleared selection has.
 *
 * This is the half the audit brief names: a button that survives its selection is
 * a control that quotes text the reader has already dismissed.
 *
 * @param state - the settled state.
 * @param what - the perturbation being judged, for the failure message.
 */
function expectAskAbsent(state: PlacementState, what: string): void {
  expect(
    state.present,
    `${what}: the browser selection is gone, so no Ask button may remain; one was found at ${
      state.box === null ? 'no published box' : describeBox(state.box)
    }`,
  ).toBe(false)
}

/**
 * The rectangle the product's own anchor rule would choose.
 *
 * Mirrors `anchorRect` in `src/client/selection/viewport.ts`: the last rectangle
 * that intersects the viewport, falling back to the last one when none does. It
 * is read from the browser here rather than imported, because the point of the
 * case is to check the product's placement against the browser's own geometry.
 *
 * @param state - the settled state.
 * @param viewport - the viewport size.
 * @returns the anchor rectangle, or `null` when the selection has no geometry.
 */
function anchorOf(state: PlacementState, viewport: { width: number; height: number }): Box | null {
  for (let index = state.rects.length - 1; index >= 0; index -= 1) {
    const rect = state.rects[index]
    if (rect === undefined) continue
    if (rect.x + rect.width >= 0 && rect.y + rect.height >= 0 && rect.x <= viewport.width && rect.y <= viewport.height) {
      return rect
    }
  }
  return state.rects[state.rects.length - 1] ?? null
}

/**
 * Require the button to sit as near the live selection as the viewport permits.
 *
 * The product places the button one margin above the anchor's top edge and then
 * clamps it into the viewport, so the claim has three shapes and all of them are
 * asserted: a visible anchor puts the button within a bounded distance of it, an
 * anchor above the viewport pins the button to the top margin, and one below pins
 * it to the bottom. The bound on the visible case is far tighter than the
 * displacement each perturbation produces, which is what makes "the button was
 * left where it used to be" fail here instead of passing quietly.
 *
 * @param ask - the button's measured box.
 * @param anchor - the anchor rectangle the product would use.
 * @param viewport - the viewport size.
 * @param what - the perturbation being judged, for the failure message.
 */
function expectAnchored(ask: Box, anchor: Box, viewport: { width: number; height: number }, what: string): void {
  if (anchor.y + anchor.height <= 0) {
    expect(
      ask.y,
      `${what}: the live selection is above the viewport, so the button must be pinned to the top edge; it is at y=${ask.y.toFixed(1)}`,
    ).toBeLessThanOrEqual(VIEWPORT_MARGIN + 1)
    return
  }
  if (anchor.y >= viewport.height) {
    expect(
      ask.y + ask.height,
      `${what}: the live selection is below the viewport, so the button must be pinned to the bottom edge; its bottom is ${(ask.y + ask.height).toFixed(1)}`,
    ).toBeGreaterThanOrEqual(viewport.height - VIEWPORT_MARGIN - 1)
    return
  }

  // The product's own gap, with room for the reflow between the anchor being
  // re-read and the frame that placed the button.
  const gap = anchor.y - (ask.y + ask.height)
  expect(
    Math.abs(gap - VIEWPORT_MARGIN),
    `${what}: the button must stay anchored to the live selection; the anchor is at y=${anchor.y.toFixed(1)} ` +
      `and the button's bottom is at ${(ask.y + ask.height).toFixed(1)}, a gap of ${gap.toFixed(1)}px`,
  ).toBeLessThanOrEqual(72)
}

/**
 * Assert the settled placement against the frozen contract, whichever way it fell.
 *
 * Both outcomes are real and each is fully checked: a live selection must have a
 * pressable, contained, anchored button, and a cleared selection must have none.
 * There is deliberately no third branch — the shape this replaced accepted a
 * button that had simply disappeared while the selection was still live.
 *
 * @param page - the browser page.
 * @param state - the settled state.
 * @param what - the perturbation being judged, for the failure message.
 */
async function expectPlacementContract(page: Page, state: PlacementState, what: string): Promise<void> {
  if (state.selection === '') {
    expectAskAbsent(state, what)
    return
  }

  const viewport = page.viewportSize()
  if (viewport === null) throw new Error('the audit viewport is unknown')

  const ask = requireAskBox(state, what)
  expectInsideViewport(ask, viewport, `the Ask button ${what}`, 0)
  expect(state.hitIsAsk, `${what}: a hit test at the button's centre must reach it, not ${state.hitTag}`).toBe(true)

  const anchor = anchorOf(state, viewport)
  expect(anchor, `${what}: a live selection must publish at least one rectangle`).not.toBeNull()
  if (anchor !== null) expectAnchored(ask, anchor, viewport, what)

  // The unforced actionability check runs the full hit test and viewport check and
  // stops short of the press, so it costs no draft.
  await page.locator(ASK_BUTTON).click({ trial: true, timeout: 10_000 })
}

/**
 * Switch the shell's appearance through its own settings dialog.
 *
 * The path is the product's public one — the settings control opens a dialog
 * whose General section carries the appearance row — so nothing here adds a class
 * to `<html>` to impersonate a theme.
 *
 * @param page - the browser page.
 * @param option - the option's own label, as the product renders it.
 */
async function selectAppearance(page: Page, option: string): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).first().click()
  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: option, exact: true }).first().click()
  await expect.poll(
    async () => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')),
    { timeout: 10_000, message: `choosing ${option} must select the product's own theme` },
  ).toBe(option === '深色')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
}

test.describe('ask surface geometry', () => {
  for (const viewport of VIEWPORTS) {
    test(`keeps the Ask button reachable in a ${viewport.width}x${viewport.height} viewport`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await openShell(page)
      await openFixture(page, 'txt', TEXT_PREVIEW)
      await selectTextLines(page, 0, 1)

      const ask = await readAsk(page)
      expect(ask.present, 'a real selection must publish the Ask button').toBe(true)
      if (ask.box === null) throw new Error('the Ask button published no box')

      expect(ask.box.width, 'the Ask button must have a width').toBeGreaterThan(0)
      expect(ask.box.height, 'the Ask button must have a height').toBeGreaterThan(0)
      expectInsideViewport(ask.box, viewport, 'the Ask button', 0)
      expect(ask.hitIsAsk, `a hit test at the button's centre must reach it, not ${ask.hitTag}`).toBe(true)

      // The unforced actionability check is the release gate for "a reader can
      // press it": a trial click runs the full hit test and viewport check and
      // stops short of the press, so it costs no draft.
      await page.locator(ASK_BUTTON).click({ trial: true, timeout: 10_000 })

      await shot(page, `ask-${viewport.width}x${viewport.height}`)
    })
  }

  test('keeps the Ask button clear of the composer after a spreadsheet selection', async ({ page }) => {
    await openShell(page)

    // The workbook adapter publishes no selection rectangle, so every spreadsheet
    // selection takes the composer-relative fallback path rather than the
    // geometry path — which is exactly the surface this gate measures.
    await openFixture(page, 'xlsx-multi-sheet', '[data-dsa-document-kind="xlsx"]')
    await page.waitForTimeout(4000)

    const content = page.locator('[data-dsa-xlsx-content]').first()
    const grid = content.locator('[role="grid"]').first()
    const gridBox = await boxOf(grid, 'the workbook grid')
    await page.mouse.move(gridBox.x + 60, gridBox.y + 60)
    await page.mouse.down()
    await page.mouse.move(gridBox.x + 160, gridBox.y + 110, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(1200)

    const ask = await readAsk(page)
    expect(ask.present, 'a spreadsheet selection must publish the Ask button').toBe(true)
    if (ask.box === null) throw new Error('the Ask button published no box')

    const viewport = page.viewportSize()
    if (viewport === null) throw new Error('the audit viewport is unknown')
    expectInsideViewport(ask.box, viewport, 'the Ask button', 0)
    expect(ask.hitIsAsk, `a hit test at the button's centre must reach it, not ${ask.hitTag}`).toBe(true)

    // The measured defect this gate closes: the fallback used to place the button
    // inside the composer card, over the right of the editable surface's own box.
    const cardBox = await boxOf(page.locator(COMPOSER_CARD).first(), 'the composer card')
    expect(
      overlapArea(ask.box, cardBox),
      `the Ask button must not overlap the composer card; button ${describeBox(ask.box)} card ${describeBox(cardBox)}`,
    ).toBe(0)

    // And a press aimed at the editable surface must reach the editable surface.
    const inputBox = await boxOf(page.locator(COMPOSER_INPUT).first(), 'the composer input')
    const reached = await page.evaluate(
      (args) => {
        const probes: string[] = []
        for (const fraction of [0.25, 0.5, 0.75, 0.95]) {
          const x = args.box.x + args.box.width * fraction
          const y = args.box.y + args.box.height / 2
          const hit = document.elementFromPoint(x, y)
          probes.push(hit === null ? 'null' : hit.tagName)
        }
        return probes
      },
      { box: inputBox },
    )
    expect(
      reached.includes('BUTTON'),
      `no point across the composer's editable surface may land on a button; the probes returned ${reached.join(', ')}`,
    ).toBe(false)

    await page.locator(ASK_BUTTON).click({ trial: true, timeout: 10_000 })
    await shot(page, 'ask-xlsx-fallback')
  })
})

test.describe('placement follows the viewport', () => {
  test('re-anchors the Ask button when the document preview scrolls', async ({ page }) => {
    await openShell(page)
    await openFixture(page, 'docx-paragraphs', '[data-dsa-document-kind="docx"]')
    await page.waitForTimeout(4000)

    const rows = page.locator('[data-dsa-docx-content] p')
    const selected = await selectRows(page, rows, 0, 1)
    expect(selected.trim(), 'the drag must select rendered text').not.toBe('')

    const before = await readPlacement(page)
    expect(before.selection, 'the drag must leave a live browser selection').not.toBe('')
    const beforeBox = requireAskBox(before, 'before the scroll')

    // A scroll small enough that the selected rows stay on screen. That is the
    // state in which "the button follows the selection" is measurable rather than
    // assumed, and the displacement it produces is what a button left at its old
    // coordinate would fail on.
    const scrollport = await scrollPreview(page, 160)
    expect(scrollport, 'DSH must publish a preview scrollport').not.toBeNull()
    const near = await settlePlacement(page, 'after a 160px preview scroll')
    if (near.selection !== '') {
      const viewport = page.viewportSize()
      if (viewport === null) throw new Error('the audit viewport is unknown')
      const anchor = anchorOf(near, viewport)
      expect(anchor, 'a live selection must still publish geometry after the scroll').not.toBeNull()
      if (anchor !== null) {
        const ask = requireAskBox(near, 'after a 160px preview scroll')
        expect(
          Math.abs(ask.y - beforeBox.y),
          `the scroll must actually have moved the button; it was at y=${beforeBox.y.toFixed(1)} and is at y=${ask.y.toFixed(1)}`,
        ).toBeGreaterThan(20)
      }
    }
    await expectPlacementContract(page, near, 'after a 160px preview scroll')

    // Now scroll the selection out of view. This is the branch the previous shape
    // of this case could not decide: with the anchor off screen, "near the
    // selection" degenerates into a clamp, and a button that had vanished while
    // its selection was still live used to pass here.
    await scrollPreview(page, 900)
    const far = await settlePlacement(page, 'after the selection is scrolled out of view')
    await expectPlacementContract(page, far, 'after the selection is scrolled out of view')

    // And the other half of the same state machine, on the same page: a real
    // press on neutral chrome collapses the browser selection, and the button must
    // go with it rather than describe text the reader has dismissed.
    await page.locator(PREVIEW_BODY).first().click({ position: { x: 40, y: 40 }, timeout: 15_000 })
    const cleared = await settlePlacement(page, 'after a real press clears the selection')
    expect(cleared.selection, 'the press must genuinely clear the browser selection').toBe('')
    expectAskAbsent(cleared, 'after a real press clears the selection')

    await shot(page, 'ask-after-scroll')
  })

  test('keeps the Ask button inside the viewport after a viewport resize', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await openShell(page)
    await openFixture(page, 'docx-paragraphs', '[data-dsa-document-kind="docx"]')
    await page.waitForTimeout(4000)

    const rows = page.locator('[data-dsa-docx-content] p')
    await selectRows(page, rows, 0, 1)

    const before = await readPlacement(page)
    expect(before.selection, 'the drag must leave a live browser selection').not.toBe('')
    requireAskBox(before, 'before the resize')

    await page.setViewportSize({ width: 900, height: 600 })
    const after = await settlePlacement(page, 'after a viewport resize')

    // The resize only changes the viewport, so the selection is expected to
    // survive it; the contract is asserted either way rather than the button being
    // allowed to disappear into a branch that asserts nothing.
    await expectPlacementContract(page, after, 'after a viewport resize')

    await shot(page, 'ask-after-resize')
  })

  test('keeps the Ask button valid when the document column is resized', async ({ page }) => {
    await openShell(page)
    await openFixture(page, 'docx-paragraphs', '[data-dsa-document-kind="docx"]')
    await page.waitForTimeout(4000)

    const rows = page.locator('[data-dsa-docx-content] p')
    await selectRows(page, rows, 0, 1)
    const before = await readPlacement(page)
    expect(before.selection, 'the drag must leave a live browser selection').not.toBe('')
    requireAskBox(before, 'before the column resize')

    // The shell exposes one column handle; the case fails rather than skips when
    // it disappears, because a resize the product does not offer cannot be
    // audited and must be reported as such rather than silently passing.
    const handle = page.locator('[class*="handle"]').first()
    await expect(handle, 'the shell must expose its column resize handle').toBeVisible({ timeout: 10_000 })
    const handleBox = await boxOf(handle, 'the column resize handle')

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 120, handleBox.y + handleBox.height / 2, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(1500)

    const after = await settlePlacement(page, 'after a column resize')
    await expectPlacementContract(page, after, 'after a column resize')

    await shot(page, 'ask-after-column-resize')
  })
})

test.describe('keyboard and pointer interaction', () => {
  test('reaches the Ask button by Tab where the tab order allows it, and always activates it from focus', async ({ page }) => {
    await openShell(page)
    await openFixture(page, 'txt', TEXT_PREVIEW)
    const selected = await selectTextLines(page, 0, 1)
    expect(selected.trim(), 'the drag must select text before the keyboard case runs').not.toBe('')

    const turnsBefore = await page.locator('[data-chat-turn]').count()
    await expect(page.locator(ASK_BUTTON)).toBeVisible({ timeout: 15_000 })

    // The traversal starts from the page background, which is where a reader who
    // has just finished a mouse selection is. `blur` moves focus and nothing else:
    // the selection stays live, as the assertions below re-check.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })

    const trail: string[] = []
    let reached = false
    for (let press = 0; press < 200 && !reached; press += 1) {
      await page.keyboard.press('Tab')
      const seen = await page.evaluate((selector) => {
        const active = document.activeElement
        return {
          isAsk: active !== null && active.matches(selector),
          stillMounted: document.querySelector(selector) !== null,
          name: active === null
            ? 'null'
            : `${active.tagName}:${(active.getAttribute('aria-label') ?? active.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 18)}`,
        }
      }, ASK_BUTTON)
      if (seen.isAsk) reached = true
      if (trail.length < 14) trail.push(seen.name)
      if (!seen.stillMounted) break
    }

    if (!reached) {
      // One outcome other than "reached" is legitimate, and it is a property of the
      // frozen selection contract rather than of this surface: a traversal that
      // passes *through* the composer's editable surface moves the caret into it,
      // which collapses the browser selection, and a capture that finds no
      // selection clears the snapshot — so the button goes with it. What may never
      // happen is a button that disappears while a selection is still live, and
      // that is what this branch asserts.
      const state = await page.evaluate((selector) => ({
        mounted: document.querySelector(selector) !== null,
        selection: document.getSelection()?.toString() ?? '',
      }), ASK_BUTTON)
      expect(
        state.selection,
        `the Ask button may only leave the DOM once the browser selection is gone; the traversal visited ${trail.join(' | ')}`,
      ).toBe('')
      expect(state.mounted, 'a cleared selection must also remove the button').toBe(false)
    }

    // The activation path is asserted from a deterministic focus rather than from
    // wherever the traversal stopped: the question here is whether the control can
    // be focused and driven by keyboard at all, and that must not depend on the
    // shell's tab order.
    const button = page.locator(ASK_BUTTON)
    if ((await button.count()) === 0) {
      // The traversal cleared the selection, so the case re-selects and focuses.
      await selectTextLines(page, 0, 1)
      await expect(button).toBeVisible({ timeout: 15_000 })
    }
    await button.focus()

    const focused = await readAsk(page)
    expect(focused.outlineStyle, 'the focused button must publish an outline style').toBe('solid')
    expect(Number.parseFloat(focused.outlineWidth), 'the focus ring must be at least 2px').toBeGreaterThanOrEqual(2)
    expect(focused.outlineOffset, 'the focus ring must be offset from the button edge').not.toBe('0px')
    const ring = parseColor(focused.outlineColor)
    expect(ring, 'the focus ring colour must resolve').not.toBeNull()
    if (ring !== null) expect(ring.a, 'the focus ring must be opaque').toBeGreaterThan(0.5)

    await shot(page, 'ask-keyboard-focus')

    await page.keyboard.press('Enter')
    await page.waitForTimeout(1200)

    const draft = await readDraft(page)
    expect(draft, 'Enter must append the quote').toContain('task5b-smoke.txt')
    expect(
      await page.evaluate((selector) => document.activeElement?.matches(selector) === true, COMPOSER_INPUT),
      'the composer must hold focus after an ask',
    ).toBe(true)
    expect(
      await page.locator('[data-chat-turn]').count(),
      'the ask must never submit the message',
    ).toBe(turnsBefore)
  })

  test('activates the Ask button with Space', async ({ page }) => {
    await openShell(page)
    await openFixture(page, 'txt', TEXT_PREVIEW)
    await selectTextLines(page, 0, 1)
    await expect(page.locator(ASK_BUTTON)).toBeVisible({ timeout: 15_000 })

    await page.locator(ASK_BUTTON).focus()
    await page.keyboard.press('Space')
    await page.waitForTimeout(1200)

    expect(await readDraft(page), 'Space must append the quote').toContain('task5b-smoke.txt')
  })

  test('keeps the selection through a pointer press and appends the quote on release', async ({ page }) => {
    await openShell(page)
    await openFixture(page, 'txt', TEXT_PREVIEW)
    const selected = await selectTextLines(page, 0, 1)
    expect(selected.trim()).not.toBe('')

    const ask = await readAsk(page)
    if (ask.box === null) throw new Error('the Ask button published no box')

    await page.mouse.move(ask.box.x + ask.box.width / 2, ask.box.y + ask.box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(150)

    expect(
      await page.evaluate(() => document.getSelection()?.toString() ?? ''),
      'a press on the button must not destroy the selection it describes',
    ).toBe(selected)

    await page.mouse.up()
    await page.waitForTimeout(1200)

    const draft = await readDraft(page)
    expect(draft, 'the press must append the quote').toContain('task5b-smoke.txt')
    expect(
      await page.evaluate((selector) => document.activeElement?.matches(selector) === true, COMPOSER_INPUT),
      'the composer must hold focus after an ask',
    ).toBe(true)
  })

  test('publishes the button with a 24px target, an accessible name and a live notice region', async ({ page }) => {
    await openShell(page)
    await openFixture(page, 'txt', TEXT_PREVIEW)
    await selectTextLines(page, 0, 1)

    const ask = await readAsk(page)
    if (ask.box === null) throw new Error('the Ask button published no box')
    expect(ask.box.width, 'the Ask target must be at least 24px wide').toBeGreaterThanOrEqual(MIN_TARGET_SIZE)
    expect(ask.box.height, 'the Ask target must be at least 24px tall').toBeGreaterThanOrEqual(MIN_TARGET_SIZE)
    expect(ask.text, 'the Ask button must carry its accessible name as text').toBe('询问 DeepSeek')

    // The live region is mounted before there is anything to announce: a region
    // that arrives already populated is not reliably announced, and this notice is
    // the only channel a refused capture has.
    await expect(page.locator(NOTICE_REGION), 'the notice region must be mounted with the surface').toHaveCount(1)
    await expect(page.locator(NOTICE), 'no notice may be shown while nothing was refused').toHaveCount(0)

    const region = await page.evaluate((selector) => {
      const element = document.querySelector(selector)
      if (element === null) return null
      const rect = element.getBoundingClientRect()
      return {
        role: element.getAttribute('role'),
        live: element.getAttribute('aria-live'),
        width: rect.width,
        height: rect.height,
        pointerEvents: getComputedStyle(element).pointerEvents,
      }
    }, NOTICE_REGION)

    expect(region?.role, 'the region must publish the status role').toBe('status')
    expect(region?.live, 'the region must be a polite live region').toBe('polite')
    expect(region?.width, 'an empty region must occupy no width').toBe(0)
    expect(region?.height, 'an empty region must occupy no height').toBe(0)
    expect(region?.pointerEvents, 'an empty region must not intercept a press').toBe('none')
  })
})

test.describe('contrast', () => {
  test('keeps the Ask button above the text contrast threshold in both states', async ({ page }) => {
    await openShell(page)
    await openFixture(page, 'txt', TEXT_PREVIEW)
    await selectTextLines(page, 0, 1)

    const normal = await readAsk(page)
    const normalForeground = parseColor(normal.color)
    const normalBackground = parseColor(normal.background)
    expect(normalForeground, `the button's colour must resolve: ${normal.color}`).not.toBeNull()
    expect(normalBackground, `the button's background must resolve: ${normal.background}`).not.toBeNull()
    if (normalForeground === null || normalBackground === null) return

    const normalRatio = contrastRatio(normalForeground, normalBackground)
    expect(
      normalRatio,
      `the Ask label must reach ${MIN_TEXT_CONTRAST}:1; ${normal.color} on ${normal.background} measures ${normalRatio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)

    await page.locator(ASK_BUTTON).hover()
    await page.waitForTimeout(250)
    const hovered = await readAsk(page)
    const hoverForeground = parseColor(hovered.color)
    const hoverBackground = parseColor(hovered.background)
    if (hoverForeground === null || hoverBackground === null) throw new Error('the hover colours must resolve')

    const hoverRatio = contrastRatio(hoverForeground, hoverBackground)
    expect(
      hoverRatio,
      `the hovered Ask label must reach ${MIN_TEXT_CONTRAST}:1; ${hovered.color} on ${hovered.background} measures ${hoverRatio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
  })

  test('keeps renderer status copy readable while a document loads', async ({ page }) => {
    await openShell(page)
    await observeStatusSurfaces(page)

    // Each fixture is opened by an ordinary click and its loading surface is then
    // measured as it stands. A large fixture is used for each format so the state
    // is observable rather than a single frame: the point of the gate is the
    // colour pair the reader actually sees while waiting.
    await page.locator('[data-dsa-smoke-open="pptx-large-120-slides"]').click()
    const pptx = await captureStatusSurface(page, '[data-dsa-pptx-status]', 15_000)
    expect(pptx, 'the PPTX status surface must appear while the presentation loads').not.toBeNull()
    if (pptx !== null) expectReadableStatus(pptx, 'the PPTX loading state', true)
    await page.waitForTimeout(5000)

    await page.locator('[data-dsa-smoke-open="docx-external-links"]').click()
    const docx = await captureStatusSurface(page, '[data-dsa-docx-status]', 15_000)
    expect(docx, 'the DOCX status surface must appear while the document loads').not.toBeNull()
    if (docx !== null) expectReadableStatus(docx, 'the DOCX loading state', true)
    await page.waitForTimeout(4000)

    await page.locator('[data-dsa-smoke-open="xlsx-large"]').click()
    const xlsx = await captureStatusSurface(page, '.dsa-xlsx-status', 15_000)
    expect(xlsx, 'the workbook status surface must appear while the workbook is checked').not.toBeNull()
    // The workbook status block inherits the sheet's canvas rather than painting
    // one, so only the composited pair is asserted here.
    if (xlsx !== null) expectReadableStatus(xlsx, 'the workbook loading state', false)
  })

  test('keeps the workbook and presentation shells legible in the product dark theme', async ({ page }) => {
    await openShell(page)
    await selectAppearance(page, '深色')

    // The renderer's own refusal path, reached with real bytes rather than by
    // inserting a look-alike element: `xlsx-corrupt` is a file whose ZIP header is
    // followed by nothing, so the OOXML preflight refuses it and the product paints
    // `.dsa-xlsx-error`. Until Task 15UR no fixture reached this branch, which is
    // why its dark-theme contrast had never been measured on the real surface.
    await openFixture(page, 'xlsx-corrupt', '[data-dsa-document-kind="xlsx"]')
    await expect(
      page.locator('.dsa-xlsx-error'),
      'a corrupted workbook must reach the renderer\'s own refusal path',
    ).toBeVisible({ timeout: 30_000 })
    const failure = await measureStatus(page, '.dsa-xlsx-error')
    expect(failure, 'a corrupted workbook must reach the renderer\'s own failure surface').not.toBeNull()
    if (failure !== null) {
      expect(failure.text, 'the failure surface must carry the product\'s own diagnosis').not.toBe('')
      expectReadableStatus(failure, 'the workbook failure copy in dark theme', true)
      await shot(page, 'xlsx-dark-failure')
    }

    // The theme tokens this surface depends on, read where it is painted. In rc.2
    // neither resolves, so both declared fallbacks paint: the canvas fallback is the
    // sheet's white and the danger fallback is the darkened red. Recording the pair
    // is what makes the measurement above a statement about the design system
    // rather than about one run.
    const tokens = await page.evaluate(() => {
      const element = document.querySelector('.dsa-xlsx-error')
      if (element === null) return null
      const style = getComputedStyle(element)
      return {
        canvas: style.getPropertyValue('--dsw-alias-bg-canvas').trim(),
        danger: style.getPropertyValue('--dsw-alias-state-danger-primary').trim(),
        color: style.color,
      }
    })
    expect(tokens, 'the failure surface must be measurable while it is on screen').not.toBeNull()
    if (tokens !== null && tokens.danger === '') {
      // The architecture claim, stated as an assertion rather than as prose: with
      // no themed danger colour defined, the style sheet's fallback is the only
      // thing standing between this copy and illegibility, so the fallback must be
      // the colour that actually paints. A resolved token is judged by the contrast
      // gate above and not pinned to a literal here.
      expect(
        tokens.color,
        'an unresolved danger token leaves the declared fallback as the only protection, so it must be the colour that paints',
      ).toBe('rgb(180, 35, 24)')
    }

    await openFixture(page, 'xlsx-multi-sheet', '[data-dsa-document-kind="xlsx"]')
    await page.waitForTimeout(4000)

    const content = page.locator('[data-dsa-xlsx-content]').first()
    const grid = content.locator('[role="grid"]').first()
    const gridBox = await boxOf(grid, 'the workbook grid')
    await page.mouse.move(gridBox.x + 60, gridBox.y + 60)
    await page.mouse.down()
    await page.mouse.move(gridBox.x + 160, gridBox.y + 110, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(1200)

    // A real semantic selection in dark theme must publish the surface; the
    // measurement that follows is only evidence about a button that exists.
    const ask = await readAsk(page)
    expect(ask.present, 'a real spreadsheet selection must publish the Ask button in dark theme').toBe(true)
    expect(ask.box, 'the dark-theme Ask button must publish a bounding box').not.toBeNull()
    if (ask.box === null) throw new Error('the dark-theme Ask button published no box')

    const foreground = parseColor(ask.color)
    const background = parseColor(ask.background)
    expect(foreground, `the dark-theme colour must resolve: ${ask.color}`).not.toBeNull()
    expect(background, `the dark-theme background must resolve: ${ask.background}`).not.toBeNull()
    if (foreground === null || background === null) throw new Error('the dark-theme colours must resolve')

    const ratio = contrastRatio(foreground, background)
    expect(
      ratio,
      `the Ask label must stay readable in dark theme; ${ask.color} on ${ask.background} measures ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    expect(ask.hitIsAsk, 'the button must stay pressable in dark theme').toBe(true)

    const viewport = page.viewportSize()
    if (viewport === null) throw new Error('the audit viewport is unknown')
    expectInsideViewport(ask.box, viewport, 'the dark-theme Ask button', 0)
    await page.locator(ASK_BUTTON).click({ trial: true, timeout: 10_000 })

    await shot(page, 'ask-dark-theme')

    // The status surfaces follow the same theme, so their pair is measured here
    // too rather than only in the light theme: a colour that is readable on the
    // light card can be the one that disappears on the dark one, and that is
    // exactly what this audit measured before the fix.
    await observeStatusSurfaces(page)
    await page.locator('[data-dsa-smoke-open="pptx-large-120-slides"]').click()
    const darkStatus = await captureStatusSurface(page, '[data-dsa-pptx-status]', 15_000)
    expect(darkStatus, 'the PPTX status surface must appear in dark theme').not.toBeNull()
    if (darkStatus !== null) expectReadableStatus(darkStatus, 'the PPTX status in dark theme', true)

    await selectAppearance(page, '浅色')
  })
})

test.describe('localization', () => {
  test('renders the product copy in the default Chinese locale', async ({ page }) => {
    await openShell(page)
    await expect(page.locator('html')).toHaveAttribute('lang', /^zh/)

    await openFixture(page, 'txt', TEXT_PREVIEW)
    await selectTextLines(page, 0, 1)

    const ask = await readAsk(page)
    expect(ask.text, 'the Chinese Ask label must render verbatim').toBe('询问 DeepSeek')
    expect(ask.text, 'no replacement character may appear in the label').not.toContain('\uFFFD')
  })

  test('renders the same surfaces in English without falling back to Chinese', async ({ browser }) => {
    // The workspace picker is addressed by its localized accessible name, so an
    // English context cannot be pointed at this repository the way the Chinese
    // one is. The product's own persisted selection is therefore carried across
    // from a Chinese context instead of the picker being driven by a guessed
    // English label: the state is the product's, and nothing is synthesized.
    const chinese = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 720 } })
    const chinesePage = await chinese.newPage()
    try {
      await openShell(chinesePage)
    } finally {
      await chinesePage.waitForTimeout(500)
    }
    const state = await chinese.storageState()
    await chinese.close()

    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 720 },
      storageState: state,
    })
    const page = await context.newPage()

    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.waitForTimeout(12_000)
      await expect(page.locator(COMPOSER_INPUT).first()).toBeVisible({ timeout: 30_000 })
      await expect(page.locator(DRIVER).first()).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('html')).toHaveAttribute('lang', /^en/)

      await openFixture(page, 'txt', TEXT_PREVIEW)
      await selectTextLines(page, 0, 1)

      const ask = await readAsk(page)
      expect(ask.text, 'the English Ask label must render verbatim').toBe('Ask DeepSeek')

      // The renderer's own notices resolve through the same language, so none of
      // them may carry Chinese text in an English document.
      await openFixture(page, 'pptx-large-120-slides', '[data-dsa-document-kind="pptx"]')
      const statuses = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dsa-pptx-status],[data-dsa-docx-status],[data-dsa-xlsx-status]')).map(
          (element) => (element.textContent ?? '').trim(),
        ),
      )
      for (const text of statuses) {
        expect(text, `renderer copy must be English in an English document: ${text}`).not.toMatch(/[\u4e00-\u9fff]/)
      }

      await shot(page, 'ask-english')
    } finally {
      await context.close()
    }
  })
})
