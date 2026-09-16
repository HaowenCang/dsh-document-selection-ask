/**
 * The shared OOXML archive preflight.
 *
 * DOCX, PPTX and XLSX are all ZIP archives, and all three are untrusted input.
 * Before any renderer is allowed to look at one, this module answers a single
 * question — *may this archive be enumerated at all* — and answers it from the
 * **central directory alone**. No entry's content is read, decompressed, parsed
 * or retained; `Entry.getData` is not called anywhere in this file, and no
 * writer, blob, object URL or temporary file exists at any point.
 *
 * That boundary is the module's reason to exist rather than an implementation
 * detail. The attacks a document preflight has to survive are properties of the
 * archive's *metadata* — a central directory with a million entries, an entry
 * whose declared expansion is a thousandfold, a name that resolves outside the
 * archive — and every one of them is visible before a byte of content is
 * touched. Reading content in order to discover whether content is safe would
 * mean performing the expensive, dangerous operation in order to decide whether
 * to perform it.
 *
 * The question it answers is deliberately **not** "is this a DOCX". A ZIP that
 * passes this gate is an archive whose metadata is within limits; whether it
 * contains `word/document.xml`, `ppt/presentation.xml` or `xl/workbook.xml`, and
 * whether those parts are well-formed XML, belongs to the format adapter that
 * understands that format. This module never opens `[Content_Types].xml`, never
 * parses XML, and never imports a renderer.
 *
 * **It returns nothing.** The verdict is `Promise<void>`: either the archive is
 * acceptable and the call resolves, or it is refused and the call rejects. No
 * `ZipReader`, no entry array and no central-directory object escapes, because
 * a preflight that handed back a live reader would be an archive session — and
 * the lifecycle of an archive session, including when its bytes may be read and
 * by which adapter, is a decision for the tasks that actually read OOXML parts.
 * Returning nothing keeps that decision open and keeps this module a gate.
 *
 * **Refusals are typed.** Every rejection is an {@link OoxmlPreflightError} with
 * a stable `code`, so a caller decides what to tell the reader by branching on
 * the code rather than by matching an English message. The one exception is
 * cancellation: an aborted `signal` rejects with an `AbortError`, because the
 * user cancelling is not a verdict about their file.
 */

import { Uint8ArrayReader, ZipReader } from '@zip.js/zip.js'

import { OoxmlPreflightError } from './errors.js'
import { DEFAULT_OOXML_LIMITS, validateOoxmlLimits, type OoxmlLimits } from './limits.js'
import { findUnsafePathReason } from './paths.js'

/**
 * The minimum an archive entry must expose to be validated.
 *
 * The preflight reads four facts per entry and nothing else. Stating that set
 * here, instead of accepting the full `Entry` union, is what makes the module's
 * input surface auditable: a reviewer can see that no content-reading member is
 * named. The four fields are the ones zip.js's own `EntryMetaData` publishes as
 * `filename`, `encrypted`, `compressedSize` and `uncompressedSize`.
 *
 * Every field is optional and typed `unknown`, which is the fail-closed seam
 * rather than a convenience. `EntryMetaData` declares the sizes as required
 * `number`s, but a required type is a compile-time claim about a library, not a
 * runtime fact about a file: a malformed central directory, a future release
 * that leaves a field unpopulated, or a value that does not fit a JavaScript
 * number can all reach this code. Declaring the fields as the library does would
 * turn "zip.js says this is a number" into "this is provably a number", and the
 * second statement is false. The declarations say what may arrive;
 * `requireDeclaredSize` and the path rules decide what is acceptable.
 */
export interface OoxmlEntryLike {
  /** The entry's name, as the central directory declares it. */
  readonly filename?: unknown
  /** Whether the entry's content is encrypted. */
  readonly encrypted?: unknown
  /** The entry's declared compressed size, in bytes. */
  readonly compressedSize?: unknown
  /** The entry's declared uncompressed size, in bytes. */
  readonly uncompressedSize?: unknown
}

