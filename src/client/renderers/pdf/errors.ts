/**
 * Typed failures of the PDF renderer.
 *
 * The two classes exist because the renderer has exactly two failure modes that
 * must stay distinguishable in the UI, and a string message cannot carry the
 * distinction reliably across the PDF.js boundary:
 *
 * - `PdfWorkerFailure` — the worker could not be started, or died after it had
 *   started. The project's frozen requirement is that this is reported, never
 *   silently absorbed by parsing the document on the main thread.
 * - `PdfAssetFailure` — PDF.js asked for a CMap, a standard font or a wasm module
 *   this build does not carry. The message names the exact `kind` and `filename`,
 *   because the alternative — a fetch of a URL that was never configured — is the
 *   remote-asset dependence the project forbids.
 *
 * Both extend `Error` and set a stable `name`, so a caller can match on the class
 * and a log line stays readable without the class identity.
 */

/** Failure mode of the PDF worker a page's render depends on. */
export class PdfWorkerFailure extends Error {
  /**
   * @param cause - the native error or `messageerror` event that ended the worker.
   */
  constructor(cause: unknown) {
    super('The PDF worker could not be used.', { cause })
    this.name = 'PdfWorkerFailure'
  }
}

/** Resource kind PDF.js requested from this build's local asset table. */
export type PdfAssetKind = 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl'

/**
 * A requested PDF.js binary asset this build does not carry.
 *
 * The renderer never falls back to a URL for one of these. A missing asset is a
 * build defect — the asset set is chosen from the exact installed PDF.js version
 * — so it is reported as itself rather than as a network failure several layers
 * away from the cause.
 */
export class PdfAssetFailure extends Error {
  /** The resource family PDF.js asked for. */
  readonly kind: PdfAssetKind
  /** The exact filename within that family. */
  readonly filename: string

  /**
   * @param kind - the resource family PDF.js asked for.
   * @param filename - the exact filename PDF.js asked for.
   */
  constructor(kind: PdfAssetKind, filename: string) {
    super(`PDF.js requested an asset this build does not carry: ${kind}/${filename}`)
    this.name = 'PdfAssetFailure'
    this.kind = kind
    this.filename = filename
  }
}
