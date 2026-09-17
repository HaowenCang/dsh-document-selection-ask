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
 * Two parts of PDF.js's own behaviour are modelled rather than simplified, because
 * a plugin decision is only observable through them:
 *
 * - **the text layer pulls chunk by chunk and appends as it goes.** PDF.js's
 *   `TextLayer.render()` reads a chunk, lays its items out, appends them and reads
 *   again, so a page's text arrives in installments and a reader is always
 *   somewhere between two of them. The stand-in pumps the same way, and a case
 *   that wants a chunk in flight can hold one (`addScriptedPage`);
 * - **it appends into whatever container it was given, and its `cancel()` leaves
 *   that container's children alone.** No ownership test is made before appending
 *   and none is made after the await, because the real layer makes none: a chunk
 *   whose read resolved before the cancellation is appended even then. A stand-in
 *   that filtered its own appends would hide exactly the accumulation the
 *   re-render cases are about.
 *
 * A real `pdfjs-dist` under jsdom would need a real module worker (jsdom has
 * none), a real 2-D canvas context (jsdom has none) and a real PDF. Those are the
 * parts the browser suite covers, against a live DSH instance and a real file.
 */

/** One text-content chunk, as `streamTextContent()` delivers them. */
export interface TextChunk {
  /** The chunk's items, in the order PDF.js would lay them out. */
  readonly items: readonly { readonly str: string }[]
}

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
  /**
   * The chunks the stream serves, in order, from the `text` array when no
   * explicit scripting was asked for.
   */
  readonly textChunks: readonly TextChunk[]
  /**
   * Whether this page's stream is scripted, i.e. its chunks are served only when
   * a case releases them. `addPage` leaves this `undefined` and serves
   * `textChunks` immediately.
   */
  readonly textGated: boolean
  /**
   * Every stream `streamTextContent()` has handed over, in order.
   *
   * A real page object builds a fresh stream per call, and so does this: a
   * re-render reads the page's text from the beginning again, which is why a
   * case that holds one generation's chunk holds `streams[0]` and expects the
   * next generation to read `streams[1]`.
   */
  readonly streams: ScriptedTextStream<TextChunk>[]
  /** Strings the text layer is fed, in order. */
  readonly text: readonly string[]
  /** When set, `render()` fails with this error instead of drawing. */
  readonly renderError: Error | undefined
  /** When set, the text stream errors instead of delivering items. */
  readonly textError: Error | undefined
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
    // One item per chunk, which is what a page whose text is already decoded
    // looks like to a layer that pulls chunk by chunk.
    textChunks: text.map((str) => ({ items: [{ str }] })),
    textGated: false,
    streams: [],
    text,
    renderError: undefined,
    textError: undefined,
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

/**
 * Add one page whose text stream is scripted rather than immediate.
 *
 * `addPage` serves every chunk as soon as the layer reads for it, which is the
 * right stand-in for a page whose text is already decoded. The cases that need to
 * observe **when** a chunk becomes available — a layer left between two chunks, a
 * generation cancelled mid-layout — need the two moments separated, and this is
 * the helper for them: `addPage`'s stream serves nothing until the case releases
 * it with `deliver()`, and `end()` finishes it.
 *
 * Each call to the page's `streamTextContent()` builds a fresh stream over the
 * same chunks, as a real page object does, and the streams are recorded on
 * `PageControl.streams` in the order they were handed out.
 *
 * @param chunks - the chunks every stream will serve, in order; each entry is one
 * chunk holding one item per string.
 * @param overrides - geometry and behaviour to override.
 * @returns the page script, whose `streams` are the handles to drive it with.
 */
export function addScriptedPage(
  chunks: readonly (readonly string[])[],
  overrides: Partial<PageControl> = {},
): PageControl {
  return addPage([], {
    ...overrides,
    textChunks: chunks.map((strs) => ({ items: strs.map((str) => ({ str })) })),
    textGated: true,
  })
}

/* --- the fake objects ---------------------------------------------------- */

