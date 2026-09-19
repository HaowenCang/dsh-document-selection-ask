/**
 * The XLSX engine-binary runtime specification.
 *
 * ## What is under test
 *
 * `src/client/renderers/xlsx/wasm.ts` carries the Duke engine inside the client
 * bundle as a deterministic gzip of the exact installed WASM, base64-encoded.
 * Everything between that string and `setWasmSource(BufferSource)` is this
 * module's own work: base64 decode, gzip inflate, length check, SHA-256 check,
 * and the singleton that makes all of it happen once per session.
 *
 * The suite therefore asserts the pipeline's **observable effects** — which
 * platform calls ran, how many times, with what — rather than its output, because
 * a runtime that decoded nothing and a runtime that decoded correctly both end
 * with the same installed bytes. `atob`, `DecompressionStream` and
 * `crypto.subtle.digest` are the three seams the payload must cross, and each one
 * is asserted for both the success path and its failure mode.
 *
 * The virtual module is stubbed rather than aliased: the real payload is 2.2
 * million characters, and the properties under test are corrupted payloads,
 * wrong lengths and wrong digests, none of which the real one is. The real
 * artifact is asserted by `tests/unit/xlsx-bundle.spec.ts`.
 *
 * ## Why these are not jsdom cases
 *
 * The pipeline is platform API, not DOM: `Blob`, `DecompressionStream`, `Response`
 * and `crypto.subtle` are all Node globals here and all real. Running it in Node
 * exercises the same code the browser runs, with no stand-in for the parts that
 * matter.
 */

import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The payload the virtual module hands the runtime, mutable per case.
 *
 * `vi.hoisted` is what makes it reachable from the module factories below:
 * `vi.mock` calls are hoisted above the imports, so a factory closing over an
 * ordinary module-level binding would capture it before initialisation.
 */
const payload = vi.hoisted(() => ({
  base64: '',
  rawBytes: 0,
  sha256: '',
  setWasmSource: vi.fn<(source: unknown) => void>(),
}))

vi.mock('@extend-ai/react-xlsx', () => ({
  setWasmSource: (source: unknown) => {
    payload.setWasmSource(source)
  },
}))

vi.mock('virtual:dsa-xlsx-wasm-gzip', () => ({
  get XLSX_WASM_GZIP_BASE64(): string {
    return payload.base64
  },
  get XLSX_WASM_RAW_BYTES(): number {
    return payload.rawBytes
  },
  get XLSX_WASM_SHA256(): string {
    return payload.sha256
  },
}))

/** The engine bytes every valid case carries. */
const RAW = new Uint8Array(Array.from({ length: 2048 }, (_unused, index) => (index * 17 + 3) % 256))

/** The SHA-256 of {@link RAW}, lowercase hex. */
const RAW_SHA256 = createHash('sha256').update(RAW).digest('hex')

/** The gzip of {@link RAW}, base64-encoded — the payload the bundle carries. */
const RAW_GZIP_BASE64 = gzipSync(RAW, { level: 9 }).toString('base64')

/**
 * Install one payload as the one the virtual module publishes.
 * @param overrides - the fields to replace; the valid payload's values otherwise.
 */
function usePayload(overrides: Partial<{ base64: string; rawBytes: number; sha256: string }> = {}): void {
  payload.base64 = overrides.base64 ?? RAW_GZIP_BASE64
  payload.rawBytes = overrides.rawBytes ?? RAW.byteLength
  payload.sha256 = overrides.sha256 ?? RAW_SHA256
}

/**
 * Import the runtime against the payload currently installed.
 *
 * The module is reset first because its whole subject is module-level state: a
 * cached successful initialization from an earlier case would make the singleton
 * assertions below vacuous.
 *
 * @returns the freshly evaluated module.
 */
async function loadRuntime(): Promise<typeof import('../../src/client/renderers/xlsx/wasm.js')> {
  vi.resetModules()
  return await import('../../src/client/renderers/xlsx/wasm.js')
}