/**
 * The minimum a reader must expose to be enumerated.
 *
 * The index signature is the fail-closed seam. zip.js declares
 * `compressedSize` and `uncompressedSize` as required `number`s, but a required
 * type is a compile-time claim about a library, not a runtime fact about a file:
 * a malformed central directory, a future release that leaves one field
 * unpopulated, or a value that does not fit a JavaScript number can all reach
 * this code. The index signature states that the reader cannot take those
 * declarations as proof, so every size is validated before it is compared.
 *
 * The two members are typed `unknown` rather than with their signatures, because
 * an index signature requires every property to be assignable to it and a
 * function is not assignable to `unknown`'s *value* shape only by accident of
 * variance. Reading them as `unknown` and checking them is also the honest
 * description of what happens: the reader arrives from a library boundary, and
 * nothing about it is known until it is inspected.
 */
export interface OoxmlArchiveReaderLike {
  /** Any member of the reader, of any shape, uninspected. */
  readonly [member: string]: unknown
}

/** The members this module needs from a reader, once they have been checked. */
interface EnumerableReader {
  /** Enumerate the archive's entries from its central directory. */
  readonly getEntries: () => Promise<unknown>
}

/** The member this module needs to release a reader, once it has been checked. */
interface ClosableReader {
  /** Release whatever the reader holds. */
  readonly close: () => Promise<unknown>
}

/**
 * Read a reader's `getEntries` member, or report that there is none.
 *
 * @param reader - the object that should be a reader.
 * @returns the bound method, or `null`.
 */
function asEnumerableReader(reader: OoxmlArchiveReaderLike): EnumerableReader | null {
  const getEntries: unknown = reader.getEntries
  return typeof getEntries === 'function' ? { getEntries: () => getEntries.call(reader) } : null
}

/**
 * Read a reader's `close` member, or report that there is none.
 *
 * @param reader - the object that should be a reader.
 * @returns the bound method, or `null`.
 */
function asClosableReader(reader: OoxmlArchiveReaderLike): ClosableReader | null {
  const close: unknown = reader.close
  return typeof close === 'function' ? { close: () => close.call(reader) } : null
}

/**
 * Check that a value the library described as an array of entries really is one.
 *
 * @param value - what `getEntries` resolved to.
 * @returns the entries, or `null` when the value is not an array.
 */
function asEntryArray(value: unknown): readonly OoxmlEntryLike[] | null {
  return Array.isArray(value) ? (value as readonly OoxmlEntryLike[]) : null
}

/**
 * Throw an `AbortError` when the caller's signal has been aborted.
 *
 * The platform's own `signal.throwIfAborted()` is deliberately not called. It
 * rethrows `signal.reason` verbatim, so a signal aborted with a plain string —
 * which `AbortController.abort(reason)` permits for any value — would surface a
 * `string` from a function whose contract says cancellation is an `AbortError`.
 * A caller that tests `error.name` would then see `undefined` and treat a
 * cancellation as an unknown failure. The reason is therefore inspected here and
 * normalized, which is the one behaviour this module needs that the platform's
 * helper does not provide.
 *
 * A caller-chosen reason that *is* an `AbortError` is rethrown unchanged, so an
 * application that passes its own reason keeps it.
 *
 * @param signal - the caller's cancellation signal, if any.
 * @throws the signal's own reason when it is an `AbortError`, otherwise an
 *   `AbortError`.
 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) {
    return
  }
  const reason: unknown = signal.reason
  if (typeof reason === 'object' && reason !== null && 'name' in reason && reason.name === 'AbortError') {
    throw reason
  }
  throw new DOMException('The OOXML archive preflight was aborted', 'AbortError')
}

/**
 * Name an entry in a refusal, when the archive declared a usable name for it.
 *
 * The error's `entryName` is `string | undefined`, so the value has to be
 * checked rather than forwarded: an entry whose name did not decode to text has
 * no name to report, and a coerced one would describe a file the archive does
 * not contain.
 *
 * @param entry - the entry being validated.
 * @returns the declared name, or `undefined` when there is not one.
 */
function declaredName(entry: OoxmlEntryLike): string | undefined {
  const filename: unknown = entry.filename
  return typeof filename === 'string' ? filename : undefined
}

