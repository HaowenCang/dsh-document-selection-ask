/**
 * Task 13 acceptance: the universal document-selection contract, stated once per
 * supported document class, against one live DSH instance.
 *
 * ## What makes this suite different from the five format suites
 *
 * `real-dsh-textpreview.spec.ts`, `pdf-renderer.spec.ts`, `docx-selection.spec.ts`,
 * `pptx-selection.spec.ts` and `xlsx-selection.spec.ts` each own one renderer and
 * prove that renderer's own DOM contract: that a document is drawn, that the
 * nodes an adapter reads exist, and that one gesture in that renderer produces a
 * quote. Each states its invariant for its own class, with its own helper set,
 * and none of them states the invariant the product actually ships — that the
 * *same* eight steps hold for every supported class through the same Ask surface.
 *
 * This suite asserts that shared invariant, once per class, and adds the two
 * properties no per-format suite can state: a selection whose endpoints live in
 * two disconnected roots is refused and leaves no live snapshot behind, and that
 * refusal does not break the selection lifecycle — the next real gesture in the
 * same page and the same preview is quoted normally, with its own provenance.
 *
 * ## The invariant, in the order every format case asserts it
 *
 * 1. the document was opened by an ordinary actionability-checked click on the
 *    smoke driver's own control, and the preview that mounted is genuinely ready:
 *    its published identity names the renderer under test, its published address
 *    names the fixture path, and its own rendered content is present with the
 *    expected element count;
 * 2. a sentinel draft is typed into the composer with real key presses and read
 *    back from the composer before anything is selected;
 * 3. the selection is produced by a real user-level gesture for that class —
 *    never programmatically, and never by calling the kernel, an adapter, the
 *    registry or the selection bridge;
 * 4. the Ask button is visible and carries the contract label;
 * 5. it is pressed with an ordinary `locator.click()` while the sentinel is still
 *    the composer's whole draft;
 * 6. the draft still starts with the sentinel, the provenance and the selected
 *    content are the exact contract strings, and nothing follows the question
 *    suffix;
 * 7. no real form `submit` event occurred and the transcript row count is
 *    unchanged — observed per case, through an observer installed before the
 *    application boots;
 * 8. focus is back in the composer's editable surface.
 *
 * ## The gesture each class uses, and why that one
 *
 * TXT, CSV and code are drawn by the product's builtin text renderers, where a
 * row's leading edge is outside its own glyphs: a drag anchored there snaps to
 * the nearest character, so the gesture is a real press inside the row followed
 * by a real held Shift and a real click at the row's end — the mechanism
 * `real-dsh-textpreview.spec.ts` measured.
 *
 * Markdown and PPTX render prose, so their gesture is a real progressive mouse
 * drag whose endpoints are the target's own glyph rects — the first non-empty text
 * node's first client rect and the last one's last client rect — each one *scanned*
 * rightwards or leftwards within its own rect until a hit test reaches a node inside
 * the renderer's content root, because the shell covers some of the pixels the
 * document was laid out on. DOCX is the case where no drag can work: its preview
 * column is a fixed 576 px wide at every viewport, the DOCX page overflows it by
 * 13 px on the left, and the first pointer-reachable pixel is roughly two
 * characters into the paragraph, so the paragraph is taken with a real triple
 * click, the one pointer gesture whose extent the browser computes from the block
 * rather than from the pixel. The measured numbers are recorded in that case.
 *
 * PDF has no element that wraps its text — a page is a canvas with absolutely
 * positioned text-layer spans over it — so the gesture is a real drag across the
 * spans of one measured line of page 1.
 *
 * XLSX paints into a canvas and publishes no per-cell elements at all, so its
 * gesture is the semantic cell-range drag the sibling XLSX suite calibrated, and
 * the range it produced is read back from the renderer's own published
 * `data-dsa-xlsx-selection` before Ask is pressed. The provenance asserted is
 * built from that value, so it is a statement about the range the gesture made
 * rather than about the range it was meant to make.
 *
 * Everywhere a gesture can be exact, it is required to be exact: the cases repeat
 * the same real gesture, re-measuring the target each time, until the browser
 * reports the contract string, and then assert that string. A run that cannot
 * reach it fails with what the browser actually selected.
 *
 * ## What is deliberately absent
 *
 * No `force: true`, no `locator.dispatchEvent`, no in-page `.click()` on a
 * product control, and no `page.evaluate` that fires events or selects text —
 * with one documented exception, the cross-root case, whose subject *is* the
 * browser's own cross-root selection. No `waitForTimeout` stands in for evidence:
 * every "did this happen" conclusion below is read from a locator, a published
 * attribute, the composer's own text or an observer, and the short waits that do
 * appear are the ones the sibling suites already justify in place.
 *
 * ## The instance
 *
 * `DSH_SMOKE_URL` names a running DSH web instance carrying this plugin, the
 * test-only driver and the generated fixtures; without it the spec is skipped so
 * `pnpm test:browser` stays usable on a machine with no DSH installed. The
 * session workspace is the registered root `tests/browser/helpers/shell.ts`
 * selects by default — the fixture addresses the driver builds are session-scoped
 * and resolve against it.
 */

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { ensureWorkspace } from './helpers/shell.js'

/** The running DSH instance this acceptance suite drives. */
const BASE_URL = process.env['DSH_SMOKE_URL'] ?? ''

test.skip(BASE_URL === '', 'set DSH_SMOKE_URL to a running DSH instance booted from the dsa-smoke profile')

/** The smoke driver's control strip, and the label it publishes its own text under. */
const DRIVER = '[data-dsa-smoke-driver]'
const DRIVER_LABEL = '[data-dsa-smoke-label]'

/** The composer's editable surface. */
const COMPOSER_INPUT = '[data-composer-input]'

/** The Ask button this plugin contributes, and its contract label. */
const ASK_BUTTON = '[data-dsa-selection-ask-button]'
const ASK_LABEL = '\u8be2\u95ee DeepSeek'

/** The transcript row the product appends when a message is actually sent. */
const CHAT_TURN = '[data-chat-turn]'

/** The product's builtin document preview and the attributes it publishes. */
const PREVIEW_STATE = '[data-textpreview-state]'
const PREVIEW_STATE_ATTRIBUTE = 'data-textpreview-state'
const PREVIEW_URL_ATTRIBUTE = 'data-textpreview-url'
const PREVIEW_BODY = '[data-textpreview-body]'
const PREVIEW_LINE = '[data-textpreview-line]'
const PREVIEW_RENDERER_ATTRIBUTE = 'data-document-preview'

/** The code renderer's own rows, inside its own content viewport. */
const CODE_LINE = '[data-code-block-content] pre .line'

/**
 * The right column the preview is drawn inside.
 *
 * The same selector `real-dsh-textpreview.spec.ts` uses. It is the published box
 * that bounds a prose gesture's endpoint scan, and it is what keeps a pointer off a
 * pixel the shell owns: a document wider than this column is laid out under the
 * neighbouring chat column, and the pixels there belong to the chat column — or to
 * the shell's own resize handle — rather than to the document.
 */
const PREVIEW_COLUMN = '[data-rightbar-col]'

/** The four plugin renderers' roots and the address attribute they publish. */
const RESOURCE_ADDRESS = 'data-dsa-resource-address'
const PDF_ROOT = '[data-dsa-document-kind="pdf"]'
const DOCX_ROOT = '[data-dsa-document-kind="docx"]'
const PPTX_ROOT = '[data-dsa-document-kind="pptx"]'
const XLSX_ROOT = '[data-dsa-document-kind="xlsx"]'
const DOCX_CONTENT = '[data-dsa-docx-content]'
const DOCX_PAGE = '[data-dsa-docx-page]'
const PPTX_CONTENT = '[data-dsa-pptx-content]'
const PPTX_SLIDE = '[data-dsa-pptx-slide]'
const PPTX_SLIDE_1 = '[data-dsa-pptx-slide="1"]'
const PDF_PAGE = '[data-dsa-pdf-page]'
const PDF_TEXT_LAYER = '[data-dsa-pdf-text]'
const PDF_PLACEHOLDER = '[data-dsa-pdf-placeholder]'
const XLSX_CONTENT = '[data-dsa-xlsx-content]'

/**
 * The XLSX renderer's published semantic selection: `"<sheet>!<range>"`.
 *
 * It is the same pair the adapter turns into provenance, produced by the renderer
 * from the state the adapter reads — so reading it is how this suite states which
 * range its gesture made instead of assuming one.
 */
const XLSX_SELECTION = 'data-dsa-xlsx-selection'

/** Renderer identities as the product registers them. */
const PLAIN_RENDERER = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text'
const MARKDOWN_RENDERER = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown'
const CODE_RENDERER = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code'
const PLUGIN_PDF_RENDERER = 'dsh-document-selection-ask/pdf'
const PLUGIN_DOCX_RENDERER = 'dsh-document-selection-ask/docx'
const PLUGIN_PPTX_RENDERER = 'dsh-document-selection-ask/pptx'
const PLUGIN_XLSX_RENDERER = 'dsh-document-selection-ask/xlsx'

/** The fixture each class is opened through, as the driver's table names it. */
const TXT_FIXTURE = 'smoke-fixtures/task5b-smoke.txt'
const MARKDOWN_FIXTURE = 'smoke-fixtures/task5b-smoke.md'
const CODE_FIXTURE = 'smoke-fixtures/task5b-smoke.ts'
const CSV_FIXTURE = 'smoke-fixtures/task13-smoke.csv'
const PDF_FIXTURE = 'smoke-fixtures/task7-single-page.pdf'
const DOCX_FIXTURE = 'smoke-fixtures/task9-paragraphs.docx'
const PPTX_FIXTURE = 'smoke-fixtures/task10-text-two-slides.pptx'
const XLSX_FIXTURE = 'smoke-fixtures/task11-simple.xlsx'

/** The sentinel every case types before it selects. */
const SENTINEL = 'UNIVERSAL-DRAFT'

/** The selected content each class's gesture must produce, exactly. */
const TXT_LINE_2 = 'beta'
const TXT_LINE_3 = 'gamma'
const CODE_ROW_2 = 'const beta = 2'
const MARKDOWN_PARAGRAPH = 'alpha paragraph'
const CSV_LINE_3 = 'south,57,beta'
const PDF_PAGE_1_LINE_1 = 'Alpha Beta Gamma'
const DOCX_PARAGRAPH_1 = 'DOCX Alpha: Leading paragraph with bold text for native selection.'
const PPTX_SLIDE_1_TEXT = 'PPTX Slide One Alpha'

