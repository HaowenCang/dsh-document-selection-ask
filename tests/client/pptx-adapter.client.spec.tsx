// @vitest-environment jsdom
/**
 * PPTX selection adapter client specification.
 *
 * Exercises `createPptxSelectionAdapter` against realistic PPTX preview DOM structures,
 * validating ownership, rejection, slide provenance, cross-root isolation,
 * 16,384 code-unit limits, and first-matching adapter guarantees.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { createDocxSelectionAdapter } from '../../src/client/adapters/docx/adapter.js'
import { createPdfSelectionAdapter } from '../../src/client/adapters/pdf/adapter.js'
import { createPptxSelectionAdapter, PPTX_SELECTION_ADAPTER_ID } from '../../src/client/adapters/pptx/adapter.js'
import {
  DOCX_DOCUMENT_KIND,
  DOCX_DOCUMENT_KIND_ATTRIBUTE,
  DOCX_RESOURCE_ADDRESS_ATTRIBUTE,
  DOCX_SELECTABLE_ATTRIBUTE,
} from '../../src/client/renderers/docx/identity.js'
import {
  PDF_DOCUMENT_KIND,
  PDF_DOCUMENT_KIND_ATTRIBUTE,
  PDF_PAGE_ATTRIBUTE,
  PDF_RESOURCE_ADDRESS_ATTRIBUTE,
  PDF_TEXT_LAYER_ATTRIBUTE,
} from '../../src/client/renderers/pdf/identity.js'
import {
  PPTX_DOCUMENT_KIND,
  PPTX_DOCUMENT_KIND_ATTRIBUTE,
  PPTX_RESOURCE_ADDRESS_ATTRIBUTE,
  PPTX_SELECTABLE_ATTRIBUTE,
  PPTX_SLIDE_ATTRIBUTE,
} from '../../src/client/renderers/pptx/identity.js'
import { SelectionAdapterRegistry } from '../../src/client/selection/registry.js'
import type { SelectionAdapter, SelectionContext } from '../../src/client/selection/registry.js'
import { rect, stubRangeGeometry } from './helpers/dom-range-fixtures.js'

const NOW = 1_700_000_000_123
const DEFAULT_URL = 'dsh-resource://file/session/s1/presentation.pptx'
const OVERSIZED_TEXT = 'x'.repeat(16_385)
const EXACT_MAX_TEXT = 'x'.repeat(16_384)

interface SlideFixtureSpec {
  readonly slide?: string | null
  readonly text?: string
}

interface PptxFixtureOptions {
  readonly resourceAddress?: string
  readonly documentKind?: string
  readonly omitContentHost?: boolean
  readonly slides?: readonly SlideFixtureSpec[]
}

function createPptxFixture(options: PptxFixtureOptions = {}): HTMLElement {
  const root = document.createElement('section')
  if (options.documentKind !== undefined) {
    root.setAttribute(PPTX_DOCUMENT_KIND_ATTRIBUTE, options.documentKind)
  } else {
    root.setAttribute(PPTX_DOCUMENT_KIND_ATTRIBUTE, PPTX_DOCUMENT_KIND)
  }

  if (options.resourceAddress !== undefined) {
    root.setAttribute(PPTX_RESOURCE_ADDRESS_ATTRIBUTE, options.resourceAddress)
  } else {
    root.setAttribute(PPTX_RESOURCE_ADDRESS_ATTRIBUTE, DEFAULT_URL)
  }

  if (options.omitContentHost) {
    return root
  }

  const contentHost = document.createElement('div')
  contentHost.setAttribute(PPTX_SELECTABLE_ATTRIBUTE, '')

  const slides = options.slides ?? [
    { slide: '1', text: 'PPTX Slide One Alpha' },
    { slide: '2', text: 'PPTX Slide Two Beta' },
  ]

  for (const slideSpec of slides) {
    const slideWrapper = document.createElement('div')
    if (slideSpec.slide !== undefined && slideSpec.slide !== null) {
      slideWrapper.setAttribute(PPTX_SLIDE_ATTRIBUTE, slideSpec.slide)
    }

    const p = document.createElement('p')
    p.textContent = slideSpec.text ?? 'Sample slide content text'
    slideWrapper.appendChild(p)
    contentHost.appendChild(slideWrapper)
  }

  root.appendChild(contentHost)
  return root
}

function selectNodes(
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
  reverse = false,
): Selection {
  const sel = window.getSelection()
  if (sel === null) {
    throw new Error('window.getSelection() returned null in jsdom')
  }
  sel.removeAllRanges()

  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  const r = rect({ x: 10, y: 20, width: 100, height: 15 })
  stubRangeGeometry(range, [r], r)

  if (reverse) {
    sel.collapse(endNode, endOffset)
    sel.extend(startNode, startOffset)
  } else {
    sel.addRange(range)
  }

  return sel
}

describe('createPptxSelectionAdapter', () => {
  let adapter: SelectionAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    adapter = createPptxSelectionAdapter()
  })

  it('exposes the stable PPTX adapter id', () => {
    expect(adapter.id).toBe(PPTX_SELECTION_ADAPTER_ID)
  })

  it('claims ownership when anchor or focus is inside pptx selectable content', () => {
    const fixture = createPptxFixture()
    document.body.appendChild(fixture)

    const p = fixture.querySelector('p')!
    const textNode = p.firstChild!

    const sel = selectNodes(textNode, 0, textNode, 4)
    const context: SelectionContext = { selection: sel, target: p, now: NOW }

    expect(adapter.canHandle(context)).toBe(true)
  })

  it('claims ownership when target is inside pptx content even if selection is not yet anchored', () => {
    const fixture = createPptxFixture()
    document.body.appendChild(fixture)

    const p = fixture.querySelector('p')!
    const context: SelectionContext = { selection: null, target: p, now: NOW }

    expect(adapter.canHandle(context)).toBe(true)
  })

  it('refuses ownership when endpoints and target are completely outside pptx content', () => {
    const outsideP = document.createElement('p')
    outsideP.textContent = 'Outside text'
    document.body.appendChild(outsideP)

    const sel = selectNodes(outsideP.firstChild!, 0, outsideP.firstChild!, 4)
    const context: SelectionContext = { selection: sel, target: outsideP, now: NOW }

    expect(adapter.canHandle(context)).toBe(false)
  })

  it('captures same-slide selection with exact slide provenance', () => {
    const fixture = createPptxFixture()
    document.body.appendChild(fixture)

    const p1 = fixture.querySelectorAll('p')[0]!
    const text1 = p1.firstChild!

    const sel = selectNodes(text1, 0, text1, 9) // "PPTX Slid"
    const context: SelectionContext = { selection: sel, target: p1, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot).not.toBeNull()

    expect(capture.snapshot).toEqual({
      adapterId: PPTX_SELECTION_ADAPTER_ID,
      resourceAddress: DEFAULT_URL,
      fileName: 'presentation.pptx',
      documentKind: 'pptx',
      text: 'PPTX Slid',
      location: {
        kind: 'slides',
        start: 1,
        end: 1,
      },
      rects: expect.any(Array),
      capturedAt: NOW,
    })
  })

  it('captures cross-slide selection spanning from slide 1 to slide 2', () => {
    const fixture = createPptxFixture()
    document.body.appendChild(fixture)

    const p1 = fixture.querySelectorAll('p')[0]!
    const p2 = fixture.querySelectorAll('p')[1]!
    const text1 = p1.firstChild!
    const text2 = p2.firstChild!

    const sel = selectNodes(text1, 5, text2, 8)
    const context: SelectionContext = { selection: sel, target: p1, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot?.location).toEqual({
      kind: 'slides',
      start: 1,
      end: 2,
    })
  })

  it('handles reverse selection (anchor on slide 2, focus on slide 1)', () => {
    const fixture = createPptxFixture()
    document.body.appendChild(fixture)

    const p1 = fixture.querySelectorAll('p')[0]!
    const p2 = fixture.querySelectorAll('p')[1]!
    const text1 = p1.firstChild!
    const text2 = p2.firstChild!

    const sel = selectNodes(text1, 0, text2, 4, true)
    const context: SelectionContext = { selection: sel, target: p2, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot?.location).toEqual({
      kind: 'slides',
      start: 1,
      end: 2,
    })
  })

  it('handles keyboard selection with target=null', () => {
    const fixture = createPptxFixture()
    document.body.appendChild(fixture)

    const p1 = fixture.querySelectorAll('p')[0]!
    const text1 = p1.firstChild!

    const sel = selectNodes(text1, 0, text1, 4)
    const context: SelectionContext = { selection: sel, target: null, now: NOW }

    expect(adapter.canHandle(context)).toBe(true)
    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot?.text).toBe('PPTX')
  })

  it('rejects collapsed selection with "collapsed"', () => {
    const fixture = createPptxFixture()
    document.body.appendChild(fixture)

    const p1 = fixture.querySelectorAll('p')[0]!
    const text1 = p1.firstChild!

    const sel = selectNodes(text1, 2, text1, 2)
    const context: SelectionContext = { selection: sel, target: p1, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('collapsed')
  })

  it('rejects whitespace-only selection with "empty-after-normalization"', () => {
    const fixture = createPptxFixture({
      slides: [{ slide: '1', text: '   \n\t  ' }],
    })
    document.body.appendChild(fixture)

    const p = fixture.querySelector('p')!
    const textNode = p.firstChild!

    const sel = selectNodes(textNode, 0, textNode, 5)
    const context: SelectionContext = { selection: sel, target: p, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('empty-after-normalization')
  })

  it('accepts exactly 16,384 UTF-16 code units', () => {
    const fixture = createPptxFixture({
      slides: [{ slide: '1', text: EXACT_MAX_TEXT }],
    })
    document.body.appendChild(fixture)

    const p = fixture.querySelector('p')!
    const textNode = p.firstChild!

    const sel = selectNodes(textNode, 0, textNode, 16_384)
    const context: SelectionContext = { selection: sel, target: p, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot?.text.length).toBe(16_384)
  })

  it('rejects selection of 16,385 UTF-16 code units with "too-large"', () => {
    const fixture = createPptxFixture({
      slides: [{ slide: '1', text: OVERSIZED_TEXT }],
    })
    document.body.appendChild(fixture)

    const p = fixture.querySelector('p')!
    const textNode = p.firstChild!

    const sel = selectNodes(textNode, 0, textNode, 16_385)
    const context: SelectionContext = { selection: sel, target: p, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('too-large')
  })

  it.each([
    ['invalid marker 0', '0'],
    ['invalid marker 01', '01'],
    ['invalid marker 1.5', '1.5'],
    ['invalid marker 1e2', '1e2'],
    ['unsafe integer', '9007199254740992'],
  ])('rejects non-canonical slide marker (%s) with renderer-not-ready', (_desc, marker) => {
    const fixture = createPptxFixture({
      slides: [{ slide: marker, text: 'Slide content' }],
    })
    document.body.appendChild(fixture)

    const p = fixture.querySelector('p')!
    const textNode = p.firstChild!

    const sel = selectNodes(textNode, 0, textNode, 5)
    const context: SelectionContext = { selection: sel, target: p, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('renderer-not-ready')
  })

  it('rejects with renderer-not-ready when slide marker is completely absent (no file-only fallback)', () => {
    const fixture = createPptxFixture({
      slides: [{ slide: null, text: 'Slide without marker' }],
    })
    document.body.appendChild(fixture)

    const p = fixture.querySelector('p')!
    const textNode = p.firstChild!

    const sel = selectNodes(textNode, 0, textNode, 5)
    const context: SelectionContext = { selection: sel, target: p, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('renderer-not-ready')
  })

  it('rejects cross-root selection between two separate PPTX document roots', () => {
    const fixture1 = createPptxFixture({ resourceAddress: 'dsh-resource://file/session/s1/deck1.pptx' })
    const fixture2 = createPptxFixture({ resourceAddress: 'dsh-resource://file/session/s1/deck2.pptx' })
    document.body.appendChild(fixture1)
    document.body.appendChild(fixture2)

    const p1 = fixture1.querySelector('p')!
    const p2 = fixture2.querySelector('p')!

    const sel = selectNodes(p1.firstChild!, 0, p2.firstChild!, 4)
    const context: SelectionContext = { selection: sel, target: p1, now: NOW }

    expect(adapter.canHandle(context)).toBe(true)
    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('cross-root')
  })

  it('rejects cross-root selection between PPTX and DOCX preview roots', () => {
    const pptxFixture = createPptxFixture()
    const docxRoot = document.createElement('section')
    docxRoot.setAttribute(DOCX_DOCUMENT_KIND_ATTRIBUTE, DOCX_DOCUMENT_KIND)
    docxRoot.setAttribute(DOCX_RESOURCE_ADDRESS_ATTRIBUTE, 'dsh-resource://file/session/s1/doc.docx')
    const docxContent = document.createElement('div')
    docxContent.setAttribute(DOCX_SELECTABLE_ATTRIBUTE, '')
    const docxP = document.createElement('p')
    docxP.textContent = 'DOCX paragraph'
    docxContent.appendChild(docxP)
    docxRoot.appendChild(docxContent)

    document.body.appendChild(pptxFixture)
    document.body.appendChild(docxRoot)

    const pptxP = pptxFixture.querySelector('p')!
    const sel = selectNodes(pptxP.firstChild!, 0, docxP.firstChild!, 4)
    const context: SelectionContext = { selection: sel, target: pptxP, now: NOW }

    expect(adapter.canHandle(context)).toBe(true)
    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('cross-root')
  })

  it('rejects cross-root selection between PPTX and PDF preview roots', () => {
    const pptxFixture = createPptxFixture()
    const pdfRoot = document.createElement('section')
    pdfRoot.setAttribute(PDF_DOCUMENT_KIND_ATTRIBUTE, PDF_DOCUMENT_KIND)
    pdfRoot.setAttribute(PDF_RESOURCE_ADDRESS_ATTRIBUTE, 'dsh-resource://file/session/s1/doc.pdf')
    const pageWrapper = document.createElement('div')
    pageWrapper.setAttribute(PDF_PAGE_ATTRIBUTE, '1')
    const textLayer = document.createElement('div')
    textLayer.setAttribute(PDF_TEXT_LAYER_ATTRIBUTE, '')
    const pdfSpan = document.createElement('span')
    pdfSpan.textContent = 'PDF span'
    textLayer.appendChild(pdfSpan)
    pageWrapper.appendChild(textLayer)
    pdfRoot.appendChild(pageWrapper)

    document.body.appendChild(pptxFixture)
    document.body.appendChild(pdfRoot)

    const pptxP = pptxFixture.querySelector('p')!
    const sel = selectNodes(pptxP.firstChild!, 0, pdfSpan.firstChild!, 4)
    const context: SelectionContext = { selection: sel, target: pptxP, now: NOW }

    expect(adapter.canHandle(context)).toBe(true)
    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('cross-root')
  })

  it('rejects cross-root selection leaking from PPTX content into outside preview chrome', () => {
    const pptxFixture = createPptxFixture()
    const chromeEl = document.createElement('div')
    chromeEl.textContent = 'Preview chrome button'
    pptxFixture.appendChild(chromeEl)
    document.body.appendChild(pptxFixture)

    const pptxP = pptxFixture.querySelector('p')!
    const sel = selectNodes(pptxP.firstChild!, 0, chromeEl.firstChild!, 4)
    const context: SelectionContext = { selection: sel, target: pptxP, now: NOW }

    expect(adapter.canHandle(context)).toBe(true)
    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('cross-root')
  })

  it('first-owner: PPTX adapter claims ownership in registry order and returns authoritative cross-root', () => {
    const registry = new SelectionAdapterRegistry()
    registry.register(createPdfSelectionAdapter())
    registry.register(createDocxSelectionAdapter())
    registry.register(createPptxSelectionAdapter())

    const pptxFixture = createPptxFixture()
    const outsideEl = document.createElement('div')
    outsideEl.textContent = 'Outside chat message'
    document.body.appendChild(pptxFixture)
    document.body.appendChild(outsideEl)

    const pptxP = pptxFixture.querySelector('p')!
    const sel = selectNodes(pptxP.firstChild!, 0, outsideEl.firstChild!, 4)
    const context: SelectionContext = { selection: sel, target: pptxP, now: NOW }

    const capture = registry.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('cross-root')
  })
})
