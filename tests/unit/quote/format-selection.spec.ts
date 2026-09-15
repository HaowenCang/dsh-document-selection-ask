/**
 * Draft quote formatting contract.
 *
 * Two properties matter more than the exact string, and both are asserted here
 * rather than assumed. The quote must be faithful: every selected line survives
 * with its internal spacing, its inner blank lines, and even its own `>` markers,
 * because the blockquote prefix is what carries the source-block structure and
 * nothing in the selected text is rewritten to protect it. And appending must be
 * additive: the user's existing draft is kept, separated by exactly one blank
 * line, and never replaced, reordered or followed by a second question suffix.
 *
 * The Chinese expectations are built from code points rather than written as
 * literals. A CJK literal that loses or duplicates a code unit still reads as
 * plausible Chinese, so a literal-to-literal comparison can pass while the
 * contract is broken; `tests/unit/quote/integrity.spec.ts` holds the same
 * guarantee for the production wording.
 */

import { describe, expect, it } from 'vitest'

import { appendSelectionToDraft, formatSelectionForDraft } from '../../../src/client/quote/format-selection.js'
import { snapshot } from '../selection/snapshot.js'

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
/** `页` */
const PAGE_NOUN = String.fromCodePoint(39029)
/** `行` */
const LINE_NOUN = String.fromCodePoint(34892)
/** `请针对以上选中内容回答：` */
const QUESTION_SUFFIX = String.fromCodePoint(
  35831, 38024, 23545, 20197, 19978, 36873, 20013, 20869, 23481, 22238, 31572, 65306,
)

/** The PDF case from the design specification: pages 3–4, two lines of text. */
const pdfSnapshot = snapshot({
  fileName: 'paper.pdf',
  documentKind: 'pdf',
  location: { kind: 'pages', start: 3, end: 4, fidelity: 'source' },
  text: 'alpha\nbeta',
})

/** The expected block for {@link pdfSnapshot}. */
const pdfQuote = `> [${SOURCE_LABEL}${COLON}paper.pdf${COMMA}${ORDINAL} 3${DASH}4 ${PAGE_NOUN}]\n> alpha\n> beta\n\n${QUESTION_SUFFIX}`

describe('formatSelectionForDraft', () => {
  it('formats a multiline selection as a blockquote with a question suffix', () => {
    expect(formatSelectionForDraft(pdfSnapshot)).toBe(pdfQuote)
  })

  it('preserves a blank line inside the selection', () => {
    const subject = snapshot({
      fileName: 'paper.pdf',
      documentKind: 'pdf',
      location: { kind: 'pages', start: 3, end: 4, fidelity: 'source' },
      text: 'alpha\n\nbeta',
    })

    expect(formatSelectionForDraft(subject)).toBe(
      `> [${SOURCE_LABEL}${COLON}paper.pdf${COMMA}${ORDINAL} 3${DASH}4 ${PAGE_NOUN}]\n> alpha\n>\n> beta\n\n${QUESTION_SUFFIX}`,
    )
  })

  it('keeps selected lines that begin with a quote marker', () => {
    const subject = snapshot({
      documentKind: 'markdown',
      text: '> nested quote\n> second',
      location: { kind: 'document' },
    })

    expect(formatSelectionForDraft(subject)).toBe(
      `> [${SOURCE_LABEL}${COLON}alpha.txt]\n> > nested quote\n> > second\n\n${QUESTION_SUFFIX}`,
    )
  })

  it('keeps a fenced code block inside the quote without nesting a new fence', () => {
    const subject = snapshot({
      documentKind: 'code',
      location: { kind: 'lines', start: 1, end: 3 },
      text: '```js\nconst a = 1\n```',
    })

    expect(formatSelectionForDraft(subject)).toBe(
      `> [${SOURCE_LABEL}${COLON}alpha.txt${COMMA}${ORDINAL} 1${DASH}3 ${LINE_NOUN}]\n> \`\`\`js\n> const a = 1\n> \`\`\`\n\n${QUESTION_SUFFIX}`,
    )
  })

  it('keeps internal spacing of a selected line', () => {
    const subject = snapshot({ documentKind: 'code', text: 'const a    = 1' })

    expect(formatSelectionForDraft(subject)).toContain('> const a    = 1\n')
  })

  it('rejects an empty selection instead of emitting an empty quote', () => {
    const subject = snapshot({ text: '' })

    expect(() => formatSelectionForDraft(subject)).toThrow(RangeError)
    expect(() => formatSelectionForDraft(subject)).toThrow('empty selection text')
  })

  it('rejects a whitespace-only selection', () => {
    const subject = snapshot({ text: '   \n\t' })

    expect(() => formatSelectionForDraft(subject)).toThrow(RangeError)
  })

  it('takes the whole selection from the snapshot, not from any live state', () => {
    const subject = snapshot({
      text: 'alpha\nbeta',
      fileName: 'paper.pdf',
      documentKind: 'pdf',
      location: { kind: 'pages', start: 3, end: 4, fidelity: 'source' },
    })

    expect(formatSelectionForDraft(subject)).toBe(pdfQuote)
    expect(formatSelectionForDraft({ ...subject, rects: [] })).toBe(pdfQuote)
  })
})