/**
 * The exact provenance line each class must carry.
 *
 * Derived from `src/client/provenance/format.ts` rather than guessed: the label
 * and the separators are that module's own code points, a single bound prints one
 * number instead of a range of one, a page range this browser produced is worded
 * as a rendered page, and a rendered Markdown document has no source-line mapping
 * so its citation names the file alone.
 */
const TXT_LINE_2_PROVENANCE = '[\u6765\u6e90\uff1atask5b-smoke.txt\uff0c\u7b2c 2 \u884c]'
const TXT_LINE_3_PROVENANCE = '[\u6765\u6e90\uff1atask5b-smoke.txt\uff0c\u7b2c 3 \u884c]'
const CODE_PROVENANCE = '[\u6765\u6e90\uff1atask5b-smoke.ts\uff0c\u7b2c 2 \u884c]'
const MARKDOWN_PROVENANCE = '[\u6765\u6e90\uff1atask5b-smoke.md]'
const CSV_PROVENANCE = '[\u6765\u6e90\uff1atask13-smoke.csv\uff0c\u7b2c 3 \u884c]'
const PDF_PROVENANCE = '[\u6765\u6e90\uff1atask7-single-page.pdf\uff0c\u7b2c 1 \u9875]'
const DOCX_PROVENANCE = '[\u6765\u6e90\uff1atask9-paragraphs.docx\uff0c\u7b2c 1 \u6e32\u67d3\u9875]'
const PPTX_PROVENANCE = '[\u6765\u6e90\uff1atask10-text-two-slides.pptx\uff0c\u7b2c 1 \u5f20\u5e7b\u706f\u7247]'

/** The question line every appended block closes with. */
const QUESTION_SUFFIX = '\u8bf7\u9488\u5bf9\u4ee5\u4e0a\u9009\u4e2d\u5185\u5bb9\u56de\u7b54\uff1a'

/** The Chinese source-line wording, which rendered Markdown must never carry. */
const LINE_PROVENANCE = /\u7b2c \d+ \u884c/u

/**
 * The displayed values of `Sheet1!A1:C3` in `task11-simple.xlsx` — the range the
 * calibrated gesture below produces.
 *
 * These are *display* values, which is what a reader sees and what the contract
 * quotes: the fixture stores `3.5` under the number format `0.00`, and the viewer
 * publishes the formatted string. The sibling XLSX suite measures the same viewer
 * publishing a formatted date and a computed formula result for the
 * formula-values fixture, so "the viewer publishes display values" is a measured
 * property of this runtime rather than an inference. `simple.xlsx` holds no
 * formula in this range, so no assertion here can be satisfied by formula source
 * text.
 */
const XLSX_EXPECTED_TABLE: readonly string[] = [
  '| Column 1 | Column 2 | Column 3 |',
  '| --- | --- | --- |',
  '| Name | Qty | Price |',
  '| Apple | 2 | 3.50 |',
  '| Pear | 4 | 2.25 |',
]

/** The key the submit observer publishes its audit under in the page. */
const SUBMIT_AUDIT_KEY = '__dsaUniversalSubmitAudit'

/** One rectangle in CSS pixels, as the DOM reports it. */
interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One point in CSS pixels. */
interface Point {
  readonly x: number
  readonly y: number
}

/** One pixel an endpoint scan sampled, and what the hit test found there. */
interface ScanSample {
  readonly x: number
  /** The topmost element at that pixel as `TAG.class`, or `null` outside the page. */
  readonly hit: string | null
  /** Whether that element sits inside the target's own content root. */
  readonly inside: boolean
}

/** One endpoint a prose gesture will use, with the scan that chose it. */
interface GestureEndpoint {
  /** Where the pointer will go. */
  readonly x: number
  readonly y: number
  /** The pixel the endpoint was derived from, before the scan. */
  readonly nominalX: number
  /** How many steps the scan took to reach the chosen pixel; `-1` when it found none. */
  readonly scanned: number
  /** Every pixel the scan sampled, in the order it sampled them. */
  readonly scan: readonly ScanSample[]
  /** The topmost element at the chosen pixel as `TAG.class`, or `null`. */
  readonly hit: string | null
  /** Whether that element really sits inside the target's own content root. */
  readonly hitInsideContent: boolean
}

/**
 * What one prose target measured before a gesture.
 *
 * The endpoints are measured from the target's *glyph rects* rather than from its
 * block box: a paragraph is several runs (a bold lead-in and a plain body), and
 * only a text node's own client rects say where the first and last characters
 * actually are. Each endpoint is then *scanned* rather than assumed — the pointer
 * cannot press a pixel the shell has covered, and only a hit test can say which
 * pixel that is.
 */
interface ProseGestureGeometry {
  /** The target's own text, as a selection of it would read. */
  readonly text: string
  /** The target's block box, for the failure report. */
  readonly elementBox: Box
  /** The preview column's published box, or `null` when it published none. */
  readonly columnBox: Box | null
  /** How many non-empty text nodes the target holds. */
  readonly textNodes: number
  /** The first non-empty text node's first client rect. */
  readonly firstRect: Box
  /** The last non-empty text node's last client rect. */
  readonly lastRect: Box
  /** The first reachable pixel at or after the first text node's first glyph rect. */
  readonly firstGlyph: GestureEndpoint
  /** The first reachable pixel at or before the last text node's last glyph rect. */
  readonly lastGlyph: GestureEndpoint
}

/** What one appended block must be, part by part. */
interface AppendedBlock {
  /** The bracketed provenance line, without the blockquote marker. */
  readonly provenance: string
  /** The selected content, one entry per line, without the blockquote marker. */
  readonly quoted: readonly string[]
}

/** Everything one case observed about the ask it performed. */
interface AskObservation {
  /** The draft as the composer holds it after the ask. */
  readonly draft: string
  /** The real `submit` events the page dispatched, or `-1` with no observer. */
  readonly submits: number
  /** Transcript rows before and after, which must be equal. */
  readonly turnsBefore: number
  readonly turnsAfter: number
  /** Whether focus was in the composer's editable surface afterwards. */
  readonly focusedAfter: boolean
}

/**
 * Install the submit observer before the application boots.
 *
 * `addInitScript` runs on the new document before any application script, which
 * is what makes "no auto-submit" an observation about the product rather than
 * about the interval this case happened to watch. The listener is installed in
 * the capture phase at the window, the earliest point a submit can be seen: the
 * event is dispatched at the form, and the capture phase walks down from the
 * window, so a submission that application code stops on the way up is still
 * counted. The listener only counts; it calls nothing and changes no behaviour.
 *
 * @param page - the browser page.
 */
async function installSubmitObserver(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    const audit = { count: 0 }
    ;(globalThis as unknown as Record<string, unknown>)[key] = audit
    window.addEventListener(
      'submit',
      () => {
        audit.count += 1
      },
      true,
    )
  }, SUBMIT_AUDIT_KEY)
}

/**
 * Read how many real `submit` events the page has dispatched.
 * @param page - the browser page.
 * @returns the count, or `-1` when the observer was never installed, so a case
 *   that forgot to install it fails instead of passing vacuously.
 */
async function readSubmitCount(page: Page): Promise<number> {
  return page.evaluate((key: string) => {
    const audit = (globalThis as unknown as Record<string, unknown>)[key] as { count: number } | undefined
    return audit === undefined ? -1 : audit.count
  }, SUBMIT_AUDIT_KEY)
}

/**
 * Collect the page's uncaught errors.
 *
 * `pageerror` is the browser's report of an exception that reached the top of the
 * page, which is how a throw inside the plugin's selection handling surfaces when
 * nothing in the product catches it.
 *
 * @param page - the browser page.
 * @returns a reader for the messages collected so far.
 */
function watchPageErrors(page: Page): () => readonly string[] {
  const messages: string[] = []
  page.on('pageerror', (error: Error) => {
    messages.push(error.message)
  })
  return () => [...messages]
}

/**
 * Read the composer's rendered draft text.
 * @param page - the browser page.
 * @returns the draft as the composer publishes it.
 */
async function readDraft(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-composer-input]')
    return element === null ? '' : element.textContent ?? ''
  })
}

/**
 * Read the text the browser reports as selected.
 * @param page - the browser page.
 * @returns the selection's string, or the empty string when nothing is selected.
 */
async function readBrowserSelection(page: Page): Promise<string> {
  return page.evaluate(() => document.getSelection()?.toString() ?? '')
}

/**
 * Apply the product's own line-end padding rule to a string.
 *
 * `src/client/selection/normalize.ts` strips spaces, tabs and trailing blank
 * lines from every captured selection before it reaches the draft. A rendered
 * line pads its end for its own layout, and a pointer gesture can only reach a
 * glyph rather than the padding after it, so the exact string a gesture can
 * produce is the target with that same padding removed. Nothing else is
 * normalized here: internal spacing, tabs and every code point must match
 * exactly.
 *
 * @param text - the raw string, from the DOM or from the browser's selection.
 * @returns the string with its line-end padding removed.
 */
function withoutLineEndPadding(text: string): string {
  return text.replace(/[ \t\n]+$/u, '')
}

/**
 * Count the transcript rows on screen.
 * @param page - the browser page.
 * @returns the number of `[data-chat-turn]` rows.
 */
async function countTurns(page: Page): Promise<number> {
  return page.locator(CHAT_TURN).count()
}

/**
 * Open the shell, wait for the composer and the driver's control, and point the
 * session at the registered workspace root the fixtures resolve against.
 *
 * The composer is the anchor: the driver's control occupies a session-scoped
 * slot, so it exists only once a session is on screen.
 *
 * @param page - the browser page.
 */
async function openShell(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  // The shell's own boot is the one wait that is not evidence about this plugin:
  // every assertion below is made against a locator, a published attribute or a
  // poll.
  await page.waitForTimeout(12_000)
  await expect(page.locator(COMPOSER_INPUT).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator(DRIVER).first()).toBeVisible({ timeout: 30_000 })
  // The picker lists registered workspace roots, and the default group is the one
  // this session already resolves fixture addresses against; see
  // `tests/browser/helpers/shell.ts`. Without it every fixture would open
  // `workspace-file/not-found`, which reads like a renderer defect.
  await ensureWorkspace(page)
}

