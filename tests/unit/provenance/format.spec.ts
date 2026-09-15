/**
 * Provenance line contract.
 *
 * The provenance line is the only part of the prompt that tells the model where
 * the quoted text came from, so its wording is a contract rather than a
 * presentation detail: `第 3–4 页` claims document pagination, `第 3–4 渲染页`
 * claims only that this browser rendered four pages, and a single-line selection
 * must not be printed as a range of one.
 */

import { describe, expect, it } from 'vitest'

import { describeLocation, formatProvenance } from '../../../src/client/provenance/format.js'
import { snapshot } from '../selection/snapshot.js'

describe('formatProvenance', () => {
  it('formats a code line range', () => {
    const subject = snapshot({
      fileName: 'src/main.ts',
      documentKind: 'code',
      location: { kind: 'lines', start: 42, end: 51 },
    })

    expect(formatProvenance(subject)).toBe('[来源：src/main.ts，第 42–51 行]')
  })

  it('formats a single line with one number rather than a range of one', () => {
    const subject = snapshot({
      fileName: 'src/main.ts',
      documentKind: 'code',
      location: { kind: 'lines', start: 42, end: 42 },
    })

    expect(formatProvenance(subject)).toBe('[来源：src/main.ts，第 42 行]')
  })

  it('formats a PDF source page range', () => {
    const subject = snapshot({
      fileName: 'paper.pdf',
      documentKind: 'pdf',
      location: { kind: 'pages', start: 3, end: 4, fidelity: 'source' },
    })

    expect(formatProvenance(subject)).toBe('[来源：paper.pdf，第 3–4 页]')
  })

  it('formats a single PDF source page', () => {
    const subject = snapshot({
      fileName: 'paper.pdf',
      documentKind: 'pdf',
      location: { kind: 'pages', start: 3, end: 3, fidelity: 'source' },
    })

    expect(formatProvenance(subject)).toBe('[来源：paper.pdf，第 3 页]')
  })

  it('words DOCX rendered pages as rendered rather than as source pages', () => {
    const subject = snapshot({
      fileName: 'report.docx',
      documentKind: 'docx',
      location: { kind: 'pages', start: 3, end: 4, fidelity: 'rendered' },
    })

    expect(formatProvenance(subject)).toBe('[来源：report.docx，第 3–4 渲染页]')
  })

  it('formats a single DOCX rendered page', () => {
    const subject = snapshot({
      fileName: 'report.docx',
      documentKind: 'docx',
      location: { kind: 'pages', start: 3, end: 3, fidelity: 'rendered' },
    })

    expect(formatProvenance(subject)).toBe('[来源：report.docx，第 3 渲染页]')
  })

  it('formats a PPTX slide range', () => {
    const subject = snapshot({
      fileName: 'slides.pptx',
      documentKind: 'pptx',
      location: { kind: 'slides', start: 12, end: 14 },
    })

    expect(formatProvenance(subject)).toBe('[来源：slides.pptx，第 12–14 张幻灯片]')
  })

  it('formats a single PPTX slide', () => {
    const subject = snapshot({
      fileName: 'slides.pptx',
      documentKind: 'pptx',
      location: { kind: 'slides', start: 12, end: 12 },
    })

    expect(formatProvenance(subject)).toBe('[来源：slides.pptx，第 12 张幻灯片]')
  })

  it('formats an XLSX sheet and A1 range', () => {
    const subject = snapshot({
      fileName: 'budget.xlsx',
      documentKind: 'xlsx',
      location: { kind: 'cells', sheet: 'Sheet1', range: 'B4:D9' },
    })

    expect(formatProvenance(subject)).toBe('[来源：budget.xlsx，Sheet1!B4:D9]')
  })

  it('falls back to the file name for a document-level selection', () => {
    const subject = snapshot({
      fileName: 'README.md',
      documentKind: 'markdown',
      location: { kind: 'document' },
    })

    expect(formatProvenance(subject)).toBe('[来源：README.md]')
  })

  it('keeps a CJK file name verbatim', () => {
    const subject = snapshot({
      fileName: '设计文档.md',
      documentKind: 'markdown',
      location: { kind: 'document' },
    })

    expect(formatProvenance(subject)).toBe('[来源：设计文档.md]')
  })
})

