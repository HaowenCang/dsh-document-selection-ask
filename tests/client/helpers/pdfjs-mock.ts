/**
 * The `pdfjs-dist` surface the PDF renderer's specs drive.
 *
 * `runtime.ts` and `render-page.ts` reach PDF.js through three values —
 * `getDocument`, `PDFWorker` and `TextLayer` — and those are the three this
 * module provides, with a controllable implementation. What is asserted here
 * belongs to *this* plugin's decisions rather than to PDF.js's behaviour, and
 * each property is observable directly:
 *
 * - **a native worker is created, from a blob URL, with `type: 'module'`** — the
 *   observable statement that no fake worker is in play;
 * - **no worker means no renderer**: when the worker fires `error`, `getDocument`
 *   must never be called, because a silent main-thread parse is the failure mode
 *   this project freezes against;
 * - **the blob URL is revoked and the worker terminated exactly once**, however
 *   many times `dispose()` is called;
 * - **the bytes PDF.js is handed are not the host's array**, asserted by identity
 *   against the caller's own buffer;
 * - **the page object is cleaned up once, after both of its renders settled**.
 *
 * A real `pdfjs-dist` under jsdom would need a real module worker (jsdom has
 * none), a real 2-D canvas context (jsdom has none) and a real PDF. Those are the
 * parts the browser suite covers, against a live DSH instance and a real file.
 */

/** One canvas render PDF.js was asked for. */
export interface RecordedRender {
  /** The canvas the page was asked to draw into. */
  readonly canvas: HTMLCanvasElement
  /** The viewport the render was given, i.e. the CSS viewport. */
  readonly viewport: FakeViewport
  /** The output transform PDF.js was given for the raster. */
  readonly transform: readonly number[] | undefined
}

/** Per-page scripted behaviour and what the renderer did with it. */
export interface PageControl {
  /** Page width in CSS pixels at `scale: 1`. */
  readonly width: number
  /** Page height in CSS pixels at `scale: 1`. */
  readonly height: number
  /** Page rotation in degrees. */
  readonly rotation: number
  /** Strings the text layer is fed, in order. */
  readonly text: readonly string[]
  /** When set, `render()` fails with this error instead of drawing. */
  readonly renderError: Error | undefined
  /** When true, `render()` stays pending until `control.releaseRender()` is called. */
  readonly holdRender: boolean
  /** How many times `cleanup()` ran on the page object. */
  cleanups: number
  /** Whether a cleanup ran while a render task was still pending. */
  cleanedUpWhileRendering: boolean
  /** The renders performed on this page, in order. */
  readonly renders: RecordedRender[]
  /** The render tasks handed out, in order. */
  readonly tasks: FakeRenderTask[]
  /** Whether the text layer was cancelled. */
  textCancelled: boolean
}

/** The mutable state one spec drives. */
export interface PdfjsControl {
  /** Every `Worker` constructed since the last reset. */
  readonly workers: FakeWorker[]
  /** Every blob URL created since the last reset. */
  readonly created: string[]
  /** Every blob URL revoked since the last reset. */
  readonly revoked: string[]
  /** Every `getDocument` call, in order. */
  readonly documents: Record<string, unknown>[]
  /** The pages the fake document serves, in order. */
  readonly pages: PageControl[]
  /** When set, every worker fires this error before it can answer the handshake. */
  workerError: Error | undefined
  /** When set, the document promise rejects with this error. */
  openError: Error | undefined
  /** When true, the document never settles until `release()` is called. */
  holdOpen: boolean
  /** The `getDocument` call indices whose loading task was destroyed. */
  readonly destroyedTasks: number[]
  /** Release a load that `holdOpen` was holding. */
  release(): void
  /** Release every render that `holdRender` was holding. */
  releaseRender(): void
  /** Restore every recorded array and setting. */
  reset(): void
}

/**
 * Add one page script.
 *
 * @param text - the strings the page's text layer is fed, in order. An empty
 * array is an image-only page.
 * @param overrides - geometry and behaviour to override.
 * @returns the script, for later assertions.
 */