/**
 * A `ReadableStream` whose chunks a spec can hold back.
 *
 * `FakePage.streamTextContent()` returns this for a page added with
 * `addScriptedPage`. When the page is gated, a chunk becomes available only when
 * the case calls `deliver()`; the read waiting for it gets it then, so the moment
 * a chunk is **served** is the case's decision and the moment it is **appended**
 * is one microtask later. That gap is why this exists: it is where a layer can be
 * left between two chunks.
 *
 * `cancel()` is what a reader's own cancellation does — the stream serves nothing
 * further and the reads still waiting are answered with a done result. It cannot
 * call back a chunk a read has already received, which is PDF.js's own situation:
 * its pump processes a value it already holds even after `cancel()`.
 */
export class ScriptedTextStream<T> {
  /** How many `cancel()` calls a reader made. */
  cancels = 0
  /** How many chunks were served to a read. */
  delivered = 0
  /** The chunks the case has released, waiting to be read. */
  private readonly available: T[] = []
  /** Reads waiting for a chunk. */
  private readonly waiting: ((result: ReadableStreamReadResult<T>) => void)[] = []
  /** Chunks not yet released. */
  private readonly pending: T[]
  /** Whether chunks are held until `deliver()`. */
  private gated: boolean
  private handedOut = false
  private ended = false
  private cancelled = false
  private unlock: (() => void) | undefined

  /**
   * @param chunks - the chunks the stream serves, in order.
   * @param gated - whether each chunk waits for `deliver()`.
   */
  constructor(chunks: readonly T[], gated: boolean) {
    this.pending = [...chunks]
    this.gated = gated
  }

  /**
   * Serve every chunk from here on without waiting to be asked.
   *
   * The other half of `addScriptedPage`: a case that wants a generation to read a
   * whole page's text — the second generation of a re-render, say — says so here
   * instead of calling `deliver()` once per chunk.
   */
  release(): void {
    this.gated = false
    while (this.waiting.length > 0) {
      const next = this.pending.shift()
      if (next === undefined) break
      const resolve = this.waiting.shift()
      if (resolve === undefined) break
      this.delivered += 1
      resolve({ done: false, value: next })
    }
  }

  /**
   * @returns a reader over this stream's own delivery. One at a time, as a real
   * stream allows.
   */
  getReader(): ReadableStreamDefaultReader<T> {
    if (this.handedOut) throw new TypeError('This stream is locked to another reader')
    this.handedOut = true
    this.unlock = (): void => {
      this.handedOut = false
    }
    return this.reader()
  }

  /**
   * @returns the reader the production layer holds.
   */
  private reader(): ReadableStreamDefaultReader<T> {
    let released = false
    return {
      read: (): Promise<ReadableStreamReadResult<T>> => {
        if (released || this.cancelled || this.ended) {
          return Promise.resolve({ done: true, value: undefined })
        }
        // Released first, whoever released it.
        const ready = this.available.shift()
        if (ready !== undefined) {
          this.delivered += 1
          return Promise.resolve({ done: false, value: ready })
        }
        // Nothing left to serve at all: the stream is exhausted, as a real page's
        // stream is once its last chunk has been read.
        if (this.pending.length === 0) {
          return Promise.resolve({ done: true, value: undefined })
        }
        // A page whose text is already decoded serves the next chunk now; a gated
        // page's chunks exist only when the case releases them.
        if (!this.gated) {
          const next = this.pending.shift()
          if (next !== undefined) {
            this.delivered += 1
            return Promise.resolve({ done: false, value: next })
          }
        }
        return new Promise<ReadableStreamReadResult<T>>((resolve) => {
          this.waiting.push(resolve)
        })
      },
      cancel: (reason?: unknown): Promise<void> => {
        void reason
        this.cancelled = true
        this.cancels += 1
        this.releaseWaiting()
        this.unlock?.()
        return Promise.resolve()
      },
      releaseLock: (): void => {
        released = true
        this.unlock?.()
      },
      get closed(): Promise<undefined> {
        return Promise.resolve(undefined)
      },
    } as unknown as ReadableStreamDefaultReader<T>
  }

