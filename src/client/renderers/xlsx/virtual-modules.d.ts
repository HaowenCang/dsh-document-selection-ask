/**
 * Declarations for the XLSX resources `tsdown.config.ts` embeds into the client
 * bundle.
 *
 * These are not `*.wasm` module declarations a bundler would resolve from disk.
 * `virtual:dsa-xlsx-wasm-gzip` is a **virtual module id** produced by a plugin in
 * `tsdown.config.ts`, which reads the exact installed
 * `@extend-ai/react-xlsx/dist/duke_sheets_wasm_bg.wasm`, verifies its SHA-256 and
 * embeds a deterministic gzip of it as base64.
 *
 * The payload is embedded rather than referenced because DSH serves an external
 * client plugin's browser half as exactly one generated script: there is no
 * package module URL, so a sibling `.wasm` address would resolve against the
 * document and 404, and no host route may be registered for it. It is embedded
 * **compressed**, which is the narrow exception recorded in
 * `docs/06-security-performance.md`: the uncompressed binary's base64
 * representation is 5,883,068 characters and remains prohibited.
 */

declare module 'virtual:dsa-xlsx-wasm-gzip' {
  /** The deterministic gzip of the exact engine binary, base64-encoded. */
  const gzipBase64: string
  /** The exact engine binary's byte length. */
  const rawBytes: number
  /** The engine binary's SHA-256, lowercase hex. */
  const sha256: string
  /** The gzip payload's byte length, before base64. */
  const gzipBytes: number
  /** The exact installed `@extend-ai/react-xlsx` version the payload came from. */
  const packageVersion: string

  export {
    gzipBase64 as XLSX_WASM_GZIP_BASE64,
    rawBytes as XLSX_WASM_RAW_BYTES,
    sha256 as XLSX_WASM_SHA256,
    gzipBytes as XLSX_WASM_GZIP_BYTES,
    packageVersion as XLSX_WASM_PACKAGE_VERSION,
  }
}
