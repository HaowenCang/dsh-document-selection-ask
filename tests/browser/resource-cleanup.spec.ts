/**
 * Task 13 acceptance spec: what a document resource's cleanup may, and may not,
 * do to the resource that replaced it.
 *
 * ## The frozen contract this file accepts
 *
 * Task 12 made selection invalidation **resource-scoped**: a renderer publishes
 * "this resource no longer owns a sendable selection" and the runtime's
 * `SelectionLifecycleCoordinator` decides what to clear, comparing addresses
 * rather than assuming that whichever cleanup arrives last is the current one.
 * The property therefore has one shape, and this suite is its real-browser
 * acceptance: a late cleanup belonging to a document the reader has left is
 * inert — it cannot clear the new document's selection, republish the old
 * document's DOM, raise the old Ask surface, or write into the composer.
 *
 * The other three frozen contracts this file leans on are older and are not
 * re-litigated here: PDF keeps one generation of text per page container and a
 * late generation leaves none of its predecessor's text behind (Task 7A/7B);
 * the four byte renderers release their workers, object URLs, observers and
 * viewer sessions on unmount (the security constraint); and XLSX parses inside a
 * client-owned `Blob` worker fed by a compressed inline WASM payload (Task 11R),
 * so no parser asset exists to fetch over HTTP.
 *
 * ## The evidence standard
 *
 * A cleanup case is worthless unless it proves two things from observable state.
 * The first is that the heavy render had really started **and had not settled**
 * when the switch happened; a case that switched after the render finished would
 * report a cleanup that never had anything to clean up. The second is that the
 * cleanup opportunity really occurred, anchored on state and never on a clock.
 * Each case below names the observable it used for both, and fails loudly when
 * the window it needs was missed rather than passing on an empty observation.
 * The bounded frame-quiet window is state rather than a sleep: it is a measured
 * run of consecutive animation frames in which the live document produced no
 * mutation at all, re-checked in the same in-page sample as the state it is
 * supposed to be quiet about. A sleep would prove only that time passed.
 *
 * ## What is instrumented, and why
 *
 * Two facts cannot be read from the DOM and are observed through the page's own
 * platform constructors, installed with `page.addInitScript` before any
 * application script runs: **a worker was constructed, and from which URL**, and
 * **which object URLs were created and released**. The wrappers delegate to the
 * real implementations, keep every return value and argument, and retain only
 * strings — never a `Worker`, `Blob` or DOM node — so the instrumentation cannot
 * keep a resource alive that the product released.
 *
 * ## The instance
 *
 * `DSH_SMOKE_URL` names a running DSH web instance carrying this plugin, the
 * test-only smoke driver and the generated fixtures. Without it every case is
 * skipped, so `pnpm test:browser` stays usable on a machine with no DSH
 * installed. The instance is shared with the other browser suites, which is why
 * this file opens its documents only through the driver's own control buttons
 * and never through a store, a kernel call or a preview API.
 */

import { expect, test } from '@playwright/test'
import type { Locator, Page, Request, WebSocket as PlaywrightWebSocket } from '@playwright/test'

import { ensureWorkspace } from './helpers/shell.js'

/** The running DSH instance this suite drives. */
const BASE_URL = process.env['DSH_SMOKE_URL'] ?? ''

test.skip(BASE_URL === '', 'set DSH_SMOKE_URL to a running DSH instance booted from the dsa-smoke profile')

/** The smoke driver's control strip. */
const DRIVER = '[data-dsa-smoke-driver]'

/** The composer's editable surface. */
const COMPOSER_INPUT = '[data-composer-input]'

/** The Ask button this plugin contributes. */
const ASK_BUTTON = '[data-dsa-selection-ask-button]'

/** The plugin's refusal toast, which a cleanup must never raise into a new document. */
const ERROR_TOAST = '[data-dsa-selection-error]'

/**
 * The renderer-root attribute that names the resource a renderer root belongs to.
 *
 * Every one of this plugin's four byte renderers publishes it, and the suite
 * compares it by value: "the new document is visible" is not an identity, and a
 * case that accepted it would pass for two renderer roots where the old one was
 * still mounted underneath.
 */
const RESOURCE_ADDRESS = 'data-dsa-resource-address'

/** The document preview's own identity attribute, written by DSH. */
const PREVIEW_IDENTITY_ATTRIBUTE = 'data-document-preview'

/** This plugin's renderer ids, as `register.ts` publishes them. */
const PLUGIN_RENDERER = {
  pdf: 'dsh-document-selection-ask/pdf',
  docx: 'dsh-document-selection-ask/docx',
  pptx: 'dsh-document-selection-ask/pptx',
  xlsx: 'dsh-document-selection-ask/xlsx',
} as const

/** One of the four byte renderers. */
type ByteFormat = keyof typeof PLUGIN_RENDERER

/** Renderer roots: `data-dsa-document-kind` is written by this plugin only. */
const RENDERER_ROOT = '[data-dsa-document-kind]'

const PDF_ROOT = '[data-dsa-document-kind="pdf"]'
const PDF_PAGE = '[data-dsa-pdf-page]'
const PDF_TEXT = '[data-dsa-pdf-text]'
const PDF_NOTICE = '[data-dsa-pdf-notice]'
const PDF_PLACEHOLDER = '[data-dsa-pdf-placeholder]'
const PDF_CANVAS = '[data-dsa-pdf-canvas]'

const DOCX_ROOT = '[data-dsa-document-kind="docx"]'
const DOCX_CONTENT = '[data-dsa-docx-content]'
const DOCX_PAGE = '[data-dsa-docx-page]'

const PPTX_ROOT = '[data-dsa-document-kind="pptx"]'
const PPTX_CONTENT = '[data-dsa-pptx-content]'
const PPTX_SLIDE = '[data-dsa-pptx-slide]'

const XLSX_ROOT = '[data-dsa-document-kind="xlsx"]'
const XLSX_CONTENT = '[data-dsa-xlsx-content]'
const XLSX_SELECTION = '[data-dsa-xlsx-selection]'
const XLSX_IMAGE = '[data-dsa-xlsx-image]'

/** The DSH builtin preview's own attributes; none of these is written by a test. */
const PREVIEW_STATE_ATTRIBUTE = 'data-textpreview-state'
const PREVIEW_URL_ATTRIBUTE = 'data-textpreview-url'
const PREVIEW_BODY = '[data-textpreview-body]'
const PREVIEW_LINE = '[data-textpreview-line]'

/**
 * The rows of a builtin-preview document, in either shape the product publishes.
 *
 * The plain renderer emits one `data-textpreview-line` row per source line and
 * the code renderer emits a Shiki block whose rows are `pre .line`; which one
 * draws a `.csv` is the preview's own ranking decision, so a readiness assertion
 * that named only one of the two would be asserting a layout the product does
 * not promise. Both shapes are the ones this plugin's text adapter reads.
 */
const TEXT_ROWS = `${PREVIEW_LINE}, [data-code-block-content] pre .line`

/** `正在加载文档…`, the plugin's own in-progress copy (`ui/locales.ts`). */
const LOADING_TEXT = '\u6b63\u5728\u52a0\u8f7d\u6587\u6863\u2026'

/** The question suffix an appended block closes with. */
const QUESTION_SUFFIX = '\u8bf7\u9488\u5bf9\u4ee5\u4e0a\u9009\u4e2d\u5185\u5bb9\u56de\u7b54\uff1a'

/** A draft typed before a document is opened, so "unchanged" is measurable. */
const DRAFT_SENTINEL = 'Pre-existing draft text'

/** The exact provenance and quote a real gesture on TXT line 2 must produce. */
const TXT_LINE_TWO_PROVENANCE = '> [\u6765\u6e90\uff1atask5b-smoke.txt\uff0c\u7b2c 2 \u884c]'

/**
 * Error-level console copy this plugin's renderers log, taken from the sources
 * that emit it: `[dsa-pptx] failed to render presentation:` (`PptxBody.tsx`) and
 * `[dsa-pdf] the failure reporter threw` (`pdf/runtime.ts`). The other two
 * prefixes are the same namespace and are listed so a future renderer that logs
 * through it is caught rather than ignored. This is a **deny** list, not a noise
 * allow-list: nothing the shell says is filtered away, and the case reports the
 * whole error-level console census in its failure message instead of hiding it.
 */
const RENDERER_LOG_MARKERS = ['[dsa-pdf]', '[dsa-docx]', '[dsa-pptx]', '[dsa-xlsx]'] as const

/**
 * The exact parser assets this plugin must never fetch, named rather than
 * matched by extension.
 *
 * `.wasm` is deliberately **not** part of this pattern: this gate is about the
 * two engines this plugin carries — the embedded PDF.js worker source and the
 * compressed inline workbook engine — while a generic `.wasm` request could
 * belong to the shell's own highlighter. Remote WASM of any origin is still
 * forbidden, by the remote-origin gate below, and the XLSX phase forbids any
 * HTTP request for a worker or a `.wasm` module of its own.
 */
const PLUGIN_RUNTIME_ASSET_PATTERN = /pdf\.worker|\.bcmap|standard_fonts|duke_sheets|dsa-assets|xlsx-worker/i

/** Third-party script/style delivery hosts no document open may reach. */
const CDN_HOST_PATTERN = /cdnjs|jsdelivr|unpkg|esm\.sh|skypack/i

