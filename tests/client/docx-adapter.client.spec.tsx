// @vitest-environment jsdom
/**
 * DOCX selection adapter client specification.
 *
 * Exercises `createDocxSelectionAdapter` against realistic DOCX preview DOM structures,
 * validating ownership, rejection, rendered-page provenance, document-level fallbacks,
 * 16,384 code-unit limits, and first-matching adapter rejection guarantees.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocxSelectionAdapter, DOCX_SELECTION_ADAPTER_ID } from '../../src/client/adapters/docx/adapter.js'
import {
  DOCX_DOCUMENT_KIND,
  DOCX_DOCUMENT_KIND_ATTRIBUTE,
  DOCX_ENGINE_CLASS_NAME,
  DOCX_PAGE_ATTRIBUTE,
  DOCX_RESOURCE_ADDRESS_ATTRIBUTE,
  DOCX_SELECTABLE_ATTRIBUTE,
  DOCX_STYLE_HOST_ATTRIBUTE,
  DOCX_WRAPPER_CLASS_NAME,
} from '../../src/client/renderers/docx/identity.js'
import { SelectionAdapterRegistry } from '../../src/client/selection/registry.js'
import type { SelectionAdapter, SelectionCapture, SelectionContext } from '../../src/client/selection/registry.js'
import { rect, stubRangeGeometry } from './helpers/dom-range-fixtures.js'

const NOW = 1_700_000_000_123
const DEFAULT_URL = 'dsh-resource://file/session/s1/report.docx'
const OVERSIZED_TEXT = 'x'.repeat(16_385)

interface PageFixtureSpec {
  readonly page?: string | null
  readonly text?: string
}

interface DocxFixtureOptions {
  readonly resourceAddress?: string
  readonly documentKind?: string
  readonly omitContentHost?: boolean
  readonly pages?: readonly PageFixtureSpec[]
}

function createDocxFixture(options: DocxFixtureOptions = {}): HTMLElement {
  const root = document.createElement('section')
  if (options.documentKind !== undefined) {
    root.setAttribute(DOCX_DOCUMENT_KIND_ATTRIBUTE, options.documentKind)
  } else {
    root.setAttribute(DOCX_DOCUMENT_KIND_ATTRIBUTE, DOCX_DOCUMENT_KIND)
  }

  if (options.resourceAddress !== undefined) {
    root.setAttribute(DOCX_RESOURCE_ADDRESS_ATTRIBUTE, options.resourceAddress)
  } else {
    root.setAttribute(DOCX_RESOURCE_ADDRESS_ATTRIBUTE, DEFAULT_URL)
  }

  const styleHost = document.createElement('div')
  styleHost.setAttribute(DOCX_STYLE_HOST_ATTRIBUTE, '')
  root.appendChild(styleHost)

  if (options.omitContentHost) {
    return root
  }

  const contentHost = document.createElement('div')
  contentHost.setAttribute(DOCX_SELECTABLE_ATTRIBUTE, '')

  const wrapper = document.createElement('div')
  wrapper.className = DOCX_WRAPPER_CLASS_NAME

  const pages = options.pages ?? [
    { page: '1', text: 'Page one text' },
    { page: '2', text: 'Page two text' },
  ]

  for (const pageSpec of pages) {
    const sec = document.createElement('section')
    sec.className = DOCX_ENGINE_CLASS_NAME
    if (pageSpec.page !== undefined && pageSpec.page !== null) {
      sec.setAttribute(DOCX_PAGE_ATTRIBUTE, pageSpec.page)
    }

    const p = document.createElement('p')
    p.textContent = pageSpec.text ?? 'Sample paragraph text'
    sec.appendChild(p)
    wrapper.appendChild(sec)
  }

  contentHost.appendChild(wrapper)
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

describe('createDocxSelectionAdapter', () => {
  let adapter: SelectionAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    adapter = createDocxSelectionAdapter()
  })

  it('exposes the stable DOCX adapter id', () => {
    expect(adapter.id).toBe(DOCX_SELECTION_ADAPTER_ID)
  })

  it('claims ownership when anchor or focus is inside docx selectable content', () => {
    const fixture = createDocxFixture()
    document.body.appendChild(fixture)

    const p = fixture.querySelector('p')!
    const textNode = p.firstChild!

    const sel = selectNodes(textNode, 0, textNode, 4)
    const context: SelectionContext = { selection: sel, target: p, now: NOW }

    expect(adapter.canHandle(context)).toBe(true)
  })

  it('claims ownership when target is inside docx content even if selection is not yet anchored', () => {
    const fixture = createDocxFixture()
    document.body.appendChild(fixture)

    const p = fixture.querySelector('p')!
    const context: SelectionContext = { selection: null, target: p, now: NOW }

    expect(adapter.canHandle(context)).toBe(true)
  })

  it('refuses ownership when endpoints and target are completely outside docx content', () => {
    const outsideP = document.createElement('p')
    outsideP.textContent = 'Outside text'
    document.body.appendChild(outsideP)

    const sel = selectNodes(outsideP.firstChild!, 0, outsideP.firstChild!, 4)
    const context: SelectionContext = { selection: sel, target: outsideP, now: NOW }

    expect(adapter.canHandle(context)).toBe(false)
  })

  it('captures single-page selection with rendered fidelity page provenance', () => {
    const fixture = createDocxFixture()
    document.body.appendChild(fixture)

    const p1 = fixture.querySelectorAll('p')[0]!
    const text1 = p1.firstChild!

    const sel = selectNodes(text1, 0, text1, 8)
    const context: SelectionContext = { selection: sel, target: p1, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot).not.toBeNull()
    expect(capture.snapshot?.adapterId).toBe(DOCX_SELECTION_ADAPTER_ID)
    expect(capture.snapshot?.resourceAddress).toBe(DEFAULT_URL)
    expect(capture.snapshot?.fileName).toBe('report.docx')
    expect(capture.snapshot?.documentKind).toBe('docx')
    expect(capture.snapshot?.text).toBe('Page one')
    expect(capture.snapshot?.location).toEqual({
      kind: 'pages',
      start: 1,
      end: 1,
      fidelity: 'rendered',
    })
    expect(capture.snapshot?.capturedAt).toBe(NOW)
    expect(capture.snapshot?.rects).toHaveLength(1)
  })

  it('captures cross-page selection spanning multiple rendered page sections', () => {
    const fixture = createDocxFixture()
    document.body.appendChild(fixture)

    const p1 = fixture.querySelectorAll('p')[0]!
    const p2 = fixture.querySelectorAll('p')[1]!
    const text1 = p1.firstChild!
    const text2 = p2.firstChild!

    const sel = selectNodes(text1, 0, text2, 8)
    const context: SelectionContext = { selection: sel, target: p1, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot?.location).toEqual({
      kind: 'pages',
      start: 1,
      end: 2,
      fidelity: 'rendered',
    })
  })

  it('handles reverse selection (focus preceding anchor) correctly', () => {
    const fixture = createDocxFixture()
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
      kind: 'pages',
      start: 1,
      end: 2,
      fidelity: 'rendered',
    })
  })

  it('captures selection with target=null (keyboard selection)', () => {
    const fixture = createDocxFixture()
    document.body.appendChild(fixture)

    const p1 = fixture.querySelectorAll('p')[0]!
    const text1 = p1.firstChild!

    const sel = selectNodes(text1, 0, text1, 4)
    const context: SelectionContext = { selection: sel, target: null, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot?.text).toBe('Page')
  })

  it('falls back softly to document-level provenance when page attributes are absent', () => {
    const fixture = createDocxFixture({
      pages: [{ page: null, text: 'No page marker text' }],
    })
    document.body.appendChild(fixture)

    const p = fixture.querySelector('p')!
    const textNode = p.firstChild!

    const sel = selectNodes(textNode, 0, textNode, 7)
    const context: SelectionContext = { selection: sel, target: p, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot?.location).toEqual({
      kind: 'document',
    })
  })

  it('falls back to document-level provenance when page markers are invalid or non-canonical', () => {
    const fixture = createDocxFixture({
      pages: [
        { page: '01', text: 'Leading zero page' },
        { page: 'abc', text: 'Non-integer page' },
      ],
    })
    document.body.appendChild(fixture)

    const p1 = fixture.querySelectorAll('p')[0]!
    const text1 = p1.firstChild!

    const sel = selectNodes(text1, 0, text1, 7)
    const context: SelectionContext = { selection: sel, target: p1, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot?.location).toEqual({
      kind: 'document',
    })
  })

  it('falls back to document-level provenance when one endpoint is outside page markers', () => {
    const fixture = createDocxFixture({
      pages: [{ page: '1', text: 'Marked page text' }],
    })
    const contentHost = fixture.querySelector(`[${DOCX_SELECTABLE_ATTRIBUTE}]`)!
    const unpagedParagraph = document.createElement('p')
    unpagedParagraph.textContent = 'Unpaged header/footer paragraph'
    contentHost.insertBefore(unpagedParagraph, contentHost.firstChild)
    document.body.appendChild(fixture)

    const sel = selectNodes(unpagedParagraph.firstChild!, 0, fixture.querySelectorAll('p')[1]!.firstChild!, 4)
    const context: SelectionContext = { selection: sel, target: unpagedParagraph, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot?.location).toEqual({
      kind: 'document',
    })
  })

  it('rejects collapsed selection with "collapsed"', () => {
    const fixture = createDocxFixture()
    document.body.appendChild(fixture)

    const p1 = fixture.querySelector('p')!
    const text1 = p1.firstChild!

    const sel = selectNodes(text1, 2, text1, 2)
    const context: SelectionContext = { selection: sel, target: p1, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('collapsed')
  })

  it('rejects whitespace-only selection with "empty-after-normalization"', () => {
    const fixture = createDocxFixture({
      pages: [{ page: '1', text: '   \n\t   ' }],
    })
    document.body.appendChild(fixture)

    const p1 = fixture.querySelector('p')!
    const text1 = p1.firstChild!

    const sel = selectNodes(text1, 0, text1, 7)
    const context: SelectionContext = { selection: sel, target: p1, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('empty-after-normalization')
  })

  it('accepts selection at exactly 16,384 UTF-16 code units', () => {
    const exactText = 'a'.repeat(16_384)
    const fixture = createDocxFixture({
      pages: [{ page: '1', text: exactText }],
    })
    document.body.appendChild(fixture)

    const p1 = fixture.querySelector('p')!
    const text1 = p1.firstChild!

    const sel = selectNodes(text1, 0, text1, 16_384)
    const context: SelectionContext = { selection: sel, target: p1, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot?.text.length).toBe(16_384)
  })

  it('rejects selection at 16,385 UTF-16 code units with "too-large"', () => {
    const fixture = createDocxFixture({
      pages: [{ page: '1', text: OVERSIZED_TEXT }],
    })
    document.body.appendChild(fixture)

    const p1 = fixture.querySelector('p')!
    const text1 = p1.firstChild!

    const sel = selectNodes(text1, 0, text1, 16_385)
    const context: SelectionContext = { selection: sel, target: p1, now: NOW }

    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('too-large')
  })

  it('claims ownership and rejects with "cross-root" when selection leaves the docx root', () => {
    const fixture = createDocxFixture()
    const outsideP = document.createElement('p')
    outsideP.textContent = 'Outside document'
    document.body.appendChild(fixture)
    document.body.appendChild(outsideP)

    const p1 = fixture.querySelector('p')!
    const textInside = p1.firstChild!
    const textOutside = outsideP.firstChild!

    const sel = selectNodes(textInside, 0, textOutside, 4)
    const context: SelectionContext = { selection: sel, target: p1, now: NOW }

    expect(adapter.canHandle(context)).toBe(true)
    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('cross-root')
  })

  it('claims ownership and rejects with "cross-root" when selection crosses between two different docx roots', () => {
    const fixture1 = createDocxFixture({ resourceAddress: 'dsh-resource://file/session/s1/doc1.docx' })
    const fixture2 = createDocxFixture({ resourceAddress: 'dsh-resource://file/session/s1/doc2.docx' })
    document.body.appendChild(fixture1)
    document.body.appendChild(fixture2)

    const text1 = fixture1.querySelector('p')!.firstChild!
    const text2 = fixture2.querySelector('p')!.firstChild!

    const sel = selectNodes(text1, 0, text2, 4)
    const context: SelectionContext = { selection: sel, target: fixture1.querySelector('p'), now: NOW }

    expect(adapter.canHandle(context)).toBe(true)
    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('cross-root')
  })

  it('claims ownership and rejects with "cross-root" when one endpoint is in style host or outside docx content', () => {
    const fixture = createDocxFixture()
    const styleHost = fixture.querySelector(`[${DOCX_STYLE_HOST_ATTRIBUTE}]`)!
    styleHost.textContent = 'Non-selectable style content'
    document.body.appendChild(fixture)

    const textStyle = styleHost.firstChild!
    const textInside = fixture.querySelector('p')!.firstChild!

    const sel = selectNodes(textStyle, 0, textInside, 4)
    const context: SelectionContext = { selection: sel, target: null, now: NOW }

    expect(adapter.canHandle(context)).toBe(true)
    const capture = adapter.capture(context)
    expect(capture.snapshot).toBeNull()
    expect(capture.rejectReason).toBe('cross-root')
  })

  it('guarantees first-matching ownership rejection in registry without falling through to sentinel', () => {
    const fixture = createDocxFixture()
    const outsideP = document.createElement('p')
    outsideP.textContent = 'Outside document'
    document.body.appendChild(fixture)
    document.body.appendChild(outsideP)

    const p1 = fixture.querySelector('p')!
    const sel = selectNodes(p1.firstChild!, 0, outsideP.firstChild!, 4)
    const context: SelectionContext = { selection: sel, target: p1, now: NOW }

    const registry = new SelectionAdapterRegistry()
    registry.register(adapter)

    const sentinelCapture = vi.fn((_context: SelectionContext): SelectionCapture => ({
      snapshot: null,
      rejectReason: null,
    }))
    const sentinelAdapter: SelectionAdapter = {
      id: 'sentinel-adapter',
      canHandle: () => true,
      capture: sentinelCapture,
    }
    registry.register(sentinelAdapter)

    const capture = registry.capture(context)
    expect(capture.rejectReason).toBe('cross-root')
    expect(sentinelCapture).not.toHaveBeenCalled()
  })
})