export function addPage(text: readonly string[], overrides: Partial<PageControl> = {}): PageControl {
  const page: PageControl = {
    width: 816,
    height: 1056,
    rotation: 0,
    text,
    renderError: undefined,
    holdRender: false,
    cleanups: 0,
    cleanedUpWhileRendering: false,
    renders: [],
    tasks: [],
    textCancelled: false,
    ...overrides,
  }
  control.pages.push(page)
  return page
}

/* --- the fake objects ---------------------------------------------------- */

/** One fake native worker. */
export class FakeWorker {
  /** Listeners registered through `addEventListener`. */
  readonly listeners = new Map<string, Set<(event: unknown) => void>>()
  /** Whether `terminate()` has run. */
  terminated = false
  /** The blob URL the worker was created from. */
  readonly url: string
  /** The `WorkerOptions` the renderer passed. */
  readonly options: { readonly type?: string; readonly name?: string } | undefined

  /**
   * @param url - the blob URL.
   * @param options - the worker options.
   */
  constructor(url: string, options?: { readonly type?: string; readonly name?: string }) {
    this.url = url
    this.options = options
  }

  /**
   * @param type - event type.
   * @param listener - listener.
   */
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set<(event: unknown) => void>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  /**
   * @param type - event type.
   * @param listener - listener to remove.
   */
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  /** Stop the worker; repeated calls are no-ops, as the platform's are. */
  terminate(): void {
    this.terminated = true
  }

  /**
   * Dispatch one event to this worker's listeners.
   * @param type - event type.
   * @param event - payload.
   */
  emit(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event)
    }
  }
}

/** The fake page viewport. */
export class FakeViewport {
  /** Width in CSS pixels at this scale. */
  readonly width: number
  /** Height in CSS pixels at this scale. */
  readonly height: number
  /** CSS pixels per PDF user unit. */
  readonly scale: number
  /** Rotation in degrees. */
  readonly rotation: number
  /** The page's own dimensions, as PDF.js reports them. */
  readonly rawDims: { readonly pageWidth: number; readonly pageHeight: number }

  /**
   * @param unitWidth - width at scale 1.
   * @param unitHeight - height at scale 1.
   * @param scale - requested scale.
   * @param rotation - requested rotation.
   */
  constructor(unitWidth: number, unitHeight: number, scale: number, rotation: number) {
    this.scale = scale
    this.rotation = rotation
    this.width = unitWidth * scale
    this.height = unitHeight * scale
    this.rawDims = { pageWidth: unitWidth, pageHeight: unitHeight }
  }
}

/** The fake render task. */
export class FakeRenderTask {
  /** Settles when the render completes or fails. */
  readonly promise: Promise<void>
  /** Whether `cancel()` ran. */
  cancelled = false
  /** Whether the promise has settled. */
  done = false
  private readonly settle: () => void
  private readonly failWith: (error: unknown) => void
  private readonly script: PageControl

  /**
   * @param script - the page script, for the cancellation flag.
   */
  constructor(script: PageControl) {
    this.script = script
    let settle!: () => void
    let failWith!: (error: unknown) => void
    this.promise = new Promise<void>((resolve, reject) => {
      settle = resolve
      failWith = reject
    })
    // A cancelled or failed render is observed through `render-page.ts`'s own
    // handler; this catch covers the window before that handler is attached.
    this.promise.catch(() => undefined)
    this.settle = settle
    this.failWith = failWith
  }

  /** Complete the render. */
  finish(): void {
    this.done = true
    this.settle()
  }

  /**
   * Fail the render.
   * @param error - the failure.
   */
  fail(error: unknown): void {
    this.done = true
    this.failWith(error)
  }

  /** Cancel the render, as PDF.js's own task does. */
  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    const cancelled = new Error('Rendering cancelled')
    cancelled.name = 'RenderingCancelledException'
    this.fail(cancelled)
  }
}

/** The fake page object. */
export class FakePage {
  /** The page's script. */
  readonly script: PageControl

  /**
   * @param script - the page's scripted behaviour.
   */
  constructor(script: PageControl) {
    this.script = script
    pagesInUse.push(script)
  }

  /**
   * @param options - requested scale and rotation.
   * @returns the viewport.
   */
  getViewport(options: { readonly scale: number; readonly rotation?: number }): FakeViewport {
    return new FakeViewport(
      this.script.width,
      this.script.height,
      options.scale,
      options.rotation ?? this.script.rotation,
    )
  }

