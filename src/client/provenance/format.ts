/**
 * Provenance formatting.
 *
 * A provenance line answers "where did this quoted text come from?" in the terms
 * the source format actually has, and the wording is deliberately not uniform.
 * A PDF page range and a DOCX page range are different claims — the first is
 * document pagination, the second is pagination this browser produced — so the
 * rendered case is worded as a rendered page and never borrows the authority of
 * the source case. A single line or page prints one number instead of a range of
 * one, because a range of one reads as a defect rather than as precision.
 *
 * The formatter assumes an adapter built the location correctly and refuses the
 * ones that cannot be printed honestly: zero, negative, fractional or inverted
 * bounds, an unnamed sheet, an empty file name. Throwing is the point. A
 * formatter that silently repaired an inverted range, or emitted page zero, would
 * ship a plausible-looking citation for a selection nothing can locate, and the
 * failure would surface as a wrong answer rather than as an error. Capture-time
 * rejections (`too-large`, `empty-after-normalization`) belong to the capture
 * path; a malformed location is a programming error.
 *
 * Every user-visible literal in this module is written as `\u` escapes rather
 * than raw CJK text, so the exact code points are visible in review and cannot be
 * altered by an editor that rewrites the file. The expected strings in
 * `tests/unit/provenance/format.spec.ts` use the same escapes.
 */

import type { SelectionLocation, SelectionSnapshot } from '../selection/types.js'

/** `–` U+2013: the en-dash in both range forms; a hyphen would read as subtraction. */
const RANGE_SEPARATOR = '\u2013'

/** Opening bracket of the provenance line: `[`. */
const LINE_OPEN = '['

/** Closing bracket of the provenance line: `]`. */
const LINE_CLOSE = ']'

/** `：` U+FF1A, the full-width colon that separates label from value. */
const COLON = '\uff1a'

/** `，` U+FF0C, the full-width comma that separates file name from location. */
const COMMA = '\uff0c'

/** `第` U+7B2C, the ordinal marker introduced by every numeric range. */
const ORDINAL = '\u7b2c'

/** `来源` U+6765 U+6E90, the provenance label. */
const SOURCE_LABEL = '\u6765\u6e90'

/** `行` U+884C, the unit for source line ranges. */
const LINE_NOUN = '\u884c'

/** `页` U+9875, the unit for document pages. */
const PAGE_NOUN = '\u9875'

/** `渲染` U+6E32 U+67D3: marks a page range this browser produced. */
const RENDERED = '\u6e32\u67d3'

/** `张幻灯片` U+5F20 U+5E7B U+706F U+7247, the unit for slides. */
const SLIDE_NOUN = '\u5f20\u5e7b\u706f\u7247'

/** `个单元格` U+4E2A U+5355 U+5143 U+683C, the unit for cells in diagnostics. */
const CELL_NOUN = '\u4e2a\u5355\u5143\u683c'

/** `文档` U+6587 U+6863, the unit for a whole-document selection. */
const DOCUMENT_NOUN = '\u6587\u6863'

/** Terminal nouns per location kind, with the rendered variant kept distinct. */
const RANGE_NOUN: Readonly<Record<SelectionLocation['kind'], string>> = {
  lines: LINE_NOUN,
  pages: PAGE_NOUN,
  slides: SLIDE_NOUN,
  cells: CELL_NOUN,
  document: DOCUMENT_NOUN,
}

/** Label used in diagnostics and in error messages; ASCII so logs stay greppable. */
const LOCATION_LABEL: Readonly<Record<SelectionLocation['kind'], string>> = {
  lines: 'lines',
  pages: 'pages',
  slides: 'slides',
  cells: 'cells',
  document: 'document',
}

/**
 * Render `第 N 行` for a single bound and `第 N–M 行` for a span.
 * @param start - inclusive first bound.
 * @param end - inclusive last bound.
 * @param noun - the terminal noun for the unit.
 * @returns the range text.
 */
function formatNumberRange(start: number, end: number, noun: string): string {
  return start === end
    ? `${ORDINAL} ${start} ${noun}`
    : `${ORDINAL} ${start}${RANGE_SEPARATOR}${end} ${noun}`
}