/** The bytes `setWasmSource` was last handed, as a byte array. */
function installedBytes(): Uint8Array {
  const source = payload.setWasmSource.mock.calls.at(-1)?.[0]
  if (source instanceof ArrayBuffer) return new Uint8Array(source)
  if (ArrayBuffer.isView(source)) {
    const view = source as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  }
  throw new Error('setWasmSource was not called with a BufferSource')
}

describe('XLSX engine-binary runtime', () => {
  beforeEach(() => {
    vi.resetModules()
    payload.setWasmSource.mockClear()
    usePayload()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does no decode, inflate, digest or install work until the first XLSX open', async () => {
    const atobSpy = vi.spyOn(globalThis, 'atob')
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest')

    // A counting subclass rather than `vi.spyOn` on the constructor: a spy is a
    // plain function and `new DecompressionStream(...)` would stop working, so
    // the case would fail for a reason that has nothing to do with laziness.
    const opened: CompressionFormat[] = []
    class CountingDecompressionStream extends DecompressionStream {
      constructor(format: CompressionFormat) {
        super(format)
        opened.push(format)
      }
    }
    vi.stubGlobal('DecompressionStream', CountingDecompressionStream)

    const runtime = await loadRuntime()

    // Importing the module is not initializing the engine: a session that never
    // opens a workbook allocates none of the 4.4 MB.
    expect(atobSpy).not.toHaveBeenCalled()
    expect(digestSpy).not.toHaveBeenCalled()
    expect(opened).toEqual([])
    expect(payload.setWasmSource).not.toHaveBeenCalled()
    expect(runtime.hasXlsxWasmSource()).toBe(false)

    await runtime.ensureXlsxWasmInitialized()

    expect(atobSpy).toHaveBeenCalledTimes(1)
    expect(opened).toEqual(['gzip'])
    expect(digestSpy).toHaveBeenCalledTimes(1)
    expect(payload.setWasmSource).toHaveBeenCalledTimes(1)
    expect(runtime.hasXlsxWasmSource()).toBe(true)
  })

  it('decodes the compressed payload into the exact engine bytes and installs them once', async () => {
    const runtime = await loadRuntime()
    await runtime.ensureXlsxWasmInitialized()

    expect(payload.setWasmSource).toHaveBeenCalledTimes(1)

    // The library's `sourceToWorkerSource` forwards an `ArrayBuffer` or a typed
    // array verbatim, so the public message path is satisfied by either; the
    // exact type is asserted rather than assumed.
    const source = payload.setWasmSource.mock.calls[0]?.[0]
    expect(source instanceof ArrayBuffer || ArrayBuffer.isView(source)).toBe(true)
    expect(installedBytes()).toEqual(RAW)
  })

  it('verifies the decompressed length and the SHA-256 before installing anything', async () => {
    const runtime = await loadRuntime()
    await runtime.ensureXlsxWasmInitialized()

    const bytes = installedBytes()
    expect(bytes.byteLength).toBe(payload.rawBytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(payload.sha256)
  })

  it('reuses one initialization for every later call', async () => {
    const atobSpy = vi.spyOn(globalThis, 'atob')
    const runtime = await loadRuntime()

    const first = runtime.ensureXlsxWasmInitialized()
    await first
    await runtime.ensureXlsxWasmInitialized()
    await runtime.ensureXlsxWasmInitialized()

    expect(atobSpy).toHaveBeenCalledTimes(1)
    expect(payload.setWasmSource).toHaveBeenCalledTimes(1)
  })

  it('shares one initialization across parallel callers', async () => {
    const atobSpy = vi.spyOn(globalThis, 'atob')
    const runtime = await loadRuntime()

    const first = runtime.ensureXlsxWasmInitialized()
    const second = runtime.ensureXlsxWasmInitialized()
    const third = runtime.ensureXlsxWasmInitialized()
    expect(second).toBe(first)

    await Promise.all([first, second, third])

    expect(atobSpy).toHaveBeenCalledTimes(1)
    expect(payload.setWasmSource).toHaveBeenCalledTimes(1)
  })

  it('refuses a decompressed length that is not the engine binary length', async () => {
    usePayload({ rawBytes: RAW.byteLength + 1 })
    const runtime = await loadRuntime()

    await expect(runtime.ensureXlsxWasmInitialized()).rejects.toBeInstanceOf(
      runtime.XlsxWasmIntegrityError,
    )
    expect(payload.setWasmSource).not.toHaveBeenCalled()
    expect(runtime.hasXlsxWasmSource()).toBe(false)
  })

  it('refuses bytes whose SHA-256 is not the engine binary digest', async () => {
    usePayload({ sha256: '0'.repeat(64) })
    const runtime = await loadRuntime()

    await expect(runtime.ensureXlsxWasmInitialized()).rejects.toBeInstanceOf(
      runtime.XlsxWasmIntegrityError,
    )
    expect(payload.setWasmSource).not.toHaveBeenCalled()
  })

  it('refuses a corrupted gzip payload', async () => {
    // Valid base64, valid gzip header, corrupt body: the inflate itself fails.
    const corrupted = Uint8Array.from(gzipSync(RAW, { level: 9 }))
    const target = corrupted.length - 5
    corrupted[target] = (corrupted[target] ?? 0) ^ 0xff
    usePayload({ base64: Buffer.from(corrupted).toString('base64') })

    const runtime = await loadRuntime()
    await expect(runtime.ensureXlsxWasmInitialized()).rejects.toBeInstanceOf(
      runtime.XlsxWasmIntegrityError,
    )
    expect(payload.setWasmSource).not.toHaveBeenCalled()
  })

  it('refuses a payload that is not base64 at all', async () => {
    usePayload({ base64: 'not base64 !!!' })
    const runtime = await loadRuntime()

    await expect(runtime.ensureXlsxWasmInitialized()).rejects.toBeInstanceOf(
      runtime.XlsxWasmIntegrityError,
    )
    expect(payload.setWasmSource).not.toHaveBeenCalled()
  })

  it('fails closed when the browser exposes no gzip decompressor', async () => {
    vi.stubGlobal('DecompressionStream', undefined)
    const runtime = await loadRuntime()

    await expect(runtime.ensureXlsxWasmInitialized()).rejects.toBeInstanceOf(
      runtime.XlsxWasmIntegrityError,
    )
    expect(payload.setWasmSource).not.toHaveBeenCalled()
  })

  it('never reaches for the network when the payload cannot be used', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    usePayload({ sha256: '1'.repeat(64) })

    const runtime = await loadRuntime()
    await expect(runtime.ensureXlsxWasmInitialized()).rejects.toBeInstanceOf(
      runtime.XlsxWasmIntegrityError,
    )

    // There is no CDN, no host route and no `fetch(data:)` fallback: a payload
    // that does not verify is a payload that is not used.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(payload.setWasmSource).not.toHaveBeenCalled()
  })

  it('rejects only the aborted caller and still completes the shared initialization', async () => {
    const runtime = await loadRuntime()
    const controller = new AbortController()

    const waiting = runtime.ensureXlsxWasmInitialized(controller.signal)
    controller.abort()

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(payload.setWasmSource).not.toHaveBeenCalled()

    // The global initialization is not a tab's: a tab that goes away while the
    // payload is being read must not leave the session without an engine.
    await runtime.ensureXlsxWasmInitialized()
    expect(payload.setWasmSource).toHaveBeenCalledTimes(1)
    expect(installedBytes()).toEqual(RAW)
  })

  it('rejects immediately for a caller whose signal is already aborted', async () => {
    const runtime = await loadRuntime()
    const controller = new AbortController()
    controller.abort()

    await expect(runtime.ensureXlsxWasmInitialized(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(payload.setWasmSource).not.toHaveBeenCalled()
  })

  it('retries after a failed initialization instead of caching the refusal forever', async () => {
    usePayload({ sha256: '2'.repeat(64) })
    const runtime = await loadRuntime()

    await expect(runtime.ensureXlsxWasmInitialized()).rejects.toBeInstanceOf(
      runtime.XlsxWasmIntegrityError,
    )

    usePayload()
    await runtime.ensureXlsxWasmInitialized()

    expect(payload.setWasmSource).toHaveBeenCalledTimes(1)
    expect(installedBytes()).toEqual(RAW)
    expect(runtime.hasXlsxWasmSource()).toBe(true)
  })
})
