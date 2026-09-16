/**
 * Declarations for the resources `tsdown.config.ts` embeds into the client
 * bundle.
 *
 * These are not `*.css` or `*.wasm` module declarations a bundler would resolve
 * from disk. Each names a **virtual module id** produced by a plugin in
 * `tsdown.config.ts`, and the suffix is part of the id the plugin matches:
 *
 * - `pdfjs-dist/build/pdf.worker.min.mjs?raw` — the worker's module source, read
 *   from the exact installed `pdfjs-dist` at build time and embedded as a
 *   JavaScript string literal. It is embedded rather than referenced because the
 *   DSH client loader evaluates an external plugin as a classic script inside a
 *   factory closure: there is no package module URL, so
 *   `new URL('pdf.worker.mjs', import.meta.url)` would resolve against the
 *   document and request an asset the DSH web server does not serve. The runtime
 *   starts the worker from a `Blob` over this string instead.
 * - `virtual:pdfjs-assets` — the CMap, standard-font and wasm families, read from
 *   the same installed package at build time and embedded as base64. They are
 *   decoded one at a time, on demand, when PDF.js asks for one.
 *
 * Both are build-time artifacts of a real installed dependency, so neither
 * duplicates package content in the repository.
 */

declare module 'pdfjs-dist/build/pdf.worker.min.mjs?raw' {
  /** The complete `pdf.worker.min.mjs` module source. */
  const workerSource: string
  export default workerSource
}

/**
 * One resource family as the build embedded it: exact filename → base64.
 *
 * Keys are the filenames PDF.js asks for through its `BinaryDataFactory` hook.
 */
type PdfEmbeddedFamily = Readonly<Record<string, string>>

declare module 'virtual:pdfjs-assets' {
  /** The embedded asset table, keyed by the resource kind PDF.js requests. */
  const assets: {
    readonly cMapUrl: PdfEmbeddedFamily
    readonly standardFontDataUrl: PdfEmbeddedFamily
    readonly wasmUrl: PdfEmbeddedFamily
  }
  export default assets
}
