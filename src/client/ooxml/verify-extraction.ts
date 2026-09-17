/**
 * Generic OOXML extraction bounds verification gate.
 *
 * Enforces that actual decompressed byte streams match declared sizes and remain
 * strictly bounded within safe limits before any third-party parser (such as
 * docx-preview or JSZip) is permitted to process the archive.
 *
 * ## Architecture
 *
 * This verifier forms the second layer of the three-phase document security pipeline:
 * 1. Cheap metadata preflight (`preflightOoxml`): verifies central-directory sizes, counts, paths, encryption.
 * 2. Streaming extraction verification (`verifyOoxmlExtraction`): proves actual == declared by decompressing
 *    entries into a counting-only discard sink with immediate early-exit bounds.
 * 3. Format renderer: invokes third-party renderer in isolated staging DOM only after steps 1 & 2 succeed.
 *
 * ## Zero-retention contract
 *
 * The verifier decompresses each file entry strictly into a discarding `WritableStream`.
 * No decompressed chunks, byte arrays, blobs, or parsed representations are retained in memory.
 */

import { Uint8ArrayReader, ZipReader } from '@zip.js/zip.js'

import { OoxmlPreflightError } from './errors.js'
import { DEFAULT_OOXML_LIMITS, validateOoxmlLimits, type OoxmlLimits } from './limits.js'

/**
 * Throw an `AbortError` when the caller's signal has been aborted,
 * normalizing signal reason to match project conventions.
 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) {
    return
  }
  const reason: unknown = signal.reason
  if (typeof reason === 'object' && reason !== null && 'name' in reason && reason.name === 'AbortError') {
    throw reason
  }
  throw new DOMException('The OOXML extraction verification was aborted', 'AbortError')
}

/**
 * Verify actual decompressed byte output of all file entries in an OOXML archive.
 *
 * Performs streaming extraction into a discarding byte-counter sink:
 * - Rejects immediately when actual decompressed bytes exceed `declaredUncompressedSize`.
 * - Rejects when actual decompressed bytes are less than `declaredUncompressedSize` upon stream end.
 * - Rejects immediately if single-entry or aggregate decompressed bounds are breached.
 * - Validates entry integrity (CRC-32/signature) and overlapping entries via zip.js.
 * - Does not retain any decompressed content in memory.
 *
 * @param bytes - raw archive binary data.
 * @param limits - resource limits to enforce (defaults to {@link DEFAULT_OOXML_LIMITS}).
 * @param signal - optional abort signal controlling verification lifecycle.
 * @throws OoxmlPreflightError when an archive violates limits or is corrupted.
 * @throws AbortError when cancelled via AbortSignal.
 */
export async function verifyOoxmlExtraction(
  bytes: Uint8Array<ArrayBuffer>,
  limits: OoxmlLimits = DEFAULT_OOXML_LIMITS,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)
  validateOoxmlLimits(limits)

  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    filenameValidation: 'tolerant',
    useWebWorkers: false,
  })

  let resolved = false
  try {
    let entries: unknown
    try {
      entries = await reader.getEntries()
    } catch {
      throwIfAborted(signal)
      throw new OoxmlPreflightError('invalid-archive')
    }

    if (!Array.isArray(entries)) {
      throw new TypeError('the archive reader resolved with a value that is not an array of entries')
    }

    let actualArchiveBytes = 0

    for (const entry of entries) {
      throwIfAborted(signal)

      // Directory entries do not produce decompressed file content
      if (entry.directory === true) {
        continue
      }

      const filename: unknown = entry.filename
      const entryName = typeof filename === 'string' ? filename : undefined

      const declaredUncompressedSize: unknown = entry.uncompressedSize
      if (
        typeof declaredUncompressedSize !== 'number' ||
        !Number.isSafeInteger(declaredUncompressedSize) ||
        declaredUncompressedSize < 0
      ) {
        throw new OoxmlPreflightError('missing-metadata', entryName)
      }

      if (declaredUncompressedSize > limits.maxSingleUncompressedBytes) {
        throw new OoxmlPreflightError('entry-too-large', entryName)
      }

      let actualEntryBytes = 0

      // Bounded counting discard sink: tallies chunk sizes and immediately rejects on breach
      const sink = new WritableStream<Uint8Array>({
        write(chunk) {
          throwIfAborted(signal)
          const len = chunk.byteLength

          const nextEntry = actualEntryBytes + len
          if (!Number.isSafeInteger(nextEntry) || nextEntry > declaredUncompressedSize) {
            throw new OoxmlPreflightError('invalid-archive', entryName)
          }
          if (nextEntry > limits.maxSingleUncompressedBytes) {
            throw new OoxmlPreflightError('entry-too-large', entryName)
          }

          const nextArchive = actualArchiveBytes + len
          if (!Number.isSafeInteger(nextArchive)) {
            throw new OoxmlPreflightError('invalid-archive')
          }
          if (nextArchive > limits.maxTotalUncompressedBytes) {
            throw new OoxmlPreflightError('archive-too-large')
          }

          actualEntryBytes = nextEntry
          actualArchiveBytes = nextArchive
        },
      })

      try {
        await entry.getData(sink, {
          signal,
          useWebWorkers: false,
          checkSignature: true,
          checkOverlappingEntry: true,
        })
      } catch (error: unknown) {
        if (error instanceof OoxmlPreflightError) {
          throw error
        }
        throwIfAborted(signal)
        if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') {
          throw error
        }
        throw new OoxmlPreflightError('invalid-archive', entryName)
      }

      // Exact size invariant: actual output must not fall short of declared uncompressed size
      if (actualEntryBytes !== declaredUncompressedSize) {
        throw new OoxmlPreflightError('invalid-archive', entryName)
      }
    }

    resolved = true
  } finally {
    try {
      await reader.close()
    } catch (closeError: unknown) {
      if (resolved) {
        throw closeError
      }
    }
  }
}