/** Remote assets that must never be fetched: the plugin's engines and any CDN. */
const REMOTE_PARSER_ASSET_PATTERN = /pdf\.worker|\.bcmap|standard_fonts|duke_sheets|dsa-assets|xlsx-worker|\.wasm/i

/** How many consecutive mutation-free frames a quiet window must observe. */
const QUIET_FRAMES = 10

/** How long one quiet-window attempt may run before it reports failure. */
const QUIET_BUDGET_MS = 4_000

/** How long the suite may keep attempting a quiet window before failing. */
const QUIET_TIMEOUT_MS = 30_000

/** The key the platform probe publishes itself under. */
const PROBE_KEY = '__dsaCleanupProbe'

/** The key the unhandled-rejection recorder publishes itself under. */
const REJECTION_KEY = '__dsaCleanupRejections'

/** One worker construction, as the probe recorded it. */
interface ProbeWorker {
  readonly url: string
  readonly type: string | undefined
  readonly name: string | undefined
}

/** The object-URL and worker activity one page recorded. */
interface RuntimeProbe {
  readonly workers: readonly ProbeWorker[]
  readonly created: readonly string[]
  readonly revoked: readonly string[]
}

/** One request, classified by the platform's own method and resource type. */
interface RequestRecord {
  readonly method: string
  readonly resourceType: string
  readonly url: string
}

/** One error-level console message. */
interface ConsoleErrorRecord {
  readonly text: string
  readonly url: string
}

/** Everything a case observes for its whole lifetime. */
interface Observers {
  readonly pageErrors: string[]
  readonly consoleErrors: ConsoleErrorRecord[]
  readonly requests: RequestRecord[]
  readonly workers: string[]
  readonly websockets: string[]
}

/** A phase boundary in the request and worker census. */
interface CensusMark {
  readonly requests: number
  readonly workers: number
}

/**
 * Install the page's own listeners.
 *
 * `pageerror` is attached before the first navigation, which is what makes "no
 * uncaught error" a statement about the whole case rather than about its tail.
 * The unhandled-rejection recorder is installed separately, once the shell has
 * settled — see {@link installRejectionRecorder}.
 *
 * @param page - the browser page.
 * @returns the collectors, which grow as the case runs.
 */
function observe(page: Page): Observers {
  const observers: Observers = {
    pageErrors: [],
    consoleErrors: [],
    requests: [],
    workers: [],
    websockets: [],
  }

  page.on('pageerror', (error: Error) => {
    observers.pageErrors.push(error.message)
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    observers.consoleErrors.push({ text: message.text(), url: message.location().url })
  })
  page.on('request', (request: Request) => {
    observers.requests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    })
  })
  page.on('worker', (worker) => {
    observers.workers.push(worker.url())
  })
  page.on('websocket', (socket: PlaywrightWebSocket) => {
    observers.websockets.push(socket.url())
  })

  return observers
}

/**
 * Instrument `Worker`, `URL.createObjectURL` and `URL.revokeObjectURL` before the
 * application boots.
 *
 * `addInitScript` runs before any script the page loads, so the wrappers are in
 * place before the plugin's bundle can capture the originals. Each wrapper
 * delegates, returns exactly what the original returned and keeps the argument
 * semantics intact; the probe retains **strings only** — a URL, never the
 * `Worker` or `Blob` behind it — so it cannot keep a resource alive that the
 * product released, and it is therefore provably inert even though it stays
 * installed for the page's life. Uninstalling it would be the riskier choice: a
 * cleanup under test releases its worker *after* the assertions begin, and a
 * wrapper removed mid-case would simply stop observing.
 *
 * @param page - the browser page.
 */
async function installRuntimeProbe(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    const created: string[] = []
    const revoked: string[] = []
    const workers: { url: string; type: string | undefined; name: string | undefined }[] = []

    const RealWorker = window.Worker
    function DsaProbeWorker(url: string | URL, options?: WorkerOptions): Worker {
      workers.push({ url: String(url), type: options?.type, name: options?.name })
      return new RealWorker(url, options)
    }
    DsaProbeWorker.prototype = RealWorker.prototype
    Object.setPrototypeOf(DsaProbeWorker, RealWorker)
    window.Worker = DsaProbeWorker as unknown as typeof Worker

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

    ;(globalThis as unknown as Record<string, unknown>)[key] = { workers, created, revoked }
  }, PROBE_KEY)
}

/**
 * Read the platform probe's record.
 * @param page - the browser page.
 * @returns the workers, created URLs and revoked URLs, copied out of the page.
 */
async function readProbe(page: Page): Promise<RuntimeProbe> {
  return page.evaluate((key: string): RuntimeProbe => {
    const probe = (globalThis as unknown as Record<string, unknown>)[key] as
      | {
          workers: { url: string; type?: string | undefined; name?: string | undefined }[]
          created: string[]
          revoked: string[]
        }
      | undefined
    return probe === undefined
      ? { workers: [], created: [], revoked: [] }
      : {
          workers: probe.workers.map((worker) => ({
            url: worker.url,
            type: worker.type,
            name: worker.name,
          })),
          created: [...probe.created],
          revoked: [...probe.revoked],
        }
  }, PROBE_KEY)
}

/**
 * Record unhandled promise rejections from this point on.
 *
 * Installed after {@link openShell} rather than through `addInitScript`, and the
 * reason is measured rather than convenient: the shell's own boot is not this
 * case's subject, and a rejection raised by the application while it mounts would
 * be reported as a document-renderer defect. The recorder is in place before the
 * first fixture is opened, so it covers every document and the whole cleanup
 * window.
 *
 * @param page - the browser page.
 */
async function installRejectionRecorder(page: Page): Promise<void> {
  await page.evaluate((key: string) => {
    const reasons: string[] = []
    ;(globalThis as unknown as Record<string, unknown>)[key] = reasons
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      reasons.push(String(event.reason))
    })
  }, REJECTION_KEY)
}

/**
 * Read the rejections recorded so far.
 * @param page - the browser page.
 * @returns the reasons, as strings.
 */
async function readRejections(page: Page): Promise<readonly string[]> {
  return page.evaluate((key: string): string[] => {
    const reasons = (globalThis as unknown as Record<string, unknown>)[key]
    return reasons === undefined ? [] : (reasons as string[]).slice()
  }, REJECTION_KEY)
}

/**
 * Whether a URL was fetched over HTTP(S).
 *
 * `startsWith('http:')` deliberately does not match `https:` — the sixth
 * character differs — so the two schemes are tested separately.
 *
 * @param url - the request URL.
 * @returns true for an `http:` or `https:` URL.
 */
function isHttpUrl(url: string): boolean {
  return url.startsWith('http:') || url.startsWith('https:')
}

/**
 * The origin of an HTTP(S) URL, or `null` when the URL cannot be parsed.
 *
 * Every caller compares the result with the shell's own `http(s)` origin, and the
 * one channel that must not go through this function is the WebSocket census:
 * `new URL('ws://host:port/x').origin` is `ws://host:port`, which can never equal
 * an `http(s)` origin, so a comparison built on it is unsatisfiable by
 * construction — measured on the running instance, where the shell's socket
 * `ws://127.0.0.1:50112/api/remote.mux` produced `ws://127.0.0.1:50112` against
 * an application origin of `http://127.0.0.1:50112`. Sockets are normalised by
 * {@link socketOrigin} instead, and this function is only ever asked about
 * `http:`/`https:` URLs: the remote census gates on {@link isHttpUrl} before it
 * compares.
 *
 * @param url - the request URL.
 * @returns the origin, or `null` when the URL is not absolute.
 */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * The origin a WebSocket URL addresses, expressed in the document's own scheme.
 *
 * The platform maps the two schemes onto each other: a page served over `http:`
 * opens `ws:` sockets and a page served over `https:` opens `wss:` sockets. The
 * mapping is applied here so that a socket can be compared with the shell's own
 * origin at all, and it is applied **strictly** rather than by discarding the
 * scheme: a socket on another host or port normalises to a different origin and
 * fails, and a socket on the wrong socket scheme — `ws:` on an `https:` page, or
 * `wss:` on an `http:` page — normalises to the wrong document scheme and fails
 * too. A URL that is not an absolute WebSocket URL answers `null`, which also
 * fails the comparison.
 *
 * @param url - the WebSocket URL.
 * @returns the normalised `http(s)://host:port` origin, or `null`.
 */
function socketOrigin(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  // The platform's own mapping between a document's scheme and its socket scheme.
  const documentScheme = parsed.protocol === 'ws:' ? 'http:' : parsed.protocol === 'wss:' ? 'https:' : null
  if (documentScheme === null) return null

  // The default port is written the way `URL.origin` writes it, so a socket that
  // spells `:80` (or `:443`) still compares equal to an origin that does not, and
  // an explicit non-default port is always kept.
  const defaultPort = documentScheme === 'http:' ? '80' : '443'
  const port = parsed.port === '' || parsed.port === defaultPort ? '' : `:${parsed.port}`
  return `${documentScheme}//${parsed.hostname}${port}`
}

/**
 * Requests that left the DSH application's own origin.
 *
 * The rule is the one the case asserts: a request is **remote** when its URL is
 * `http:` or `https:` and its origin is not the origin the shell was loaded
 * from. Same-origin traffic is the application's own — its client bundle, its
 * API calls, its stylesheets — and is expected rather than forbidden; a request
 * to any other origin is not something a document preview may cause.
 *
 * @param records - the request census.
 * @param appOrigin - `new URL(BASE_URL).origin`.
 * @returns the remote requests, in the order they were made.
 */