/**
 * Read one declared size from an entry, refusing anything unusable.
 *
 * `undefined` and `null` are not treated as zero. A missing size is the whole
 * attack the fail-closed rule exists for: if an absent `compressedSize` became
 * `0`, the ratio of a genuinely enormous entry would be computed against a
 * denominator this code invented, and an absent `uncompressedSize` would
 * contribute nothing to the aggregate. Both would let a malformed archive past
 * the gate by making the gate's own arithmetic meaningless.
 *
 * @param entry - the entry being validated.
 * @param field - which declared size to read.
 * @returns the size, as a non-negative safe integer.
 * @throws OoxmlPreflightError with code `missing-metadata`.
 */
function requireDeclaredSize(
  entry: OoxmlEntryLike,
  field: 'compressedSize' | 'uncompressedSize',
): number {
  const value: unknown = entry[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new OoxmlPreflightError('missing-metadata', declaredName(entry))
  }
  return value
}

/**
 * Apply every per-entry rule to one entry.
 *
 * The order is chosen so that the refusal a reader sees is the most specific
 * true statement about the entry. An encrypted entry is reported as encrypted
 * even if its name is also unsafe; an unsafe name is reported before its sizes
 * are examined, because the name is what a diagnostic would have to print and a
 * name that cannot be trusted should not reach one. Directory entries are
 * validated exactly like file entries — they carry a name, an encryption flag
 * and sizes too, and a `../` directory entry is the same traversal as a `../`
 * file entry.
 *
 * @param entry - the entry being validated.
 * @param limits - the bounds to apply.
 */
function validateEntry(entry: OoxmlEntryLike, limits: OoxmlLimits): void {
  // Read once, as `unknown`, and establish what it is before any rule uses it.
  // The name is the value every refusal below reports, so a name that is not
  // text is a refusal rather than a value to coerce: `String(name)` would
  // invent a name the archive does not contain.
  const filename: unknown = entry.filename
  if (findUnsafePathReason(filename) !== null) {
    throw new OoxmlPreflightError('unsafe-path', typeof filename === 'string' ? filename : undefined)
  }
  if (typeof filename !== 'string') {
    // Unreachable: the rule above refuses everything that is not a string. It
    // is stated so that the name passed to every refusal below is provably text
    // rather than asserted to be.
    throw new OoxmlPreflightError('unsafe-path')
  }

  if (entry.encrypted === true) {
    throw new OoxmlPreflightError('encrypted-entry', filename)
  }

  const compressedSize = requireDeclaredSize(entry, 'compressedSize')
  const uncompressedSize = requireDeclaredSize(entry, 'uncompressedSize')

  if (uncompressedSize > limits.maxSingleUncompressedBytes) {
    throw new OoxmlPreflightError('entry-too-large', filename)
  }

  // The denominator is never zero: a compressed size of 0 stands for "no
  // compressed bytes are declared", and an entry that declares content while
  // declaring no compressed bytes has, by that fact alone, an unbounded ratio.
  // Dividing by `Math.max(1, …)` states that without producing `Infinity` or
  // `NaN`, both of which would make the comparison below quietly false.
  const ratio = uncompressedSize / Math.max(1, compressedSize)
  if (ratio > limits.maxCompressionRatio) {
    throw new OoxmlPreflightError('compression-ratio-too-high', filename)
  }
}

/**
 * Apply the archive-wide rules and then the per-entry rules.
 *
 * The aggregate is accumulated and checked **at every step** rather than
 * compared once at the end. A `reduce` that summed ten thousand declared sizes
 * before comparing would already have lost precision on an archive crafted to
 * push the total past `Number.MAX_SAFE_INTEGER`, and a total that has stopped
 * being a safe integer is no longer a quantity that can be compared with a
 * limit. Checking as the sum grows keeps every intermediate value exact.
 *
 * @param entries - every entry the archive declares, directories included.
 * @param limits - the bounds to apply.
 * @param signal - the caller's cancellation signal, checked between entries.
 */
function validateEntries(
  entries: readonly OoxmlEntryLike[],
  limits: OoxmlLimits,
  signal: AbortSignal | undefined,
): void {
  if (entries.length > limits.maxEntries) {
    throw new OoxmlPreflightError('too-many-entries')
  }

  let total = 0
  for (const entry of entries) {
    throwIfAborted(signal)
    validateEntry(entry, limits)

    const uncompressedSize = requireDeclaredSize(entry, 'uncompressedSize')
    total += uncompressedSize
    if (!Number.isSafeInteger(total)) {
      throw new OoxmlPreflightError('missing-metadata', declaredName(entry))
    }
    if (total > limits.maxTotalUncompressedBytes) {
      throw new OoxmlPreflightError('archive-too-large')
    }
  }
}

