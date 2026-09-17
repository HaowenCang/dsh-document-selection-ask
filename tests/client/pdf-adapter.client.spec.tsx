// @vitest-environment jsdom
/**
 * PDF selection adapter client specification.
 *
 * Exercises `createPdfSelectionAdapter` against realistic PDF preview DOM structures,
 * validating ownership, rejection, page markers, geometry, 16,384 code-unit limits,
 * and first-matching adapter rejection guarantees.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPdfSelectionAdapter, PDF_SELECTION_ADAPTER_ID } from '../../src/client/adapters/pdf/adapter.js'
import { DSH_TEXT_ADAPTER_ID } from '../../src/client/adapters/dsh-text/adapter.js'
import { applyClient } from '../../src/client/dsh/register.js'
import type { ClientContext } from '../../src/client/dsh/contracts.js'
import {
  PDF_DOCUMENT_KIND,
  PDF_DOCUMENT_KIND_ATTRIBUTE,
  PDF_PAGE_ATTRIBUTE,
  PDF_RESOURCE_ADDRESS_ATTRIBUTE,
  PDF_TEXT_LAYER_ATTRIBUTE,
} from '../../src/client/renderers/pdf/identity.js'
import { SelectionAdapterRegistry } from '../../src/client/selection/registry.js'
import type { SelectionAdapter, SelectionCapture, SelectionContext } from '../../src/client/selection/registry.js'
import { rect, stubRangeGeometry } from './helpers/dom-range-fixtures.js'

const NOW = 1_700_000_000_123
const DEFAULT_URL = 'dsh-resource://file/session/s1/paper.pdf'
const OVERSIZED_TEXT = 'x'.repeat(16_385)

interface PageFixtureSpec {
  readonly page?: string | null
  readonly text?: string
  readonly omitTextLayer?: boolean
  readonly extraNodes?: (parent: HTMLElement) => void
}

interface PdfFixtureOptions {
  readonly resourceAddress?: string
  readonly documentKind?: string
  readonly pages?: readonly PageFixtureSpec[]
}

function createPdfFixture(options: PdfFixtureOptions = {}): HTMLElement {
  const root = document.createElement('section')
  if (options.documentKind !== undefined) {
    root.setAttribute(PDF_DOCUMENT_KIND_ATTRIBUTE, options.documentKind)
  } else {
    root.setAttribute(PDF_DOCUMENT_KIND_ATTRIBUTE, PDF_DOCUMENT_KIND)
  }

  if (options.resourceAddress !== undefined) {
    root.setAttribute(PDF_RESOURCE_ADDRESS_ATTRIBUTE, options.resourceAddress)
  } else {
    root.setAttribute(PDF_RESOURCE_ADDRESS_ATTRIBUTE, DEFAULT_URL)
  }

  const stack = document.createElement('div')
  stack.setAttribute('data-dsa-pdf-stack', '')

  const pages = options.pages ?? [
    { page: '1', text: 'Alpha page one' },
    { page: '2', text: 'Beta page two' },
  ]

  for (const pageSpec of pages) {
    const pageWrapper = document.createElement('div')
    if (pageSpec.page !== undefined && pageSpec.page !== null) {
      pageWrapper.setAttribute(PDF_PAGE_ATTRIBUTE, pageSpec.page)
    }

    const canvas = document.createElement('canvas')
    pageWrapper.append(canvas)

    if (!pageSpec.omitTextLayer) {
      const textLayer = document.createElement('div')
      textLayer.setAttribute(PDF_TEXT_LAYER_ATTRIBUTE, '')

      if (pageSpec.text !== undefined) {
        const span = document.createElement('span')
        span.textContent = pageSpec.text
        textLayer.append(span)
      }

      pageWrapper.append(textLayer)
    }

    if (pageSpec.extraNodes) {
      pageSpec.extraNodes(pageWrapper)
    }

    stack.append(pageWrapper)
  }

  root.append(stack)
  return root
}

function mount(element: HTMLElement): HTMLElement {
  document.body.append(element)
  return element
}

function currentSelection(): Selection {
  const selection = window.getSelection()
  if (selection === null) {
    throw new Error('jsdom must expose window.getSelection()')
  }
  return selection
}

function setSelectionRange(range: Range): Selection {
  const sel = currentSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  return sel
}

function selectText(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Selection {
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return setSelectionRange(range)
}

function selectReverse(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Selection {
  const sel = currentSelection()
  sel.removeAllRanges()
  sel.collapse(endNode, endOffset)
  sel.extend(startNode, startOffset)
  return sel
}

describe('createPdfSelectionAdapter', () => {
  let adapter: SelectionAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    adapter = createPdfSelectionAdapter()
  })

  describe('ownership & canHandle', () => {
    it('claims selection within same PDF text layer', () => {
      const root = mount(createPdfFixture())
      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const textNode = span.firstChild!
      const selection = selectText(textNode, 0, textNode, 5)

      const context: SelectionContext = { selection, target: span, now: NOW }
      expect(adapter.canHandle(context)).toBe(true)
    })

    it('claims cross-page PDF selection', () => {
      const root = mount(createPdfFixture())
      const spans = root.querySelectorAll(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)
      const span1 = spans[0]!
      const span2 = spans[1]!
      const node1 = span1.firstChild!
      const node2 = span2.firstChild!
      const selection = selectText(node1, 0, node2, 4)

      const context: SelectionContext = { selection, target: null, now: NOW }
      expect(adapter.canHandle(context)).toBe(true)
    })

    it('claims reverse PDF selection', () => {
      const root = mount(createPdfFixture())
      const spans = root.querySelectorAll(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)
      const span1 = spans[0]!
      const span2 = spans[1]!
      const node1 = span1.firstChild!
      const node2 = span2.firstChild!
      const selection = selectReverse(node1, 0, node2, 4)

      const context: SelectionContext = { selection, target: null, now: NOW }
      expect(adapter.canHandle(context)).toBe(true)
    })

    it('claims keyboard-style selection where target is null', () => {
      const root = mount(createPdfFixture())
      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const textNode = span.firstChild!
      const selection = selectText(textNode, 0, textNode, 5)

      const context: SelectionContext = { selection, target: null, now: NOW }
      expect(adapter.canHandle(context)).toBe(true)
    })

    it('claims selection when anchor is inside PDF TextLayer and focus is outside root', () => {
      const root = mount(createPdfFixture())
      const external = document.createElement('div')
      external.textContent = 'chat transcript'
      document.body.append(external)

      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const sel = selectText(span.firstChild!, 0, external.firstChild!, 4)

      const context: SelectionContext = { selection: sel, target: null, now: NOW }
      expect(adapter.canHandle(context)).toBe(true)

      const capture = adapter.capture(context)
      expect(capture.snapshot).toBeNull()
      expect(capture.rejectReason).toBe('cross-root')
    })

    it('claims selection when focus is inside PDF TextLayer and anchor is outside root', () => {
      const root = mount(createPdfFixture())
      const external = document.createElement('div')
      external.textContent = 'chat transcript'
      document.body.append(external)

      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const sel = selectReverse(span.firstChild!, 4, external.firstChild!, 0)

      const context: SelectionContext = { selection: sel, target: null, now: NOW }
      expect(adapter.canHandle(context)).toBe(true)

      const capture = adapter.capture(context)
      expect(capture.snapshot).toBeNull()
      expect(capture.rejectReason).toBe('cross-root')
    })

    it('does not claim when target is canvas and selection is null', () => {
      const root = mount(createPdfFixture())
      const canvas = root.querySelector('canvas')!
      const context: SelectionContext = { selection: null, target: canvas, now: NOW }
      expect(adapter.canHandle(context)).toBe(false)
    })

    it('does not claim selection entirely outside any PDF root', () => {
      const external = document.createElement('div')
      external.textContent = 'plain external text'
      mount(external)
      const sel = selectText(external.firstChild!, 0, external.firstChild!, 5)

      const context: SelectionContext = { selection: sel, target: external, now: NOW }
      expect(adapter.canHandle(context)).toBe(false)
    })

    it('does not claim non-PDF document kind', () => {
      const root = mount(createPdfFixture({ documentKind: 'docx' }))
      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const sel = selectText(span.firstChild!, 0, span.firstChild!, 5)

      const context: SelectionContext = { selection: sel, target: span, now: NOW }
      expect(adapter.canHandle(context)).toBe(false)
    })
  })

  describe('rejection & boundaries', () => {
    it('rejects collapsed selection as collapsed', () => {
      const root = mount(createPdfFixture())
      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const textNode = span.firstChild!
      const sel = selectText(textNode, 2, textNode, 2)

      const context: SelectionContext = { selection: sel, target: span, now: NOW }
      const capture = adapter.capture(context)
      expect(capture.snapshot).toBeNull()
      expect(capture.rejectReason).toBe('collapsed')
    })

    it('rejects whitespace-only selection as empty-after-normalization', () => {
      const root = mount(
        createPdfFixture({
          pages: [{ page: '1', text: '   \n  \t  ' }],
        }),
      )
      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const sel = selectText(span.firstChild!, 0, span.firstChild!, span.textContent!.length)

      const context: SelectionContext = { selection: sel, target: span, now: NOW }
      const capture = adapter.capture(context)
      expect(capture.snapshot).toBeNull()
      expect(capture.rejectReason).toBe('empty-after-normalization')
    })

    it('rejects selection exceeding 16,384 code units as too-large', () => {
      const root = mount(
        createPdfFixture({
          pages: [{ page: '1', text: OVERSIZED_TEXT }],
        }),
      )
      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const sel = selectText(span.firstChild!, 0, span.firstChild!, 16_385)

      const context: SelectionContext = { selection: sel, target: span, now: NOW }
      const capture = adapter.capture(context)
      expect(capture.snapshot).toBeNull()
      expect(capture.rejectReason).toBe('too-large')
    })

    it('accepts selection of exactly 16,384 code units', () => {
      const exactText = 'a'.repeat(16_384)
      const root = mount(
        createPdfFixture({
          pages: [{ page: '1', text: exactText }],
        }),
      )
      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const sel = selectText(span.firstChild!, 0, span.firstChild!, 16_384)

      const context: SelectionContext = { selection: sel, target: span, now: NOW }
      const capture = adapter.capture(context)
      expect(capture.rejectReason).toBeNull()
      expect(capture.snapshot?.text.length).toBe(16_384)
    })

    it('rejects selection spanning across two different PDF roots as cross-root', () => {
      const root1 = mount(createPdfFixture({ resourceAddress: 'dsh-resource://file/session/s1/doc1.pdf' }))
      const root2 = mount(createPdfFixture({ resourceAddress: 'dsh-resource://file/session/s1/doc2.pdf' }))

      const span1 = root1.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const span2 = root2.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const sel = selectText(span1.firstChild!, 0, span2.firstChild!, 4)

      const context: SelectionContext = { selection: sel, target: span1, now: NOW }
      expect(adapter.canHandle(context)).toBe(true)

      const capture = adapter.capture(context)
      expect(capture.snapshot).toBeNull()
      expect(capture.rejectReason).toBe('cross-root')
    })

    it('rejects selection extending into canvas as cross-root', () => {
      let canvasText: Text | null = null
      const root = mount(
        createPdfFixture({
          pages: [
            {
              page: '1',
              text: 'selectable',
              extraNodes(pageWrapper) {
                const canvas = pageWrapper.querySelector('canvas')!
                canvasText = document.createTextNode('canvas fallback text')
                canvas.append(canvasText)
              },
            },
          ],
        }),
      )

      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const sel = selectText(canvasText!, 0, span.firstChild!, 5)

      const context: SelectionContext = { selection: sel, target: span, now: NOW }
      expect(adapter.canHandle(context)).toBe(true)

      const capture = adapter.capture(context)
      expect(capture.snapshot).toBeNull()
      expect(capture.rejectReason).toBe('cross-root')
    })

    it('rejects unparseable resource address as outside-supported-preview', () => {
      const root = mount(createPdfFixture({ resourceAddress: 'invalid-not-an-address' }))
      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const sel = selectText(span.firstChild!, 0, span.firstChild!, 5)

      const context: SelectionContext = { selection: sel, target: span, now: NOW }
      const capture = adapter.capture(context)
      expect(capture.snapshot).toBeNull()
      expect(capture.rejectReason).toBe('outside-supported-preview')
    })
  })

  describe('page provenance resolution', () => {
    it('resolves single-page source provenance', () => {
      const root = mount(
        createPdfFixture({
          pages: [{ page: '3', text: 'third page content' }],
        }),
      )
      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const textNode = span.firstChild!
      const sel = selectText(textNode, 0, textNode, 5)

      const context: SelectionContext = { selection: sel, target: span, now: NOW }
      const capture = adapter.capture(context)

      expect(capture.rejectReason).toBeNull()
      expect(capture.snapshot?.location).toEqual({
        kind: 'pages',
        start: 3,
        end: 3,
        fidelity: 'source',
      })
    })

    it('resolves cross-page source provenance', () => {
      const root = mount(
        createPdfFixture({
          pages: [
            { page: '3', text: 'third page content' },
            { page: '4', text: 'fourth page content' },
          ],
        }),
      )
      const spans = root.querySelectorAll(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)
      const span1 = spans[0]!
      const span2 = spans[1]!
      const sel = selectText(span1.firstChild!, 0, span2.firstChild!, 6)

      const context: SelectionContext = { selection: sel, target: span1, now: NOW }
      const capture = adapter.capture(context)

      expect(capture.rejectReason).toBeNull()
      expect(capture.snapshot?.location).toEqual({
        kind: 'pages',
        start: 3,
        end: 4,
        fidelity: 'source',
      })
    })

    it('resolves reversed selection in document Range order', () => {
      const root = mount(
        createPdfFixture({
          pages: [
            { page: '1', text: 'Alpha page one' },
            { page: '2', text: 'Beta page two' },
          ],
        }),
      )
      const spans = root.querySelectorAll(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)
      const span1 = spans[0]!
      const span2 = spans[1]!
      const sel = selectReverse(span1.firstChild!, 0, span2.firstChild!, 4)

      const context: SelectionContext = { selection: sel, target: span2, now: NOW }
      const capture = adapter.capture(context)

      expect(capture.rejectReason).toBeNull()
      expect(capture.snapshot?.location).toEqual({
        kind: 'pages',
        start: 1,
        end: 2,
        fidelity: 'source',
      })
    })

    it.each([
      ['missing page attribute', null],
      ['zero', '0'],
      ['negative', '-1'],
      ['decimal', '1.5'],
      ['leading whitespace', ' 1'],
      ['trailing whitespace', '1 '],
      ['leading zero', '01'],
      ['scientific notation', '1e2'],
      ['unsafe integer', '9007199254740992'],
    ])('rejects invalid page marker (%s) as renderer-not-ready', (_label, marker) => {
      const root = mount(
        createPdfFixture({
          pages: [{ page: marker, text: 'content' }],
        }),
      )
      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const sel = selectText(span.firstChild!, 0, span.firstChild!, 5)

      const context: SelectionContext = { selection: sel, target: span, now: NOW }
      const capture = adapter.capture(context)

      expect(capture.snapshot).toBeNull()
      expect(capture.rejectReason).toBe('renderer-not-ready')
    })

    it('rejects inverted page markers in DOM order as renderer-not-ready', () => {
      const root = mount(
        createPdfFixture({
          pages: [
            { page: '4', text: 'first in DOM but marked page 4' },
            { page: '3', text: 'second in DOM but marked page 3' },
          ],
        }),
      )
      const spans = root.querySelectorAll(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)
      const span1 = spans[0]!
      const span2 = spans[1]!
      const sel = selectText(span1.firstChild!, 0, span2.firstChild!, 5)

      const context: SelectionContext = { selection: sel, target: span1, now: NOW }
      const capture = adapter.capture(context)

      expect(capture.snapshot).toBeNull()
      expect(capture.rejectReason).toBe('renderer-not-ready')
    })
  })

  describe('snapshot structure and geometry', () => {
    it('populates snapshot with exact fields', () => {
      const root = mount(createPdfFixture())
      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const textNode = span.firstChild!
      const sel = selectText(textNode, 0, textNode, 5)

      const testRect = rect({ x: 10, y: 20, width: 100, height: 20 })
      stubRangeGeometry(sel.getRangeAt(0), [testRect], testRect)

      const context: SelectionContext = { selection: sel, target: span, now: NOW }
      const capture = adapter.capture(context)

      expect(capture.rejectReason).toBeNull()
      expect(capture.snapshot).toEqual({
        adapterId: PDF_SELECTION_ADAPTER_ID,
        resourceAddress: DEFAULT_URL,
        fileName: 'paper.pdf',
        documentKind: 'pdf',
        text: 'Alpha',
        location: {
          kind: 'pages',
          start: 1,
          end: 1,
          fidelity: 'source',
        },
        rects: [
          expect.objectContaining({
            x: 10,
            y: 20,
            width: 100,
            height: 20,
          }),
        ],
        capturedAt: NOW,
      })
    })
  })

  describe('first-matching adapter ownership and fall-through prevention', () => {
    it('claims invalid cross-root gesture and prevents fallback sentinel adapter', () => {
      const registry = new SelectionAdapterRegistry()
      registry.register(adapter)

      let sentinelCalled = false
      const sentinelAdapter: SelectionAdapter = {
        id: 'sentinel',
        canHandle() {
          sentinelCalled = true
          return true
        },
        capture() {
          return {
            snapshot: {
              adapterId: 'sentinel',
              resourceAddress: 'sentinel://url',
              fileName: 'sentinel.txt',
              documentKind: 'text',
              text: 'sentinel',
              location: { kind: 'document' },
              rects: [],
              capturedAt: NOW,
            },
            rejectReason: null,
          }
        },
      }
      registry.register(sentinelAdapter)

      const root = mount(createPdfFixture())
      const outside = document.createElement('div')
      outside.textContent = 'chat content'
      document.body.append(outside)

      const span = root.querySelector(`[${PDF_TEXT_LAYER_ATTRIBUTE}] span`)!
      const sel = selectText(span.firstChild!, 0, outside.firstChild!, 4)

      const context: SelectionContext = { selection: sel, target: null, now: NOW }
      const result = registry.capture(context)

      expect(result.snapshot).toBeNull()
      expect(result.rejectReason).toBe('cross-root')
      expect(sentinelCalled).toBe(false)
    })
  })

  describe('applyClient registration order', () => {
    it('registers PDF selection adapter before DSH builtin text adapter', () => {
      const registerSpy = vi.spyOn(SelectionAdapterRegistry.prototype, 'register')

      const fakeCtx = {
        effect: (execute: () => (() => void) | void): (() => void) => {
          const produced = execute()
          return typeof produced === 'function' ? produced : () => undefined
        },
        slots: {
          inject: (_key: string, callback: () => () => void): (() => void) => callback(),
          register: (): (() => void) => () => undefined,
        },
        documentPreviews: {
          register: (): (() => void) => () => undefined,
        },
      } as unknown as ClientContext

      applyClient(fakeCtx)

      const registeredIds = registerSpy.mock.calls.map((call) => call[0].id)
      const pdfIndex = registeredIds.indexOf(PDF_SELECTION_ADAPTER_ID)
      const textIndex = registeredIds.indexOf(DSH_TEXT_ADAPTER_ID)

      expect(pdfIndex).toBeGreaterThanOrEqual(0)
      expect(textIndex).toBeGreaterThanOrEqual(0)
      expect(pdfIndex).toBeLessThan(textIndex)

      registerSpy.mockRestore()
    })
  })
})