/**
 * Assert that a fixture control is genuinely reachable before it is clicked.
 *
 * The click below is an ordinary actionability-checked `locator.click()`, so a
 * control the browser will not accept as clickable fails the case anyway — but it
 * fails with "element is outside of the viewport" after thirty seconds, which
 * names a Playwright retry rather than a geometry. Stating the four bounds first
 * turns that into a measurement: the failing case names the control, its box and
 * the viewport it did not fit.
 *
 * @param button - the fixture control about to be clicked.
 * @param key - the fixture key, for the failure message.
 */
async function expectControlReachable(button: Locator, key: string): Promise<void> {
  await expect(button, `the driver must publish a control for ${key}`).toBeVisible({ timeout: 20_000 })

  const box = await button.boundingBox()
  expect(box, `the control for ${key} must publish a bounding box`).not.toBeNull()
  if (box === null) throw new Error(`the control for ${key} published no bounding box`)

  const viewport = button.page().viewportSize()
  expect(viewport, 'the smoke viewport must be a known size').not.toBeNull()
  if (viewport === null) throw new Error('the smoke viewport is unknown')

  const bounds =
    `the control for ${key} must lie inside the ${viewport.width}x${viewport.height} viewport; ` +
    `its box is x=${box.x.toFixed(1)} y=${box.y.toFixed(1)} w=${box.width.toFixed(1)} h=${box.height.toFixed(1)}`

  expect(box.x, bounds).toBeGreaterThanOrEqual(0)
  expect(box.y, bounds).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width, bounds).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height, bounds).toBeLessThanOrEqual(viewport.height)
}

/**
 * Open one fixture by clicking the smoke driver's own control.
 *
 * This is the only way any case below opens a document: the control is the
 * driver's public navigation call, and which renderer then draws the file is the
 * product's own ranking decision.
 *
 * @param page - the browser page.
 * @param key - the fixture key.
 */
async function clickFixtureControl(page: Page, key: string): Promise<void> {
  const button = page.locator(`[data-dsa-smoke-open="${key}"]`)
  await expectControlReachable(button, key)
  await button.click()
}

/**
 * Open one document the builtin preview renders, and assert it is ready.
 *
 * `data-textpreview-state` is published with `data-textpreview-url` and the
 * renderer identity on the same element, so the assertions below are one
 * statement: the product mounted *that* renderer for *that* fixture and its body
 * exists.
 *
 * @param page - the browser page.
 * @param key - the fixture key.
 * @param path - the fixture path the address must name.
 * @param rendererId - the builtin renderer identity the preview must publish.
 * @returns the address the preview published for itself.
 */
async function openPreviewFixture(page: Page, key: string, path: string, rendererId: string): Promise<string> {
  await clickFixtureControl(page, key)

  const root = page.locator(`${PREVIEW_STATE}[${PREVIEW_URL_ATTRIBUTE}]`).first()
  await expect(root).toHaveAttribute(PREVIEW_STATE_ATTRIBUTE, 'text', { timeout: 40_000 })

  const address = await root.getAttribute(PREVIEW_URL_ATTRIBUTE)
  expect(address, `the preview must publish the address it opened (${key})`).not.toBeNull()
  expect(address, 'the address must be the session-scoped form a Session resolves').toMatch(
    /^dsh-resource:\/\/file\/session\/[^/]+\/smoke-fixtures\//u,
  )
  expect(address, `the address must name ${path}`).toContain(path)

  const published = await root.getAttribute(PREVIEW_RENDERER_ATTRIBUTE)
  expect(published, `DSH must have drawn ${path} with ${rendererId}`).toBe(rendererId)

  await expect(page.locator(PREVIEW_BODY).first()).toBeVisible({ timeout: 30_000 })
  return address ?? ''
}

/**
 * Open one document a plugin renderer draws, and assert it is ready.
 *
 * The renderer root publishes the address it was given, and `data-document-preview`
 * on the nearest ancestor names the *renderer definition* the preview ranked —
 * which is what proves this plugin's definition won rather than merely that some
 * preview mounted.
 *
 * @param page - the browser page.
 * @param rootSelector - the plugin renderer's own root selector.
 * @param key - the fixture key.
 * @param path - the fixture path the address must name.
 * @param rendererId - this plugin's renderer identity.
 * @returns the address the renderer published.
 */
async function openPluginFixture(
  page: Page,
  rootSelector: string,
  key: string,
  path: string,
  rendererId: string,
): Promise<string> {
  await clickFixtureControl(page, key)

  const root = page.locator(rootSelector).first()
  await expect(root, `the renderer for ${path} must publish its root`).toBeVisible({ timeout: 60_000 })

  const address = await root.getAttribute(RESOURCE_ADDRESS)
  expect(address, `the renderer must publish the address it was given (${key})`).not.toBeNull()
  expect(address, 'the address must be the session-scoped form a Session resolves').toMatch(
    /^dsh-resource:\/\/file\/session\/[^/]+\/smoke-fixtures\//u,
  )
  expect(address, `the address must name ${path}`).toContain(path)

  const preview = await root.evaluate(
    (element, attribute) => element.closest(`[${attribute}]`)?.getAttribute(attribute) ?? null,
    PREVIEW_RENDERER_ATTRIBUTE,
  )
  expect(preview, `DSH must have ranked ${rendererId} for ${path}`).toBe(rendererId)

  return address ?? ''
}

/**
 * Type the sentinel into the composer with real key presses, and read it back.
 *
 * The sequence is the one `real-dsh-textpreview.spec.ts` uses: a real click into
 * the composer, select-all, delete, then a real key sequence. Nothing assigns the
 * composer's DOM value and nothing synthesizes an input event.
 *
 * @param page - the browser page.
 */
async function typeSentinelDraft(page: Page): Promise<void> {
  await page.locator(COMPOSER_INPUT).first().click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.type(SENTINEL)
  await page.waitForTimeout(700)
  await expect
    .poll(() => readDraft(page), {
      timeout: 10_000,
      message: 'the composer must hold the sentinel draft before anything is selected',
    })
    .toBe(SENTINEL)
}

/**
 * Assert the Ask button is on screen and carries the contract label.
 * @param page - the browser page.
 */
async function expectAskButton(page: Page): Promise<void> {
  const ask = page.locator(ASK_BUTTON).first()
  await expect(ask, 'the Ask button must appear for a real selection in a supported preview').toBeVisible({
    timeout: 20_000,
  })
  await expect(ask, 'the Ask button must carry the contract label').toHaveText(ASK_LABEL)
}

/**
 * The attempts the PDF line gesture is given, each re-measuring the text layer.
 *
 * A PDF page offers no element that wraps its text, so this path measures grouped
 * text-layer spans rather than a target element's text nodes, and it owns its own
 * table. The prose targets' drags are {@link PROSE_DRAGS}.
 */
const DRAG_ATTEMPTS: readonly { readonly settle: number; readonly inset: number }[] = [
  { settle: 0, inset: 1 },
  { settle: 900, inset: 1 },
  { settle: 1800, inset: 2 },
  { settle: 1800, inset: 0.5 },
  // The last resort reaches a few pixels past the line's own box. A caret placed
  // beyond the last glyph snaps to the nearest text position, which for a point
  // just past the end of a line is the end of that line; a target whose text does
  // not end there still fails, because the required string is compared exactly.
  { settle: 1800, inset: -4 },
]

/**
 * Perform one real pointer drag between two viewport points.
 * @param page - the browser page.
 * @param from - where the pointer presses.
 * @param to - where it releases.
 */
async function dragBetween(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 16 })
  await page.mouse.up()
}

/**
 * Describe a measured box for a failure report.
 * @param box - the box, or `null` when nothing published one.
 * @returns a compact single-line description.
 */
function describeBox(box: Box | null): string {
  return box === null
    ? 'absent'
    : `x=${box.x.toFixed(1)} y=${box.y.toFixed(1)} w=${box.width.toFixed(1)} h=${box.height.toFixed(1)}`
}

/**
 * Measure the endpoints of a prose gesture, scan each one to a pixel the document
 * owns, and report the whole scan.
 *
 * Three measurements decide the two points, and each exists because the naive
 * version was measured to be wrong.
 *
 * The endpoints come from the target's **text nodes**, not from its block box and
 * not from its first line box alone. A rendered paragraph is several runs — the
 * `task9-paragraphs.docx` lead-in is a bold run and its body a plain one — and the
 * live measurement of that paragraph recorded a first-text-node rect of 96 px
 * against a last-text-node rect of 378 px, so a gesture aimed at the first rect's
 * right edge would take the lead-in and stop. The press is derived from the *first*
 * non-empty text node's first client rect and the release from the *last* non-empty
 * text node's last client rect, which spans every run.
 *
 * Each derived pixel is then **scanned** along x until the hit test reaches a node
 * inside the target's own content root, because the shell covers some of the
 * pixels the document was laid out on. The live measurement recorded the DOCX
 * paragraph laid out from x = 691 while its column begins at x = 704 — the page
 * overflows the column by 13 px on the left — and `document.elementFromPoint` at
 * `column.left + 1` reaching the shell's own resize handle `DIV.pI_x6G_handle`; the
 * first pixel inside the content was `column.left + 5`. The scan is bounded by the
 * glyph rect it was derived from, so a press may only move within the run it aimed
 * at, and the release only within the last run. A scan that finds nothing is a
 * failure with every pixel it sampled, not a silently moved point.
 *
 * This is the same discipline the Ask button's own geometry check applies: a point
 * the document does not own must be a named failure with the geometry in it, not a
 * plausible-looking selection that turns into a text diff.
 *
 * `document.elementFromPoint` is a measurement here: it creates no selection and
 * changes no state.
 *
 * @param target - the element whose text must be selected.
 * @param contentSelector - the target's own content root, which the hit must be inside.
 * @param releaseInset - how far inside the last glyph rect the release is derived; a
 *   negative value reaches past it, where the scan starts beyond the last glyph.
 * @returns the measured geometry, including both scanned endpoints.
 */