/**
 * Enumerate the archive's entries, mapping a parse failure to `invalid-archive`.
 *
 * The `try` block contains the library call and nothing else. That is the whole
 * point of the boundary: everything this module does with the result — the path
 * rules, the size rules, the ratio — sits outside it, so a `TypeError` from this
 * module's own code cannot be relabelled as a broken document. A reader that
 * reports a syntax error is reporting the caller's file; a bug in the loop that
 * reads its output is reporting this project, and the two must not share a code.
 *
 * An abort is checked first inside the handler, because zip.js reports
 * cancellation through the same `Error` channel as a parse failure and
 * cancellation is not a verdict about the archive.
 *
 * @param reader - the archive reader, already checked for an enumerable member.
 * @param signal - the caller's cancellation signal.
 * @returns the entries the archive declares.
 * @throws OoxmlPreflightError with code `invalid-archive`, or the signal's own
 *   abort reason.
 */
async function enumerateEntries(
  reader: EnumerableReader,
  signal: AbortSignal | undefined,
): Promise<readonly OoxmlEntryLike[]> {
  let listed: unknown
  try {
    listed = await reader.getEntries()
  } catch (error: unknown) {
    throwIfAborted(signal)
    throw new OoxmlPreflightError('invalid-archive')
  }

  // Outside the boundary above: a reader that resolves with something that is
  // not an entry array has not failed to parse the archive, it has broken the
  // library's own contract. Reporting that as a broken document would send the
  // reader looking for a problem with their file.
  const entries = asEntryArray(listed)
  if (entries === null) {
    throw new TypeError('the archive reader resolved with a value that is not an array of entries')
  }
  return entries
}

/**
 * Run the preflight against an archive reader that has already been created.
 *
 * This is the seam the unit suite drives. Production reaches it through
 * {@link preflightOoxml}, which owns the reader's construction and closes it;
 * the lifecycle rules below are testable only against a reader whose `close` can
 * be observed, and a test that had to construct a real `ZipReader` to make a
 * cleanup failure happen would be asserting on the library rather than on this
 * module.
 *
 * @param reader - an enumerable archive reader.
 * @param limits - the bounds to apply, validated by the caller.
 * @param signal - the caller's cancellation signal.
 * @throws OoxmlPreflightError for every archive rule, or the abort reason.
 */
export async function runOoxmlPreflight(
  reader: OoxmlArchiveReaderLike,
  limits: OoxmlLimits,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)

  const enumerable = asEnumerableReader(reader)
  if (enumerable === null) {
    throw new TypeError('the archive reader exposes no getEntries method')
  }

  const entries = await enumerateEntries(enumerable, signal)
  throwIfAborted(signal)
  validateEntries(entries, limits, signal)
}

/**
 * The archive reader this module builds, as the seam expects it.
 *
 * The cast exists because `ZipReader<unknown>` and `ZipReader<Uint8Array>` are
 * unrelated instantiations of the same class: their private state mentions the
 * type parameter, so neither is assignable to the other even though their
 * public members are identical. The runtime object satisfies the seam
 * structurally, and re-declaring the reader's public surface here to avoid one
 * cast would introduce a hand-maintained copy of a library's contract — the
 * thing `typecheck` exists to prevent. The cast is therefore stated once, at the
 * single point where the library meets the seam.
 *
 * @param reader - the reader constructed from the archive's own bytes.
 * @returns the same reader, as the seam's own shape.
 */
function asArchiveReader(reader: ZipReader<unknown>): OoxmlArchiveReaderLike {
  return reader as unknown as OoxmlArchiveReaderLike
}

