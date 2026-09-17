/**
 * Selectable text on top of a page's canvas.
 *
 * The layer is PDF.js's own `TextLayer`, constructed through the class the
 * package exports publicly for version 6.3.289 — the same class the reference
 * viewer uses. This module supplies the environment that class assumes and
 * nothing else: it does not position spans, compute glyph transforms or build a
 * selection model, because PDF.js already owns the font transform and glyph
 * positioning data and a second implementation of that arithmetic would be wrong
 * in a way no test here could see.
 *
 * ## The container is shared, and that is this module's problem
 *
 * A page's text-layer element belongs to React and is handed back to every
 * re-render of that page — a resize re-renders into the **same** element, which
 * is the whole point of the element being stable. PDF.js appends into whatever
 * container it is given and its `cancel()` does not remove what a previous layer
 * appended: `TextLayer.cancel()` cancels the reader and rejects the layer's own
 * capability (6.3.289, `build/pdf.mjs`, `cancel()`), and the container's children
 * are untouched. Two renders into one container therefore leave the page's text
 * in the DOM twice and a third leaves it in three times.
 *
 * The duplicates are invisible — the spans are transparent and coincide — but
 * they are what the browser reads: `getSelection().toString()` returns the text
 * twice, copy takes it twice, assistive technology reads it twice, and a
 * provenance-aware quote would quote it twice. One generation of text per render
 * is therefore this module's responsibility, and `clearTextLayer` is where it is
 * discharged: the module that owns PDF.js's own text-layer DOM is the module that
 * ends a generation, so no caller has to remember to.
 *
 * ## The one number that has to agree with the canvas
 *
 * `TextLayer` lays a span out at `transform × viewport.scale × devicePixelRatio`
 * and divides the result back down through the `--total-scale-factor` custom
 * property on its container. The canvas beside it is rendered at
 * `viewport.scale` with a separate output transform, so a text layer that keeps
 * the wrong factor is offset and mis-scaled relative to the image it selects.
 * `configureTextLayer` is where the factor is written, and both callers pass the
 * one `PdfBackingGeometry` they rendered the canvas with.
 *
 * The container carries `class="textLayer"` because the selectors are the
 * attribute-free class names PDF.js's own stylesheet uses; the sheet this plugin
 * ships contains the TextLayer rules it needs, adapted from
 * `pdfjs-dist/web/pdf_viewer.css` with attribution in `THIRD_PARTY_NOTICES.md`.
 */

import { TextLayer } from 'pdfjs-dist'
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist'

/**
 * End the container's current generation of text.
 *
 * This is the statement that the text in a layer is no longer the text of the
 * render that produced it. It is called at two points, and both are needed:
 *
 * - by `renderPdfPage`, at the start of every render operation — the generation
 *   boundary. The previous operation has been cancelled by then, and this is what
 *   makes the DOM on screen belong to the new generation even when the new one
 *   fails before it reaches the text layer at all, or is cancelled before its
 *   first `await`;
 * - by `renderTextLayer`, immediately before it constructs the layer. That one is
 *   redundant when the only caller is `renderPdfPage`, and it is kept because it
 *   is what makes the rule this module's rather than its caller's: a layer can
 *   never be constructed over a container that still holds another generation's
 *   text, whoever asked for it.
 *
 * `replaceChildren()` is the API for it, rather than `innerHTML = ''` or
 * `textContent = ''`: it parses nothing, takes no string, cannot be made to run
 * script, and states that every child is replaced rather than that a string
 * property was assigned.
 *
 * ## Why this is enough without a generation token
 *
 * A cancelled layer could in principle append a chunk whose read resolved before
 * the cancellation and whose continuation runs after it, and such a chunk would
 * be appended into the container that has already been given to the next
 * generation. That window cannot be reached from this application, and the reason
 * is in the platform rather than in timing: a text chunk reaches PDF.js's pump
 * from a worker `message` event (`MessageHandler.#processStreamMessage` →
 * `controller.enqueue`), the pump's continuation for it is a microtask, and a
 * microtask always drains before the event loop returns to its task queue. Every
 * `cancel()` this renderer performs — from `SelectablePdfBody`'s animation frame,
 * from an abort listener, from an effect cleanup — runs in a later task, so a
 * chunk can never be served-but-unappended across a generation change. A token
 * would therefore be a guard against a state the application cannot produce;
 * what the containers needed was to be emptied, and that is what this does.
 *
 * @param container - the layer's own element.
 */
