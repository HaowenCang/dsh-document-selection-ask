/**
 * Page geometry: the raster cap, and the one factor canvas rendering and text
 * layout both have to agree on.
 *
 * The rule this module exists to enforce is that the **raster budget never
 * changes the document's visible geometry**. A page is laid out once in CSS
 * pixels — the page wrapper, the canvas's CSS box and the text layer all take
 * that one size — and the device pixel ratio only decides how many device pixels
 * back the canvas. When the ratio would exceed a cap, the *backing scale* is
 * reduced and nothing else is; a renderer that instead shrank the page to fit
 * the budget would move the text layer relative to the canvas and break
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
 * ## Why one factor and not two
 *
 * PDF.js lays a text span out at `transform × viewport.scale × devicePixelRatio`
 * and divides the result back down through the `--total-scale-factor` custom
 * property its text layer reads from its container. A canvas rendered at `factor`
 * device pixels per CSS pixel therefore has to be paired with
 * `--total-scale-factor = factor / devicePixelRatio`; the same number that scales
 * the raster is the number that keeps the selectable text on top of it. Leaving
 * the property unset — or setting it to `1` unconditionally — offsets and
 * mis-scales every span on a display whose ratio is not 1.
 */

/** Frozen maximum canvas side length in device pixels. */
export const MAX_CANVAS_DIMENSION = 16_384

/** Frozen maximum canvas area in device pixels. */
export const MAX_CANVAS_PIXELS = 64 * 1024 * 1024

/** Device pixel ratio at and above which the finest render tier is affordable. */
export const FINEST_DETAIL_RATIO = 1.5

/**
 * Detail tier of a rendered page.
 *
 * Both tiers display the page at the same CSS size. `normal` asks for one device
 * pixel per CSS pixel per `devicePixelRatio`; `finest` asks for one device pixel
 * per CSS pixel, which is the tier a page small enough to stay inside the budget
 * wants on a dense display. Neither tier can exceed the cap below.
 */
export type PdfRenderDetail = 'normal' | 'finest'

/** Which bound produced a page's backing factor. */
export type PdfBackingLimit = 'device-pixel-ratio' | 'max-dimension' | 'max-pixels'

/** The device-pixel geometry one page's canvas is rendered at. */
export interface PdfBackingGeometry {
  /**
   * Device pixels per PDF user unit: the PDF.js page-viewport scale. Canvas
   * rendering and text-layer layout are both derived from this one number.
   */
  readonly scale: number
  /** Device pixels per CSS pixel. Always positive and finite. */
  readonly factor: number
  /** Buffered canvas width in device pixels; at least 1. */
  readonly width: number
  /** Buffered canvas height in device pixels; at least 1. */
  readonly height: number
  /** Which bound decided `factor`; `device-pixel-ratio` means nothing was capped. */
  readonly limitedBy: PdfBackingLimit
  /** The tier this geometry was computed for. */
  readonly detail: PdfRenderDetail
  /**
   * Multiplier of `viewport.scale` the matching text layer must be laid out
   * with, i.e. the value of `--total-scale-factor`.
   */
  readonly textScaleFactor: number
}

/**
 * The detail tier a device pixel ratio selects.
 *
 * The threshold is deliberately simple rather than tuned: a page on a display
 * whose ratio is at least `FINEST_DETAIL_RATIO` is small enough in CSS pixels
 * that the finest tier is affordable, and a page on a 1× display has no finer
 * tier to ask for. Both tiers still pass through the cap, so the threshold
 * decides quality only, never safety.
 *
 * @param devicePixelRatio - the display's ratio, already validated.
 * @returns the tier that ratio selects.
 */
function detailFor(devicePixelRatio: number): PdfRenderDetail {
  return devicePixelRatio >= FINEST_DETAIL_RATIO ? 'finest' : 'normal'
}

/**
 * The multiplier a tier requests before either cap is applied.
 *
 * @param detail - the tier.
 * @param devicePixelRatio - the display's ratio.
 * @returns the requested device pixels per CSS pixel.
 */
function requestedFactor(detail: PdfRenderDetail, devicePixelRatio: number): number {
  return detail === 'normal' ? devicePixelRatio : devicePixelRatio / 2
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
 * The requested factor is `devicePixelRatio` in the normal tier and
 * `devicePixelRatio / 2` in the finest tier, as `PdfRenderDetail` documents. The
 * request is then bounded twice and the smallest bound wins:
 *
 * ```text
 * dimensionBound = MAX_CANVAS_DIMENSION / max(cssWidth, cssHeight)
 * pixelBound     = sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight))
 * factor         = min(requested, dimensionBound, pixelBound)
 * ```
 *
 * A page that fits the budget keeps its requested factor exactly; a page that
 * does not is reduced to the largest factor that fits. `cssWidth` and
 * `cssHeight` are returned nowhere and used nowhere else, so the visible page
 * cannot change size to satisfy the cap.
 *
 * @param cssWidth - the page's width in CSS pixels; a finite positive number.
 * @param cssHeight - the page's height in CSS pixels; a finite positive number.
 * @param devicePixelRatio - the display's device pixel ratio.
 * @param detail - optional tier override; defaults to the ratio's own tier.
 * @returns the factor, the integer canvas size, the binding limit and the tier.
 * @throws RangeError when a dimension is not a finite positive number, because
 * such a page has no geometry to compute and returning one anyway would hide the
 * caller's defect behind a blank canvas.
 */
export function backingGeometry(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  detail?: PdfRenderDetail,
): Omit<PdfBackingGeometry, 'scale' | 'textScaleFactor'> {
  if (!Number.isFinite(cssWidth) || cssWidth <= 0) {
    throw new RangeError(`A PDF page needs a positive finite width, received ${String(cssWidth)}`)
  }
  if (!Number.isFinite(cssHeight) || cssHeight <= 0) {
    throw new RangeError(`A PDF page needs a positive finite height, received ${String(cssHeight)}`)
  }

  const ratio = usableRatio(devicePixelRatio)
  const tier = detail ?? detailFor(ratio)
  const requested = Math.max(requestedFactor(tier, ratio), Number.MIN_VALUE)

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
    detail: tier,
  }
}

/**
 * Complete a backing geometry for one page at a known CSS resolution.
 *
 * The page's CSS geometry is fixed by the caller; only the raster follows the
 * caps. `cssPixelsPerUnit` is the PDF.js page-viewport scale, so `scale` is what
 * `page.render({ viewport })` and `page.getTextContent()` are both built from.
 *
 * @param cssWidth - the page's width in CSS pixels.
 * @param cssHeight - the page's height in CSS pixels.
 * @param cssPixelsPerUnit - PDF user units per CSS pixel, i.e. the CSS viewport scale.
 * @param devicePixelRatio - the display's device pixel ratio.
 * @param detail - optional tier override.
 * @returns the factor, the canvas size, the viewport scale and the text factor.
 */
export function pageBackingGeometry(
  cssWidth: number,
  cssHeight: number,
  cssPixelsPerUnit: number,
  devicePixelRatio: number,
  detail?: PdfRenderDetail,
): PdfBackingGeometry {
  if (!Number.isFinite(cssPixelsPerUnit) || cssPixelsPerUnit <= 0) {
    throw new RangeError(`A PDF page needs a positive finite viewport scale, received ${String(cssPixelsPerUnit)}`)
  }

  const base = backingGeometry(cssWidth, cssHeight, devicePixelRatio, detail)
  return {
    ...base,
    scale: cssPixelsPerUnit * base.factor,
    textScaleFactor: base.factor / usableRatio(devicePixelRatio),
  }
}
