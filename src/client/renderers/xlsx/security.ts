/**
 * XLSX relationship security policy and external resource gating.
 *
 * Inspects all relationship XML definitions before any spreadsheet parsing
 * or rendering occurs.
 *
 * ## Policy
 * - Fail-closed policy for `TargetMode="External"`.
 * - ONLY external relationships with recognized `.../hyperlink` type are permitted.
 * - Hyperlink targets must start with `http://`, `https://`, or `mailto:`.
 *   Targets starting with `javascript:`, `data:`, `file:`, etc., are rejected.
 * - All other external relationship types (external images, external workbooks
 *   via externalLink, external OLE/data) immediately reject document rendering.
 * - Malformed relationship XML immediately rejects document rendering.
 *
 * ## Reader options
 *
 * {@link XLSX_RELATIONSHIP_READER_OPTIONS} states the two integrity checks this
 * scan runs under, by name, so they can be compared with the shared OOXML
 * verifier's own policy (`verifyOoxmlExtraction`) rather than inferred from the
 * library's defaults. `checkSignature` is deliberately absent: zip.js documents
 * it as a deprecated alias of `checkCrc32`, and a gate whose integrity policy is
 * spelled with a deprecated name is a gate whose policy cannot be reviewed.
 *
 * ## Cancellation and cleanup
 *
 * A cancelled scan rejects with an `AbortError`. Returning quietly would report
 * a security check that never finished as one that passed, which is the one
 * outcome a gate must not produce.
 *
 * The reader is released on every path, and the cleanup failure never replaces
 * the verdict: when the scan refused the archive or was cancelled, that outcome
 * is what the caller acts on, and a `close` failure is at most a second fact
 * about a reader nobody will use again. When the scan accepted the archive there
 * is no verdict to protect, so a `close` failure propagates rather than being
 * swallowed into an unobservable resource leak. This is the same asymmetry the
 * shared preflight and extraction verifier apply.
 */

import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js'

const ALLOWED_EXTERNAL_HYPERLINK_RELATIONSHIP_TYPES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink',
])

const SAFE_HYPERLINK_SCHEMES = /^(?:https?:|mailto:)/i

/**
 * The integrity and execution options every XLSX relationship read runs under.
 *
 * Stated as one value rather than inline so the policy is a single reviewable
 * object, and so a spec can pin it against the shared verifier's policy. All
 * three members are deliberate.
 *
 * `checkCrc32` states the integrity rule by its current name; `checkSignature`
 * is zip.js's deprecated alias for it, and a gate whose policy is spelled with a
 * deprecated name is a gate whose policy cannot be reviewed.
 *
 * `checkOverlappingEntry` refuses an archive whose local headers describe
 * overlapping content, which is the shape a "two entries, one payload" archive
 * takes.
 *
 * `useWebWorkers: false` keeps the scan on the calling thread. It is not a
 * performance statement: zip.js's default is to inflate and CRC-check through a
 * `Blob` codec worker, so leaving it unset made this security gate spawn a
 * worker *before* it had decided the archive was safe, and a gate that cannot
 * run — a content security policy that refuses blob workers — would either
 * refuse every document or, worse, be skipped. The shared extraction verifier
 * states the same option for the same reason, and the two gates must agree.
 */
export const XLSX_RELATIONSHIP_READER_OPTIONS = {
  checkCrc32: true,
  checkOverlappingEntry: true,
  useWebWorkers: false,
} as const

export class XlsxRelationshipSecurityError extends Error {
  readonly target: string
  readonly type: string

  constructor(message: string, target = '', type = '') {
    super(message)
    this.name = 'XlsxRelationshipSecurityError'
    this.target = target
    this.type = type
  }
}

function isAllowedExternalHyperlink(type: string, target: string): boolean {
  if (!ALLOWED_EXTERNAL_HYPERLINK_RELATIONSHIP_TYPES.has(type.trim())) {
    return false
  }
  const trimmedTarget = target.trim()
  if (!SAFE_HYPERLINK_SCHEMES.test(trimmedTarget)) {
    return false
  }
  return true
}

export function assertSafeXlsxRelationshipXml(xmlString: string): void {
  if (!xmlString || !xmlString.trim()) {
    return
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlString, 'application/xml')

  const parserError = doc.querySelector('parsererror')
  if (parserError !== null) {
    throw new XlsxRelationshipSecurityError('Malformed relationship XML in XLSX package')
  }

  let rels = doc.getElementsByTagNameNS('*', 'Relationship')
  if (rels.length === 0) {
    rels = doc.getElementsByTagName('Relationship')
  }

  for (let i = 0; i < rels.length; i += 1) {
    const rel = rels[i]!
    const targetMode = rel.getAttribute('TargetMode')

    if (targetMode !== null && targetMode.trim().toLowerCase() === 'external') {
      const type = (rel.getAttribute('Type') ?? '').trim()
      const target = (rel.getAttribute('Target') ?? '').trim()

      if (!isAllowedExternalHyperlink(type, target)) {
        throw new XlsxRelationshipSecurityError(
          `Disallowed external relationship in XLSX: Type="${type}", Target="${target}"`,
          target,
          type,
        )
      }
    }
  }
}

/**
 * The minimum an archive entry must expose to be scanned.
 *
 * The two members are the ones this module uses and no others: a name to decide
 * whether the entry is a relationships part, and a content reader to obtain its
 * text. Stating that set here is what makes the scan's input surface auditable.
 */
