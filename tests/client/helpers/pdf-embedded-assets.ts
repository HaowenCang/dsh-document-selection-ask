/**
 * The build's embedded PDF.js asset table, as the specs see it.
 *
 * `tsdown.config.ts` produces this module by reading the CMap, standard-font and
 * wasm families out of the installed `pdfjs-dist` and embedding them as base64 —
 * about 5 MB of string literals. The specs that exercise the asset factory build
 * their own tables and pass them in, so this module only has to exist and to be
 * shaped like the real one.
 *
 * The two entries below are the control for "an asset this build does carry":
 * `assets.client.spec.tsx` asserts that a request for one of them resolves to the
 * decoded bytes, and that a request for anything else rejects with
 * `PdfAssetFailure` rather than reaching for a URL.
 */

const EMPTY_FAMILY: Readonly<Record<string, string>> = Object.freeze({})

export default {
  cMapUrl: EMPTY_FAMILY,
  standardFontDataUrl: EMPTY_FAMILY,
  wasmUrl: EMPTY_FAMILY,
} as {
  readonly cMapUrl: Readonly<Record<string, string>>
  readonly standardFontDataUrl: Readonly<Record<string, string>>
  readonly wasmUrl: Readonly<Record<string, string>>
}
