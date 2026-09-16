/**
 * Build-time embedded PDF.js resources.
 *
 * Two things are embedded, and both are read from the **exact installed**
 * `pdfjs-dist` at build time by the plugins in `tsdown.config.ts`:
 *
 * - the worker's module source, so the renderer can start a real module worker
 *   from a `Blob` URL without a package URL to resolve;
 * - the CMap, standard-font and wasm families, so PDF.js's own request for one of
 *   them is answered from bytes this bundle already carries.
 *
 * Neither has a network fallback. `PdfAssetFailure` is thrown for a name the
 * table does not hold, because the alternative — handing PDF.js a URL — is the
 * remote-asset dependence the project forbids, and a `fetch` that fails at the
 * edge of the parser is a much worse diagnostic than a named missing asset.
 *
 * The table is a `Record<string, string>` of **base64**: a build-time string
 * literal per file, decoded only when PDF.js asks for that file. Decoding the
 * whole table at module load would cost several megabytes of memory for every
 * document that never needed a CMap, so `PdfBinaryDataFactory.fetch` decodes
 * exactly one entry per call and hands the result to PDF.js, which transfers it.
 */

import embeddedAssets from 'virtual:pdfjs-assets'

import { PdfAssetFailure } from './errors.js'
import type { PdfAssetKind } from './errors.js'
import { PDF_WORKER_SOURCE } from './worker-source.js'

/** One resource family as the build embedded it: exact filename → base64. */
type PdfAssetFamily = Readonly<Record<string, string>>

/** What PDF.js asks its `BinaryDataFactory` for. */
interface PdfAssetRequest {
  readonly kind: PdfAssetKind
  readonly filename: string
}

/**
 * The public shape of the constructor PDF.js's `BinaryDataFactory` option takes.
 *
 * Declared structurally rather than imported from a `pdfjs-dist` subpath: the
 * main entry exports no type for it, and this project imports only the package's
 * public surface. The shape is the one `getDocument` reaches —
 * `factory.binaryDataFactory.fetch({ kind, filename })`.
 */
export interface PdfBinaryDataFactory {
  /**
   * @param request - the resource family and exact filename PDF.js needs.
   * @returns the file's bytes, as an independent buffer PDF.js may transfer.
   */
  fetch(request: PdfAssetRequest): Promise<Uint8Array<ArrayBuffer>>
}

/**
 * The constructor passed as `getDocument`'s `BinaryDataFactory`.
 *
 * PDF.js instantiates it once per document and calls `fetch` only for a resource
 * the document actually needs: an unembedded CMap, a standard font the document
 * references without embedding, or the wasm decoder for JBIG2, JPEG 2000 or a
 * ICC profile. A PDF that embeds everything asks for nothing, and the embedded
 * table costs only the string literals the bundle already carries.
 *
 * @param table - the embedded asset table; defaults to this build's.
 * @returns a class PDF.js can construct.
 */
export function createPdfBinaryDataFactory(
  table: Readonly<Record<PdfAssetKind, PdfAssetFamily>> = embeddedAssets,
): new () => PdfBinaryDataFactory {
  return class LocalPdfBinaryDataFactory implements PdfBinaryDataFactory {
    /**
     * @param request - the resource family and exact filename PDF.js needs.
     * @returns the decoded bytes.
     * @throws PdfAssetFailure when this build does not carry that asset.
     */
    fetch({ kind, filename }: PdfAssetRequest): Promise<Uint8Array<ArrayBuffer>> {
      const family = table[kind]
      const encoded = family[filename]
      if (encoded === undefined) {
        return Promise.reject(new PdfAssetFailure(kind, filename))
      }
      return Promise.resolve(decodeBase64(encoded))
    }
  }
}

/**
 * Decode one base64 asset into an independent byte buffer.
 *
 * `atob` is the browser's own decoder and is available in every environment this
 * bundle runs in. The returned buffer is newly allocated per call, which is what
 * lets PDF.js transfer it to the worker without disturbing the embedded string.
 *
 * @param encoded - base64 as the build wrote it.
 * @returns the file's bytes.
 */
function decodeBase64(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * The local worker source this build carries.
 *
 * Re-exported from `worker-source.ts` so every consumer of the PDF.js resources
 * — the runtime, the specs, a review of what the bundle embeds — reaches them
 * through one module rather than importing the virtual id directly.
 */
export { PDF_WORKER_SOURCE }