  /**
   * Render the page into a canvas.
   * @param parameters - canvas, viewport and output transform.
   * @returns the render task.
   */
  render(parameters: {
    readonly canvas: HTMLCanvasElement
    readonly viewport: FakeViewport
    readonly transform?: readonly number[] | undefined
  }): FakeRenderTask {
    this.script.renders.push({
      canvas: parameters.canvas,
      viewport: parameters.viewport,
      transform: parameters.transform,
    })

    const task = new FakeRenderTask(this.script)
    this.script.tasks.push(task)
    if (this.script.renderError !== undefined) {
      task.fail(this.script.renderError)
    } else if (this.script.holdRender) {
      renderHolders.push(() => {
        task.finish()
      })
    } else {
      task.finish()
    }
    return task
  }

  /**
   * @returns a stream of this page's scripted strings.
   */
  streamTextContent(): ReadableStream<{ readonly items: readonly { readonly str: string }[] }> {
    const items = this.script.text.map((str) => ({ str }))
    return new ReadableStream({
      start(controller) {
        controller.enqueue({ items })
        controller.close()
      },
    })
  }

  /**
   * Release the page's resources.
   * @returns whether cleanup ran, as the real method reports.
   */
  cleanup(): boolean {
    this.script.cleanups += 1
    if (this.script.tasks.some((task) => !task.done)) {
      this.script.cleanedUpWhileRendering = true
    }
    return true
  }
}

/** The fake document. */
export class FakeDocument {
  /** Page count. */
  readonly numPages: number

  /**
   * @param numPages - the page count.
   */
  constructor(numPages: number) {
    this.numPages = numPages
  }

  /**
   * @param pageNumber - 1-based page index.
   * @returns the page object.
   */
  async getPage(pageNumber: number): Promise<FakePage> {
    const script = control.pages[pageNumber - 1]
    if (script === undefined) throw new Error(`No such page: ${String(pageNumber)}`)
    return new FakePage(script)
  }
}

/** The fake text layer. */
export class FakeTextLayer {
  /** Every construction, so a case can assert what the renderer asked for. */
  static readonly instances: FakeTextLayer[] = []
  /** The container the layer writes into. */
  readonly container: HTMLElement
  /** The viewport the layer was laid out against. */
  readonly viewport: FakeViewport
  /** The text the layer lays out. */
  readonly items: readonly string[]
  private cancelled = false

  /**
   * @param parameters - the stream, the container and the viewport, exactly as
   * `renderTextLayer` passes them. The page's own script is not among them: the
   * production call site has no such parameter, and a stand-in that required one
   * would be testing a different call.
   */
  constructor(parameters: {
    readonly textContentSource: ReadableStream<{ readonly items: readonly { readonly str: string }[] }>
    readonly container: HTMLElement
    readonly viewport: FakeViewport
  }) {
    FakeTextLayer.instances.push(this)
    this.container = parameters.container
    this.viewport = parameters.viewport
    this.items = pagesInUse.at(-1)?.text ?? []
    void parameters.textContentSource
  }

  /**
   * Lay the spans out.
   *
   * Nothing is appended during construction, so the caller holds the handle
   * before any span exists — which is what makes cancellation a real possibility
   * rather than a race the test always loses.
   *
   * @returns when every span is appended.
   */
  async render(): Promise<void> {
    if (this.cancelled) return
    await Promise.resolve()
    if (this.cancelled) return
    for (const text of this.items) {
      const span = document.createElement('span')
      span.textContent = text
      this.container.append(span)
    }
  }

  /** Stop rendering. */
  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    const script = pagesInUse.at(-1)
    if (script !== undefined) script.textCancelled = true
  }
}

/** The fake PDF.js worker bridge. */
export class FakePdfWorker {
  /** The port the runtime created the native worker on. */
  readonly port: unknown
  /** Whether `destroy()` ran. */
  destroyed = false

  /**
   * @param parameters - the port.
   */
  constructor(parameters: { readonly port?: unknown } = {}) {
    this.port = parameters.port
  }

  /**
   * @param parameters - the port.
   * @returns the bridge, remembered as the most recent one.
   */
  static create(parameters: { readonly port?: unknown }): FakePdfWorker {
    const bridge = new FakePdfWorker(parameters)
    lastBridge = bridge
    bridges.push(bridge)
    return bridge
  }