describe('appendSelectionToDraft', () => {
  /** The user's own text, as a code-point composition rather than a literal. */
  const draft = String.fromCodePoint(25105, 30340, 38382, 39064)

  it('appends the quote below an existing draft', () => {
    expect(appendSelectionToDraft(draft, pdfSnapshot)).toBe(`${draft}\n\n${pdfQuote}`)
  })

  it('treats an empty draft as no draft', () => {
    expect(appendSelectionToDraft('', pdfSnapshot)).toBe(formatSelectionForDraft(pdfSnapshot))
  })

  it('treats a whitespace-only draft as no draft', () => {
    expect(appendSelectionToDraft('  \n\n\t ', pdfSnapshot)).toBe(formatSelectionForDraft(pdfSnapshot))
  })

  it('collapses trailing draft newlines to a single block separation', () => {
    expect(appendSelectionToDraft(`${draft}\n\n\n\n`, pdfSnapshot)).toBe(`${draft}\n\n${pdfQuote}`)
  })

  it('appends a second block below the first without rewriting it', () => {
    const first = appendSelectionToDraft(draft, pdfSnapshot)
    const second = appendSelectionToDraft(first, snapshot({ documentKind: 'code', text: 'gamma' }))
    const secondQuote = `> [${SOURCE_LABEL}${COLON}alpha.txt${COMMA}${ORDINAL} 1 ${LINE_NOUN}]\n> gamma\n\n${QUESTION_SUFFIX}`

    // The unit is a draft, so trailing whitespace is normalized away before the new
    // block is added; the first draft's text is preserved verbatim.
    expect(second).toBe(`${first.trimEnd()}\n\n${secondQuote}`)
    expect(second.startsWith(first.trimEnd())).toBe(true)
    expect(second.endsWith(QUESTION_SUFFIX)).toBe(true)
  })

  it('keeps a question line for every selection', () => {
    const first = appendSelectionToDraft(draft, pdfSnapshot)
    const second = appendSelectionToDraft(first, pdfSnapshot)

    expect(second.split(QUESTION_SUFFIX).length - 1).toBe(2)
  })

  it('appends below a draft that already ends with a question line', () => {
    expect(appendSelectionToDraft(`${draft}\n\n${pdfQuote}`, pdfSnapshot)).toBe(
      `${draft}\n\n${pdfQuote}\n\n${pdfQuote}`,
    )
  })

  it('never replaces or reorders the existing draft', () => {
    const result = appendSelectionToDraft(draft, pdfSnapshot)

    expect(result.startsWith(`${draft}\n\n`)).toBe(true)
    expect(result).toContain(pdfQuote)
  })

  it('rejects an empty selection without touching the draft', () => {
    expect(() => appendSelectionToDraft(draft, snapshot({ text: '' }))).toThrow(RangeError)
  })
})