async function measureProseGesture(
  target: Locator,
  contentSelector: string,
  releaseInset: number,
): Promise<ProseGestureGeometry> {
  return target.evaluate(
    (element, args: readonly [string, string, number]) => {
      const [content, column, inset] = args
      const toPlain = (rect: DOMRect) => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      })

      const textNodes: Text[] = []
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node !== null) {
        if ((node.textContent ?? '').trim() !== '') textNodes.push(node as Text)
        node = walker.nextNode()
      }

      const rectsOf = (textNode: Text): DOMRect[] => {
        const range = document.createRange()
        range.selectNodeContents(textNode)
        return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
      }

      const elementBox = element.getBoundingClientRect()
      const columnBox = document.querySelector(column)?.getBoundingClientRect() ?? null
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const left = Math.max(columnBox === null ? 0 : columnBox.left, 0)
      const right = Math.min(columnBox === null ? viewport.width : columnBox.right, viewport.width)
      const top = Math.max(columnBox === null ? 0 : columnBox.top, 0)
      const bottom = Math.min(columnBox === null ? viewport.height : columnBox.bottom, viewport.height)

      const first = textNodes[0]
      const last = textNodes[textNodes.length - 1]
      if (first === undefined || last === undefined) {
        throw new Error(`the drag target holds no selectable text inside ${content}`)
      }

      const firstRects = rectsOf(first)
      const lastRects = rectsOf(last)
      const firstRect = firstRects[0]
      const lastRect = lastRects[lastRects.length - 1]
      if (firstRect === undefined || lastRect === undefined) {
        throw new Error(`the drag target's text nodes published no client rect inside ${content}`)
      }

      const contentRoot = document.querySelector(content)
      const describeHit = (hit: Element | null): string | null => {
        if (hit === null) return null
        const className = hit.getAttribute('class')
        return className === null ? hit.tagName : `${hit.tagName}.${className}`
      }

      /**
       * Sample pixels from a derived one in one direction until one is inside the
       * content root, stopping at the glyph rect's own far edge.
       *
       * The scan starts at the derived pixel already brought inside the column, so
       * its step count is the distance the pointer actually moves: a derived pixel
       * that the shell covered is not reported as a run of steps that never left the
       * column's edge.
       */
      const scan = (nominalX: number, nominalY: number, step: number, limitX: number) => {
        const pointY = Math.min(Math.max(nominalY, top + 1), bottom - 1)
        const origin = Math.min(Math.max(nominalX, left + 1), right - 1)
        const samples: { x: number; hit: string | null; inside: boolean }[] = []
        const furthest = Math.abs(limitX - origin)

        for (let moved = 0; moved <= furthest + 1; moved += 1) {
          const pointX = Math.min(Math.max(origin + step * moved, left + 1), right - 1)
          const hit = document.elementFromPoint(pointX, pointY)
          const inside = contentRoot !== null && hit !== null && contentRoot.contains(hit)
          samples.push({ x: pointX, hit: describeHit(hit), inside })
          if (inside) {
            return {
              x: pointX,
              y: pointY,
              nominalX,
              scanned: moved,
              scan: samples,
              hit: describeHit(hit),
              hitInsideContent: true,
            }
          }
          if ((step > 0 && pointX >= limitX) || (step < 0 && pointX <= limitX)) break
        }

        return {
          x: origin,
          y: pointY,
          nominalX,
          scanned: -1,
          scan: samples,
          hit: describeHit(document.elementFromPoint(origin, pointY)),
          hitInsideContent: false,
        }
      }

      return {
        text: element.textContent ?? '',
        elementBox: toPlain(elementBox),
        columnBox: columnBox === null ? null : toPlain(columnBox),
        textNodes: textNodes.length,
        firstRect: toPlain(firstRect),
        lastRect: toPlain(lastRect),
        // Rightwards from the first glyph rect's left edge, bounded by that rect.
        firstGlyph: scan(
          firstRect.x + 1,
          firstRect.y + firstRect.height / 2,
          1,
          Math.min(firstRect.x + firstRect.width, right - 1),
        ),
        // Leftwards from the last glyph rect's right edge, bounded by that rect.
        lastGlyph: scan(
          lastRect.x + lastRect.width - inset,
          lastRect.y + lastRect.height / 2,
          -1,
          Math.max(lastRect.x, left + 1),
        ),
      }
    },
    [contentSelector, PREVIEW_COLUMN, releaseInset] as const,
  )
}

/**
 * Describe a scan as runs of consecutive pixels that reached the same element.
 * @param samples - every pixel the scan sampled, in order.
 * @returns a compact single-line description, or `empty` for a scan that sampled none.
 */
function describeScan(samples: readonly ScanSample[]): string {
  if (samples.length === 0) return 'empty'

  const runs: string[] = []
  let from = samples[0]?.x ?? 0
  let to = from
  let hit = samples[0]?.hit ?? null

  for (const sample of samples.slice(1)) {
    if (sample.hit === hit) {
      to = sample.x
      continue
    }
    runs.push(`${String(from)}-${String(to)}->${String(hit)}`)
    from = sample.x
    to = sample.x
    hit = sample.hit
  }
  runs.push(`${String(from)}-${String(to)}->${String(hit)}`)

  return runs.join(', ')
}

/**
 * Require one scanned endpoint to have landed inside the target's own content root.
 *
 * The failure carries the whole scan — every pixel it sampled and the element each
 * one reached, run-length encoded — together with the target's block box, its two
 * glyph rects, its text-node count and the preview column, so a geometry defect
 * reads as geometry rather than as a diff of whatever text the browser selected
 * instead.
 *
 * @param geometry - the measurement.
 * @param label - which endpoint this is.
 * @param endpoint - the scanned endpoint to check.
 * @param contentSelector - the content root the hit must be inside.
 */
function expectEndpointInsideContent(
  geometry: ProseGestureGeometry,
  label: string,
  endpoint: GestureEndpoint,
  contentSelector: string,
): void {
  const outcome =
    endpoint.scanned < 0
      ? `found no pixel inside ${contentSelector}`
      : `chose x=${endpoint.x.toFixed(1)} after ${String(endpoint.scanned)} step(s)`
  const detail =
    `${label} was derived at x=${endpoint.nominalX.toFixed(1)} y=${endpoint.y.toFixed(1)} and ${outcome}; ` +
    `the scan sampled ${describeScan(endpoint.scan)}; ` +
    `the target's box is ${describeBox(geometry.elementBox)}, its first text rect is ${describeBox(geometry.firstRect)}, ` +
    `its last text rect is ${describeBox(geometry.lastRect)}, it holds ${String(geometry.textNodes)} text node(s), ` +
    `and the preview column is ${describeBox(geometry.columnBox)}`

  expect(endpoint.hitInsideContent, `${detail}; the pointer must land inside ${contentSelector}`).toBe(true)
}

/**
 * The drags one reachable prose target is given, in order, each re-measuring.
 *
 * Only the release point moves between attempts, by at most two pixels, and the
 * column is given longer to settle each time — which is what the earlier suites
 * measured the reveal animation to require. This path is for targets whose first
 * glyph is reachable, which is a measurement the caller's case records: a target
 * whose leading characters are laid out under the neighbouring column cannot be
 * taken by a drag at all, and is selected by {@link tripleClickProseExact} instead.
 */
const PROSE_DRAGS: readonly { readonly settle: number; readonly inset: number }[] = [
  { settle: 0, inset: 1 },
  { settle: 900, inset: 1 },
  { settle: 1800, inset: 2 },
]

/**
 * Select a reachable prose target's own text with real drags until the browser
 * reports it, and require the result to be the whole of it.
 *
 * The repetition is a re-measurement, not a bypass. The document column animates
 * in when the shell reveals it, so a pixel sampled while it is still moving
 * describes where the text was rather than where it is; every attempt re-measures
 * the glyph rects, re-scans both endpoints and re-runs their hit tests. Nothing
 * selects programmatically: each attempt is a real press, a real pointer path and a
 * real release, and the value the caller receives is the browser's own selection
 * string from the last attempt, so a target that genuinely cannot be taken exactly
 * still fails — with what the browser selected instead.
 *
 * @param page - the browser page.
 * @param target - the element whose text must be selected.
 * @param contentSelector - the target's own content root, for the hit tests.
 * @param expected - the string the gesture must produce, after the product's own
 *   line-end padding rule is applied to both sides.
 * @returns the browser's selection string from the last attempt.
 */
async function dragProseExact(
  page: Page,
  target: Locator,
  contentSelector: string,
  expected: string,
): Promise<string> {
  let selected = ''
  for (const attempt of PROSE_DRAGS) {
    if (attempt.settle > 0) await page.waitForTimeout(attempt.settle)

    const geometry = await measureProseGesture(target, contentSelector, attempt.inset)
    expectEndpointInsideContent(geometry, 'the press endpoint', geometry.firstGlyph, contentSelector)
    expectEndpointInsideContent(geometry, 'the release endpoint', geometry.lastGlyph, contentSelector)

    await dragBetween(page, geometry.firstGlyph, geometry.lastGlyph)

    selected = await readBrowserSelection(page)
    if (withoutLineEndPadding(selected) === expected) return selected
  }
  return selected
}

/**
 * Select a whole prose block with real triple clicks at a scanned, hit-tested pixel.
 *
 * This is the gesture for a block whose leading characters the layout has placed
 * outside the visible column. The measurement is what forces it: the paragraph is
 * laid out from x = 691 while its column begins at x = 704 at every viewport — the
 * column is a fixed 576 px wide, so a larger window moves both boxes together — and
 * the shell's resize handle answers `elementFromPoint` at `column.left + 1`, so the
 * first pixel the document owns is `column.left + 5`. With a 96 px first run for 12
 * characters, the earliest reachable pixel is roughly two characters in, which
 * means no drag endpoint can reach the paragraph's first character however it is
 * measured.
 *
 * The browser computes a triple click's extent from the block the pixel lands in
 * rather than from the pixel itself, which is exactly the property that makes the
 * whole paragraph reachable through a real user-level gesture: real pointer moves
 * and three real press/release pairs carrying detail 1, 2 and 3. Nothing here
 * creates a range and nothing moves the selection by hand.
 *
 * @param page - the browser page.
 * @param target - the element whose text must be selected.
 * @param contentSelector - the target's own content root, for the hit test.
 * @param expected - the string the gesture must produce, after the product's own
 *   line-end padding rule is applied to both sides.
 * @returns the browser's selection string from the last attempt.
 */
async function tripleClickProseExact(
  page: Page,
  target: Locator,
  contentSelector: string,
  expected: string,
): Promise<string> {
  let selected = ''
  for (const settle of [0, 900, 1800]) {
    if (settle > 0) await page.waitForTimeout(settle)

    const geometry = await measureProseGesture(target, contentSelector, 1)
    expectEndpointInsideContent(geometry, 'the triple-click endpoint', geometry.firstGlyph, contentSelector)

    await tripleClickAt(page, geometry.firstGlyph)

    selected = await readBrowserSelection(page)
    if (withoutLineEndPadding(selected) === expected) return selected
  }
  return selected
}