/**
 * Compile-time guard for an unhandled location variant.
 * @param value - the value that should be `never`.
 * @returns never; throws if a new variant reaches an exhaustive switch.
 */
function assertNever(value: never): never {
  throw new Error(`Unhandled selection location: ${JSON.stringify(value)}`)
}

/**
 * Reject an empty or whitespace-only required string.
 * @param value - the candidate text.
 * @param message - the error message to raise.
 */
function assertNonEmpty(value: string, message: string): void {
  if (value.trim() === '') throw new RangeError(message)
}

/**
 * Reject a range bound that cannot be printed as a positive inclusive bound.
 * @param label - location label used in the error message.
 * @param value - the candidate bound.
 * @param name - `start` or `end`, for the error message.
 */
function assertPositiveInteger(label: string, value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`Invalid selection location: ${label} ${name} must be a positive integer, received ${value}`)
  }
}

/**
 * Reject an inverted range.
 * @param label - location label used in the error message.
 * @param start - the range start.
 * @param end - the range end.
 * @param describe - the already computed location description.
 */
function assertNotInverted(label: string, start: number, end: number, describe: string): void {
  if (start > end) {
    throw new RangeError(`Invalid selection location: ${label} start exceeds end (${describe})`)
  }
}

/**
 * Describe a location compactly for diagnostics and error messages.
 * @param location - the location to describe.
 * @returns a stable single-line ASCII description, e.g. `pages 4-3`.
 */
export function describeLocation(location: SelectionLocation): string {
  const label = LOCATION_LABEL[location.kind]
  switch (location.kind) {
    case 'lines':
    case 'pages':
    case 'slides':
      return `${label} ${location.start}-${location.end}`
    case 'cells':
      return `${label} ${location.sheet}!${location.range}`
    case 'document':
      return label
  }
}

/**
 * Build the provenance line for a captured selection.
 *
 * @param snapshot - the captured selection; only its file name and location are read.
 * @returns a bracketed provenance line, for example `[来源：paper.pdf，第 3–4 页]`.
 * @throws RangeError when the file name is empty or the location violates the
 * documented selection contract.
 */
export function formatProvenance(snapshot: SelectionSnapshot): string {
  const { fileName, location } = snapshot
  const label = LOCATION_LABEL[location.kind]
  const description = describeLocation(location)

  assertNonEmpty(fileName, `Invalid selection location: empty file name (${description})`)

  switch (location.kind) {
    case 'lines':
      assertPositiveInteger(label, location.start, 'start')
      assertPositiveInteger(label, location.end, 'end')
      assertNotInverted(label, location.start, location.end, description)
      return `${LINE_OPEN}${SOURCE_LABEL}${COLON}${fileName}${COMMA}${formatNumberRange(location.start, location.end, RANGE_NOUN.lines)}${LINE_CLOSE}`

    case 'pages':
      assertPositiveInteger(label, location.start, 'start')
      assertPositiveInteger(label, location.end, 'end')
      assertNotInverted(label, location.start, location.end, description)
      return `${LINE_OPEN}${SOURCE_LABEL}${COLON}${fileName}${COMMA}${formatNumberRange(location.start, location.end, location.fidelity === 'rendered' ? RENDERED + PAGE_NOUN : PAGE_NOUN)}${LINE_CLOSE}`

    case 'slides':
      assertPositiveInteger(label, location.start, 'start')
      assertPositiveInteger(label, location.end, 'end')
      assertNotInverted(label, location.start, location.end, description)
      return `${LINE_OPEN}${SOURCE_LABEL}${COLON}${fileName}${COMMA}${formatNumberRange(location.start, location.end, RANGE_NOUN.slides)}${LINE_CLOSE}`

    case 'cells':
      assertNonEmpty(location.sheet, `Invalid selection location: empty sheet name (${description})`)
      assertNonEmpty(location.range, `Invalid selection location: empty cell range (${description})`)
      return `${LINE_OPEN}${SOURCE_LABEL}${COLON}${fileName}${COMMA}${location.sheet}!${location.range}${LINE_CLOSE}`

    case 'document':
      return `${LINE_OPEN}${SOURCE_LABEL}${COLON}${fileName}${LINE_CLOSE}`

    default:
      return assertNever(location)
  }
}
