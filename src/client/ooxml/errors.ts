/**
 * The failure vocabulary of the OOXML archive preflight.
 *
 * `preflightOoxml` is a security gate, so its refusals have to be decidable by
 * a caller that will not read English. Every rejection therefore carries a
 * `code` from a closed union rather than a message a caller could only match by
 * substring, and the code names the rule that fired rather than the library that
 * noticed it.
 *
 * Two properties of this type are load-bearing.
 *
 * **The union is closed and each member is a distinct rule.** A caller that
 * wants to explain a refusal to the reader — "this file is encrypted", "this
 * file expands too much" — branches on the code and gets an exhaustive check
 * from the compiler. A `reason: string` would move that decision to runtime and
 * make every caller's handling unverifiable.
 *
 * **No member describes an empty document.** A ZIP that passed the gate but
 * holds no entry is not a preflight failure: whether an archive is a well-formed
 * DOCX, PPTX or XLSX is the question its own format adapter answers, and this
 * module deliberately does not answer it. `missing-metadata` is about an entry's
 * *numbers* being unreadable, not about the document being empty.
 *
 * **An abort is not a preflight failure.** Cancellation is the caller's own
 * request, not a property of the bytes, so it leaves this vocabulary entirely
 * and surfaces as an `AbortError` (see `preflight.ts`).
 */

/**
 * Why an archive was refused.
 *
 * `invalid-archive` is the only member that reports a *parse* failure; every
 * other member is a rule this project states about an archive it could read.
 * Keeping them apart is what stops "the library could not open this" and "this
 * project will not open this" from arriving at the same branch.
 */
export type OoxmlPreflightErrorCode =
  /** The bytes are not a ZIP archive this reader can enumerate. */
  | 'invalid-archive'
  /** More entries than `maxEntries`. Directory entries are counted too. */
  | 'too-many-entries'
  /** One entry declares more uncompressed bytes than `maxSingleUncompressedBytes`. */
  | 'entry-too-large'
  /** The declared uncompressed sizes sum above `maxTotalUncompressedBytes`. */
  | 'archive-too-large'
  /** One entry's declared expansion exceeds `maxCompressionRatio`. */
  | 'compression-ratio-too-high'
  /** A name the archive may not hold: absolute, traversing, empty or NUL-bearing. */
  | 'unsafe-path'
  /** An entry whose content is encrypted, which v1 does not support. */
  | 'encrypted-entry'
  /** An entry whose size fields are missing, negative, fractional or unsafe. */
  | 'missing-metadata'
  /** The caller's own limits are not usable, so no archive rule could be applied. */
  | 'invalid-limits'

/**
 * A refusal produced by the OOXML archive preflight.
 *
 * The error carries no document content and no archive bytes: `entryName` is the
 * entry's own central-directory name, which is metadata the archive publishes
 * and which a diagnostic surface needs in order to name the offending entry.
 * Nothing read out of an entry's data is ever attached, because nothing is ever
 * read out of it.
 */
export class OoxmlPreflightError extends Error {
  /** The rule that refused the archive. Stable across releases of this module. */
  readonly code: OoxmlPreflightErrorCode

  /**
   * The central-directory name of the entry the rule applied to, when the rule
   * applied to one entry. Absent for archive-wide rules such as
   * `too-many-entries`, `archive-too-large` and `invalid-archive`.
   *
   * The name is reported exactly as the archive declares it, including a name
   * this module has just refused for being unsafe. It is never normalized,
   * rewritten or truncated: the value is evidence about the input, and a
   * "repaired" name would describe a file the archive does not contain.
   */
  readonly entryName?: string

  /**
   * Create a refusal.
   * @param code - the rule that fired.
   * @param entryName - the entry the rule applied to, when it applied to one.
   */
  constructor(code: OoxmlPreflightErrorCode, entryName?: string) {
    super(entryName === undefined ? code : `${code}: ${entryName}`)
    this.name = 'OoxmlPreflightError'
    this.code = code
    if (entryName !== undefined) {
      this.entryName = entryName
    }
  }
}
