/**
 * Canvas backing geometry: how many device pixels back one page, and which
 * bound limited that number.
 *
 * The rule this module exists to enforce is that the **raster budget never
 * changes the document's visible geometry**. A page is laid out once in CSS
 * pixels — the page wrapper, the canvas's CSS box and the text layer all take
 * that one size — and the device pixel ratio decides only how many device pixels
 * back the canvas is drawn at. When a cap binds, the backing factor is reduced
 * and nothing else is: the page still occupies the same CSS box, and the browser
 * resamples a coarser raster into it. A renderer that instead shrank the page to
 * fit the budget would move the text layer relative to the canvas and break
 * selection geometry on exactly the displays the cap exists for.
 *
 * The two caps are the project's frozen limits:
 *
 * ```text
 * MAX_CANVAS_DIMENSION = 16_384 device pixels per side
 * MAX_CANVAS_PIXELS    = 64 Mi device pixels total
 * ```
 *
 * Both sit well below the browser's own canvas limits, so a page at the cap
 * still rasterizes rather than producing an empty canvas.
 *
 * ## What this module deliberately does not compute
 *
 * There is no quality tier and no text-layer factor here, because neither is a
 * property of the raster. The backing factor is `devicePixelRatio` bounded by the
 * two caps and by nothing else, and the selectable text is laid out from the same
 * CSS `PageViewport` the canvas's CSS box comes from — see `render-page.ts`. The
 * text layer must **not** follow the backing factor: when a cap lowers the raster
 * below the device ratio the page still occupies the same CSS pixels, and a text
 * layer that followed the raster instead would slide off the glyphs it selects.
 *
 * The contract that makes this correct belongs to PDF.js, and it is worth stating
 * where it comes from (`pdfjs-dist@6.3.289`, `build/pdf.mjs`):
 *
 * ```text
 * TextLayer.#scale        = viewport.scale × devicePixelRatio   (constructor)
 * container width/height  = --total-scale-factor × rawDims.pageWidth/Height
 * span font-size          = --total-scale-factor × --font-height
 * --font-height           = |viewport transform · glyph matrix| (CSS pixels)
 * ```
 *
 * `--total-scale-factor` therefore multiplies a CSS-pixel quantity, and the only
 * value that puts a span on its glyph is the viewport's own CSS scale. The
 * library's own `devicePixelRatio` term sizes a canvas text-measurement font and
 * the `--scale-x` correction; it reaches neither the span box nor the span's
 * position, and it is not a number this renderer contributes.
 */

/** Frozen maximum canvas side length in device pixels. */
export const MAX_CANVAS_DIMENSION = 16_384

/** Frozen maximum canvas area in device pixels. */
export const MAX_CANVAS_PIXELS = 64 * 1024 * 1024

/** Which bound produced a page's backing factor. */
export type PdfBackingLimit = 'device-pixel-ratio' | 'max-dimension' | 'max-pixels'

/** The device-pixel geometry one page's canvas is rendered at. */
export interface PdfBackingGeometry {
  /** Device pixels per CSS pixel. Always positive and finite. */
  readonly factor: number
  /** Buffered canvas width in device pixels; at least 1. */
  readonly width: number
  /** Buffered canvas height in device pixels; at least 1. */
  readonly height: number
  /** Which bound decided `factor`; `device-pixel-ratio` means nothing was capped. */
  readonly limitedBy: PdfBackingLimit
}

/**
 * Normalise a device pixel ratio into the range the caps are computed in.
 *
 * A missing, zero, negative, `NaN` or infinite ratio would silently disable the
 * resampling it was supposed to request, so it is replaced by the identity
 * rather than trusted.
 *
 * @param devicePixelRatio - the value read from `window`.
 * @returns a finite positive ratio.
 */
function usableRatio(devicePixelRatio: number): number {
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
}

/**
 * Decide how many device pixels back one page, keeping the CSS geometry fixed.
 *
 * The requested factor is the display's own device pixel ratio. The request is
 * then bounded twice and the smallest bound wins:
 *
 * ```text
 * dimensionBound = MAX_CANVAS_DIMENSION / max(cssWidth, cssHeight)
 * pixelBound     = sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight))
 * factor         = min(devicePixelRatio, dimensionBound, pixelBound)
 * ```
 *
 * An ordinary page at any ratio keeps that ratio exactly. A page too large for the
 * budget is reduced to the largest factor that fits, and that is the only case in
 * which the factor differs from the ratio — including the extreme page for which
 * the fitting factor is below `1`. `cssWidth` and `cssHeight` are returned nowhere
 * and used nowhere else, so the visible page cannot change size to satisfy the
 * cap.
 *
 * @param cssWidth - the page's width in CSS pixels; a finite positive number.
 * @param cssHeight - the page's height in CSS pixels; a finite positive number.
 * @param devicePixelRatio - the display's device pixel ratio.
 * @returns the factor, the integer canvas size and the binding limit.
 * @throws RangeError when a dimension is not a finite positive number, because
 * such a page has no geometry to compute and returning one anyway would hide the
 * caller's defect behind a blank canvas.
 */
export function backingGeometry(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): PdfBackingGeometry {
  if (!Number.isFinite(cssWidth) || cssWidth <= 0) {
    throw new RangeError(`A PDF page needs a positive finite width, received ${String(cssWidth)}`)
  }
  if (!Number.isFinite(cssHeight) || cssHeight <= 0) {
    throw new RangeError(`A PDF page needs a positive finite height, received ${String(cssHeight)}`)
  }

  const requested = usableRatio(devicePixelRatio)

  const dimensionBound = MAX_CANVAS_DIMENSION / Math.max(cssWidth, cssHeight)
  const pixelBound = Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight))

  const factor = Math.min(requested, dimensionBound, pixelBound)

  // The minimum of three positive finite numbers is positive and finite, so this
  // guard is unreachable. It is kept because every later stage divides by the
  // factor, and an empty canvas is a far worse symptom than a thrown error.
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(
      `No usable PDF backing scale for ${cssWidth}x${cssHeight} CSS pixels at ratio ${String(devicePixelRatio)}`,
    )
  }

  const limitedBy: PdfBackingLimit =
    factor === requested ? 'device-pixel-ratio' : dimensionBound <= pixelBound ? 'max-dimension' : 'max-pixels'

  return {
    factor,
    width: Math.max(1, Math.floor(cssWidth * factor)),
    height: Math.max(1, Math.floor(cssHeight * factor)),
    limitedBy,
  }
}