/**
 * The archive reader this module constructs for one set of bytes.
 *
 * Two options are stated rather than defaulted.
 *
 * `filenameValidation: 'tolerant'` moves every path decision to
 * {@link findUnsafePathReason}, so that exactly one rule decides which names an
 * archive may carry. zip.js's `balanced` mode would reject an escaping name
 * before this module ever saw it, which makes the rule here look enforced while
 * the branch that applies it is never reached — the archive would be refused by
 * the library's rule, with the library's reason string, and a later reader of
 * this file could not tell whether the project's own rule still worked. The two
 * rules also differ in both directions: `balanced` additionally rejects a bare
 * `.` or empty segment, while this project additionally rejects every
 * drive-prefixed name. One rule, stated here, is what makes the contract
 * verifiable.
 *
 * `useWebWorkers: false` states the archive is enumerated on the calling thread.
 * Enumerating a central directory is arithmetic over bytes already in memory,
 * and a metadata-only gate must not depend on a worker asset the host's content
 * security policy may refuse to load — a preflight that cannot run would refuse
 * every document, or worse, be skipped.
 *
 * @param bytes - the archive's bytes, exactly as they were received.
 * @returns the reader.
 */
function createArchiveReader(bytes: Uint8Array<ArrayBuffer>): ZipReader<unknown> {
  return new ZipReader(new Uint8ArrayReader(bytes), {
    filenameValidation: 'tolerant',
    useWebWorkers: false,
  })
}

/**
 * Validate an OOXML archive's metadata before any renderer may read it.
 *
 * Resolves with nothing when the archive is acceptable, and rejects with an
 * {@link OoxmlPreflightError} carrying a stable `code` when it is not. The
 * bytes are read in place: no copy is taken, no entry is extracted, nothing is
 * written anywhere, and no request leaves the browser.
 *
 * The reader is closed on every path — acceptance, every refusal, and abort —
 * and a cleanup failure never replaces the verdict that was already reached. The
 * rules are asymmetric on purpose: when the archive has been refused or the call
 * was cancelled, that outcome is the caller's answer and a `close` failure is at
 * most a second fact about a reader nobody will use again; when the archive
 * passed, there is no verdict to protect, so a `close` failure propagates rather
 * than being swallowed. Discarding it there would leave a resource leak that no
 * caller could observe.
 *
 * @param bytes - the archive's bytes.
 * @param limits - the bounds to apply, defaulting to {@link DEFAULT_OOXML_LIMITS}.
 * @param signal - cancels the preflight. Rejects with an `AbortError`, not an
 *   {@link OoxmlPreflightError}.
 * @throws OoxmlPreflightError with code `invalid-limits`, `invalid-archive`,
 *   `too-many-entries`, `unsafe-path`, `encrypted-entry`, `missing-metadata`,
 *   `entry-too-large`, `archive-too-large` or `compression-ratio-too-high`.
 */
export async function preflightOoxml(
  bytes: Uint8Array<ArrayBuffer>,
  limits: OoxmlLimits = DEFAULT_OOXML_LIMITS,
  signal?: AbortSignal,
): Promise<void> {
  // Cancellation is checked before anything else, and before the reader exists,
  // so an already-cancelled call allocates nothing. It is also the more accurate
  // answer when both conditions hold: a caller whose tab has already closed has
  // cancelled the work, and the state of its limit object is no longer a fact
  // anyone is waiting for.
  throwIfAborted(signal)

  // The limits are checked next, before the bytes are touched. A caller that
  // passed unusable limits has asked a question this module cannot answer, and
  // answering it anyway — against a bound that was never applied — would be
  // worse than refusing.
  validateOoxmlLimits(limits)

  const reader = createArchiveReader(bytes)
  const closable = asClosableReader(asArchiveReader(reader))
  let resolved = false
  try {
    await runOoxmlPreflight(asArchiveReader(reader), limits, signal)
    resolved = true
  } catch (error: unknown) {
    // Rethrown unchanged. A single fact decides the cleanup policy below:
    // whether a verdict was reached. Every failure path — a refusal, a parse
    // error, an abort — leaves `resolved` false, and a failing `close` then
    // adds nothing the caller can act on while a blanket replacement would
    // erase the reason the archive was refused.
    throw error
  } finally {
    try {
      await closable?.close()
    } catch (closeError: unknown) {
      // Acceptance is the one case with no verdict to protect: there the
      // cleanup failure is the only fact there is, and it propagates rather
      // than being swallowed into an unobservable resource leak.
      if (resolved) {
        throw closeError
      }
    }
  }
}