export function clearTextLayer(container: HTMLElement): void {
  container.replaceChildren()
}

/**
 * Prepare a container for one page's text layer.
 *
 * Must run before the layer is rendered and after every geometry change. Both
 * properties are set in JavaScript rather than in the style sheet because both
 * are values, not rules.
 *
 * @param container - the layer's own element.
 * @param textScaleFactor - the multiplier of `viewport.scale` the text is laid
 * out at, from `PdfBackingGeometry.textScaleFactor`.
 */
export function configureTextLayer(container: HTMLElement, textScaleFactor: number): void {
  container.style.setProperty('--total-scale-factor', String(textScaleFactor))
  // The rounding the reference viewer applies to its container dimensions. These
  // are 1px by default, which is what a page that is not being snapped to a
  // fractional column width wants.
  container.style.setProperty('--scale-round-x', '1px')
  container.style.setProperty('--scale-round-y', '1px')
}

/** A text layer that is rendering, and the two ways it can be stopped. */
export interface PdfTextRender {
  /** Settles when every span has been laid out. */
  readonly done: Promise<void>
  /** Stop laying out spans; safe after completion. */
  cancel(): void
}

/**
 * Render one page's selectable text.
 *
 * `TextLayer` accepts either the page's resolved text content or a stream of it.
 * This module hands it the **stream** — `PDFPageProxy.streamTextContent()` — so
 * the layer starts laying out spans as content arrives rather than after the
 * whole page has been decoded, and so cancelling the layer cancels the read.
 *
 * The container is emptied first, so the layer that starts here is the only
 * generation whose spans that element holds; see the module note above.
 *
 * A page with no text — a scan, an image-only export — produces an empty layer
 * rather than an error, and that is the correct outcome: this renderer shows what
 * the file contains. No OCR, no filename-as-text and no synthesised placeholder
 * stand in for text the document does not have.
 *
 * @param page - the loaded page.
 * @param viewport - the page's **CSS** viewport, the same one the canvas is sized to.
 * @param container - the layer's own element, inside the page wrapper.
 * @param signal - the owning operation's lifetime.
 * @returns the render handle.
 */
export function renderTextLayer(
  page: PDFPageProxy,
  viewport: PageViewport,
  container: HTMLElement,
  signal: AbortSignal,
): PdfTextRender {
  clearTextLayer(container)
  const layer = new TextLayer({
    // `disableNormalization: false` is the deliberate choice: normalization is
    // what makes a ligature or a decomposed accent select and copy as the
    // characters a reader sees. A selection that copied byte-for-byte glyph runs
    // would be a different string from the one on screen.
    textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: false }),
    container,
    viewport,
  })

  const done = layer.render()
  const cancel = (): void => {
    try {
      layer.cancel()
    } catch {
      // `cancel()` rejects the layer's own capability, which `done` reports; a
      // throw here would be a second report of the same cancellation.
    }
  }

  if (signal.aborted) cancel()
  else {
    const onAbort = (): void => {
      cancel()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    // The listener is released when the render settles, whichever way it settled:
    // a cancelled layer has already had `cancel()` called on it, and a finished
    // one needs nothing from the signal.
    void done.then(
      () => {
        signal.removeEventListener('abort', onAbort)
      },
      () => {
        signal.removeEventListener('abort', onAbort)
      },
    )
  }

  return { done, cancel }
}
