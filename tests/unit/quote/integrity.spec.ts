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
import { ZH, resolveSelectionStrings } from '../../../src/client/ui/locales.js'
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

/** `询问 DeepSeek` */
const ASK_TEXT = String.fromCodePoint(0x8be2, 0x95ee, 0x20, 0x44, 0x65, 0x65, 0x70, 0x53, 0x65, 0x65, 0x6b)

/** `选区过大` */
const TOO_LARGE_SUBJECT = String.fromCodePoint(0x9009, 0x533a, 0x8fc7, 0x5927)
/** `，` */
const FULL_WIDTH_COMMA = String.fromCodePoint(0xff0c)
/** `请缩小范围` */
const TOO_LARGE_REQUEST = String.fromCodePoint(0x8bf7, 0x7f29, 0x5c0f, 0x8303, 0x56f4)

/** `选区过大，请缩小范围` — the whole notice, composed from its named groups. */
const TOO_LARGE_TEXT = TOO_LARGE_SUBJECT + FULL_WIDTH_COMMA + TOO_LARGE_REQUEST

/** `选中的单元格过多` */
const TOO_MANY_CELLS_SUBJECT = String.fromCodePoint(
  0x9009, 0x4e2d, 0x7684, 0x5355, 0x5143, 0x683c, 0x8fc7, 0x591a,
)
/** `请选择不超过` */
const TOO_MANY_CELLS_REQUEST = String.fromCodePoint(0x8bf7, 0x9009, 0x62e9, 0x4e0d, 0x8d85, 0x8fc7)
/** `个单元格` */
const CELL_NOUN = String.fromCodePoint(0x4e2a, 0x5355, 0x5143, 0x683c)

/** `无法显示文档` */
const RENDERER_FAILED_TEXT = String.fromCodePoint(0x65e0, 0x6cd5, 0x663e, 0x793a, 0x6587, 0x6863)

/** `当前内容没有可选择文本` */
const NO_SELECTABLE_TEXT = String.fromCodePoint(
  0x5f53, 0x524d, 0x5185, 0x5bb9, 0x6ca1, 0x6709, 0x53ef, 0x9009, 0x62e9, 0x6587, 0x672c,
)

/** `正在加载文档` */
const LOADING_TEXT = String.fromCodePoint(0x6b63, 0x5728, 0x52a0, 0x8f7d, 0x6587, 0x6863)

/** `…` — the single horizontal-ellipsis code point, not three periods. */
const ELLIPSIS = String.fromCodePoint(0x2026)

describe('Ask UI copy', () => {
  it('names the Ask button with exactly the documented code points', () => {
    expect(ZH.ask).toBe(ASK_TEXT)
    expect([...ZH.ask].map((character) => character.codePointAt(0))).toEqual([
      0x8be2, 0x95ee, 0x20, 0x44, 0x65, 0x65, 0x70, 0x53, 0x65, 0x65, 0x6b,
    ])
  })

  it('words the size limit with exactly the documented code points', () => {
    expect(ZH.selectionTooLarge).toBe(TOO_LARGE_TEXT)
    expect([...ZH.selectionTooLarge].map((character) => character.codePointAt(0))).toEqual([
      0x9009, 0x533a, 0x8fc7, 0x5927, 0xff0c, 0x8bf7, 0x7f29, 0x5c0f, 0x8303, 0x56f4,
    ])
  })

  it('words the cell limit with exactly the documented code points', () => {
    // `选中的单元格过多，请选择不超过 200 个单元格` — the digit group is ASCII and
    // is the same limit the adapter enforces, so it is asserted as digits rather
    // than as a code-point run.
    expect(ZH.tooManyCells).toBe(
      TOO_MANY_CELLS_SUBJECT + FULL_WIDTH_COMMA + TOO_MANY_CELLS_REQUEST + ' 200 ' + CELL_NOUN,
    )
    expect([...ZH.tooManyCells].map((character) => character.codePointAt(0))).toEqual([
      0x9009, 0x4e2d, 0x7684, 0x5355, 0x5143, 0x683c, 0x8fc7, 0x591a, 0xff0c, 0x8bf7, 0x9009,
      0x62e9, 0x4e0d, 0x8d85, 0x8fc7, 0x20, 0x32, 0x30, 0x30, 0x20, 0x4e2a, 0x5355, 0x5143, 0x683c,
    ])
  })

  it('words the generic renderer failure with exactly the documented code points', () => {
    expect(ZH.rendererFailed).toBe(RENDERER_FAILED_TEXT)
    expect([...ZH.rendererFailed].map((character) => character.codePointAt(0))).toEqual([
      0x65e0, 0x6cd5, 0x663e, 0x793a, 0x6587, 0x6863,
    ])
  })

  it('words the image-only state with exactly the documented code points', () => {
    expect(ZH.noSelectableText).toBe(NO_SELECTABLE_TEXT)
    expect([...ZH.noSelectableText].map((character) => character.codePointAt(0))).toEqual([
      0x5f53, 0x524d, 0x5185, 0x5bb9, 0x6ca1, 0x6709, 0x53ef, 0x9009, 0x62e9, 0x6587, 0x672c,
    ])
  })

  it('words the loading state with exactly the documented code points', () => {
    expect(ZH.loading).toBe(LOADING_TEXT + ELLIPSIS)
    expect([...ZH.loading].map((character) => character.codePointAt(0))).toEqual([
      0x6b63, 0x5728, 0x52a0, 0x8f7d, 0x6587, 0x6863, 0x2026,
    ])
  })

  it('resolves Chinese as the default for an unknown or absent language', () => {
    // The product's default must not be replaced by English merely because a host
    // published no language at all.
    expect(resolveSelectionStrings(undefined)).toBe(ZH)
    expect(resolveSelectionStrings('zh')).toBe(ZH)
    expect(resolveSelectionStrings('zh-CN')).toBe(ZH)
    expect(resolveSelectionStrings('ZH-hant')).toBe(ZH)
  })

  it('resolves English only for a positively non-Chinese language', () => {
    expect(resolveSelectionStrings('en').ask).toBe('Ask DeepSeek')
    expect(resolveSelectionStrings('en-US').selectionTooLarge).not.toBe(ZH.selectionTooLarge)
  })
})