  /**
   * Release the next held chunk to whichever read is waiting for it.
   *
   * @returns whether a chunk became available.
   */
  deliver(): boolean {
    const next = this.pending.shift()
    if (next === undefined) return false
    const resolve = this.waiting.shift()
    if (resolve === undefined) {
      this.available.push(next)
      return true
    }
    this.delivered += 1
    resolve({ done: false, value: next })
    return true
  }

  /** Serve nothing further, as an exhausted stream does. */
  end(): void {
    this.ended = true
    this.releaseWaiting()
  }

  /** Answer every read still waiting for a chunk. */
  private releaseWaiting(): void {
    for (const resolve of this.waiting.splice(0)) {
      resolve({ done: true, value: undefined })
    }
  }
}

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
   * @returns a stream of this page's text chunks.
   *
   * A fresh stream per call, as a real page object's is: a re-render reads the
   * page's text from the beginning again. A page whose chunks are gated is served
   * one chunk at a time, on the case's own `deliver()` calls; any other page's
   * stream answers immediately.
   *
   * A stream that is asked to fail errors before delivering anything — a damaged
   * content stream, a font PDF.js cannot decode — and PDF.js's own
   * `TextLayer.render()` rejects its capability with whatever the reader rejected
   * with.
   */
  streamTextContent(): ReadableStream<TextChunk> {
    const failure = this.script.textError
    if (failure === undefined) {
      const stream = new ScriptedTextStream<TextChunk>(this.script.textChunks, this.script.textGated)
      this.script.streams.push(stream)
      return stream as unknown as ReadableStream<TextChunk>
    }
    return new ReadableStream<TextChunk>({
      start(controller) {
        controller.error(failure)
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
  /** The stream `PDFPageProxy.streamTextContent()` handed over. */
  readonly textContentSource: ReadableStream<TextChunk>
  /** The reader `render()` is pulling through, once it has started. */
  private reader: ReadableStreamDefaultReader<TextChunk> | undefined
  private cancelled = false

  /**
   * @param parameters - the stream, the container and the viewport, exactly as
   * `renderTextLayer` passes them. The page's own script is not among them: the
   * production call site has no such parameter, and a stand-in that required one
   * would be testing a different call.
   */
  constructor(parameters: {
    readonly textContentSource: ReadableStream<TextChunk>
    readonly container: HTMLElement
    readonly viewport: FakeViewport
  }) {
    FakeTextLayer.instances.push(this)
    this.container = parameters.container
    this.viewport = parameters.viewport
    this.textContentSource = parameters.textContentSource
  }

  /**
   * Lay the spans out.
   *
   * Nothing is appended during construction, so the caller holds the handle
   * before any span exists — which is what makes cancellation a real possibility
   * rather than a race the test always loses.
   *
   * The read follows PDF.js's own pump: a chunk is pulled, its items are appended
   * to the container, and the next pull follows — so a page's text arrives in as
   * many installments as the stream has chunks, and the moment between two of
   * them is a moment a case can take hold of.
   *
   * The append makes no test of its own beyond the cancellation flag PDF.js's
   * pump also honours: the container is written into as given, which is what makes
   * a re-render into the same element accumulate unless the renderer empties it.
   * A stream that errors rejects this promise with that error, which is the whole
   * of the text path's failure mode.
   *
   * @returns when the stream is exhausted, or rejects with its error.
   */
  async render(): Promise<void> {
    if (this.cancelled) return
    const reader = this.textContentSource.getReader()
    this.reader = reader
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) return
        for (const { str } of next.value.items) {
          const span = document.createElement('span')
          span.textContent = str
          this.container.append(span)
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Stop rendering.
   *
   * The reader's own cancellation is part of it, as it is in PDF.js's
   * `TextLayer.cancel()`: a read already waiting is answered with a done result,
   * so a layer cancelled between two chunks settles rather than hanging on a
   * chunk that will never arrive.
   */
  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    const script = pagesInUse.at(-1)
    if (script !== undefined) script.textCancelled = true
    void this.reader?.cancel(new Error('TextLayer task cancelled.')).catch(() => undefined)
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
    // The stack is a stack of the pages handed out, so it goes with them: a stale
    // entry would make the next case's cancellation mark the previous case's page.
    pagesInUse.length = 0
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
