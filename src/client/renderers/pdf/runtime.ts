/**
 * Document lifetime: one native worker, one PDF.js loading task, one idempotent
 * cleanup.
 *
 * ## Why the worker is created here and not by PDF.js
 *
 * PDF.js can create a worker itself from `GlobalWorkerOptions.workerSrc`, but it
 * does so along a path that contains a **silent fallback**: if the script cannot
 * be fetched, if the URL is cross-origin, or if the `test` message does not come
 * back, `PDFWorker` calls its `#setupFakeWorker` branch and parses the entire
 * document on the main thread. This project freezes the opposite requirement — a
 * worker failure must be a visible failure, never a quieter parse — so the worker
 * is created explicitly and handed to PDF.js as a port:
 * `PDFWorker.create({ port })` takes the `#initializeFromPort` branch, which has
 * no fallback branch at all. Every failure mode that remains is one this module
 * raises.
 *
 * The worker is started from a `Blob` over the build-embedded source, because the
 * DSH client loader gives an external plugin no module URL to resolve. A ready
 * handshake is appended to that source rather than assumed: a module worker that
 * fails to parse fires `error` and never evaluates, so without the handshake the
 * first symptom would be a document promise that never settles.
 *
 * ## Cleanup
 *
 * `dispose()` is idempotent and returns one shared promise, so an abort, an
 * unmount and a fatal failure can all call it and the resources are released
 * once. Every release step is attempted even when an earlier one throws —
 * PDF.js's own teardown is the step most likely to fail, and a failure there must
 * not leave the `Blob` URL or the native worker alive. A teardown failure is
 * reported through the optional `onFailure` callback rather than rethrown into a
 * caller that has already stopped caring.
 *
 * ## Input bytes
 *
 * `bytes` is the host's `DocumentContent.data`, which belongs to the DSH preview
 * and outlives this session: the builtin renderer may be selected again, the tab
 * may be re-rendered, and the same array is handed to the next session. PDF.js
 * transfers the buffer it is given to the worker, which detaches it. The slice
 * below is therefore not defensive style — handing the host's array over would
 * leave the document owner holding a detached buffer after the first render.
 */

import { getDocument, PDFWorker } from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

import { createPdfBinaryDataFactory } from './assets.js'
import { createDeferred } from './deferred.js'
import { PdfWorkerFailure } from './errors.js'
import { PDF_WORKER_SOURCE } from './worker-source.js'

/** The message the appended worker stub posts once the module has evaluated. */
const WORKER_READY = 'dsa-pdf-worker-ready'

/**
 * How long PDF.js's own teardown is given before the native worker is killed.
 *
 * PDF.js sends the worker a `Terminate` message and awaits it, which never
 * arrives if the worker has already died. The native worker is terminated
 * regardless, so a hung teardown costs latency and nothing else — but it must not
 * cost an unbounded amount of it.
 */
const TEARDOWN_TIMEOUT_MS = 2_000

/** One page's size in CSS pixels at unit scale. */
export interface PdfPageSize {
  /** Width in CSS pixels. */
  readonly width: number
  /** Height in CSS pixels. */
  readonly height: number
}

/** A document that has finished loading, with its page geometry already read. */
export interface PdfReadyDocument {
  /** The loaded document. */
  readonly document: PDFDocumentProxy
  /** Page count. */
  readonly pageCount: number
  /** Per-page CSS size at one CSS pixel per PDF user unit, in page order. */
  readonly sizes: readonly PdfPageSize[]
}

/**
 * One open PDF document and the resources that keep it alive.
 *
 * The worker, the loading task and the object URL are deliberately **not** part
 * of this interface. A component that could reach them would be able to
 * terminate a worker the document still needs or revoke a URL a pending request
 * is still reading; the only operations a renderer needs are "read the document"
 * and "release everything".
 */
export interface PdfSession {
  /**
   * The loaded document.
   *
   * @throws Error when read before `ready` has settled, which is a programming
   * error rather than a state the renderer should represent.
   */
  readonly document: PDFDocumentProxy
  /**
   * The document once it is ready, with every page's geometry read.
   *
   * `dispose()` may be called before this settles; it then destroys the pending
   * load, and this promise rejects with the abort reason or the worker failure.
   */
  readonly ready: Promise<PdfReadyDocument>
  /**
   * Release the loading task, the document, the PDF.js worker bridge, the native
   * worker, its listeners and the object URL.
   *
   * Idempotent, never rejects, and safe before the document has loaded.
   * @returns completion of every release step.
   */
  dispose(): Promise<void>
}

/** Options for `openPdf`. */
export interface OpenPdfOptions {
  /** The complete bytes; copied before PDF.js may transfer them. */
  readonly bytes: Uint8Array<ArrayBuffer>
  /** The owning tab's lifetime; aborting it releases every resource. */
  readonly signal: AbortSignal
  /**
   * Report a failure arriving **after** the document loaded — a worker that dies
   * mid-document, or a PDF.js teardown error. Optional, because a caller that has
   * already unmounted has nothing to show it in.
   */
  readonly onFailure?: (error: unknown) => void
}

