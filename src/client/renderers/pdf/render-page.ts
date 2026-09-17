/**
 * Rendering one page: the canvas, the selectable text over it, and the point at
 * which PDF.js is told the page is no longer needed.
 *
 * ## One operation owns the page
 *
 * A page has two independent renders — an asynchronous raster on the canvas and
 * an asynchronous layout of the text spans — and a single page object shared by
 * both. `PDFPageProxy.cleanup()` releases the glyph and operator caches that both
 * of them read, so calling it when only the canvas has finished leaves the text
 * layer reading caches that were just dropped: the spans come out empty and the
 * page looks like a scan while its text was present all along. The page is
 * therefore owned by one operation that starts both renders, waits for both to
 * settle — completion or cancellation — and only then cleans up.
 *
 * ## Cancellation
 *
 * PDF.js cancels a canvas render only through its `RenderTask.cancel()`, and
 * `cleanup()` while a render is in flight is not a cancellation at all. Both are
 * driven from the same signal here, and the operation's promise stays settled
 * once it has settled, so an abort cannot both reject and resolve.
 *
 * ## The listener this operation attaches
 *
 * The signal is the tab's, which outlives every page and every resize re-render,
 * so the listener cannot be left to the signal's own `{ once: true }`: that
 * releases it only when the tab finally aborts, which would leave one finished
 * operation — its page proxy, render task and text render — reachable from the tab
 * for as many times as the column has been resized. The operation therefore
 * releases its own registration at both ends of its life: `cancel()` detaches as
 * its first act, so an explicit cancel unlinks the operation immediately rather
 * than when `done` settles, and the `finally` detaches on every other path —
 * success, raster failure, text failure and abort alike. `detachAbort` is
 * idempotent and never throws, and `page.cleanup()` still waits for both render
 * paths to settle; releasing a listener does not release the page earlier.
 *
 * ## The text layer this operation inherits
 *
 * The text-layer element is React's and is the same element on every re-render of
 * the page, while PDF.js appends into whatever container it is given and does not
 * remove what a previous layer appended. This operation is therefore also the
 * generation boundary for that element: it empties it synchronously, before its
 * first `await`, so the text on screen belongs to this generation from the moment
 * this generation exists — including when it fails before it ever reaches the
 * text layer, and including when its signal has already aborted. The raster's
 * canvas has no equivalent problem: `page.render()` draws into the canvas it is
 * given and its cancellation is a `RenderTask.cancel()`.
 */

import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

import type { PdfBackingGeometry } from './geometry.js'
import { pageBackingGeometry } from './geometry.js'
import { clearTextLayer, configureTextLayer, renderTextLayer } from './text-layer.js'
import type { PdfTextRender } from './text-layer.js'

/** The DOM nodes one page render fills. */
export interface PdfPageHosts {
  /** The page's canvas; its CSS box is set here and never by the raster scale. */
  readonly canvas: HTMLCanvasElement
  /** The selectable text layer, inside the same page wrapper. */
  readonly textLayer: HTMLElement
}

/** One in-flight page render. */
export interface PdfPageRender {
  /** Settles when both the canvas and the text layer have settled. */
  readonly done: Promise<void>
  /** Stop both renders and release the page. */
  cancel(): void
}

/**
 * Render one page into hosts the caller owns.
 *
 * The page wrapper, the canvas element and the text layer element all belong to
 * React; this function only writes into them. Cleanup of the page object is its
 * own responsibility, because the page object is what this function obtained.
 *
 * One listener is registered on `signal` for the life of the operation and is
 * released when the operation settles, whichever way it settled; see the module
 * note above.
 *
 * @param document - the loaded document.
 * @param pageNumber - the 1-based page to render.
 * @param hosts - the canvas and the text-layer element for that page.
 * @param cssWidth - the width the page is displayed at, in CSS pixels.
 * @param devicePixelRatio - the display's device pixel ratio.
 * @param signal - the owning operation's lifetime.
 * @returns the render handle for the caller to await or cancel.
 */
export function renderPdfPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  hosts: PdfPageHosts,
  cssWidth: number,
  devicePixelRatio: number,
  signal: AbortSignal,
): PdfPageRender {
  // The generation boundary, and the first statement rather than the last: the
  // caller has cancelled the operation this one replaces, so the text still in
  // this element belongs to a generation that no longer exists. Emptying it here
  // — synchronously, before the first `await` and before the abort check below —
  // is what makes the layer's contents this operation's responsibility on every
  // path out of it, including the one where it never obtains a page at all.
  clearTextLayer(hosts.textLayer)

  let cancelled = false
  let page: PDFPageProxy | undefined
  let canvasTask: RenderTask | undefined
  let text: PdfTextRender | undefined

  // Releasing the listener can never fail the render it is releasing, so it is
  // idempotent and swallows whatever the signal raises: an operation that has
  // already finished has nothing left to do about it.
  let detachAbort = (): void => {}

  const cancel = (): void => {
    if (cancelled) return
    cancelled = true
    // Before the two renders, so an explicit cancel unlinks this operation from
    // the tab's lifetime at the moment it is asked to stop.
    detachAbort()
    // The text layer next: it is what a half-finished layout leaves visible.
    text?.cancel()
    canvasTask?.cancel()
  }

  let attached = false
  if (signal.aborted) cancel()
  else {
    const onAbort = (): void => {
      cancel()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    attached = true
    detachAbort = (): void => {
      if (!attached) return
      attached = false
      try {
        signal.removeEventListener('abort', onAbort)
      } catch {
        // A releasing operation cannot report a failure, and there is no
        // registration left to make.
      }
    }
  }

  const done = (async (): Promise<void> => {
    try {
      page = await document.getPage(pageNumber)
      if (cancelled) return

      // The CSS viewport. Its scale is one CSS pixel per PDF user unit times the
      // fit-width factor, which is the geometry the wrapper, the canvas box and
      // the text layer all share.
      const unitViewport = page.getViewport({ scale: 1 })
      const cssScale = cssWidth / unitViewport.width
      const cssViewport = page.getViewport({ scale: cssScale })

      const backing: PdfBackingGeometry = pageBackingGeometry(
        cssViewport.width,
        cssViewport.height,
        cssScale,
        devicePixelRatio,
      )

      // The canvas box is the CSS viewport, never the backing size: the backing
      // size is what the raster is drawn at, not how large the page is.
      hosts.canvas.width = backing.width
      hosts.canvas.height = backing.height
      hosts.canvas.style.width = `${cssViewport.width}px`
      hosts.canvas.style.height = `${cssViewport.height}px`

      configureTextLayer(hosts.textLayer, backing.textScaleFactor)
      text = renderTextLayer(page, cssViewport, hosts.textLayer, signal)

      canvasTask = page.render({
        canvas: hosts.canvas,
        viewport: cssViewport,
        transform: backing.factor === 1 ? undefined : [backing.factor, 0, 0, backing.factor, 0, 0],
      })

      await Promise.all([
        canvasTask.promise.catch((error: unknown) => {
          if (cancelled) return
          throw error
        }),
        text.done.catch((error: unknown) => {
          if (cancelled) return
          throw error
        }),
      ])
    } finally {
      // Reached on success, on cancellation and on failure alike. A cancelled
      // `getPage` may still resolve later, but by then `page` is either cleaned
      // up or was never obtained. The listener goes with the same boundary, so
      // nothing of this operation outlives it on the tab's signal.
      detachAbort()
      page?.cleanup()
    }
  })()

  return { done, cancel }
}
