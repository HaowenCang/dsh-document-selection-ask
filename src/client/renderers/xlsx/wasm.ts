/**
 * The Duke sheets WebAssembly source the XLSX renderer parses workbooks with.
 *
 * ## Why this module fails closed
 *
 * `@extend-ai/react-xlsx` parses workbooks with a 4.4 MB WebAssembly engine
 * shipped inside its own package at a public subpath
 * ({@link XLSX_WASM_ASSET_SUBPATH}). Its `setWasmSource` accepts the bytes
 * directly, and `sourceToWorkerSource` forwards an `ArrayBuffer` or a typed
 * array to the library's worker verbatim, so a **client-owned `BufferSource`**
 * is the one source that satisfies every constraint this plugin is under at
 * once: no HTTP route, no CDN, no `fetch`, and a genuinely worker-backed parse.
 *
 * What the browser cannot do is obtain those 4.4 MB under those constraints.
 * DSH serves an external client plugin's browser half as exactly one generated
 * script — the file `exports["./client"]` names, plus its optional source map —
 * through a closed, pre-computed response table (`ClientModuleRegistry`); it
 * answers 404 for every other path and exposes no API by which a plugin may
 * contribute a second file. `DshClientManifest` declares only `platform`,
 * `inject`, `immediately` and `external`. The served URL is the only address the
 * bundle can learn at runtime, and no sibling asset address can be derived from
 * it; `import.meta.url` is unavailable because the bundle is a classic script.
 *
 * An earlier revision worked around that by registering `/dsa-assets/...` routes
 * in the host half and pointing `setWasmSource` at the resulting URL. That made
 * the plugin's browser runtime depend on a host service, which the frozen design
 * does not permit, and it has been removed.
 *
 * The alternative — inlining the binary into `lib/client.js` — is technically
 * feasible but is not authorized: it still embeds the complete WASM payload in
 * the main bundle, which the project's own XLSX constraint forbids.
 *
 * Until an architecture decision is made, this module does not guess. It holds
 * the client-owned source contract ({@link installXlsxWasmSource}), which is the
 * exact seam a permitted delivery mechanism would populate, and
 * {@link ensureXlsxWasmInitialized} refuses rather than reaching for a URL, a
 * network fallback, or a CDN. The XLSX renderer turns that refusal into a
 * visible failure before any third-party viewer is mounted, so the blocked state
 * is reported rather than silently degraded.
 */

import { setWasmSource } from '@extend-ai/react-xlsx'

/**
 * The public subpath `@extend-ai/react-xlsx` publishes its engine binary under.
 *
 * Recorded here because it is the exact artifact a permitted delivery mechanism
 * has to carry; it is not fetched from anywhere by this module.
 */
export const XLSX_WASM_ASSET_SUBPATH = '@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm'

/** Raised when a workbook is opened and no client-owned engine binary exists. */
export class XlsxWasmSourceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XlsxWasmSourceUnavailableError'
  }
}

/** Whether {@link installXlsxWasmSource} has supplied this session's bytes. */
let installed = false

/**
 * Install the package-provided engine bytes as this session's WASM source.
 *
 * The caller's buffer is copied before it is handed to the library, for the same
 * reason the workbook bytes are copied: `setWasmSource` keeps a reference, and a
 * source that a caller can still mutate is not a source this plugin has
 * validated. The copy is made once per call and the library derives its worker
 * copy from it.
 *
 * @param bytes - the exact `duke_sheets_wasm_bg.wasm` bytes from the installed
 *   `@extend-ai/react-xlsx` package.
 */
export function installXlsxWasmSource(bytes: ArrayBuffer | ArrayBufferView): void {
  const copy =
    bytes instanceof ArrayBuffer
      ? bytes.slice(0)
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  setWasmSource(copy)
  installed = true
}

/**
 * Report whether a client-owned engine binary has been installed.
 * @returns `true` once {@link installXlsxWasmSource} has run.
 */
export function hasXlsxWasmSource(): boolean {
  return installed
}

/**
 * Confirm the renderer has an engine binary to parse with.
 *
 * Deliberately has no fallback. A URL would be a network request, a `data:` URL
 * would be the inlining this project does not permit, and a CDN is forbidden
 * outright; the only acceptable state is that the caller supplied the bytes.
 *
 * @throws XlsxWasmSourceUnavailableError when no source has been installed.
 */
export function ensureXlsxWasmInitialized(): void {
  if (installed) {
    return
  }
  throw new XlsxWasmSourceUnavailableError(
    'XLSX rendering is unavailable: no client-owned WebAssembly source has been installed. ' +
      `The engine binary ${XLSX_WASM_ASSET_SUBPATH} cannot be delivered to the browser ` +
      'through any public client-only DSH contract, and this plugin does not serve it from the host.',
  )
}
