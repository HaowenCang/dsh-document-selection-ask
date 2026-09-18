/**
 * The Duke sheets WebAssembly source the XLSX renderer parses workbooks with.
 *
 * ## Where the engine comes from
 *
 * `@extend-ai/react-xlsx` parses workbooks with a 4.4 MB WebAssembly engine that
 * ships inside its own package at a public subpath. Its `setWasmSource` accepts
 * the bytes directly and `sourceToWorkerSource` forwards an `ArrayBuffer` to the
 * library's worker verbatim, so a **client-owned `BufferSource`** is the one
 * source that satisfies every constraint this plugin is under at once: no HTTP
 * route, no CDN, no `fetch`, and a genuinely worker-backed parse.
 *
 * What the browser cannot do is obtain those bytes as a **file**. DSH serves an
 * external client plugin's browser half as exactly one generated script — the file
 * `exports["./client"]` names, plus its optional source map — through a closed,
 * pre-computed response table, answers 404 for every other path, and exposes no
 * API by which a plugin may contribute a second file. An earlier revision
 * registered two host routes in the host half instead; naming the path prefix
 * here would put it back in this bundle, whose own spec asserts that it appears
 * nowhere in the artifact. That revision made the browser runtime depend on a
 * host service, which the frozen client-only design forbids, and it has been
 * removed.
 *
 * The approved architecture carries the engine **inside that one script**: the
 * exact installed bytes, deterministically gzipped, base64-encoded, and inflated
 * and SHA-256 verified here on first use. The exception is narrow and explicit —
 * it covers this one binary, and it does **not** authorise embedding raw
 * uncompressed WASM base64, whose representation stays prohibited for the same
 * reason it always was: it is 2.6 times larger and carries no integrity story of
 * its own. Nothing in this module fetches anything, and there is no fallback of
 * any kind: a payload that does not decode to the exact reviewed binary is a
 * refusal, not a reason to reach for a URL.
 *
 * ## Why the runtime still verifies a payload that was built into it
 *
 * The digest here is not defending against a hostile network. It is a check that
 * the build transform did what it claimed: that the gzip decode, the inflate and
 * the base64 decode are correct end to end, that the payload was not corrupted in
 * the bundle, and that a future dependency bump cannot quietly install a different
 * engine than the one this renderer was written against. It runs once per session,
 * on the first workbook, and it is the same digest `scripts/xlsx-runtime-assets.ts`
 * refused to build without.
 */

import { setWasmSource } from '@extend-ai/react-xlsx'

import {
  XLSX_WASM_GZIP_BASE64,
  XLSX_WASM_RAW_BYTES,
  XLSX_WASM_SHA256,
} from 'virtual:dsa-xlsx-wasm-gzip'

/**
 * The public subpath `@extend-ai/react-xlsx` publishes its engine binary under.
 *
 * Recorded because it is the exact artifact the build reads and verifies; it is
 * not fetched from anywhere by this module.
 */
export const XLSX_WASM_ASSET_SUBPATH = '@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm'

/** Raised when a workbook is opened and no engine binary can be installed. */
export class XlsxWasmSourceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XlsxWasmSourceUnavailableError'
  }
}

/**
 * Raised when the embedded engine payload does not reproduce the reviewed binary.
 *
 * Every cause shares this type because every one of them is the same finding —
 * the runtime could not turn the bytes it carries into the engine it is supposed
 * to be — and every one of them fails closed in the same place.
 */
export class XlsxWasmIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XlsxWasmIntegrityError'
  }
}

/** Whether {@link installXlsxWasmSource} has supplied this session's bytes. */
let installed = false

/**
 * This session's engine initialization, created on the first workbook and reused
 * by every later one.
 *
 * A session-level singleton rather than a per-workbook step: decoding, inflating
 * and hashing 4.4 MB once per tab would be work whose result is identical every
 * time.
 */
let wasmInitialization: Promise<void> | null = null

/**
 * Install the engine bytes as this session's WASM source.
 *
 * The caller's buffer is copied before it is handed to the library, for the same
 * reason the workbook bytes are copied: `setWasmSource` keeps a reference, and a
 * source a caller can still mutate is not a source this plugin has validated. The
 * copy is made once per call and the library derives its worker copy from it.
 *
 * @param bytes - the exact `duke_sheets_wasm_bg.wasm` bytes.
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
 * Decode the embedded base64 payload into the compressed bytes it represents.
 *
 * One `atob` call over 2.2 million characters, then a linear fill: the payload is
 * small enough for the single call, and the fill avoids the several-times-larger
 * peak a `split`/`map`/`Array` chain would produce for the same result.
 *
 * @param base64 - the embedded payload.
 * @returns the gzip bytes.
 * @throws XlsxWasmIntegrityError when the payload is not valid base64.
 */