function remoteRequests(records: readonly RequestRecord[], appOrigin: string): readonly RequestRecord[] {
  return records.filter((record) => isHttpUrl(record.url) && originOf(record.url) !== appOrigin)
}

/**
 * Render one request line for a failure message.
 * @param record - the request.
 * @returns `"<METHOD> <resourceType> <url>"`.
 */
function describeRequest(record: RequestRecord): string {
  return `${record.method} ${record.resourceType} ${record.url}`
}

/**
 * Fail when an error-level console message names this plugin's renderers.
 *
 * The gate is exact and narrow: it matches the four `[dsa-*]` log prefixes the
 * renderers use, so a shell message cannot be mistaken for a renderer failure
 * and no renderer failure can be filtered away. The whole error-level census is
 * carried in the failure message, because the alternative — asserting that the
 * shell produced no error-level message at all — would be a claim about the
 * application that this suite has not measured.
 *
 * @param consoleErrors - the error-level messages collected.
 * @param phase - which case is reporting.
 */
function expectNoRendererConsoleFailure(consoleErrors: readonly ConsoleErrorRecord[], phase: string): void {
  const offenders = consoleErrors.filter((message) =>
    RENDERER_LOG_MARKERS.some((marker) => message.text.includes(marker)),
  )
  expect(
    offenders,
    `${phase}: a renderer failure was logged while a resource was released; error-level console census: ` +
      consoleErrors.map((message) => `${message.url} :: ${message.text}`).join(' | '),
  ).toEqual([])
}

/**
 * Open the DSH shell and point it at the fixture workspace.
 *
 * The session workspace is the one the shared helper selects; the fixtures are
 * addressed relative to it and are published there by the profile bootstrap.
 * Nothing here reads a store or calls a preview API.
 *
 * @param page - the browser page.
 */
async function openShell(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  // The shell's own boot. Every assertion in this file is made against a locator
  // or an in-page predicate, so this is the only unconditional wait.
  await page.waitForTimeout(12_000)
  await expect(page.locator(COMPOSER_INPUT).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator(DRIVER).first()).toBeVisible({ timeout: 30_000 })
  await ensureWorkspace(page)
}

/**
 * Type the sentinel draft and return the projection the composer publishes for it.
 *
 * The comparison recorded here is the composer's own `textContent` projection
 * rather than the string that was typed: the composer is a rich-text surface, and
 * a case that compared against the typed literal would be asserting a
 * normalization the product never promised. The sentinel is still required to be
 * present, so the baseline is a measurement and not merely "whatever was there".
 *
 * @param page - the browser page.
 * @returns the draft as the composer publishes it.
 */
async function typeSentinelDraft(page: Page): Promise<string> {
  const composer = page.locator(COMPOSER_INPUT).first()
  await composer.click()
  await composer.fill(DRAFT_SENTINEL)

  const draft = await readDraft(page)
  expect(draft, 'the composer must hold the sentinel draft this case compares against').toContain(DRAFT_SENTINEL)
  return draft
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
 * Assert that a fixture control is genuinely reachable before it is clicked.
 *
 * The click is an ordinary actionability-checked `locator.click()`, so a control
 * the browser will not accept fails the case anyway — after thirty seconds, with
 * a message that names a Playwright retry rather than a geometry. Stating the
 * four bounds first turns that into a measurement naming the control, its box and
 * the viewport it did not fit. The strip is `position: fixed`, so no scrolling
 * could rescue a control that overflowed it.
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
 * Click one fixture control, asserting its geometry first.
 *
 * Every fixture in this file is opened through here, so "the document was opened
 * by an ordinary click on a control that was inside the window" is a property of
 * the suite rather than of one helper.
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
 * Open one byte-rendered fixture and return the address its root published.
 *
 * The root's own `data-dsa-resource-address` is the address the renderer was
 * given, and the nearest `data-document-preview` ancestor is asserted to be this
 * plugin's definition for the format: the builtin PDF renderer would produce a
 * preview container too, and a case that waited only for the container could be
 * measuring a renderer this plugin never mounted.
 *
 * @param page - the browser page.
 * @param key - the fixture key.
 * @param format - which of the four renderers must draw it.
 * @returns the published resource address.
 */
async function openByteFixture(page: Page, key: string, format: ByteFormat): Promise<string> {
  await clickFixtureControl(page, key)

  const root = page.locator(`[data-dsa-document-kind="${format}"]`).first()
  await expect(root).toBeVisible({ timeout: 60_000 })

  const address = await root.getAttribute(RESOURCE_ADDRESS)
  if (address === null || address === '') {
    throw new Error(`the ${format} renderer published an empty resource address`)
  }

  const preview = await root.evaluate((element, attribute) => {
    const ancestor = element.closest(`[${attribute}]`)
    return ancestor === null ? null : ancestor.getAttribute(attribute)
  }, PREVIEW_IDENTITY_ATTRIBUTE)

  expect(preview, `the document preview must be registered as ${PLUGIN_RENDERER[format]}`).toBe(
    PLUGIN_RENDERER[format],
  )

  return address
}

/**
 * Open one builtin-preview fixture (TXT, Markdown, code, CSV).
 * @param page - the browser page.
 * @param key - the fixture key.
 * @returns the address the preview published for itself.
 */
async function openTextFixture(page: Page, key: string): Promise<string> {
  await clickFixtureControl(page, key)

  const root = page.locator(`[${PREVIEW_STATE_ATTRIBUTE}][${PREVIEW_URL_ATTRIBUTE}]`).first()
  await expect(root).toHaveAttribute(PREVIEW_STATE_ATTRIBUTE, 'text', { timeout: 60_000 })

  const address = await root.getAttribute(PREVIEW_URL_ATTRIBUTE)
  if (address === null || address === '') throw new Error('the text preview published no address')

  await expect(page.locator(PREVIEW_BODY).first()).toBeVisible({ timeout: 40_000 })
  return address
}

/**
 * Read every renderer root's published resource address, in document order.
 * @param page - the browser page.
 * @returns one entry per live renderer root.
 */
async function readPublishedAddresses(page: Page): Promise<readonly string[]> {
  return page.evaluate(
    (attribute: string): string[] =>
      [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)].map(
        (element) => element.getAttribute(attribute) ?? '',
      ),
    RESOURCE_ADDRESS,
  )
}

/**
 * Count the live renderer roots that name one exact address.
 * @param page - the browser page.
 * @param address - the address to count.
 * @returns how many renderer roots publish it.
 */
async function countRootsForAddress(page: Page, address: string): Promise<number> {
  return page.evaluate(
    ([attribute, expected]: readonly [string, string]): number =>
      [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)].filter(
        (element) => element.getAttribute(attribute) === expected,
      ).length,
    [RESOURCE_ADDRESS, address] as const,
  )
}

/**
 * Read the XLSX grid's published accessible name.
 *
 * The library labels the grid `"Workbook grid"` while it has no active sheet and
 * `"<Sheet> worksheet grid"` once the parsed model is available, which is the
 * state this suite uses to tell a parse that is still running from one that
 * finished.
 *
 * @param page - the browser page.
 * @returns the label, or `null` when no grid is mounted.
 */
async function readGridLabel(page: Page): Promise<string | null> {
  return page.evaluate((selector: string): string | null => {
    const grid = document.querySelector(`${selector} [role="grid"]`)
    return grid === null ? null : grid.getAttribute('aria-label')
  }, XLSX_CONTENT)
}

/**
 * Wait until one page of the plugin's PDF renderer has finished its first raster.
 *
 * The gate is **page-scoped**, and that is a measured decision rather than a
 * convenience. Probed on the running instance with `pdf-two` open at the smoke
 * viewport, the plugin's stack published **six** page wrappers for that fixture;
 * page 1 was the only one that had rasterised (canvas 576x814, its own
 * placeholder gone), while pages 2-6 were still the renderer's lazy state — one
 * placeholder each and a canvas at the browser's 300x150 default — because the
 * stack sat at `scrollTop: 0` and later pages mount only once they are scrolled
 * to. A document-wide `[data-dsa-pdf-placeholder]` count of zero is therefore a
 * state this renderer never produces for this fixture, at any time, and waiting
 * for it waits for something the product does not do. The shape below is the repo's
 * own measured idiom for one page — `waitForPage` in `pdf-renderer.spec.ts`: a
 * sized canvas, the page's own placeholder gone, then the text layer populated —
 * narrowed here by requiring a canvas that is not the lazy default, so a mounted
 * wrapper whose page was never rasterised cannot satisfy it.
 *
 * @param page - the browser page.
 * @param pageNumber - the 1-based page that must be ready.
 * @param phase - which case is reporting.
 */
