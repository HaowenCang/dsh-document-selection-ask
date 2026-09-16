/**
 * The resource limits the OOXML archive preflight enforces.
 *
 * The numbers live here, apart from the code that applies them, because two
 * audiences need them and neither should own them: the preflight reads them, and
 * the tests and the design record state them as a contract. A limit that drifted
 * inside a loop would be a security rule nobody could review.
 *
 * The units are chosen so that every comparison is exact. Entry counts and byte
 * sizes are compared against JavaScript numbers that the ZIP central directory
 * stores as 32- or 64-bit integers, so both must be safe integers; a fractional
 * or infinite bound would make the comparison meaningless rather than lenient.
 * The compression ratio is a quotient and is deliberately allowed to be
 * fractional — 2.5 is a rule that can be stated, and refusing it would be a
 * restriction this project never decided on.
 */

import { OoxmlPreflightError } from './errors.js'

/**
 * The bounds `preflightOoxml` applies to an archive's central directory.
 *
 * Sizes are in bytes and describe the archive's *declared* uncompressed sizes —
 * the numbers in the central directory — never the amount of data this process
 * has expanded. `maxCompressionRatio` is a quotient of two such declarations, so
 * a crafted archive that lies about its sizes is bounded by the same numbers
 * that a truthful one is.
 */
export interface OoxmlLimits {
  /** Maximum number of entries, directory entries included. */
  readonly maxEntries: number
  /** Maximum sum of all entries' declared uncompressed sizes, in bytes. */
  readonly maxTotalUncompressedBytes: number
  /** Maximum declared uncompressed size of any single entry, in bytes. */
  readonly maxSingleUncompressedBytes: number
  /** Maximum declared expansion of any single entry, as a multiple of its compressed size. */
  readonly maxCompressionRatio: number
}

/**
 * The limits this project applies to DOCX, PPTX and XLSX archives.
 *
 * These four numbers are the design's own, and the split between them answers
 * three different attacks. `maxEntries` bounds the metadata itself, because a
 * central directory of a million entries exhausts memory before a single byte of
 * content is read. The two byte bounds separate one enormous entry from many
 * moderate ones, which a single total would conflate. `maxCompressionRatio`
 * catches the remaining case: an archive whose declared sizes are small enough to
 * pass both byte bounds while its content becomes orders of magnitude larger on
 * expansion.
 */
export const DEFAULT_OOXML_LIMITS: OoxmlLimits = {
  maxEntries: 10_000,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxSingleUncompressedBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 200,
}

const INTEGER_LIMITS = [
  'maxEntries',
  'maxTotalUncompressedBytes',
  'maxSingleUncompressedBytes',
] as const

const RATIO_LIMIT = 'maxCompressionRatio'

/**
 * Apply one predicate to one field, refusing the whole limits object when it
 * fails.
 *
 * The parameter is typed `OoxmlLimits`, but that type is a claim rather than a
 * fact: these values arrive from a caller that may have built them from a
 * configuration file, a URL parameter or a JSON blob, none of which TypeScript
 * checks. They are therefore read as `unknown` and validated, because a bound
 * that is `undefined` or `NaN` silently disables the comparison it was supposed
 * to make — `size > NaN` is `false` for every size.
 *
 * The refusal is raised before any archive is parsed, which is the point: a
 * caller that passed unusable limits must not receive a verdict about their
 * document, because the verdict would have been computed against a rule that was
 * never applied.
 *
 * @param source - the object the caller passed.
 * @param field - the bound being checked.
 * @param accepts - whether the value is a usable bound.
 */
function requireLimit(
  source: OoxmlLimits,
  field: keyof OoxmlLimits,
  accepts: (value: number) => boolean,
): void {
  const fields: Readonly<Record<keyof OoxmlLimits, unknown>> = source
  const value = fields[field]
  if (typeof value !== 'number' || !accepts(value)) {
    throw new OoxmlPreflightError('invalid-limits')
  }
}

/**
 * Refuse a caller-supplied limits object that cannot bound anything.
 *
 * A count or byte bound must be a positive safe integer: zero and negatives
 * would refuse every archive including an empty one, and a value above
 * `Number.MAX_SAFE_INTEGER` cannot be compared against a size without losing
 * precision. The ratio must be a positive finite number, and may be fractional.
 *
 * `undefined` is not a usable limits object at this layer. The public entry point
 * substitutes {@link DEFAULT_OOXML_LIMITS} when the argument is absent, so a
 * field that is still missing here means the caller passed an object that claims
 * to be limits and is not one.
 *
 * @param limits - the caller's limits, if any.
 * @throws OoxmlPreflightError with code `invalid-limits`.
 */
export function validateOoxmlLimits(limits: OoxmlLimits): void {
  for (const field of INTEGER_LIMITS) {
    requireLimit(limits, field, (value) => Number.isSafeInteger(value) && value > 0)
  }
  requireLimit(limits, RATIO_LIMIT, (value) => Number.isFinite(value) && value > 0)
}