/**
 * Triple click a point with real pointer input.
 *
 * Three press/release pairs with the detail count a real triple click carries, in
 * the order a real one arrives. The browser decides the selection's extent from the
 * block the point lands in, which is the property this gesture is used for; nothing
 * here creates a range or moves the selection itself.
 *
 * @param page - the browser page.
 * @param point - the hit-tested point to click three times.
 */
async function tripleClickAt(page: Page, point: GestureEndpoint): Promise<void> {
  await page.mouse.move(point.x, point.y)
  for (let count = 1; count <= 3; count += 1) {
    await page.mouse.down({ clickCount: count })
    await page.mouse.up({ clickCount: count })
  }
}

/**
 * Read an element's own text.
 * @param target - the element to read.
 * @returns its `textContent`.
 */
async function readTargetText(target: Locator): Promise<string> {
  return target.evaluate((element) => element.textContent ?? '')
}

/**
 * Locate the innermost element of a scope whose own text is exactly `text`.
 *
 * A rendered text box nests the paragraph that holds its text, so matching by
 * containment would aim a gesture at a box far wider than the glyphs. The
 * innermost match — an element whose text matches and no descendant of which also
 * matches — is the element the text itself belongs to.
 *
 * @param page - the browser page.
 * @param scope - the container to search, as a CSS selector.
 * @param text - the exact text to match, after whitespace normalization.
 * @returns the innermost matching element.
 */
async function locatorForInnermostText(page: Page, scope: string, text: string): Promise<Locator> {
  const container = page.locator(scope).first()
  await expect(container, `the renderer must publish ${scope}`).toBeVisible({ timeout: 30_000 })

  const candidates = container.locator('div, span, p')
  const index = await candidates.evaluateAll((nodes, wanted) => {
    const normalize = (value: string | null): string => (value ?? '').replace(/\s+/gu, ' ').trim()
    for (let position = 0; position < nodes.length; position += 1) {
      const node = nodes[position]
      if (node === undefined || normalize(node.textContent) !== wanted) continue
      const nested = [...node.querySelectorAll('*')].some((child) => normalize(child.textContent) === wanted)
      if (!nested) return position
    }
    return -1
  }, text)

  if (index < 0) {
    const observed = await candidates.evaluateAll((nodes) =>
      nodes
        .map((node) => (node.textContent ?? '').replace(/\s+/gu, ' ').trim())
        .filter((value) => value !== '')
        .slice(0, 8),
    )
    throw new Error(
      `${scope} holds no element whose own text is ${JSON.stringify(text)}; ` +
        `the first texts it holds are ${JSON.stringify(observed)}`,
    )
  }

  return candidates.nth(index)
}

/**
 * Select a run of rows: press inside the first row, then shift-click the end of
 * the last one.
 *
 * A single drag across rows is unreliable here, and the reason is measured rather
 * than guessed. These renderers draw each row as a block-level element whose box
 * spans the whole content width, so a row's leading edge is *outside* its own
 * glyphs; a drag anchored there snaps to the nearest character, and the recorded
 * probes saw a two-row drag select only the second row. Anchoring inside the first
 * row's first token and extending with a real Shift+click produces exactly the
 * run, in both the plain and the highlighted renderer shapes.
 *
 * The gesture stays a real one: a real press, a real key held down, a real click
 * at the target. Nothing selects programmatically.
 *
 * @param page - the browser page.
 * @param rows - the rows, in document order.
 * @param fromIndex - the first row to include.
 * @param toIndex - the last row to include.
 * @returns the selected text as the browser reports it.
 */