  /** Release the bridge. */
  destroy(): void {
    this.destroyed = true
  }
}

/** The most recently created bridge. */
let lastBridge: FakePdfWorker | undefined
/** Every bridge created since the last reset. */
const bridges: FakePdfWorker[] = []

/**
 * @returns the bridge PDF.js created over a port, or `undefined` when none does.
 */
export function lastPdfWorkerBridge(): FakePdfWorker | undefined {
  return lastBridge
}

/**
 * @returns every bridge created since the last reset.
 */
export function pdfWorkerBridges(): readonly FakePdfWorker[] {
  return bridges
}

/** Pending document loads released by `control.release()`. */
const openers: (() => void)[] = []
/** Pending renders released by `control.releaseRender()`. */
const renderHolders: (() => void)[] = []

/**
 * The page scripts whose page objects have been handed out, most recent last.
 *
 * `renderTextLayer` never receives the page object — it receives the page's text
 * stream, its viewport and its container, which is the whole of PDF.js's public
 * `TextLayerParameters`. The stand-in therefore cannot know which page it is
 * serving from its own arguments, and this stack is how it does know: the page
 * object is pushed when `getPage` hands it out, and a text layer belongs to the
 * most recently handed-out page.
 */
const pagesInUse: PageControl[] = []

/**
 * The one mutable control object the specs drive.
 *
 * Created once and mutated in place by `reset()`, so a spec that captured it in a
 * `beforeEach` keeps seeing current state.
 */
export const control: PdfjsControl = {
  workers: [],
  created: [],
  revoked: [],
  documents: [],
  pages: [],
  workerError: undefined,
  openError: undefined,
  holdOpen: false,
  destroyedTasks: [],
  release(): void {
    for (const release of openers.splice(0)) release()
  },
  releaseRender(): void {
    for (const release of renderHolders.splice(0)) release()
  },
  reset(): void {
    this.workers.length = 0
    this.created.length = 0
    this.revoked.length = 0
    this.documents.length = 0
    this.pages.length = 0
    this.destroyedTasks.length = 0
    this.workerError = undefined
    this.openError = undefined
    this.holdOpen = false
    FakeTextLayer.instances.length = 0
    bridges.length = 0
    lastBridge = undefined
    openers.length = 0
    renderHolders.length = 0
  },
}

/** Blob URL counter. */
let nextUrl = 0

/**
 * `URL.createObjectURL`, as the renderer uses it.
 * @param blob - the blob being given a URL.
 * @returns a unique blob URL, recorded on the control.
 */
export function fakeCreateObjectURL(blob: Blob): string {
  void blob
  const url = `blob:dsa-test/${String(nextUrl++)}`
  control.created.push(url)
  return url
}

/**
 * `URL.revokeObjectURL`, as the renderer uses it.
 * @param url - the URL to release.
 */
export function fakeRevokeObjectURL(url: string): void {
  control.revoked.push(url)
}

/** The loading task `getDocument` returns. */
export interface FakeLoadingTask {
  /** Resolves with the fake document. */
  readonly promise: Promise<FakeDocument>
  /** Release the load. */
  destroy(): Promise<void>
}

/**
 * @param parameters - the document init parameters.
 * @returns a loading task.
 */
export function getDocument(parameters: Record<string, unknown>): FakeLoadingTask {
  control.documents.push(parameters)
  const index = control.documents.length - 1

  let released = false
  const promise = new Promise<FakeDocument>((resolve, reject) => {
    if (control.openError !== undefined) {
      reject(control.openError)
      return
    }
    const open = (): void => {
      resolve(new FakeDocument(control.pages.length))
    }
    if (control.holdOpen && !released) {
      openers.push(open)
      return
    }
    // One microtask, so the caller receives the loading task before it settles —
    // which is what makes abort-before-open a case rather than a race the test
    // always loses.
    void Promise.resolve().then(open)
  })
  promise.catch(() => undefined)

  return {
    promise,
    destroy(): Promise<void> {
      released = true
      control.destroyedTasks.push(index)
      return Promise.resolve()
    },
  }
}

export { FakePdfWorker as PDFWorker }
export { FakeTextLayer as TextLayer }