export interface XlsxRelationshipEntryLike {
  /** The entry's name, as the central directory declares it. */
  readonly filename?: unknown
  /** Whether the entry carries no content. */
  readonly directory?: unknown
  /** Read the entry's content through a writer, verifying it as it is read. */
  readonly getData?: unknown
}

/**
 * The minimum a reader must expose to be scanned.
 *
 * `getEntries` and `close` are the whole surface. `getEntries` is typed
 * `unknown` because the value arrives from a library boundary and nothing about
 * it is proved until it is inspected; `close` is optional because the cleanup
 * policy is stated against a reader that may or may not be releasable.
 */
export interface XlsxRelationshipReaderLike {
  /** Enumerate the archive's entries from its central directory. */
  readonly getEntries?: unknown
  /** Release whatever the reader holds. */
  readonly close?: unknown
}

/** An entry once its members have been checked. */
interface ScannableEntry {
  /** The declared name. */
  readonly filename: string
  /**
   * Read the entry's text under the scan's own options.
   * @param options - the integrity and execution options for this read.
   * @returns the entry's text.
   */
  readonly readText: (options: Record<string, unknown>) => Promise<string>
}

/**
 * Read one entry's name and content reader, or report that it is not scannable.
 * @param value - one member of the array `getEntries` resolved to.
 * @returns the entry, or `null` when it cannot be scanned.
 */
function asScannableEntry(value: unknown): ScannableEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const entry = value as XlsxRelationshipEntryLike
  if (typeof entry.filename !== 'string') return null
  const getData: unknown = entry.getData
  if (typeof getData !== 'function') return null
  return {
    filename: entry.filename,
    readText: (options: Record<string, unknown>) =>
      (
        getData as (writer: TextWriter, options?: Record<string, unknown>) => Promise<string>
      ).call(entry, new TextWriter(), options),
  }
}

/**
 * Throw an `AbortError` when the caller's signal has been aborted.
 *
 * The reason is inspected and normalized rather than rethrown verbatim, so a
 * signal aborted with a plain string still surfaces an error whose `name` is
 * `AbortError`. A caller that branches on `error.name` would otherwise read a
 * cancellation as an unknown failure.
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
  throw new DOMException('The XLSX relationship scan was aborted', 'AbortError')
}

/**
 * Scan an archive reader for disallowed external relationships.
 *
 * This is the seam the security suite drives. Production reaches it through
 * {@link assertSafeXlsxRelationships}, which owns the reader's construction; the
 * cancellation and cleanup rules are testable only against a reader whose
 * entries and `close` can be driven, and a test that had to build a corrupt
 * archive to make a cleanup failure happen would be asserting on zip.js rather
 * than on this module.
 *
 * Cancellation is checked before the archive is enumerated, between entries, and
 * after each entry's content is read, because each is a distinct point at which
 * the tab that asked for the scan may have gone away.
 *
 * @param reader - an enumerable, closable archive reader.
 * @param signal - the caller's cancellation signal.
 * @throws XlsxRelationshipSecurityError for every policy refusal.
 * @throws AbortError when cancelled.
 */
export async function runXlsxRelationshipScan(
  reader: XlsxRelationshipReaderLike,
  signal?: AbortSignal,
): Promise<void> {
  const getEntries: unknown = reader.getEntries
  if (typeof getEntries !== 'function') {
    throw new TypeError('the XLSX relationship reader exposes no getEntries method')
  }
  const close: unknown = reader.close

  let resolved = false
  try {
    // Inside the `try`, not before it: the reader was handed to this function
    // already constructed, so refusing without releasing it would leak the
    // archive session of a document nobody is going to render.
    throwIfAborted(signal)

    const listed: unknown = await (getEntries as () => Promise<unknown>).call(reader)
    throwIfAborted(signal)

    if (!Array.isArray(listed)) {
      throw new TypeError('the XLSX relationship reader resolved with a value that is not an array')
    }

    for (const candidate of listed) {
      throwIfAborted(signal)

      const entry = asScannableEntry(candidate)
      if (entry === null) continue
      if (entry.filename.endsWith('.rels') === false) continue
      if ((candidate as XlsxRelationshipEntryLike).directory === true) continue

      const xml = await entry.readText(
        signal === undefined
          ? { ...XLSX_RELATIONSHIP_READER_OPTIONS }
          : { ...XLSX_RELATIONSHIP_READER_OPTIONS, signal },
      )
      throwIfAborted(signal)
      assertSafeXlsxRelationshipXml(xml)
    }

    resolved = true
  } finally {
    if (typeof close === 'function') {
      try {
        await (close as () => Promise<unknown>).call(reader)
      } catch (closeError: unknown) {
        if (resolved) {
          throw closeError
        }
      }
    }
  }
}

/**
 * Scan all `.rels` entries in an XLSX archive and enforce external resource policy.
 *
 * @param bytes - the archive's bytes, exactly as validated.
 * @param signal - the caller's cancellation signal.
 * @throws XlsxRelationshipSecurityError for every policy refusal.
 * @throws AbortError when cancelled.
 */
export async function assertSafeXlsxRelationships(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { ...XLSX_RELATIONSHIP_READER_OPTIONS })
  await runXlsxRelationshipScan(reader as unknown as XlsxRelationshipReaderLike, signal)
}