async function expectPdfPageReady(page: Page, pageNumber: number, phase: string): Promise<void> {
  const wrapper = page.locator(`[data-dsa-pdf-page="${String(pageNumber)}"]`).first()
  await expect(wrapper, `${phase}: PDF page ${String(pageNumber)} must be mounted`).toBeVisible({ timeout: 60_000 })

  // The placeholder the renderer shows until the first render settles is its own
  // signal that this page's canvas and text layer have both finished.
  await expect(
    wrapper.locator(PDF_PLACEHOLDER),
    `${phase}: PDF page ${String(pageNumber)} never settled`,
  ).toHaveCount(0, { timeout: 60_000 })

  await expect
    .poll(
      async () =>
        wrapper
          .locator(PDF_CANVAS)
          .evaluate(
            (canvas: HTMLCanvasElement) =>
              canvas.width > 0 && canvas.height > 0 && !(canvas.width === 300 && canvas.height === 150),
          ),
      { timeout: 60_000, message: `${phase}: PDF page ${String(pageNumber)} never produced a real raster` },
    )
    .toBe(true)

  await expect
    .poll(async () => await wrapper.locator(`${PDF_TEXT} span`).count(), {
      timeout: 60_000,
      message: `${phase}: PDF page ${String(pageNumber)} never published a text layer`,
    })
    .toBeGreaterThan(0)
}

/**
 * The shape of the argument an in-page predicate may receive.
 *
 * Strings only, so the argument survives the page boundary unchanged and the
 * predicate stays a plain DOM function with no harness object in it.
 */
type InPageArg = Record<string, string>

/**
 * Run one in-page predicate once per animation frame until it answers.
 *
 * `page.waitForFunction` is the only polling mode that samples on animation
 * frames, which is what makes a narrow window observable at all — a worker that
 * has started but whose document is not open yet, or a page whose first raster
 * has not settled. Its options carry no message, so a missed window would surface
 * as a bare timeout; the message is attached here instead, naming the window the
 * case needed and why it depends on it. Each evaluation is one in-page task, so
 * the facts a predicate reads are sampled together rather than across round
 * trips.
 *
 * @param page - the browser page.
 * @param predicate - the in-page predicate, called with `arg`.
 * @param arg - the string-valued argument the predicate receives.
 * @param message - this suite's own words for a miss.
 * @param timeout - how long the predicate may keep answering falsy.
 * @returns the truthy value the predicate settled on.
 */