function decodeBase64Payload(base64: string): Uint8Array<ArrayBuffer> {
  let binary: string
  try {
    binary = atob(base64)
  } catch (cause: unknown) {
    throw new XlsxWasmIntegrityError(
      `the embedded XLSX engine payload is not valid base64: ${String(cause)}`,
    )
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * Inflate a gzip payload with the browser's own decompressor.
 *
 * `DecompressionStream` is a Web API this project already relies on elsewhere in
 * DSH, so no decompressor is added as a dependency. When it is absent the runtime
 * refuses rather than falling back to a script from anywhere.
 *
 * @param compressed - the gzip bytes.
 * @returns the decompressed bytes.
 * @throws XlsxWasmIntegrityError when no decompressor exists or the stream fails.
 */
async function inflateGzipPayload(
  compressed: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream === 'undefined') {
    throw new XlsxWasmIntegrityError(
      'this browser exposes no DecompressionStream, so the embedded XLSX engine cannot be inflated',
    )
  }
  try {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch (cause: unknown) {
    throw new XlsxWasmIntegrityError(
      `the embedded XLSX engine payload could not be inflated: ${String(cause)}`,
    )
  }
}

/**
 * Render a digest as lowercase hex.
 * @param digest - the raw digest bytes.
 * @returns the hex string.
 */
function toHex(digest: ArrayBuffer): string {
  let hex = ''
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Turn the embedded payload into this session's installed engine binary.
 *
 * @throws XlsxWasmIntegrityError when the payload does not reproduce the exact
 *   reviewed binary, in which case nothing is installed.
 */
async function initializeXlsxWasm(): Promise<void> {
  const compressed = decodeBase64Payload(XLSX_WASM_GZIP_BASE64)
  const raw = await inflateGzipPayload(compressed)

  if (raw.byteLength !== XLSX_WASM_RAW_BYTES) {
    throw new XlsxWasmIntegrityError(
      `the embedded XLSX engine is ${raw.byteLength} bytes, expected ${XLSX_WASM_RAW_BYTES}`,
    )
  }

  const digest = toHex(await crypto.subtle.digest('SHA-256', raw))
  if (digest !== XLSX_WASM_SHA256) {
    throw new XlsxWasmIntegrityError(
      `the embedded XLSX engine hashes to ${digest}, expected ${XLSX_WASM_SHA256}`,
    )
  }

  installXlsxWasmSource(raw)
}

/**
 * Start this session's engine initialization, or return the one already running.
 *
 * The promise is shared by every caller, so a second workbook, a parallel one, or
 * a resize that re-renders the first all wait on the same work. A failed attempt
 * clears the cache rather than caching its own rejection: nothing was installed,
 * so a later open is a fresh chance rather than a session that can never show a
 * spreadsheet again.
 *
 * @returns the shared initialization.
 */
function startInitialization(): Promise<void> {
  if (wasmInitialization === null) {
    const initialization = initializeXlsxWasm()
    wasmInitialization = initialization
    // A refusal is not cached: nothing was installed, so a later open is a fresh
    // chance rather than a session that can never show a spreadsheet again. The
    // handler is attached to the same promise the callers receive and returns
    // nothing, so it clears the cache without becoming the rejection they see.
    initialization.catch(() => {
      if (wasmInitialization === initialization) wasmInitialization = null
    })
  }
  return wasmInitialization
}

/**
 * Build the rejection an aborted caller receives.
 * @returns an `AbortError`.
 */
function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

/**
 * Wait for the shared initialization, unless this caller goes away first.
 *
 * The two lifetimes are deliberately separate. The payload belongs to the
 * session: a tab that is released while it is being read must not leave the
 * session without an engine, so the shared work always runs to completion. The
 * **waiting** belongs to the caller, so a released tab stops waiting immediately
 * and its renderer never mounts on a result it no longer wants.
 *
 * @param initialization - the shared initialization.
 * @param signal - the caller's lifecycle signal.
 * @returns the initialization's outcome, or an `AbortError`.
 */
function awaitInitialization(initialization: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(createAbortError())
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      reject(createAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    initialization.then(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/**
 * Ensure the renderer has an engine binary to parse with.
 *
 * Deliberately has no fallback. A URL would be a network request, a host route is
 * forbidden, and a CDN is out of the question; the only acceptable state is that
 * the embedded payload reproduced the exact reviewed binary. The first call does
 * the work — base64 decode, gzip inflate, length check, SHA-256 check, install —
 * and every later call returns the same promise.
 *
 * @param signal - the calling tab's lifecycle signal, honoured for the wait only.
 * @returns a promise that resolves once the engine is installed.
 * @throws XlsxWasmIntegrityError when the payload does not reproduce the binary.
 * @throws AbortError when `signal` aborts first.
 */
export function ensureXlsxWasmInitialized(signal?: AbortSignal): Promise<void> {
  const initialization = startInitialization()
  return signal === undefined ? initialization : awaitInitialization(initialization, signal)
}
