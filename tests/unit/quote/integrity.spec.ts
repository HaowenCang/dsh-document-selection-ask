/**
 * Code-point integrity check for the user-visible strings.
 *
 * The provenance wording and the question suffix are contracts, and both are
 * Chinese text. Comparing them as literals would assume that the editor which
 * wrote the source and the editor which wrote the expectation produced identical
 * bytes — the assumption that fails silently, because a dropped or duplicated
 * code unit inside a CJK string still reads as plausible Chinese and still passes
 * a visual diff. That failure mode was observed while writing this module.
 *
 * Every expectation here is therefore a number, every inspected value is built
 * by the production modules, and the expectations are composed from the named
 * code-point groups rather than sliced by hand, so an off-by-one in a test cannot
 * masquerade as a defect in the implementation.
 */

import { describe, expect, it } from 'vitest'

import { formatProvenance } from '../../../src/client/provenance/format.js'
import { SELECTION_QUESTION_SUFFIX, formatSelectionForDraft } from '../../../src/client/quote/format-selection.js'
import { snapshot } from '../selection/snapshot.js'

/** `请针对以上选中内容回答：` */
const QUESTION_TEXT = String.fromCodePoint(
  35831, 38024, 23545, 20197, 19978, 36873, 20013, 20869, 23481, 22238, 31572, 65306,
)

/** `来源` */
const SOURCE_LABEL = String.fromCodePoint(26469, 28304)
/** `：` */
const COLON = String.fromCodePoint(65306)
/** `，` */
const COMMA = String.fromCodePoint(65292)
/** `第` */
const ORDINAL = String.fromCodePoint(31532)
/** `–` */
const DASH = String.fromCodePoint(8211)
/** `行` */
const LINE_NOUN = String.fromCodePoint(34892)
/** `页` */
const PAGE_NOUN = String.fromCodePoint(39029)
/** `渲染` */
const RENDERED = String.fromCodePoint(28210, 26579)
/** `张幻灯片` */
const SLIDE_NOUN = String.fromCodePoint(24352, 24187, 28783, 29255)

/**
 * Build the expected provenance line for one location.
 * @param fileName - the file name the snapshot carries.
 * @param locationText - the location wording after the full-width comma; the
 * empty string is the document-level case, which carries no comma at all.
 * @returns the expected line.
 */
function expectedLine(fileName: string, locationText: string): string {
  const location = locationText === '' ? '' : `${COMMA}${locationText}`
  return `[${SOURCE_LABEL}${COLON}${fileName}${location}]`
}

describe('provenance line composition', () => {
  it('renders a text line range', () => {
    const line = formatProvenance(snapshot({ fileName: 'a.txt', location: { kind: 'lines', start: 42, end: 51 } }))

    expect(line).toBe(expectedLine('a.txt', `${ORDINAL} 42${DASH}51 ${LINE_NOUN}`))
  })

  it('renders a single line without a range', () => {
    const line = formatProvenance(snapshot({ fileName: 'a.txt', location: { kind: 'lines', start: 42, end: 42 } }))

    expect(line).toBe(expectedLine('a.txt', `${ORDINAL} 42 ${LINE_NOUN}`))
  })

  it('renders a PDF source page range', () => {
    const line = formatProvenance(
      snapshot({ fileName: 'paper.pdf', location: { kind: 'pages', start: 3, end: 4, fidelity: 'source' } }),
    )

    expect(line).toBe(expectedLine('paper.pdf', `${ORDINAL} 3${DASH}4 ${PAGE_NOUN}`))
  })

  it('renders a DOCX range as rendered pages', () => {
    const line = formatProvenance(
      snapshot({ fileName: 'report.docx', location: { kind: 'pages', start: 3, end: 4, fidelity: 'rendered' } }),
    )

    expect(line).toBe(expectedLine('report.docx', `${ORDINAL} 3${DASH}4 ${RENDERED}${PAGE_NOUN}`))
  })

  it('renders a PPTX slide range', () => {
    const line = formatProvenance(
      snapshot({ fileName: 'slides.pptx', location: { kind: 'slides', start: 12, end: 14 } }),
    )

    expect(line).toBe(expectedLine('slides.pptx', `${ORDINAL} 12${DASH}14 ${SLIDE_NOUN}`))
  })

  it('renders an XLSX sheet and A1 range with an ASCII exclamation mark', () => {
    const line = formatProvenance(
      snapshot({ fileName: 'budget.xlsx', documentKind: 'xlsx', location: { kind: 'cells', sheet: 'Sheet1', range: 'B4:D9' } }),
    )

    expect(line).toBe(expectedLine('budget.xlsx', 'Sheet1!B4:D9'))
  })

  it('renders a document-level selection', () => {
    const line = formatProvenance(snapshot({ fileName: 'README.md', location: { kind: 'document' } }))

    expect(line).toBe(expectedLine('README.md', ''))
  })

  it('rejects the locations the contract forbids', () => {
    expect(() => formatProvenance(snapshot({ location: { kind: 'lines', start: 9, end: 3 } }))).toThrow(RangeError)
    expect(() => formatProvenance(snapshot({ location: { kind: 'lines', start: 0, end: 3 } }))).toThrow(RangeError)
  })
})

describe('question suffix composition', () => {
  it('is exactly the documented question text', () => {
    expect(SELECTION_QUESTION_SUFFIX).toBe(QUESTION_TEXT)
  })

  it('closes a formatted draft after the quoted text', () => {
    const block = formatSelectionForDraft(
      snapshot({ fileName: 'a.txt', location: { kind: 'document' }, text: 'alpha' }),
    )
    const expected = `> ${expectedLine('a.txt', '')}\n> alpha\n\n${QUESTION_TEXT}`

    expect(block).toBe(expected)
  })
})