describe('formatProvenance defensive behavior', () => {
  it('rejects an inverted line range', () => {
    const subject = snapshot({ location: { kind: 'lines', start: 9, end: 3 } })

    expect(() => formatProvenance(subject)).toThrow(RangeError)
    expect(() => formatProvenance(subject)).toThrow(
      'Invalid selection location: lines start exceeds end (lines 9-3)',
    )
  })

  it('rejects an inverted page range', () => {
    const subject = snapshot({
      fileName: 'paper.pdf',
      documentKind: 'pdf',
      location: { kind: 'pages', start: 4, end: 3, fidelity: 'source' },
    })

    expect(() => formatProvenance(subject)).toThrow(RangeError)
    expect(() => formatProvenance(subject)).toThrow(
      'Invalid selection location: pages start exceeds end (pages 4-3)',
    )
  })

  it('rejects an inverted slide range', () => {
    const subject = snapshot({
      fileName: 'slides.pptx',
      documentKind: 'pptx',
      location: { kind: 'slides', start: 14, end: 12 },
    })

    expect(() => formatProvenance(subject)).toThrow(RangeError)
    expect(() => formatProvenance(subject)).toThrow(
      'Invalid selection location: slides start exceeds end (slides 14-12)',
    )
  })

  it('rejects line zero and negative lines', () => {
    const zero = snapshot({ location: { kind: 'lines', start: 0, end: 4 } })
    const negative = snapshot({ location: { kind: 'lines', start: -3, end: 4 } })

    expect(() => formatProvenance(zero)).toThrow(RangeError)
    expect(() => formatProvenance(negative)).toThrow(RangeError)
  })

  it('rejects page zero', () => {
    const subject = snapshot({
      fileName: 'paper.pdf',
      documentKind: 'pdf',
      location: { kind: 'pages', start: 0, end: 0, fidelity: 'source' },
    })

    expect(() => formatProvenance(subject)).toThrow(RangeError)
  })

  it('rejects slide zero', () => {
    const subject = snapshot({
      fileName: 'slides.pptx',
      documentKind: 'pptx',
      location: { kind: 'slides', start: 0, end: 1 },
    })

    expect(() => formatProvenance(subject)).toThrow(RangeError)
  })

  it('rejects a non-integer bound', () => {
    const subject = snapshot({ location: { kind: 'lines', start: 1.5, end: 4 } })

    expect(() => formatProvenance(subject)).toThrow(RangeError)
  })

  it('rejects a non-finite bound', () => {
    const subject = snapshot({ location: { kind: 'lines', start: 1, end: Number.NaN } })

    expect(() => formatProvenance(subject)).toThrow(RangeError)
  })

  it('rejects an empty file name', () => {
    const subject = snapshot({ fileName: '', location: { kind: 'lines', start: 1, end: 4 } })

    expect(() => formatProvenance(subject)).toThrow(RangeError)
    expect(() => formatProvenance(subject)).toThrow(
      'Invalid selection location: empty file name (lines 1-4)',
    )
  })

  it('rejects a blank file name', () => {
    const subject = snapshot({ fileName: '   ', location: { kind: 'document' } })

    expect(() => formatProvenance(subject)).toThrow(RangeError)
  })

  it('rejects an empty sheet name', () => {
    const subject = snapshot({
      fileName: 'budget.xlsx',
      documentKind: 'xlsx',
      location: { kind: 'cells', sheet: '', range: 'B4:D9' },
    })

    expect(() => formatProvenance(subject)).toThrow(RangeError)
    expect(() => formatProvenance(subject)).toThrow(
      'Invalid selection location: empty sheet name (cells !B4:D9)',
    )
  })

  it('rejects an empty cell range', () => {
    const subject = snapshot({
      fileName: 'budget.xlsx',
      documentKind: 'xlsx',
      location: { kind: 'cells', sheet: 'Sheet1', range: '' },
    })

    expect(() => formatProvenance(subject)).toThrow(RangeError)
    expect(() => formatProvenance(subject)).toThrow(
      'Invalid selection location: empty cell range (cells Sheet1!)',
    )
  })

  it('rejects a blank cell range', () => {
    const subject = snapshot({
      fileName: 'budget.xlsx',
      documentKind: 'xlsx',
      location: { kind: 'cells', sheet: 'Sheet1', range: '  ' },
    })

    expect(() => formatProvenance(subject)).toThrow(RangeError)
  })
})

describe('describeLocation', () => {
  it('describes numeric ranges in ASCII for diagnostics', () => {
    expect(describeLocation({ kind: 'lines', start: 42, end: 51 })).toBe('lines 42-51')
    expect(describeLocation({ kind: 'slides', start: 12, end: 12 })).toBe('slides 12-12')
  })

  it('describes source and rendered page ranges alike', () => {
    expect(describeLocation({ kind: 'pages', start: 3, end: 4, fidelity: 'source' })).toBe('pages 3-4')
    expect(describeLocation({ kind: 'pages', start: 3, end: 4, fidelity: 'rendered' })).toBe('pages 3-4')
  })

  it('describes cell ranges with their sheet', () => {
    expect(describeLocation({ kind: 'cells', sheet: 'Sheet1', range: 'B4:D9' })).toBe('cells Sheet1!B4:D9')
  })

  it('describes a document-level location', () => {
    expect(describeLocation({ kind: 'document' })).toBe('document')
  })
})