async function pollInPage<Result extends string | number | boolean>(
  page: Page,
  predicate: (arg: InPageArg) => Result | Promise<Result>,
  arg: InPageArg,
  message: string,
  timeout: number,
): Promise<Result> {
  try {
    const handle = await page.waitForFunction<Result | Promise<Result>, InPageArg>(predicate, arg, {
      timeout,
      polling: 'raf',
    })
    const value = await handle.jsonValue()
    await handle.dispose()
    return value
  } catch (error: unknown) {
    throw new Error(`${message} — observed instead: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Wait until the live document has been mutation-quiet for a bounded run of
 * animation frames.
 *
 * The window is state, not a sleep. The predicate installs a `MutationObserver`
 * over the whole document and counts consecutive animation frames in which it
 * received nothing; a single mutation resets the run, and the predicate answers
 * true only when the run reaches the required length. The run must be found
 * inside the attempt budget, so unrelated low-rate shell churn cannot fail the
 * case, while the burst a late publication would produce breaks every run it
 * falls into — and the state assertions that follow re-check the same facts once
 * the window has closed. A sleep would prove only that time passed; a quiet run
 * proves that the asynchronous tail being measured produced no DOM at all.
 *
 * @param page - the browser page.
 * @param phase - which case is reporting.
 */
async function waitForFrameQuiet(page: Page, phase: string): Promise<void> {
  try {
    await page.waitForFunction(
      async (options: { readonly frames: number; readonly budget: number }): Promise<boolean> => {
        const quiet = await new Promise<number>((resolve) => {
          const started = performance.now()
          let run = 0
          const observer = new MutationObserver(() => {
            run = 0
          })
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          })

          const tick = (): void => {
            run += 1
            if (run >= options.frames || performance.now() - started >= options.budget) {
              observer.disconnect()
              resolve(run)
              return
            }
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })

        return quiet >= options.frames
      },
      { frames: QUIET_FRAMES, budget: QUIET_BUDGET_MS },
      { timeout: QUIET_TIMEOUT_MS, polling: 'raf' },
    )
  } catch (error: unknown) {
    throw new Error(
      `${phase}: the document must become mutation-quiet for ${String(QUIET_FRAMES)} consecutive animation ` +
        `frames within ${String(QUIET_BUDGET_MS)} ms per attempt; a document that never quiets cannot ` +
        `witness an inert late cleanup — observed instead: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * The shared state gate every cleanup case asserts after its observation window.
 *
 * These are the facts that make "the late cleanup was inert" observable: the old
 * renderer root is gone **by address**, the live preview publishes exactly the
 * new resource's address, the Ask surface is absent (an Ask button that
 * unexpectedly exists fails the case — the locator is read, never hidden or
 * skipped), the composer still holds exactly the draft it held before the heavy
 * fixture was opened, no refusal toast was raised into the new document, and the
 * page raised no uncaught error, no unhandled rejection, no renderer console
 * failure and no remote request.
 *
 * @param page - the browser page.
 * @param options - the case's identity and expectations.
 */
async function expectCleanupStayedInert(
  page: Page,
  options: {
    readonly phase: string
    readonly closedAddress: string
    readonly currentAddress: string
    readonly draftBeforeOpen: string
    readonly observers: Observers
    readonly appOrigin: string
  },
): Promise<void> {
  const { phase, closedAddress, currentAddress, draftBeforeOpen, observers, appOrigin } = options

  expect(
    await page.locator(ASK_BUTTON).count(),
    `${phase}: no Ask surface may exist after the old resource was released; a button here would offer a ` +
      `selection that belongs to a document the reader has left, so this case fails rather than skipping it`,
  ).toBe(0)

  expect(
    await readDraft(page),
    `${phase}: the composer draft must be byte-for-byte the projection it held before the heavy fixture ` +
      `was opened; a quote block here would mean an old selection was still sendable`,
  ).toBe(draftBeforeOpen)

  expect(
    await page.locator(ERROR_TOAST).count(),
    `${phase}: releasing a resource must not raise a refusal into the document that replaced it`,
  ).toBe(0)

  expect(
    await readPublishedAddresses(page),
    `${phase}: the live preview must publish exactly one renderer root, and its ${RESOURCE_ADDRESS} must be ` +
      `the address of the resource that is actually open`,
  ).toEqual([currentAddress])

  expect(
    await countRootsForAddress(page, closedAddress),
    `${phase}: the released resource's root must not be published anywhere in the live page`,
  ).toBe(0)

  expect(await readRejections(page), `${phase}: releasing a resource must raise no unhandled rejection`).toEqual([])
  expect(observers.pageErrors, `${phase}: releasing a resource must raise no uncaught page error`).toEqual([])
  expectNoRendererConsoleFailure(observers.consoleErrors, phase)

  expect(
    remoteRequests(observers.requests, appOrigin).map(describeRequest),
    `${phase}: opening and releasing documents must reach no origin other than the DSH application's own`,
  ).toEqual([])
}

/**
 * Select a run of rows with a real gesture: press inside the first row's own
 * text, then extend with a real held Shift and a real click.
 *
 * The two-box read and the anchor offset are the ones the TXT suite measured:
 * a row's leading edge can sit outside its glyphs, and a drag anchored there
 * snaps to the nearest character. Nothing here selects programmatically.
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

  await page.keyboard.down('Shift')
  await page.mouse.move(end.x + Math.max(1, end.width - 1), end.y + end.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.up('Shift')

  return page.evaluate(() => document.getSelection()?.toString() ?? '')
}

/**
 * Repeat the real gesture until the browser reports exactly the expected text.
 *
 * The retry answers a measured property of the shell rather than a flake: the
 * document column animates in, and a gesture anchored while it is still moving
 * lands on a different glyph. Each attempt re-reads the boxes and the final
 * attempt's answer is what the caller sees, so a genuine failure still fails.
 *
 * @param page - the browser page.
 * @param rows - the rows, in document order.
 * @param fromIndex - the first row to include.
 * @param toIndex - the last row to include.
 * @param expected - the text the gesture must have selected.
 * @returns the selected text.
 */
async function selectExpectedRows(
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

test.describe('real DSH cross-format resource cleanup', () => {
  /**
   * The file's own budget, stated rather than inherited.
   *
   * Every case below navigates to the shell (whose boot alone is the twelve
   * second wait in `openShell`), opens two documents through the driver's
   * controls and then observes a bounded frame-quiet window. The default
   * thirty-second per-test budget measures a single-document case; this suite's
   * cases are longer by construction, and a budget that expires mid-window would
   * report a timeout instead of the state it was measuring.
   */
  test.describe.configure({ timeout: 180_000 })

  test('1. PDF rapid switch: the old text layer is not republished, the worker’s start URL is released and Ask does not return', async ({
    page,
  }) => {
    const observers = observe(page)
    const appOrigin = new URL(BASE_URL).origin
    await installRuntimeProbe(page)
    await openShell(page)
    await installRejectionRecorder(page)
    const draftBeforeOpen = await typeSentinelDraft(page)

    const pdfAddress = await openByteFixture(page, 'pdf-two', 'pdf')

    // (a) The render really started **and had not settled**.
    //
    // Two observables, sampled together in one in-page predicate so the assertion
    // cannot be raced by its own round trip. The first is the platform fact that a
    // native worker was constructed from a `blob:` URL under the name `dsa-pdf` (a
    // main-thread fallback would leave no trace). The second is the renderer's own
    // unfinished state, and it is deliberately **page-scoped**: probed on the
    // running instance with this fixture open at the smoke viewport, the stack
    // publishes six page wrappers, and pages 2-6 keep their placeholder and a
    // 300x150 canvas for as long as the stack sits at `scrollTop: 0` — so a
    // document-wide placeholder count is not a settlement signal on this renderer
    // and a case that read one would be "in flight" forever. What is read instead
    // is: the loading notice stands (the document is still opening, so no page is
    // mounted yet), or page 1 has not published its own generation (its
    // placeholder is still there, or its text layer holds no span). Both states
    // are gone once the first page has settled. A `role="alert"` notice is
    // excluded on purpose — a failed render also sits in that stack, and a case
    // that accepted it would be switching away from a document that never
    // rendered.
    const pdfWorkerUrl = await pollInPage(
      page,
      (options: InPageArg): string | false => {
        const probe = (globalThis as unknown as Record<string, unknown>)[options['key'] ?? ''] as
          | { workers: { url: string; name?: string | undefined }[] }
          | undefined
        const root = document.querySelector(`[data-dsa-document-kind="${options['kind'] ?? ''}"]`)
        if (probe === undefined || root === null) return false

        const worker = probe.workers.find((entry) => entry.name === (options['name'] ?? ''))
        if (worker === undefined) return false

        const notice = [...root.querySelectorAll('[data-dsa-pdf-notice]')].filter(
          (element) => element.getAttribute('role') !== 'alert',
        )
        if (notice.length > 0) return worker.url

        const firstPage = root.querySelector('[data-dsa-pdf-page="1"]')
        if (firstPage === null) return false

        const unsettled =
          firstPage.querySelector('[data-dsa-pdf-placeholder]') !== null ||
          firstPage.querySelectorAll('[data-dsa-pdf-text] span').length === 0
        return unsettled ? worker.url : false
      },
      { key: PROBE_KEY, name: 'dsa-pdf', kind: 'pdf' },
      'PDF: the render must still be in flight when the switch happens — a pdf-two whose first page had ' +
        'already settled would leave this case with no cleanup window to observe',
      60_000,
    )
    if (typeof pdfWorkerUrl !== 'string') throw new Error('PDF: the in-flight predicate resolved with no worker URL')

    expect(pdfWorkerUrl.startsWith('blob:'), `the PDF worker must run from a client-owned URL, got ${pdfWorkerUrl}`).toBe(
      true,
    )
    expect(
      (await readProbe(page)).created,
      `the URL the PDF worker was started from must have been created in this page: ${pdfWorkerUrl}`,
    ).toContain(pdfWorkerUrl)

    // The switch, while pages are still rastering: an ordinary actionability
    // checked click on the driver's own control.
    const docxAddress = await openByteFixture(page, 'docx-paragraphs', 'docx')

    // (b) The cleanup opportunity, observed on the platform rather than inferred
    // from the code that should perform it: `session.dispose()` revokes the URL
    // the PDF worker was started from, and that call *is* the late cleanup. The
    // URL was created while the old resource was loading, so its revocation is
    // the exact event this case is about.
    //
    // What is measured, stated exactly: the revocation of the URL the worker was
    // **started from**. Worker *termination* itself has no observable state in the
    // platform — `Worker` exposes no lifecycle query, and the browser reports
    // nothing when a thread ends — so this case does not claim to have watched the
    // worker stop. The released start URL is the platform-observable proxy for the
    // session's release, and the case is titled for the proxy rather than for the
    // thread.
    expect(
      await pollInPage(
        page,
        (options: InPageArg): boolean => {
          const probe = (globalThis as unknown as Record<string, unknown>)[options['key'] ?? ''] as
            | { revoked: string[] }
            | undefined
          return probe !== undefined && probe.revoked.includes(options['url'] ?? '')
        },
        { key: PROBE_KEY, url: pdfWorkerUrl },
        `PDF: the object URL ${pdfWorkerUrl} must be released when the resource that owned it is left; ` +
          `without that call the cleanup never ran and this case would prove nothing`,
        60_000,
      ),
      'PDF: the released worker URL must be observed as revoked',
    ).toBe(true)

    await waitForFrameQuiet(page, 'PDF')

    await expectCleanupStayedInert(page, {
      phase: 'PDF',
      closedAddress: pdfAddress,
      currentAddress: docxAddress,
      draftBeforeOpen,
      observers,
      appOrigin,
    })

    // One generation of text per page container, and no predecessor left behind:
    // the released document's page wrappers and text layers are gone from the
    // live page, so no late generation can republish text, and no selection can
    // be resolved inside the old document any more.
    expect(await page.locator(PDF_ROOT).count(), 'PDF: the released renderer root must not exist').toBe(0)
    expect(await page.locator(PDF_PAGE).count(), 'PDF: no page wrapper of the released document may remain').toBe(0)
    expect(await page.locator(PDF_TEXT).count(), 'PDF: no text layer of the released document may remain').toBe(0)
    // A late failure notice is the other half of the same rule: a document that
    // was released cannot report anything into the one that replaced it.
    expect(await page.locator(PDF_NOTICE).count(), 'PDF: no notice of the released document may remain').toBe(0)

    // The replacement is ready and still standing: its own rendered page markers
    // exist and its first raster has settled.
    await expect(page.locator(DOCX_PAGE).first()).toBeVisible({ timeout: 40_000 })
    await expect(page.locator(DOCX_CONTENT).first()).toBeVisible()
  })

  test('2. DOCX rapid switch: a detached staging completion publishes nothing, raises no toast and leaves no stale Ask', async ({
    page,
  }) => {
    const observers = observe(page)
    const appOrigin = new URL(BASE_URL).origin
    await openShell(page)
    await installRejectionRecorder(page)
    const draftBeforeOpen = await typeSentinelDraft(page)

    const docxAddress = await openByteFixture(page, 'docx-table-image', 'docx')

    // (a) The render really started **and had not settled**. The DOCX body
    // publishes its own load state, and the state itself is the proof: the
    // loading copy is rendered only while `state.kind === 'loading'`, which is
    // mutually exclusive with the ready state, and no `data-dsa-docx-page` marker
    // exists yet, so the staging that the switch interrupts is demonstrably still
    // pending. This fixture is the non-trivial one — an archive with a table and
    // an embedded image — so preflight, extraction verification and rendering are
    // all still ahead at this point.
    expect(
      await pollInPage(
        page,
        (options: InPageArg): boolean => {
          const root = document.querySelector(`[data-dsa-document-kind="${options['kind'] ?? ''}"]`)
          if (root === null) return false
          const loading = (root.textContent ?? '').includes(options['loading'] ?? '')
          return loading && document.querySelectorAll('[data-dsa-docx-page]').length === 0
        },
        { kind: 'docx', loading: LOADING_TEXT },
        'DOCX: the render must still be in its loading state when the switch happens — a settled ' +
          'docx-table-image would leave no staging completion to detach',
        60_000,
      ),
      'DOCX: the render must be observed as still loading',
    ).toBe(true)

    const pdfAddress = await openByteFixture(page, 'pdf-single', 'pdf')

    // (b) The cleanup opportunity: the old viewer session is released at the
    // switch, and the claim is that its asynchronous tail — the staging
    // completion the renderer awaits, its `dispose()` and its publish path — has
    // landed without touching the live document. The frame-quiet window is the
    // direct observation of that: a run of animation frames in which the whole
    // document produced no mutation at all, sampled in the same in-page predicate
    // as the state that must still hold afterwards.
    await waitForFrameQuiet(page, 'DOCX')

    await expectCleanupStayedInert(page, {
      phase: 'DOCX',
      closedAddress: docxAddress,
      currentAddress: pdfAddress,
      draftBeforeOpen,
      observers,
      appOrigin,
    })

    // A detached staging completion must not publish live DOM: neither the old
    // content host nor any rendered page marker exists, and the old body cannot
    // have mounted a second viewer over the new document.
    expect(await page.locator(DOCX_ROOT).count(), 'DOCX: the released renderer root must not exist').toBe(0)
    expect(await page.locator(DOCX_CONTENT).count(), 'DOCX: the released content host must not exist').toBe(0)
    expect(await page.locator(DOCX_PAGE).count(), 'DOCX: no rendered page marker may return').toBe(0)

    // The replacement is ready and still standing, read from page 1's own state.
    await expectPdfPageReady(page, 1, 'DOCX')
  })

  test('3. PPTX rapid switch: the viewer is destroyed, old slides do not return and object URLs balance', async ({
    page,
  }) => {
    const observers = observe(page)
    const appOrigin = new URL(BASE_URL).origin
    await installRuntimeProbe(page)
    await openShell(page)
    await installRejectionRecorder(page)
    const draftBeforeOpen = await typeSentinelDraft(page)

    const pptxAddress = await openByteFixture(page, 'pptx-large-120-slides', 'pptx')

    // (a) The render really started **and had not settled**. The deck's own
    // published load state is the anchor: the loading copy exists only while the
    // body is in `state.kind === 'loading'`, and no `data-dsa-pptx-slide` node has
    // been marked yet, so the 120-slide parse, its security gates and its
    // windowed render are all still in flight. This is the same observable the
    // existing PPTX suite uses for its own rapid-switch case, which is why it is
    // reused rather than replaced by a probe that would measure a different
    // renderer.
    expect(
      await pollInPage(
        page,
        (options: InPageArg): boolean => {
          const root = document.querySelector(`[data-dsa-document-kind="${options['kind'] ?? ''}"]`)
          if (root === null) return false
          const loading = (root.textContent ?? '').includes(options['loading'] ?? '')
          return loading && document.querySelectorAll('[data-dsa-pptx-slide]').length === 0
        },
        { kind: 'pptx', loading: LOADING_TEXT },
        'PPTX: the 120-slide render must still be in flight when the switch happens — a settled deck ' +
          'would leave no viewer to destroy',
        60_000,
      ),
      'PPTX: the render must be observed as still loading',
    ).toBe(true)

    // Everything the deck allocated before the switch, so the balance below is a
    // statement about the released resource and not about the one replacing it.
    const allocationsBeforeSwitch = (await readProbe(page)).created.length

    const xlsxAddress = await openByteFixture(page, 'xlsx-simple', 'xlsx')

    // (b) The cleanup opportunity: the deck's abort path runs at the switch and
    // its tail is asynchronous, so the observation is a mutation-quiet run over
    // the whole document while the replacement stands.
    await waitForFrameQuiet(page, 'PPTX')

    await expectCleanupStayedInert(page, {
      phase: 'PPTX',
      closedAddress: pptxAddress,
      currentAddress: xlsxAddress,
      draftBeforeOpen,
      observers,
      appOrigin,
    })

    // The viewer is destroyed and its slides do not come back: no marked slide
    // node and no content host of the released deck exists anywhere in the live
    // page, which is what a republished windowed render would produce.
    expect(await page.locator(PPTX_SLIDE).count(), 'PPTX: no slide node of the released deck may remain').toBe(0)
    expect(await page.locator(PPTX_CONTENT).count(), 'PPTX: the released content host must not exist').toBe(0)
    expect(await page.locator(PPTX_ROOT).count(), 'PPTX: the released renderer root must not exist').toBe(0)

    // The replacement works: its workbook was parsed by a real client-owned
    // worker and the grid carries a parsed sheet, not the pre-parse placeholder
    // label. The object-URL census is read *after* this point, so it also covers
    // the replacement's own allocations.
    await expect(page.locator(`${XLSX_CONTENT} [role="grid"]`).first()).toBeVisible({ timeout: 60_000 })
    await expect
      .poll(async () => await readGridLabel(page), {
        timeout: 60_000,
        message: 'the replacement workbook must finish parsing',
      })
      .not.toBe('Workbook grid')

    // Object URLs, in two readings that cannot be vacuous together.
    //
    // The document-wide balance is the primary check and it always has something
    // to measure: the replacement workbook was parsed by a real client-owned
    // `Blob` worker, so this page minted at least that worker's URL, and by the
    // contract the existing XLSX suite records it is released rather than left
    // behind. Asserting the census is non-empty first is what stops an empty page
    // from satisfying the balance silently.
    //
    // The released deck's own slice — everything created up to the switch — is
    // then reported and checked for leaks. Its length is a measurement, not an
    // expectation: this fixture's deck is 120 slides of text with no media (the
    // generator adds none), and the renderer mints object URLs only for media or
    // for the embedded-PDF path it runs with `pdfjs: false`, so a zero here is the
    // measured fact and is recorded as one in the report annotation below. A
    // non-zero reading is equally acceptable and is held to the same no-leak rule;
    // what is not acceptable is a balance that passed because nothing was counted.
    const probeAfter = await readProbe(page)
    expect(
      probeAfter.created.length,
      'PPTX: the page must have allocated at least the replacement workbook’s worker URL, or the balance ' +
        'below would compare nothing',
    ).toBeGreaterThanOrEqual(1)

    const outstandingPage = probeAfter.created.filter((url) => !probeAfter.revoked.includes(url))
    expect(
      outstandingPage,
      `PPTX: every object URL this page minted must be released once its owner is done — created ` +
        `${String(probeAfter.created.length)}, revoked ${String(probeAfter.revoked.length)}; outstanding: ` +
        `${outstandingPage.join(', ')}`,
    ).toEqual([])

    const deckAllocations = probeAfter.created.slice(0, allocationsBeforeSwitch)
    const outstandingDeck = deckAllocations.filter((url) => !probeAfter.revoked.includes(url))
    test.info().annotations.push({
      type: 'object-url census',
      description:
        `PPTX phase: deck allocations before the switch ${String(deckAllocations.length)}; ` +
        `page created ${String(probeAfter.created.length)}, revoked ${String(probeAfter.revoked.length)}`,
    })
    expect(
      outstandingDeck,
      `PPTX: ${String(deckAllocations.length)} object URL(s) were created while the deck was open and every ` +
        `one of them must have been released; outstanding: ${outstandingDeck.join(', ')}`,
    ).toEqual([])
  })

  test('4. XLSX rapid switch: a really-started Blob Worker parse is released without a stale semantic publish', async ({
    page,
  }) => {
    const observers = observe(page)
    const appOrigin = new URL(BASE_URL).origin
    await installRuntimeProbe(page)
    await openShell(page)
    await installRejectionRecorder(page)
    const draftBeforeOpen = await typeSentinelDraft(page)

    // How many workers the page already had before the workbook was opened. The
    // parse worker is the one constructed *after* this mark, so the case cannot
    // mistake a shell worker for the plugin's parse.
    const workersBeforeOpen = (await readProbe(page)).workers.length

    const xlsxAddress = await openByteFixture(page, 'xlsx-large', 'xlsx')

    // (a) The render really started **and had not settled**, from the instrumented
    // `Blob` Worker. The probe is installed before the application boots, so the
    // worker's construction and the exact URL it was handed are read from the
    // platform. "Still in flight" is the parse itself: the grid publishes the
    // label `Workbook grid` while it has no active sheet and `Sheet1 worksheet
    // grid` once the parsed model exists, so a grid that is absent or still
    // unlabelled is a parse that has not finished. Both facts are sampled in one
    // in-page predicate.
    const parseWorkerUrl = await pollInPage(
      page,
      (options: InPageArg): string | false => {
        const probe = (globalThis as unknown as Record<string, unknown>)[options['key'] ?? ''] as
          | { workers: { url: string }[] }
          | undefined
        const fresh = probe === undefined ? [] : probe.workers.slice(Number(options['baseline'] ?? '0'))
        if (fresh.length === 0) return false

        const grid = document.querySelector(`${options['content'] ?? ''} [role="grid"]`)
        const parsed = grid !== null && (grid.getAttribute('aria-label') ?? '') !== 'Workbook grid'
        if (parsed) return false

        const worker = fresh[0]
        return worker === undefined ? false : worker.url
      },
      { key: PROBE_KEY, content: XLSX_CONTENT, baseline: String(workersBeforeOpen) },
      'XLSX: a Blob Worker must have started the parse and the workbook must not be parsed yet when ' +
        'the switch happens — otherwise this case never enters the mid-parse window',
      120_000,
    )
    if (typeof parseWorkerUrl !== 'string') throw new Error('XLSX: the in-flight predicate resolved with no worker URL')

    expect(
      parseWorkerUrl.startsWith('blob:'),
      `the workbook must be parsed in a client-owned Worker, got ${parseWorkerUrl}`,
    ).toBe(true)
    const probeBeforeSwitch = await readProbe(page)
    expect(
      probeBeforeSwitch.created,
      `the URL the parse worker was started from must have been created in this page: ${parseWorkerUrl}`,
    ).toContain(parseWorkerUrl)

    const allocationsBeforeSwitch = probeBeforeSwitch.created.length
    const docxAddress = await openByteFixture(page, 'docx-paragraphs', 'docx')

    // (b) The cleanup opportunity: the parse's abort path and the viewer session's
    // release run at the switch, and their tail is what must be inert. The
    // mutation-quiet run over the whole document is the observation; the released
    // URL set below is the corroborating platform record.
    await waitForFrameQuiet(page, 'XLSX')

    await expectCleanupStayedInert(page, {
      phase: 'XLSX',
      closedAddress: xlsxAddress,
      currentAddress: docxAddress,
      draftBeforeOpen,
      observers,
      appOrigin,
    })

    // No stale semantic publish: the attribute the adapter would turn into
    // provenance cannot be read from the live page at all — neither on a surviving
    // root nor on any other node — and the released workbook root does not return.
    expect(
      await page.locator(XLSX_SELECTION).count(),
      'XLSX: a semantic selection of the released workbook must not be readable from the live page',
    ).toBe(0)
    expect(await page.locator(XLSX_ROOT).count(), 'XLSX: the released workbook root must not return').toBe(0)
    expect(await page.locator(XLSX_CONTENT).count(), 'XLSX: the released workbook content host must not exist').toBe(0)

    // Worker-related blob cleanup follows the contract the existing XLSX suite
    // records: every URL created while the workbook was open is released. The
    // count is reported even when the set is empty.
    const probeAfter = await readProbe(page)
    const workbookAllocations = probeAfter.created.slice(0, allocationsBeforeSwitch)
    const outstanding = workbookAllocations.filter((url) => !probeAfter.revoked.includes(url))
    expect(
      outstanding,
      `XLSX: ${String(workbookAllocations.length)} object URL(s) were created while the workbook was open and ` +
        `every one of them must have been released; outstanding: ${outstanding.join(', ')}`,
    ).toEqual([])

    // The engine is a compressed payload inside the client bundle and the parse
    // runs in a `blob:` worker, so no worker or WASM request may exist over HTTP
    // at any point in this case.
    const httpRuntimeRequests = observers.requests.filter(
      (record) =>
        isHttpUrl(record.url) &&
        (record.resourceType === 'worker' || /worker/i.test(record.url) || /\.wasm/i.test(record.url)),
    )
    expect(
      httpRuntimeRequests.map(describeRequest),
      'XLSX: the worker and the WASM engine must not be fetched over HTTP',
    ).toEqual([])

    // The replacement works.
    await expect(page.locator(DOCX_PAGE).first()).toBeVisible({ timeout: 40_000 })

    // The viewer's own image URL is not the plugin's to reclaim. This is the
    // ownership contract the existing XLSX object-URL case records: the picture's
    // source is created exactly once, by the controller, and is still live while
    // its workbook is open — a plugin that released it would blank a picture the
    // reader is still looking at.
    const imageAddress = await openByteFixture(page, 'xlsx-chart-image', 'xlsx')
    const content = page.locator(XLSX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 60_000 })
    await expect
      .poll(async () => await content.locator(XLSX_IMAGE).count(), {
        timeout: 40_000,
        message: 'the workbook’s embedded picture must be published as an image node',
      })
      .toBeGreaterThanOrEqual(1)

    const pictureSrc = await content.locator(XLSX_IMAGE).first().getAttribute('src')
    expect(pictureSrc, 'the published picture must carry a source').not.toBeNull()
    expect(pictureSrc?.startsWith('blob:'), `the picture must render from a client-owned URL, got ${pictureSrc}`).toBe(
      true,
    )

    const audit = await readProbe(page)
    expect(
      audit.created.filter((url) => url === pictureSrc),
      'the picture’s bytes must be minted once, not once per render',
    ).toHaveLength(1)
    expect(
      audit.revoked,
      'a viewer-owned picture URL must not be reclaimed by the plugin while its workbook is open',
    ).not.toContain(pictureSrc)
    expect(await readPublishedAddresses(page)).toEqual([imageAddress])
  })

  test('5. a late PPTX cleanup cannot clear the live TXT selection that replaced it', async ({ page }) => {
    // **This is the real-browser acceptance for Task 12's resource-scoped
    // invalidation.** A is the slowest resource in the corpus and B is a
    // different supported format drawn by the product's own plain renderer, so
    // the late cleanup crosses a renderer boundary — the case in which a
    // coordinator that cleared "whatever is current" instead of "the resource
    // that ended" would clear B's snapshot and take B's Ask surface down.
    //
    // The ordering below is the whole point, and it is stated because the obvious
    // ordering does not test the property: B's selection must still be **live and
    // unconsumed** when A's cleanup lands. The Ask button is only rendered while
    // the overlay holds a snapshot *and* a composer target, and a press clears the
    // snapshot after a successful write, so a case that pressed first and observed
    // afterwards would have nothing left for the late cleanup to damage — it would
    // prove that A's DOM stayed away and that the composer was not rewritten, and
    // not the property it names. Here the gesture raises the surface and the
    // surface is left un-pressed across the observation window; the surviving
    // button is the live-snapshot observable, and the press happens afterwards, so
    // the block it appends also proves the survivor is the *right* snapshot.
    const observers = observe(page)
    const appOrigin = new URL(BASE_URL).origin
    await openShell(page)
    await installRejectionRecorder(page)
    const draftBeforeOpen = await typeSentinelDraft(page)

    // 1. Open A, and prove its render started and had not settled.
    const pptxAddress = await openByteFixture(page, 'pptx-large-120-slides', 'pptx')
    expect(
      await pollInPage(
        page,
        (options: InPageArg): boolean => {
          const root = document.querySelector(`[data-dsa-document-kind="${options['kind'] ?? ''}"]`)
          if (root === null) return false
          const loading = (root.textContent ?? '').includes(options['loading'] ?? '')
          return loading && document.querySelectorAll('[data-dsa-pptx-slide]').length === 0
        },
        { kind: 'pptx', loading: LOADING_TEXT },
        'A must still be rendering when B is opened, or the late cleanup this case measures cannot exist',
        60_000,
      ),
      'A: the deck must be observed as still loading',
    ).toBe(true)

    // 2. Switch to B while A is still in flight.
    const textAddress = await openTextFixture(page, 'txt')
    await expect(page.locator(PREVIEW_LINE)).toHaveCount(3, { timeout: 40_000 })

    // 3. A real selection in B, with a real gesture on the preview's own rows, and
    // the Ask surface it raises is left **un-pressed**: that visible button is the
    // live snapshot this case is about. No quote may reach the composer yet, which
    // is asserted rather than assumed.
    const rows = page.locator(PREVIEW_LINE)
    const selected = await selectExpectedRows(page, rows, 1, 1, 'beta')
    expect(selected, 'the gesture must select exactly the TXT preview’s second line').toBe('beta')

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton, 'B’s Ask surface must come up for B’s own selection').toBeVisible({ timeout: 20_000 })
    expect(
      await readDraft(page),
      'raising the Ask surface must not write to the composer; the quote belongs to the press',
    ).toBe(draftBeforeOpen)

    // 4. A's late cleanup opportunity, anchored on state: a mutation-quiet run
    // over the whole document while B stands **and B's snapshot is still live**.
    // A's abort tail — the rejected `renderPptx`, its `invalidateActiveViewer` and
    // the body's unmount cleanup — lands inside this window, and a publication from
    // any of them would break every quiet run it fell into. A cleanup that reached
    // for "the current selection" instead of "the resource that ended" would clear
    // B's snapshot here, and the surface would go with it.
    await waitForFrameQuiet(page, 'A-cannot-clear-B')

    expect(await page.locator(PPTX_SLIDE).count(), 'A’s slide nodes must not return').toBe(0)
    expect(await page.locator(PPTX_CONTENT).count(), 'A’s content host must not return').toBe(0)
    expect(await countRootsForAddress(page, pptxAddress)).toBe(0)

    // 5. B's Ask surface is still there and still usable: still visible, still
    // enabled, and the ordinary actionability-checked click below is what proves
    // it is still actionable — Playwright refuses a covered, hidden, disabled or
    // detached button without any forcing.
    await expect(
      askButton,
      'B’s Ask surface must survive A’s late cleanup: a snapshot cleared by the wrong resource would ' +
        'take the button down with it',
    ).toBeVisible()
    await expect(askButton, 'the surviving Ask surface must still be enabled').toBeEnabled()
    expect(
      await readDraft(page),
      'no late cleanup may write to the composer: B’s draft must be byte-for-byte what it held before',
    ).toBe(draftBeforeOpen)
    // B's identity, not merely "some text is visible": the preview that is on
    // screen still publishes B's own address, and no byte renderer of A's stands
    // anywhere in the page.
    await expect(
      page.locator(`[${PREVIEW_URL_ATTRIBUTE}="${textAddress}"]`),
      'B’s preview must still be the one publishing B’s address',
    ).toHaveCount(1)
    await expect(page.locator(PREVIEW_BODY).first()).toBeVisible()
    await expect(page.locator(PREVIEW_LINE)).toHaveCount(3)
    expect(await page.locator(RENDERER_ROOT).count(), 'no byte renderer of A may stand over B').toBe(0)
    expect(await page.locator(ERROR_TOAST).count()).toBe(0)

    // 6. The survivor is the right snapshot: pressing the button appends exactly
    // B's provenance, B's quoted line and the question suffix, in that order, and
    // nothing else follows the block. The comparison is positional rather than
    // byte-for-byte because the composer publishes a projection of its document;
    // the offsets and the trailing-nothing check are the existing TXT suite's own
    // assertion shape.
    await askButton.click()

    const draftAfterAsk = await readDraft(page)
    const provenanceAt = draftAfterAsk.indexOf(TXT_LINE_TWO_PROVENANCE)
    const quoteAt = draftAfterAsk.indexOf('> beta')
    const suffixAt = draftAfterAsk.indexOf(QUESTION_SUFFIX)

    expect(
      draftAfterAsk.indexOf(draftBeforeOpen),
      'the draft the reader had must still lead the composer',
    ).toBe(0)
    expect(provenanceAt, 'the appended block must carry B’s own provenance').toBeGreaterThanOrEqual(0)
    expect(quoteAt, 'the quoted line must follow its provenance').toBeGreaterThan(provenanceAt)
    expect(suffixAt, 'the question suffix must close the block').toBeGreaterThan(quoteAt)
    expect(
      draftAfterAsk.slice(suffixAt + QUESTION_SUFFIX.length),
      'the block must end where the contract says it does',
    ).toBe('')
    expect(
      draftAfterAsk.split(TXT_LINE_TWO_PROVENANCE).length - 1,
      'exactly one block may be appended, so the survivor was the snapshot of the line the gesture selected',
    ).toBe(1)

    expect(await readRejections(page), 'no unhandled rejection may follow A’s late cleanup').toEqual([])
    expect(observers.pageErrors, 'no uncaught error may follow A’s late cleanup').toEqual([])
    expectNoRendererConsoleFailure(observers.consoleErrors, 'A-cannot-clear-B')
    expect(
      remoteRequests(observers.requests, appOrigin).map(describeRequest),
      'opening A and B must reach no origin other than the DSH application’s own',
    ).toEqual([])
  })

  test('6. cross-format network gate: remote uploads, remote parser assets and remote viewer assets are all zero', async ({
    page,
  }) => {
    const observers = observe(page)
    await installRuntimeProbe(page)

    // The classification rule, recorded where it is asserted: a request is
    // **remote** when its URL is `http:` or `https:` and its origin is not the
    // origin the shell itself was loaded from. Everything the application
    // legitimately does is named: same-origin HTTP(S) requests (the shell, the
    // plugin's own client bundle, the DSH API), the `blob:` URLs the page mints
    // for its own workers and pictures, and the DSH WebSocket, which Playwright
    // records as a websocket and not as a request.
    const appOrigin = new URL(BASE_URL).origin

    await openShell(page)
    const bootMark: CensusMark = { requests: observers.requests.length, workers: observers.workers.length }

    // PDF: a real page, a real text layer, a client-owned worker. The readiness
    // gate is page 1's own state rather than a document-wide placeholder count,
    // because this fixture's later pages stay lazily held while the stack is at
    // `scrollTop: 0` — see {@link expectPdfPageReady} for the measurement.
    const pdfMark: CensusMark = { requests: observers.requests.length, workers: observers.workers.length }
    await openByteFixture(page, 'pdf-two', 'pdf')
    await expectPdfPageReady(page, 1, 'network gate')
    const pdfWorkers = observers.workers.slice(pdfMark.workers)
    expect(pdfWorkers.length, 'opening a PDF must start a PDF.js worker').toBeGreaterThanOrEqual(1)
    for (const url of pdfWorkers) {
      expect(url.startsWith('blob:'), `the PDF worker must be client-owned, got ${url}`).toBe(true)
    }
    expect((await readProbe(page)).created).toEqual(expect.arrayContaining(pdfWorkers))

    // DOCX: a real table parsed out of a real archive.
    await openByteFixture(page, 'docx-table-image', 'docx')
    await expect(page.locator(DOCX_CONTENT).first()).toContainText('Table Cell 1-1', { timeout: 60_000 })

    // PPTX: real slides rendered by the windowed viewer.
    await openByteFixture(page, 'pptx-text-two-slides', 'pptx')
    await expect(page.locator(PPTX_SLIDE).first()).toBeVisible({ timeout: 60_000 })
    await expect(page.locator(PPTX_CONTENT).first()).toContainText('PPTX Slide One Alpha', { timeout: 40_000 })

    // XLSX: the engine is the compressed inline WASM payload and the parse is a
    // `blob:` worker. The grid's own label proves the parse reached the model.
    const xlsxMark: CensusMark = { requests: observers.requests.length, workers: observers.workers.length }
    await openByteFixture(page, 'xlsx-simple', 'xlsx')
    const content = page.locator(XLSX_CONTENT).first()
    await expect(content.locator('[role="grid"]').first()).toBeVisible({ timeout: 90_000 })
    await expect
      .poll(async () => await readGridLabel(page), {
        timeout: 90_000,
        message: 'the workbook must be parsed, not merely mounted',
      })
      .not.toBe('Workbook grid')
    const xlsxWorkers = observers.workers.slice(xlsxMark.workers)
    expect(xlsxWorkers.length, 'opening a workbook must start the parse worker').toBeGreaterThanOrEqual(1)
    for (const url of xlsxWorkers) {
      expect(url.startsWith('blob:'), `the workbook worker must run from a blob: URL, got ${url}`).toBe(true)
    }
    expect((await readProbe(page)).created).toEqual(expect.arrayContaining(xlsxWorkers))

    // The workbook phase ends here: everything after this mark belongs to the text
    // previews, and the XLSX runtime gate below is a statement about opening a
    // document rather than about the shell's own highlighter.
    const textMark: CensusMark = { requests: observers.requests.length, workers: observers.workers.length }

    // CSV and TXT: the builtin previews, which the plugin's text adapter reads.
    const csvAddress = await openTextFixture(page, 'csv')
    expect(csvAddress, 'the CSV fixture must be the document the preview published').toContain('task13-smoke.csv')
    await expect
      .poll(async () => await page.locator(TEXT_ROWS).count(), { timeout: 40_000, message: 'the CSV must render rows' })
      .toBeGreaterThan(0)
    const txtAddress = await openTextFixture(page, 'txt')
    expect(txtAddress, 'the TXT fixture must be the document the preview published').toContain('task5b-smoke.txt')
    await expect(page.locator(PREVIEW_LINE)).toHaveCount(3, { timeout: 40_000 })

    // The census, classified. Reported with the phase boundaries so a failure
    // names what was fetched and when.
    const phases =
      `boot=${String(bootMark.requests)} pdf=${String(pdfMark.requests)} ` +
      `xlsx=${String(xlsxMark.requests)} total=${String(observers.requests.length)} requests`
    const census = observers.requests.map(describeRequest)
    const remote = remoteRequests(observers.requests, appOrigin)
    const remoteUploads = remote.filter((record) => !['GET', 'HEAD', 'OPTIONS'].includes(record.method))
    const remoteParserAssets = remote.filter(
      (record) => REMOTE_PARSER_ASSET_PATTERN.test(record.url) || CDN_HOST_PATTERN.test(record.url),
    )
    const cdnRequests = observers.requests.filter((record) => CDN_HOST_PATTERN.test(record.url))
    const blobRequests = observers.requests.filter((record) => record.url.startsWith('blob:'))
    const sameOrigin = observers.requests.filter((record) => originOf(record.url) === appOrigin)
    // The workbook phase, sliced by its own two marks: the XLSX runtime's HTTP
    // gate is a statement about opening a document, so it must not be polluted by
    // the text previews opened afterwards.
    const xlsxPhaseRequests = observers.requests.slice(xlsxMark.requests, textMark.requests)
    const xlsxHttpRuntimeRequests = xlsxPhaseRequests.filter(
      (record) =>
        isHttpUrl(record.url) &&
        (record.resourceType === 'worker' || /\.wasm/i.test(record.url) || /worker/i.test(record.url)),
    )

    // Remote document uploads = 0: no POST/PUT/PATCH leaves the application, and
    // no remote GET asks for a parser asset.
    expect(remoteUploads.map(describeRequest), `remote uploads from ${appOrigin} (${phases}): ${census.join(' | ')}`).toEqual(
      [],
    )
    // Remote parser assets = 0: no remote worker, WASM, CMap, standard font or
    // CDN viewer asset.
    expect(
      remoteParserAssets.map(describeRequest),
      `remote parser assets while documents were opened (${phases}): ${census.join(' | ')}`,
    ).toEqual([])
    // XLSX worker requests over HTTP = 0 and XLSX WASM HTTP requests = 0, read
    // from the workbook phase's own slice of the census.
    expect(
      xlsxHttpRuntimeRequests.map(describeRequest),
      `HTTP requests for the workbook worker or engine (${phases}): ${census.join(' | ')}`,
    ).toEqual([])
    expect(cdnRequests.map(describeRequest), `CDN requests (${phases}): ${census.join(' | ')}`).toEqual([])
    // And nothing left the application's own origin at all: HTTP(S) traffic to any
    // other origin is the failure, while same-origin HTTP(S) traffic is the shell
    // loading itself and is expected.
    expect(
      remote.map(describeRequest),
      `requests left ${appOrigin} while documents were opened (${phases}): ${census.join(' | ')}`,
    ).toEqual([])

    // The named local traffic really happened, so the gates above are statements
    // about a live census and not about an empty one.
    expect(sameOrigin.length, `same-origin traffic must exist (${phases})`).toBeGreaterThan(0)
    expect(observers.requests.length).toBeGreaterThan(0)

    // Every `blob:` request is the page's own worker delivery rather than a fetch
    // of anything: the PDF worker and the inlined XLSX worker are both started from
    // a `Blob` this page minted, and the platform records that delivery as a
    // request of resource type `script` whose URL scheme is `blob:`. Attributing
    // each one to the page's own createObjectURL record is what tells that local
    // path apart from an asset fetched from an origin — so the comparison is made
    // against the request's URL string.
    for (const record of blobRequests) {
      expect(
        (await readProbe(page)).created,
        `${describeRequest(record)} is a blob: request this page did not create`,
      ).toContain(record.url)
    }
    // The API channel is same-host on the page's own socket scheme, normalised so
    // that a `ws:` socket can be compared with an `http:` origin at all; a socket
    // on another host, or on the wrong socket scheme for this document, does not
    // normalise to the application's origin and still fails here.
    for (const url of observers.websockets) {
      expect(
        socketOrigin(url),
        `the DSH API channel must be the application's own host on the page's socket scheme, got ${url}`,
      ).toBe(appOrigin)
    }

    // The two formats whose parser delivery is easiest to get wrong, asserted
    // against the design they actually have: PDF.js runs from an embedded worker
    // source, so no `pdf.worker`, CMap or standard-font URL exists; the workbook
    // engine is compressed into the client bundle, so nothing requests
    // `duke_sheets_wasm_bg.wasm` or a host asset route. Neither may be requested at
    // all, over any scheme and from any origin, because a `blob:` worker is not a
    // fetch and the host routes that used to serve them no longer exist.
    const pluginRuntimeAssetRequests = observers.requests.filter((record) =>
      PLUGIN_RUNTIME_ASSET_PATTERN.test(record.url),
    )
    expect(
      pluginRuntimeAssetRequests.map(describeRequest),
      `PDF/XLSX parser assets must not be requested at all (${phases}): ${census.join(' | ')}`,
    ).toEqual([])

    expect(observers.pageErrors, 'no document in this case may raise an uncaught error').toEqual([])
    expectNoRendererConsoleFailure(observers.consoleErrors, 'network gate')
  })
})