async function selectRows(page: Page, rows: Locator, fromIndex: number, toIndex: number): Promise<string> {
  const firstToken = rows.nth(fromIndex).locator('span').first()
  const start =
    (await firstToken.count()) > 0 ? await firstToken.boundingBox() : await rows.nth(fromIndex).boundingBox()
  if (start === null) throw new Error('the first row to select has no box')

  const lastRow = rows.nth(toIndex)
  const lastTokens = lastRow.locator('span')
  const tokenCount = await lastTokens.count()
  const end = tokenCount > 0 ? await lastTokens.nth(tokenCount - 1).boundingBox() : await lastRow.boundingBox()
  if (end === null) throw new Error('the last row to select has no box')

  await page.mouse.move(start.x + 1, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(200)

  await page.keyboard.down('Shift')
  await page.mouse.move(end.x + Math.max(1, end.width - 1), end.y + end.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await page.waitForTimeout(900)
  return readBrowserSelection(page)
}

/**
 * Select a run of rows and require the gesture to have taken exactly them.
 *
 * The retry is not a workaround for the plugin. The document column animates in
 * when the shell reveals it, and a drag anchored while it is still moving lands on
 * a different glyph than the one it aimed at; a single `boundingBox()` read cannot
 * tell a settled box from a moving one, so the case repeats the same real gesture,
 * re-measuring the box each time, until the browser reports the run. The
 * requirement is exact equality, so a run that stops short still fails.
 *
 * @param page - the browser page.
 * @param rows - the rows, in document order.
 * @param fromIndex - the first row to include.
 * @param toIndex - the last row to include.
 * @param expected - the text the gesture must have selected.
 * @returns the selected text as the browser reports it.
 */
async function selectExpectedRowsExact(
  page: Page,
  rows: Locator,
  fromIndex: number,
  toIndex: number,
  expected: string,
): Promise<string> {
  let selected = ''
  for (const settle of [0, 800, 1600]) {
    if (settle > 0) await page.waitForTimeout(settle)
    selected = await selectRows(page, rows, fromIndex, toIndex)
    if (selected === expected) return selected
  }
  return selected
}

/**
 * Read the XLSX renderer's published semantic selection.
 * @param page - the browser page.
 * @returns the `"<sheet>!<range>"` value, or `null` when nothing is selected.
 */
async function readPublishedSelection(page: Page): Promise<string | null> {
  return page.evaluate((attribute) => {
    return document.querySelector(`[data-dsa-document-kind="xlsx"]`)?.getAttribute(attribute) ?? null
  }, XLSX_SELECTION)
}

/**
 * Wait for the renderer to publish exactly one range, and return it.
 *
 * Polling the document is the wait; no fixed delay stands in for it. A range that
 * never arrives fails here, with the range that did arrive in the message, rather
 * than producing a provenance assertion about a range nobody selected.
 *
 * @param page - the browser page.
 * @param expected - the exact `"<sheet>!<range>"` the gesture must produce.
 * @returns the published value.
 */
async function expectPublishedSelection(page: Page, expected: string): Promise<string> {
  await expect
    .poll(() => readPublishedSelection(page), {
      timeout: 20_000,
      message: `the XLSX renderer must publish the selection ${expected}`,
    })
    .toBe(expected)
  return expected
}

/**
 * Drag a pointer across a range of the spreadsheet grid.
 *
 * The viewer paints into a canvas and publishes no per-cell elements, so the
 * gesture is made in the grid's own coordinate space: the two points are offsets
 * from the grid's published bounding box. The offsets are not the assertion — the
 * range that results is read back from the renderer's published selection and
 * compared exactly, so a gesture that landed elsewhere fails instead of silently
 * quoting a different range.
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

  await page.mouse.move(box.x + from[0], box.y + from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 8 })
  await page.mouse.up()
}

/**
 * Wait until the workbook has reached the viewer, and return its content surface.
 *
 * `data-dsa-xlsx-content` exists only on the selectable container the renderer
 * mounts once every security gate has passed and the engine is available, so its
 * presence is the readiness gate every later assertion depends on.
 *
 * @param page - the browser page.
 * @returns the content locator.
 */
async function expectWorkbookReady(page: Page): Promise<Locator> {
  const content = page.locator(XLSX_CONTENT).first()
  await expect(content).toBeVisible({ timeout: 35_000 })
  await expect(content.locator('[role="grid"]').first()).toBeVisible({ timeout: 25_000 })
  return content
}

/**
 * Wait until the PDF renderer has a sized canvas and a laid-out text layer.
 * @param page - the browser page.
 * @param pageNumber - the 1-based page number.
 */
async function waitForPage(page: Page, pageNumber: number): Promise<void> {
  const wrapper = page.locator(`[data-dsa-pdf-page="${String(pageNumber)}"]`)
  await expect(wrapper).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(
      async () =>
        wrapper
          .locator('[data-dsa-pdf-canvas]')
          .evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0),
      { timeout: 60_000, message: `page ${String(pageNumber)} never produced a sized canvas` },
    )
    .toBe(true)
  // The placeholder the renderer shows until the first render settles is its own
  // signal that the canvas and the text layer have both finished.
  await expect(wrapper.locator(PDF_PLACEHOLDER)).toHaveCount(0, { timeout: 60_000 })
}

/** One rendered line of a PDF page's text layer. */
interface PdfLine {
  /** The concatenated text of the spans on that line, as the DOM holds it. */
  readonly text: string
  readonly box: Box
}

/**
 * Measure the rendered text lines of one PDF page.
 *
 * The text layer holds one absolutely positioned span per pdf.js text item, so a
 * line of the document is a group of spans sharing a top edge rather than one
 * element. The spans are grouped by that edge and each group's box is the union of
 * its spans' boxes; a small vertical tolerance is used because two spans on one
 * line can start a pixel or two apart.
 *
 * @param page - the browser page.
 * @param pageNumber - the 1-based page number.
 * @returns one entry per rendered line, ordered top to bottom.
 */
async function readPdfLines(page: Page, pageNumber: number): Promise<readonly PdfLine[]> {
  return page.evaluate(
    (selector: string) => {
      const layer = document.querySelector(selector)
      if (layer === null) return []

      const groups: { texts: string[]; left: number; right: number; top: number; bottom: number }[] = []
      for (const span of [...layer.querySelectorAll('span')]) {
        const text = span.textContent ?? ''
        if (text === '') continue
        const box = span.getBoundingClientRect()
        if (box.width <= 0 || box.height <= 0) continue

        const existing = groups.find((group) => Math.abs(group.top - box.top) < 4)
        if (existing === undefined) {
          groups.push({ texts: [text], left: box.left, right: box.right, top: box.top, bottom: box.bottom })
          continue
        }
        existing.texts.push(text)
        existing.left = Math.min(existing.left, box.left)
        existing.right = Math.max(existing.right, box.right)
        existing.top = Math.min(existing.top, box.top)
        existing.bottom = Math.max(existing.bottom, box.bottom)
      }

      return groups
        .sort((left, right) => left.top - right.top)
        .map((group) => ({
          text: group.texts.join(''),
          box: { x: group.left, y: group.top, width: group.right - group.left, height: group.bottom - group.top },
        }))
    },
    `[data-dsa-pdf-page="${String(pageNumber)}"] ${PDF_TEXT_LAYER}`,
  )
}

/**
 * Drag across one measured line of a PDF page until the browser reports it.
 *
 * The repetition is the same re-measurement the prose gesture uses, and for the
 * same measured reason: the line's spans are positioned by layout, and a drag
 * aimed at a box read mid-animation lands on a different glyph. Each attempt
 * re-reads the layer and repeats the same real pointer drag.
 *
 * @param page - the browser page.
 * @param pageNumber - the 1-based page number.
 * @param expected - the line's text, after the product's line-end padding rule.
 * @returns the browser's selection string from the last attempt.
 */
async function dragPdfLineExact(page: Page, pageNumber: number, expected: string): Promise<string> {
  let selected = ''
  for (const attempt of DRAG_ATTEMPTS) {
    if (attempt.settle > 0) await page.waitForTimeout(attempt.settle)

    const lines = await readPdfLines(page, pageNumber)
    const line = lines.find((candidate) => withoutLineEndPadding(candidate.text) === expected)
    if (line === undefined) continue

    await dragBetween(
      page,
      { x: line.box.x + 1, y: line.box.y + line.box.height / 2 },
      { x: line.box.x + line.box.width - attempt.inset, y: line.box.y + line.box.height / 2 },
    )

    selected = await readBrowserSelection(page)
    if (withoutLineEndPadding(selected) === expected) return selected
  }
  return selected
}

/**
 * Assert that a draft is exactly the appended block, part by part.
 *
 * A byte-for-byte comparison of the whole draft would be the wrong assertion, for
 * a measured reason: the composer is a contenteditable, and what it publishes as
 * the draft is the clipboard projection of its document, in which the block's
 * newlines are not part of the string. The parts are therefore matched in order
 * against the raw string, and the assertion that nothing follows the last part is
 * what keeps the check tight.
 *
 * Unlike the earlier suites, every part here — including the selected content —
 * is exact. A prefix match would accept `> const beta =` for `const beta = 2`,
 * which is the one thing this acceptance suite must not do.
 *
 * @param actual - the draft as the composer publishes it.
 * @param parts - the block's parts, in order.
 */
function expectDraftBlock(actual: string, parts: readonly string[]): void {
  let cursor = 0
  for (const part of parts) {
    const index = actual.indexOf(part, cursor)
    expect(index, `the draft must contain ${JSON.stringify(part)} at offset ${cursor}`).toBe(cursor)
    cursor += part.length
  }

  expect(actual.slice(cursor), 'the block must end where the contract says it does').toBe('')
}

/**
 * Press the Ask button with a real pointer click and collect what the composer
 * did.
 *
 * The click is an ordinary Playwright `locator.click()`, which runs the
 * actionability check and performs a real hit test at the element's centre.
 * `force`, `dispatchEvent` and an in-page `.click()` are deliberately absent, so a
 * regression that puts the button under the preview column fails here rather than
 * passing on a bypass.
 *
 * @param page - the browser page.
 * @param expectedProvenance - the provenance line the append must produce, which
 *   is what the poll below waits for instead of a delay.
 * @returns the observation.
 */
async function pressAsk(page: Page, expectedProvenance: string): Promise<AskObservation> {
  const turnsBefore = await countTurns(page)
  const ask = page.locator(ASK_BUTTON).first()
  await expect(ask, 'the Ask button must be on screen when it is pressed').toBeVisible({ timeout: 15_000 })

  await ask.click({ timeout: 8000 })

  // The append is observed rather than slept for: the draft is polled until the
  // provenance line this selection earned is in it.
  await expect
    .poll(() => readDraft(page), {
      timeout: 20_000,
      message: `the composer must receive ${expectedProvenance}`,
    })
    .toContain(expectedProvenance)

  // A send would append a transcript row within this window; the count is read
  // late enough that a real submission could not hide behind the wait.
  await page.waitForTimeout(1800)

  const draft = await readDraft(page)
  const turnsAfter = await countTurns(page)
  const focusedAfter = await page.evaluate(
    // `hasAttribute` rather than comparing the attribute's value: with no active
    // element at all the optional chain yields `undefined`, and the value comparison
    // this form replaces (`?.getAttribute(...) !== null`) is *true* for `undefined`,
    // so it would have reported focus restored without having observed it. This is
    // true only when the composer's own editable surface really is the active
    // element.
    () => document.activeElement?.hasAttribute('data-composer-input') === true,
  )
  const submits = await readSubmitCount(page)

  return { draft, submits, turnsBefore, turnsAfter, focusedAfter }
}

/**
 * Assert the whole contract for one class's ask.
 *
 * The sentinel is re-read from the composer immediately before the press, so "the
 * draft is preserved" is a statement about the draft the button was actually
 * pressed with, and the block is then asserted part by part with nothing after its
 * question line. The submit count and the transcript row count come from the
 * page's own observer and the product's own rows, per case.
 *
 * @param page - the browser page.
 * @param expected - the provenance line and the selected content the block must
 *   carry, the content one entry per line and without the blockquote marker.
 * @returns the observation, for cases that assert something extra about the draft.
 */
async function askAndAssert(page: Page, expected: AppendedBlock): Promise<AskObservation> {
  const beforePress = await readDraft(page)
  expect(
    beforePress,
    "the sentinel draft must still be the composer's whole draft when Ask is pressed",
  ).toBe(SENTINEL)

  const outcome = await pressAsk(page, `> ${expected.provenance}`)

  expect(
    outcome.draft.startsWith(SENTINEL),
    `the ask must preserve the draft; the composer holds ${JSON.stringify(outcome.draft)}`,
  ).toBe(true)

  expectDraftBlock(outcome.draft, [
    SENTINEL,
    `> ${expected.provenance}`,
    ...expected.quoted.map((line) => `> ${line}`),
    QUESTION_SUFFIX,
  ])

  expect(outcome.submits, 'the ask must never submit the conversation').toBe(0)
  expect(outcome.turnsAfter, 'no message may have been sent to the transcript').toBe(outcome.turnsBefore)
  expect(outcome.focusedAfter, 'the ask must leave focus in the composer').toBe(true)

  return outcome
}

/** What one cross-root selection construction did, as the page observed it. */
interface CrossRootSelection {
  /** Whether the range could be built at all. */
  readonly ok: boolean
  /** Why not, when it could not. */
  readonly reason: string
  /** Whether the preview endpoint sits inside the preview's document body. */
  readonly previewEndpointInsideBody: boolean
  /** Whether that endpoint is the range's start rather than its end. */
  readonly previewEndpointIsStart: boolean
  /** Whether the other endpoint sits inside *any* document preview root. */
  readonly otherEndpointInAnyPreview: boolean
  /** Whether the browser ended up holding a collapsed range instead. */
  readonly collapsed: boolean
  /** The outside endpoint's own text, which the selection must therefore hold. */
  readonly outsideEndpointText: string
  /** What the browser reports as selected. */
  readonly selectedText: string
}

/**
 * Build the cross-root selection under test, and set it as the document's own.
 *
 * This is the single place in this suite where `page.evaluate` touches a
 * selection, and the reason is that the object under test *is* the browser's
 * cross-root selection: no real pointer gesture can produce a range whose two
 * endpoints live in two disconnected roots — a pointer drag places both endpoints
 * where the pointer went, and the browser normalises each of them to the nearest
 * text position on the way. The plugin's rule is stated about the endpoints
 * (`selectionLivesInSameRoot`), so the endpoints are what this case constructs.
 *
 * Nothing here reaches the plugin: no kernel, no adapter, no registry and no
 * selection bridge is called. The range is handed to the browser's own selection,
 * and the plugin is left to observe it through the events it already listens to.
 * The two endpoints are ordered by the document's own node comparison, so the
 * range is a real non-empty one rather than a collapsed range — which the plugin
 * would refuse for a different reason, and the cross-root rule is what this case
 * has to exercise.
 *
 * @param page - the browser page.
 * @param previewSelector - the node inside the supported preview.
 * @param outsideSelector - the node outside every preview.
 * @returns what the construction did, as the page reports it.
 */
async function selectAcrossPreviewAndChrome(
  page: Page,
  previewSelector: string,
  outsideSelector: string,
): Promise<CrossRootSelection> {
  return page.evaluate(
    ([insideSelector, beyondSelector]: readonly [string, string]) => {
      const failed = (reason: string): CrossRootSelection => ({
        ok: false,
        reason,
        previewEndpointInsideBody: false,
        previewEndpointIsStart: false,
        otherEndpointInAnyPreview: false,
        collapsed: false,
        outsideEndpointText: '',
        selectedText: '',
      })

      const firstTextNode = (root: Element | null): Text | null => {
        if (root === null) return null
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        while (node !== null && (node.textContent ?? '').trim() === '') node = walker.nextNode()
        return node === null ? null : (node as Text)
      }

      const previewNode = firstTextNode(document.querySelector(insideSelector))
      const outsideNode = firstTextNode(document.querySelector(beyondSelector))
      if (previewNode === null) return failed(`no text inside ${insideSelector}`)
      if (outsideNode === null) return failed(`no text inside ${beyondSelector}`)

      const previewFirst =
        (previewNode.compareDocumentPosition(outsideNode) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      const startNode = previewFirst ? previewNode : outsideNode
      const endNode = previewFirst ? outsideNode : previewNode

      const range = document.createRange()
      range.setStart(startNode, 0)
      range.setEnd(endNode, endNode.length)

      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)

      const body = document.querySelector('[data-textpreview-body]')
      const outsideElement = outsideNode.parentElement
      return {
        ok: true,
        reason: '',
        previewEndpointInsideBody: body !== null && body.contains(previewNode),
        previewEndpointIsStart: previewFirst,
        // Stated without an optional chain: a detached node has no parent, and
        // `undefined !== null` is true, which would report a preview root that was
        // never found.
        otherEndpointInAnyPreview:
          outsideElement !== null && outsideElement.closest('[data-document-preview]') !== null,
        // `?? true` is the safe direction: a document that exposes no selection at
        // all is reported as collapsed, which the case asserts against.
        collapsed: selection?.isCollapsed ?? true,
        outsideEndpointText: (outsideNode.textContent ?? '').trim(),
        selectedText: selection?.toString() ?? '',
      }
    },
    [previewSelector, outsideSelector] as const,
  )
}

/**
 * Collapse the browser's selection and report the state the browser publishes.
 *
 * This belongs to the same sanctioned use of `page.evaluate` as the construction
 * above: the case's subject is the browser's own selection, and the requirement is
 * that this selection is collapsed. A real click elsewhere would collapse it too,
 * but it would also move the pointer and the caret, which is a second variable in
 * a case about one.
 *
 * @param page - the browser page.
 * @returns whether the browser now holds a collapsed selection.
 */
async function collapseBrowserSelection(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    document.getSelection()?.removeAllRanges()
    return document.getSelection()?.isCollapsed ?? false
  })
}