/**
 * Open complete PDF bytes in an explicitly owned worker.
 *
 * @param options - the bytes, the lifetime signal and the late-failure reporter.
 * @returns the document, its readiness, and the one cleanup for every resource.
 */
export function openPdf(options: OpenPdfOptions): PdfSession {
  const { bytes, signal, onFailure } = options

  const broken = createDeferred<never>()
  // Nothing awaits `broken` after the document has settled, so its rejection is
  // consumed here; the failure itself reaches the renderer through `onFailure`.
  broken.promise.catch(() => undefined)

  let opened: PDFDocumentProxy | undefined
  let loading: PDFDocumentLoadingTask | undefined
  let bridge: PDFWorker | undefined
  let nativeWorker: Worker | undefined
  let workerUrl: string | undefined
  let stopReadyHandshake: (() => void) | undefined
  let detachAbort: (() => void) | undefined
  let closing: Promise<void> | undefined

  const workerFailed = (event: Event): void => {
    const failure = new PdfWorkerFailure(event)
    broken.reject(failure)
    reportQuietly(onFailure, failure)
  }

  /**
   * Detach the ready handshake.
   *
   * It is registered on the same worker object as the two failure listeners and
   * is removed separately: it has nothing left to wait for as soon as the worker
   * answered, while the failure listeners stay for the session's whole life.
   */
  const removeReadyHandshake = (): void => {
    stopReadyHandshake?.()
    stopReadyHandshake = undefined
  }

  const dispose = (): Promise<void> => {
    if (closing !== undefined) return closing
    closing = (async () => {
      removeReadyHandshake()
      detachAbort?.()
      detachAbort = undefined

      try {
        if (loading !== undefined) {
          nativeWorker?.removeEventListener('error', workerFailed)
          nativeWorker?.removeEventListener('messageerror', workerFailed)
          await Promise.race([
            loading.destroy().catch((error: unknown) => {
              reportQuietly(onFailure, error)
            }),
            AbortSignal.timeout(TEARDOWN_TIMEOUT_MS),
          ])
        }
      } finally {
        // Every release is attempted even when the step above failed: a leaked
        // object URL or a live worker thread is not an acceptable price for
        // PDF.js's teardown throwing.
        bridge?.destroy()
        nativeWorker?.removeEventListener('error', workerFailed)
        nativeWorker?.removeEventListener('messageerror', workerFailed)
        nativeWorker?.terminate()
        if (workerUrl !== undefined) {
          URL.revokeObjectURL(workerUrl)
          workerUrl = undefined
        }
        loading = undefined
        bridge = undefined
        nativeWorker = undefined
      }
    })()
    return closing
  }

  const load = async (): Promise<PdfReadyDocument> => {
    if (signal.aborted) throw abortReason(signal)

    const worker = startWorker(PDF_WORKER_SOURCE, workerFailed)
    nativeWorker = worker.port
    workerUrl = worker.url
    stopReadyHandshake = worker.stopReadyHandshake

    await worker.ready
    if (signal.aborted) throw abortReason(signal)

    // The handshake answered, so its listener has nothing left to wait for. The
    // worker's failure listeners stay: they are what reports a worker that dies
    // while a document is being read or rendered.
    removeReadyHandshake()

    bridge = PDFWorker.create({ port: worker.port })
    loading = getDocument({
      // The host's array is never handed over: PDF.js transfers what it is given,
      // which would detach the document owner's buffer.
      data: bytes.slice(),
      worker: bridge,
      BinaryDataFactory: createPdfBinaryDataFactory(),
      cMapPacked: true,
      // `false` routes every CMap, standard-font and wasm request to this build's
      // own asset table instead of letting the worker fetch a URL. Together with
      // the absent `cMapUrl`/`standardFontDataUrl`/`wasmUrl`, the document has no
      // address it could reach the network through.
      useWorkerFetch: false,
      // XFA documents render as their static pages rather than needing the XFA
      // scripting layer, which belongs to document editing.
      enableXfa: false,
      // A malformed page fails its own render instead of being repaired into
      // something the selection layer would later quote as if it were the file.
      stopAtErrors: true,
    })

    const document = await loading.promise.catch((error: unknown) => {
      // A document that never opens is reported where it happens; the rejection
      // still travels to `ready`, which is what the renderer renders the failure
      // from. This handler exists so a load that failed **after** the caller
      // stopped waiting is not reported as an unhandled rejection.
      if (!signal.aborted) reportQuietly(onFailure, error)
      throw error
    })
    if (signal.aborted) throw abortReason(signal)

    opened = document
    return { document, pageCount: document.numPages, sizes: await readPageSizes(document) }
  }

  /**
   * The load's outcome, including the case the load itself cannot see.
   *
   * An abort has to settle this promise from **here** rather than through
   * `dispose()` tearing the load down. PDF.js's own `destroy()` releases the
   * transport; it does not settle a document promise that has not settled yet, so
   * a load awaiting a document that never arrives would wait forever even after
   * the tab that asked for it had gone. Routing the signal into the promise the
   * caller is actually waiting on is what makes cancellation an outcome rather
   * than a hang.
   */
  const outcome = async (): Promise<PdfReadyDocument> => {
    if (signal.aborted) throw abortReason(signal)

    const abortSignal = new Promise<never>((_resolve, reject) => {
      const onAbort = (): void => {
        reject(abortReason(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      detachAbort = () => {
        signal.removeEventListener('abort', onAbort)
      }
    })
    // Nothing awaits this promise on the path where the load wins the race, so
    // its later rejection is consumed here rather than reported.
    abortSignal.catch(() => undefined)

    return Promise.race([load(), abortSignal, broken.promise])
  }

  const ready = outcome().catch(async (error: unknown) => {
    await dispose()
    throw error
  })
  // `ready` is handed to the caller, which attaches its own handler; this one
  // exists so the race's intermediate rejection is not reported as unhandled in
  // the window before the caller attaches.
  ready.catch(() => undefined)

  return {
    get document(): PDFDocumentProxy {
      if (opened === undefined) {
        throw new Error('openPdf: the document is not loaded yet; await `ready` first')
      }
      return opened
    },
    ready,
    dispose,
  }
}

/**
 * Read every page's CSS size at unit scale.
 *
 * This runs once, on open, rather than per page on first visibility. The
 * alternative — a placeholder aspect ratio corrected when a page finally scrolls
 * into view — changes the document's scroll height under the reader and makes
 * "scroll to page 12" land somewhere else. Reading geometry is metadata work
 * inside PDF.js and rasterizes nothing, which is the cost that actually matters.
 *
 * @param document - the loaded document.
 * @returns one entry per page, in page order.
 */
async function readPageSizes(document: PDFDocumentProxy): Promise<readonly PdfPageSize[]> {
  const sizes: PdfPageSize[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page: PDFPageProxy = await document.getPage(pageNumber)
    // The unit viewport is the page's own geometry: `scale: 1` is one CSS pixel
    // per PDF user unit, with the rotation the page declares already applied.
    const viewport = page.getViewport({ scale: 1 })
    sizes.push({ width: viewport.width, height: viewport.height })
  }
  return sizes
}

/** A started native worker and the handshake that proves it runs. */
interface StartedWorker {
  /** The native module worker. */
  readonly port: Worker
  /** The `Blob` URL it was created from, for revocation on release. */
  readonly url: string
  /** Settles when the module has evaluated and posted its ready message. */
  readonly ready: Promise<void>
  /** Detach the ready listener; the session owns the failure listeners. */
  readonly stopReadyHandshake: () => void
}

/**
 * Start the local module worker from the embedded source.
 *
 * The ready handshake is appended to the worker's own module rather than being a
 * separate bootstrap file: that module finishes by publishing
 * `globalThis.pdfjsWorker`, so a stub that imported it would only restate that,
 * and a second file would be one more thing to keep in step with the pinned
 * version.
 *
 * @param source - the embedded `pdf.worker.min.mjs` module text.
 * @param onFailure - receives the worker's `error` and `messageerror` events.
 * @returns the worker, its URL and its readiness.
 */
function startWorker(source: string, onFailure: (event: Event) => void): StartedWorker {
  const greeting = `\nself.postMessage({ type: ${JSON.stringify(WORKER_READY)} });\n`
  const url = URL.createObjectURL(new Blob([source, greeting], { type: 'text/javascript' }))

  let worker: Worker
  try {
    worker = new Worker(url, { type: 'module', name: 'dsa-pdf' })
  } catch (error) {
    // A constructor that throws — a CSP that forbids blob workers, a document
    // with no worker support — leaves nothing to hand to PDF.js and no fallback
    // this project permits, so the URL is released and the failure is typed.
    URL.revokeObjectURL(url)
    throw new PdfWorkerFailure(error)
  }

  worker.addEventListener('error', onFailure)
  worker.addEventListener('messageerror', onFailure)

  const started = createDeferred<void>()
  const onMessage = (event: MessageEvent): void => {
    const data: unknown = event.data
    if (typeof data !== 'object' || data === null) return
    if ((data as { type?: unknown }).type !== WORKER_READY) return
    started.resolve()
  }
  worker.addEventListener('message', onMessage)

  return {
    port: worker,
    url,
    ready: started.promise,
    stopReadyHandshake: () => {
      worker.removeEventListener('message', onMessage)
    },
  }
}

/**
 * The reason an aborted session rejects with.
 *
 * `AbortSignal.throwIfAborted()` is deliberately not used: it rethrows whatever
 * the signal was aborted with, which may be a string, while this module's
 * contract says a cancelled load rejects with an `AbortError`.
 *
 * @param signal - the aborted signal.
 * @returns the error to reject with.
 */
function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  const error = new Error('The PDF load was aborted.')
  error.name = 'AbortError'
  return error
}

/**
 * Deliver a failure to the renderer without letting the reporter's own throw
 * replace the failure being reported.
 *
 * @param report - the optional reporter.
 * @param error - the failure.
 */
function reportQuietly(report: ((error: unknown) => void) | undefined, error: unknown): void {
  if (report === undefined) return
  try {
    report(error)
  } catch (reportingFailure) {
    console.error('[dsa-pdf] the failure reporter threw', reportingFailure)
  }
}