/**
 * Wait for two animation frames.
 *
 * The plugin's lifecycle coalesces selection changes into one animation frame
 * (`src/client/selection/browser-lifecycle.ts`), so two frames are the boundary on
 * which the state it publishes after a selection change is on screen. This waits
 * for that boundary rather than for a duration, which is what lets the assertion
 * after it be about what the plugin published rather than about when it was read.
 *
 * @param page - the browser page.
 */
async function waitForSelectionFrames(page: Page): Promise<void> {
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
}

// The per-test timeout is the configuration's own default of 30 s, and it is left
// there on a measurement: the live acceptance run of this file took about 2.9
// minutes across its ten cases, so every case finished well inside that budget and
// none of the longer budgets declared inside a case (the 60 s page-render poll, for
// example) was ever reached. Raising the per-test budget would only turn a case that
// exceeded its own diagnostics into a slower failure.
test.describe('real DSH universal document selection acceptance', () => {
  test('quotes a TXT line 2 with exact provenance, keeping the draft and never sending', async ({ page }) => {
    await installSubmitObserver(page)
    await openShell(page)
    await openPreviewFixture(page, 'txt', TXT_FIXTURE, PLAIN_RENDERER)

    // The plain renderer publishes one row per source line, numbered from 1.
    const rows = page.locator(PREVIEW_LINE)
    await expect(rows, 'the plain renderer must publish one row per source line').toHaveCount(3, {
      timeout: 30_000,
    })
    await expect(rows.nth(0)).toHaveText('alpha')
    await expect(rows.nth(1)).toHaveText(TXT_LINE_2)
    await expect(rows.nth(2)).toHaveText(TXT_LINE_3)

    await typeSentinelDraft(page)
    const selected = await selectExpectedRowsExact(page, rows, 1, 1, TXT_LINE_2)
    expect(selected, "the real gesture must have taken exactly the fixture's second line").toBe(TXT_LINE_2)

    await expectAskButton(page)
    await askAndAssert(page, { provenance: TXT_LINE_2_PROVENANCE, quoted: [TXT_LINE_2] })
  })

  test('quotes a Markdown paragraph with file-only provenance, keeping the draft and never sending', async ({
    page,
  }) => {
    await installSubmitObserver(page)
    await openShell(page)
    await openPreviewFixture(page, 'markdown', MARKDOWN_FIXTURE, MARKDOWN_RENDERER)

    const paragraph = page.locator(`${PREVIEW_BODY} p`).filter({ hasText: MARKDOWN_PARAGRAPH }).first()
    await expect(paragraph, 'the Markdown renderer must draw the fixture paragraph').toBeVisible({
      timeout: 20_000,
    })
    await expect(paragraph).toHaveText(MARKDOWN_PARAGRAPH)

    await typeSentinelDraft(page)
    // The drag's endpoints are the paragraph's own glyph rects, scanned to the first
    // pixel the preview body owns and hit-tested before anything is pressed; see
    // `measureProseGesture`.
    const selected = await dragProseExact(page, paragraph, PREVIEW_BODY, MARKDOWN_PARAGRAPH)
    expect(withoutLineEndPadding(selected), 'the real gesture must have taken exactly the rendered paragraph').toBe(
      MARKDOWN_PARAGRAPH,
    )

    await expectAskButton(page)
    const outcome = await askAndAssert(page, {
      provenance: MARKDOWN_PROVENANCE,
      quoted: [MARKDOWN_PARAGRAPH],
    })

    // Rendered Markdown has no source-line mapping: the source's lines are not the
    // lines a reader sees, so a citation for one would be invented.
    expect(outcome.draft, 'a rendered Markdown citation must never claim a source line').not.toMatch(
      LINE_PROVENANCE,
    )
  })

  test('quotes a code row 2 with exact provenance, keeping the draft and never sending', async ({ page }) => {
    await installSubmitObserver(page)
    await openShell(page)
    await openPreviewFixture(page, 'code', CODE_FIXTURE, CODE_RENDERER)

    // The code renderer's own rows: one highlighted line per source line, inside
    // its own code-block viewport.
    const rows = page.locator(CODE_LINE)
    await expect(rows, 'the code renderer must publish one row per source line').toHaveCount(3, {
      timeout: 30_000,
    })
    await expect(rows.nth(0)).toHaveText('const alpha = 1')
    await expect(rows.nth(1)).toHaveText(CODE_ROW_2)
    await expect(rows.nth(2)).toHaveText('const gamma = 3')

    await typeSentinelDraft(page)

    // The row renders as several Shiki token spans, so a drag can stop short of
    // the last one. `selectExpectedRowsExact` repeats the same real gesture until
    // the browser reports the whole row; it re-measures the box, it does not relax
    // the assertion, which is exact equality below.
    const selected = await selectExpectedRowsExact(page, rows, 1, 1, CODE_ROW_2)
    expect(selected, 'the real gesture must have taken exactly the const beta row').toBe(CODE_ROW_2)

    await expectAskButton(page)
    await askAndAssert(page, { provenance: CODE_PROVENANCE, quoted: [CODE_ROW_2] })
  })

  test('quotes a CSV line 3 with exact provenance through the plain renderer, keeping the draft', async ({
    page,
  }) => {
    await installSubmitObserver(page)
    await openShell(page)
    await openPreviewFixture(page, 'csv', CSV_FIXTURE, PLAIN_RENDERER)

    // Task 13 measured this against the real-DSH `dsa-smoke` smoke profile, on two
    // releases: the builtin **plain** renderer draws a `.csv` and publishes
    // `[data-textpreview-line]` rows for it, not the code renderer. The identity is
    // asserted rather than accepted as either of the two renderers that could draw
    // a CSV, so a ranking change is caught here instead of being absorbed silently.
    // `openPreviewFixture` already asserted it; the lines below repeat the fact
    // with the observation in the message, and the measurement is a statement
    // about the profile rather than about a release — the primary acceptance run
    // re-confirms it on the runtime it drives.
    const published = await page.locator(PREVIEW_STATE).first().getAttribute(PREVIEW_RENDERER_ATTRIBUTE)
    expect(
      published,
      `the smoke profile measured the CSV preview publishing ${PLAIN_RENDERER}; it published ${String(published)}`,
    ).toBe(PLAIN_RENDERER)

    const rows = page.locator(PREVIEW_LINE)
    await expect(rows, 'the plain renderer must publish one row per CSV line').toHaveCount(4, {
      timeout: 30_000,
    })
    await expect(rows.nth(0)).toHaveText('region,units,note')
    await expect(rows.nth(1)).toHaveText('north,41,alpha')
    await expect(rows.nth(2)).toHaveText(CSV_LINE_3)
    await expect(rows.nth(3)).toHaveText('east,63,gamma')

    await typeSentinelDraft(page)
    const selected = await selectExpectedRowsExact(page, rows, 2, 2, CSV_LINE_3)
    expect(selected, "the real gesture must have taken exactly the fixture's third line").toBe(CSV_LINE_3)

    await expectAskButton(page)
    await askAndAssert(page, { provenance: CSV_PROVENANCE, quoted: [CSV_LINE_3] })
  })

  test('quotes PDF page 1 with page provenance, keeping the draft and never sending', async ({ page }) => {
    await installSubmitObserver(page)
    await openShell(page)
    await openPluginFixture(page, PDF_ROOT, 'pdf-single', PDF_FIXTURE, PLUGIN_PDF_RENDERER)
    await waitForPage(page, 1)
    await expect(page.locator(PDF_PAGE), 'the single-page fixture renders one page').toHaveCount(1)

    // The page is a canvas with a text layer over it; the text layer's spans are
    // real DOM text, which is the whole reason a PDF can be selected at all.
    await expect
      .poll(() => page.locator(`${PDF_TEXT_LAYER} span`).count(), {
        timeout: 60_000,
        message: 'page 1 must carry a laid-out text layer',
      })
      .toBeGreaterThan(0)

    const lines = await readPdfLines(page, 1)
    expect(
      lines.map((line) => withoutLineEndPadding(line.text)),
      "page 1 must render the fixture's first line as its own selectable line",
    ).toContain(PDF_PAGE_1_LINE_1)

    await typeSentinelDraft(page)
    const selected = await dragPdfLineExact(page, 1, PDF_PAGE_1_LINE_1)
    expect(
      withoutLineEndPadding(selected),
      'the real drag must have taken exactly the first rendered line of page 1',
    ).toBe(PDF_PAGE_1_LINE_1)

    await expectAskButton(page)
    await askAndAssert(page, { provenance: PDF_PROVENANCE, quoted: [PDF_PAGE_1_LINE_1] })
  })

  test('quotes the first rendered DOCX paragraph with rendered-page provenance, keeping the draft', async ({
    page,
  }) => {
    await installSubmitObserver(page)
    await openShell(page)
    await openPluginFixture(page, DOCX_ROOT, 'docx-paragraphs', DOCX_FIXTURE, PLUGIN_DOCX_RENDERER)

    // The fixture holds three paragraphs in one section, which the DOCX renderer
    // draws as the page section the marker reads and one `<p>` per paragraph.
    await expect(page.locator(DOCX_PAGE), 'the fixture renders one page section').toHaveCount(1, {
      timeout: 30_000,
    })
    const paragraphs = page.locator(`${DOCX_CONTENT} p`)
    await expect(paragraphs, 'the fixture renders three paragraphs').toHaveCount(3, { timeout: 30_000 })

    const paragraph = paragraphs.first()
    expect(await readTargetText(paragraph), "the first rendered paragraph must be the fixture's own first paragraph").toBe(
      DOCX_PARAGRAPH_1,
    )

    await typeSentinelDraft(page)

    // The live measurement of this fixture is why a paragraph-level gesture is the
    // right one here, and it holds at every viewport. The preview column is a fixed
    // 576 px wide, and the DOCX page stays centred on it and overflows it by 13 px
    // on the left: measured at 1280x720, 1600x1000 and 2560x1300, the paragraph's
    // box begins 13 px left of the column at each size (paragraph x = 691 against
    // column x = 704 at 1280x720), so a wider window moves both boxes together and
    // does not help. The shell's own resize handle answers `elementFromPoint` at
    // `column.left + 1` at that height — the live failure reported
    // `DIV.pI_x6G_handle` — and the first pixel inside `[data-dsa-docx-content]` is
    // `column.left + 5`, with the occluding handle measuring 25 px wide there. The
    // first run is 96 px for 12 characters, so the earliest pointer-reachable pixel
    // is roughly two characters in: the paragraph's first characters are not hard to
    // reach, they are unreachable by any drag endpoint. The paragraph is therefore
    // taken with real triple clicks at the scanned, hit-tested pixel, because the
    // browser computes that gesture's extent from the block rather than from the
    // pixel. The endpoints are still scanned rather than assumed, and the assertion
    // below stays exact.
    const selected = await tripleClickProseExact(page, paragraph, DOCX_CONTENT, DOCX_PARAGRAPH_1)
    expect(withoutLineEndPadding(selected), 'the real gesture must have taken exactly the rendered paragraph').toBe(
      DOCX_PARAGRAPH_1,
    )

    await expectAskButton(page)
    await askAndAssert(page, { provenance: DOCX_PROVENANCE, quoted: [DOCX_PARAGRAPH_1] })
  })

  test('quotes slide 1 text with slide provenance, keeping the draft and never sending', async ({ page }) => {
    await installSubmitObserver(page)
    await openShell(page)
    await openPluginFixture(page, PPTX_ROOT, 'pptx-text-two-slides', PPTX_FIXTURE, PLUGIN_PPTX_RENDERER)

    await expect(page.locator(PPTX_CONTENT).first(), 'the deck must be on screen').toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator(PPTX_SLIDE), 'the fixture holds two slides').toHaveCount(2, { timeout: 30_000 })

    // The innermost element carrying the text, so the drag aims at the glyphs
    // rather than at the box the slide lays them out in.
    const target = await locatorForInnermostText(page, PPTX_SLIDE_1, PPTX_SLIDE_1_TEXT)

    await typeSentinelDraft(page)
    const selected = await dragProseExact(page, target, PPTX_CONTENT, PPTX_SLIDE_1_TEXT)
    expect(
      withoutLineEndPadding(selected),
      "the real gesture must have taken exactly slide 1's first text box",
    ).toBe(PPTX_SLIDE_1_TEXT)

    await expectAskButton(page)
    await askAndAssert(page, { provenance: PPTX_PROVENANCE, quoted: [PPTX_SLIDE_1_TEXT] })
  })

  test('quotes a semantic XLSX cell range with the range it published, keeping the draft', async ({ page }) => {
    await installSubmitObserver(page)
    await openShell(page)
    await openPluginFixture(page, XLSX_ROOT, 'xlsx-simple', XLSX_FIXTURE, PLUGIN_XLSX_RENDERER)
    const content = await expectWorkbookReady(page)

    await typeSentinelDraft(page)

    // The offsets are measured against this runtime rather than chosen: the grid's
    // published box includes the 40 px row header and the 24 px column header, and
    // the sibling XLSX suite calibrated exactly these two points on exactly this
    // fixture to `Sheet1!A1:C3`.
    await dragRange(page, content, [75, 26], [180, 84])

    // The range is confirmed from the renderer's own published state before Ask is
    // pressed, and the provenance asserted below is built from that value, so it is
    // a statement about the range the gesture produced rather than about the range
    // it was meant to produce.
    const publishedRange = await expectPublishedSelection(page, 'Sheet1!A1:C3')
    const provenance = `[\u6765\u6e90\uff1atask11-simple.xlsx\uff0c${publishedRange}]`

    await expectAskButton(page)
    await askAndAssert(page, { provenance, quoted: XLSX_EXPECTED_TABLE })
  })

  test('refuses a selection whose other endpoint is outside every preview, and keeps no live snapshot', async ({
    page,
  }) => {
    await installSubmitObserver(page)
    const pageErrors = watchPageErrors(page)
    await openShell(page)
    await openPreviewFixture(page, 'txt', TXT_FIXTURE, PLAIN_RENDERER)

    const rows = page.locator(PREVIEW_LINE)
    await expect(rows).toHaveCount(3, { timeout: 30_000 })

    await typeSentinelDraft(page)

    // A real selection first, so the page holds a live snapshot before the
    // cross-root one. Without it, "no snapshot survives the rejection" would also
    // be true of a plugin that had never captured anything, which proves nothing.
    const selected = await selectExpectedRowsExact(page, rows, 1, 1, TXT_LINE_2)
    expect(selected).toBe(TXT_LINE_2)
    await expectAskButton(page)

    const turnsBefore = await countTurns(page)
    const draftBefore = await readDraft(page)

    const crossRoot = await selectAcrossPreviewAndChrome(
      page,
      `${PREVIEW_LINE}[data-textpreview-line="2"]`,
      DRIVER_LABEL,
    )

    // The construction is asserted before its consequence: one endpoint inside a
    // supported preview's document region, the other inside no document preview at
    // all, and a real non-empty range rather than a collapsed one — otherwise the
    // refusal below would be about `collapsed` rather than about two roots.
    expect(crossRoot.ok, `the cross-root range must be constructible: ${crossRoot.reason}`).toBe(true)
    expect(crossRoot.previewEndpointInsideBody, 'one endpoint must be inside the preview body').toBe(true)
    expect(crossRoot.otherEndpointInAnyPreview, 'the other endpoint must be outside every preview').toBe(false)
    expect(crossRoot.collapsed, 'the selection must not be collapsed').toBe(false)
    // The two endpoints are both really in the selection: the outside node's own
    // text and the preview's own line. A range that had collapsed to one endpoint,
    // or been dropped by the browser, could satisfy neither.
    expect(crossRoot.selectedText, 'the selection must hold the endpoint outside every preview').toContain(
      crossRoot.outsideEndpointText,
    )
    expect(crossRoot.selectedText, "the selection must hold the preview's own line").toContain(TXT_LINE_2)

    // The observed state change that proves the plugin handled the new selection:
    // the Ask button raised for the valid selection is gone. A plugin that left the
    // stale snapshot in place would keep the button here, and this poll would time
    // out rather than passing.
    await expect(
      page.locator(ASK_BUTTON),
      'the refusal must retire the Ask button raised by the previous selection',
    ).toHaveCount(0, { timeout: 20_000 })

    expect(await page.locator(ASK_BUTTON).count(), 'the Ask button count must be exactly 0').toBe(0)
    expect(await readDraft(page), 'the refusal must not touch the composer draft').toBe(draftBefore)
    expect(await readSubmitCount(page), 'the refusal must not submit anything').toBe(0)
    expect(await countTurns(page)).toBe(turnsBefore)

    // The stale-snapshot requirement, stated observably: the selection is
    // collapsed, two animation frames pass — the boundary on which the lifecycle
    // publishes the state it derived from that collapse — and no Ask button has
    // come back. A snapshot that had survived the rejection would be visible here.
    expect(await collapseBrowserSelection(page), 'the browser must hold a collapsed selection').toBe(true)
    await waitForSelectionFrames(page)
    expect(
      await page.locator(ASK_BUTTON).count(),
      'no live snapshot may survive the rejection, even after the selection is collapsed',
    ).toBe(0)
    expect(await readDraft(page), 'the collapsed selection must not touch the draft').toBe(draftBefore)

    expect(pageErrors(), 'handling a cross-root selection must raise no uncaught page error').toEqual([])
  })

  test('recovers after the refusal: the next real gesture in the same preview is quoted normally', async ({
    page,
  }) => {
    await installSubmitObserver(page)
    const pageErrors = watchPageErrors(page)
    await openShell(page)
    await openPreviewFixture(page, 'txt', TXT_FIXTURE, PLAIN_RENDERER)

    const rows = page.locator(PREVIEW_LINE)
    await expect(rows).toHaveCount(3, { timeout: 30_000 })
    await typeSentinelDraft(page)

    // The lifecycle is proved live, then refused, then used again — all in this
    // page and this preview. The first selection is retired by the refusal, so the
    // provenance asserted at the end can only have come from the recovery gesture.
    const before = await selectExpectedRowsExact(page, rows, 1, 1, TXT_LINE_2)
    expect(before).toBe(TXT_LINE_2)
    await expectAskButton(page)

    const crossRoot = await selectAcrossPreviewAndChrome(
      page,
      `${PREVIEW_LINE}[data-textpreview-line="2"]`,
      DRIVER_LABEL,
    )
    expect(crossRoot.ok, `the cross-root range must be constructible: ${crossRoot.reason}`).toBe(true)
    expect(crossRoot.previewEndpointInsideBody).toBe(true)
    expect(crossRoot.otherEndpointInAnyPreview).toBe(false)
    expect(crossRoot.collapsed).toBe(false)

    await expect(page.locator(ASK_BUTTON), 'the refusal must retire the Ask button').toHaveCount(0, {
      timeout: 20_000,
    })
    await waitForSelectionFrames(page)
    expect(await page.locator(ASK_BUTTON).count()).toBe(0)
    expect(await readDraft(page), 'the refusal must leave the sentinel untouched').toBe(SENTINEL)

    // The recovery: a real press inside row 3 and a real held Shift + click at its
    // end, in the same page and the same preview that were just refused.
    const recovered = await selectExpectedRowsExact(page, rows, 2, 2, TXT_LINE_3)
    expect(recovered, 'the recovery gesture must have taken exactly the third line').toBe(TXT_LINE_3)

    await expectAskButton(page)
    // The block cites line 3 — the line the recovery selected — so a snapshot that
    // had survived the refusal would fail the block assertion rather than passing.
    await askAndAssert(page, { provenance: TXT_LINE_3_PROVENANCE, quoted: [TXT_LINE_3] })

    expect(pageErrors(), 'the refusal and the recovery must raise no uncaught page error').toEqual([])
  })
})
