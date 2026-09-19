// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { createXlsxSelectionAdapter } from '../../src/client/adapters/xlsx/adapter.js'
import {
  XLSX_DOCUMENT_KIND,
  XLSX_DOCUMENT_KIND_ATTRIBUTE,
  XLSX_RESOURCE_ADDRESS_ATTRIBUTE,
  XLSX_SELECTION_ADAPTER_ID,
} from '../../src/client/renderers/xlsx/identity.js'
import { createXlsxSelectionBridge } from '../../src/client/renderers/xlsx/selection-bridge.js'
import { installXlsxSelectionLifecycle } from '../../src/client/renderers/xlsx/selection-lifecycle.js'
import { createSelectionFeedback } from '../../src/client/selection/feedback.js'
import { createSelectionKernel } from '../../src/client/selection/kernel.js'
import { SelectionAdapterRegistry, type SelectionAdapter } from '../../src/client/selection/registry.js'

describe('XLSX Selection Adapter & Lifecycle Client Tests', () => {
  function createTestRoot(address: string = 'dsh-resource://file/session/s1/book.xlsx'): HTMLElement {
    const root = document.createElement('section')
    root.setAttribute(XLSX_DOCUMENT_KIND_ATTRIBUTE, XLSX_DOCUMENT_KIND)
    root.setAttribute(XLSX_RESOURCE_ADDRESS_ATTRIBUTE, address)
    document.body.appendChild(root)
    return root
  }

  it('claims and captures single cell', () => {
    const bridge = createXlsxSelectionBridge()
    const adapter = createXlsxSelectionAdapter(bridge)
    const address = 'dsh-resource://file/session/s1/book.xlsx'
    const root = createTestRoot(address)
    const owner = bridge.createOwner(address, root)

    owner.publish({
      resourceAddress: address,
      root,
      sheet: 'Sheet1',
      range: 'A1',
      values: [['Apple']],
      cellCount: 1,
      rect: null,
    })

    const context = { selection: null, target: root, now: 1000 }
    expect(adapter.canHandle(context)).toBe(true)

    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot).not.toBeNull()
    expect(capture.snapshot?.adapterId).toBe(XLSX_SELECTION_ADAPTER_ID)
    expect(capture.snapshot?.location).toEqual({
      kind: 'cells',
      sheet: 'Sheet1',
      range: 'A1',
    })
    expect(capture.snapshot?.fileName).toBe('book.xlsx')
    expect(capture.snapshot?.rects).toEqual([])

    root.remove()
  })

  it('claims and captures small range with rect', () => {
    const bridge = createXlsxSelectionBridge()
    const adapter = createXlsxSelectionAdapter(bridge)
    const address = 'dsh-resource://file/session/s1/data.xlsx'
    const root = createTestRoot(address)
    const owner = bridge.createOwner(address, root)

    const dummyRect = new DOMRectReadOnly(10, 20, 100, 200)
    owner.publish({
      resourceAddress: address,
      root,
      sheet: 'Summary',
      range: 'B2:C3',
      values: [['R1C1', 'R1C2'], ['R2C1', 'R2C2']],
      cellCount: 4,
      rect: dummyRect,
    })

    const context = { selection: null, target: root, now: 2000 }
    const capture = adapter.capture(context)
    expect(capture.rejectReason).toBeNull()
    expect(capture.snapshot?.rects).toHaveLength(1)
    expect(capture.snapshot?.rects[0]).toBe(dummyRect)
    expect(capture.snapshot?.location).toEqual({
      kind: 'cells',
      sheet: 'Summary',
      range: 'B2:C3',
    })

    root.remove()
  })

  it('strictly enforces 200 cell limit: 200 accepted, 201 rejected with too-many-cells', () => {
    const bridge = createXlsxSelectionBridge()
    const adapter = createXlsxSelectionAdapter(bridge)
    const address = 'dsh-resource://file/session/s1/large.xlsx'
    const root = createTestRoot(address)
    const owner = bridge.createOwner(address, root)

    // Exactly 200 cells: 20 rows x 10 cols (A1:J20)
    const rows200: string[][] = Array.from({ length: 20 }, (_, r) =>
      Array.from({ length: 10 }, (_, c) => `R${r}C${c}`),
    )
    owner.publish({
      resourceAddress: address,
      root,
      sheet: 'Sheet1',
      range: 'A1:J20',
      values: rows200,
      cellCount: 200,
      rect: null,
    })

    const capture200 = adapter.capture({ selection: null, target: root, now: 3000 })
    expect(capture200.rejectReason).toBeNull()
    expect(capture200.snapshot).not.toBeNull()

    // 201 cells: e.g. 201 rows x 1 col (A1:A201)
    const rows201: string[][] = Array.from({ length: 201 }, (_, r) => [`R${r}`])
    owner.publish({
      resourceAddress: address,
      root,
      sheet: 'Sheet1',
      range: 'A1:A201',
      values: rows201,
      cellCount: 201,
      rect: null,
    })

    const capture201 = adapter.capture({ selection: null, target: root, now: 3001 })
    expect(capture201.rejectReason).toBe('too-many-cells')
    expect(capture201.snapshot).toBeNull()

    root.remove()
  })

  it('canonicalizes reversed ranges in snapshot location', () => {
    const bridge = createXlsxSelectionBridge()
    const adapter = createXlsxSelectionAdapter(bridge)
    const address = 'dsh-resource://file/session/s1/book.xlsx'
    const root = createTestRoot(address)
    const owner = bridge.createOwner(address, root)

    owner.publish({
      resourceAddress: address,
      root,
      sheet: 'Sheet1',
      range: 'D4:B2',
      values: [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']],
      cellCount: 9,
      rect: null,
    })

    const capture = adapter.capture({ selection: null, target: root, now: 4000 })
    expect(capture.snapshot?.location).toEqual({
      kind: 'cells',
      sheet: 'Sheet1',
      range: 'B2:D4',
    })

    root.remove()
  })

  it('supports sheet names with spaces and Unicode in provenance', () => {
    const bridge = createXlsxSelectionBridge()
    const adapter = createXlsxSelectionAdapter(bridge)
    const address = 'dsh-resource://file/session/s1/multi.xlsx'
    const root = createTestRoot(address)
    const owner = bridge.createOwner(address, root)

    owner.publish({
      resourceAddress: address,
      root,
      sheet: 'Data 2026',
      range: 'A1:B2',
      values: [['A', 'B'], ['C', 'D']],
      cellCount: 4,
      rect: null,
    })
    const cap1 = adapter.capture({ selection: null, target: root, now: 5000 })
    expect(cap1.snapshot?.location).toEqual({ kind: 'cells', sheet: 'Data 2026', range: 'A1:B2' })

    owner.publish({
      resourceAddress: address,
      root,
      sheet: '中文表',
      range: 'C3',
      values: [['测试']],
      cellCount: 1,
      rect: null,
    })
    const cap2 = adapter.capture({ selection: null, target: root, now: 5001 })
    expect(cap2.snapshot?.location).toEqual({ kind: 'cells', sheet: '中文表', range: 'C3' })

    root.remove()
  })

  it('enforces 16,384 text limit: 16,384 accepted, 16,385 rejected with too-large', () => {
    const bridge = createXlsxSelectionBridge()
    const adapter = createXlsxSelectionAdapter(bridge)
    const address = 'dsh-resource://file/session/s1/book.xlsx'
    const root = createTestRoot(address)
    const owner = bridge.createOwner(address, root)

    // A single cell with huge string that causes serialized text to exceed 16,384
    const hugeValue = 'x'.repeat(16400)
    owner.publish({
      resourceAddress: address,
      root,
      sheet: 'Sheet1',
      range: 'A1',
      values: [[hugeValue]],
      cellCount: 1,
      rect: null,
    })

    const capture = adapter.capture({ selection: null, target: root, now: 6000 })
    expect(capture.rejectReason).toBe('too-large')
    expect(capture.snapshot).toBeNull()

    root.remove()
  })

  it('rejects when root is disconnected or stale (renderer-not-ready)', () => {
    const bridge = createXlsxSelectionBridge()
    const adapter = createXlsxSelectionAdapter(bridge)
    const address = 'dsh-resource://file/session/s1/book.xlsx'
    const root = createTestRoot(address)
    const owner = bridge.createOwner(address, root)

    owner.publish({
      resourceAddress: address,
      root,
      sheet: 'Sheet1',
      range: 'A1',
      values: [['val']],
      cellCount: 1,
      rect: null,
    })

    // Disconnect root
    root.remove()
    expect(adapter.canHandle({ selection: null, target: root, now: 7000 })).toBe(false)
    const capture = adapter.capture({ selection: null, target: root, now: 7000 })
    expect(capture.rejectReason).toBe('renderer-not-ready')
    expect(capture.snapshot).toBeNull()
  })

  it('semantic lifecycle pushes selection to kernel and feedback, and clears on unmount', () => {
    const bridge = createXlsxSelectionBridge()
    const adapter = createXlsxSelectionAdapter(bridge)
    const registry = new SelectionAdapterRegistry()
    registry.register(adapter)

    const kernel = createSelectionKernel(registry)
    const feedback = createSelectionFeedback()

    const disposeLifecycle = installXlsxSelectionLifecycle(bridge, kernel, feedback)

    const address = 'dsh-resource://file/session/s1/book.xlsx'
    const root = createTestRoot(address)
    const owner = bridge.createOwner(address, root)

    // Publish valid selection
    owner.publish({
      resourceAddress: address,
      root,
      sheet: 'Sheet1',
      range: 'A1:B2',
      values: [['1', '2'], ['3', '4']],
      cellCount: 4,
      rect: null,
    })

    expect(kernel.getSnapshot()?.adapterId).toBe(XLSX_SELECTION_ADAPTER_ID)
    expect(kernel.getSnapshot()?.text).toContain('1')
    expect(feedback.getSnapshot()).toBeNull()

    // Publish too-large
    const hugeValue = 'y'.repeat(16400)
    owner.publish({
      resourceAddress: address,
      root,
      sheet: 'Sheet1',
      range: 'A1',
      values: [[hugeValue]],
      cellCount: 1,
      rect: null,
    })

    expect(kernel.getSnapshot()).toBeNull()
    expect(feedback.getSnapshot()?.kind).toBe('too-large')

    // Publish valid selection clears feedback
    owner.publish({
      resourceAddress: address,
      root,
      sheet: 'Sheet1',
      range: 'A1',
      values: [['hello']],
      cellCount: 1,
      rect: null,
    })
    expect(kernel.getSnapshot()?.text).toContain('hello')
    expect(feedback.getSnapshot()).toBeNull()

    // Owner clear clears kernel
    owner.clear()
    expect(kernel.getSnapshot()).toBeNull()
    expect(feedback.getSnapshot()).toBeNull()

    disposeLifecycle()
    root.remove()
  })

  it('cross-format takeover: non-XLSX selection can replace active XLSX selection in kernel', () => {
    const bridge = createXlsxSelectionBridge()
    const xlsxAdapter = createXlsxSelectionAdapter(bridge)
    const registry = new SelectionAdapterRegistry()

    // XLSX adapter registered first
    registry.register(xlsxAdapter)

    // Text adapter registered second
    const textTarget = document.createElement('div')
    document.body.appendChild(textTarget)

    const textAdapter: SelectionAdapter = {
      id: 'dsh-builtin-text',
      canHandle(ctx) {
        return ctx.target === textTarget
      },
      capture(ctx) {
        return {
          snapshot: {
            adapterId: 'dsh-builtin-text',
            resourceAddress: 'dsh-resource://file/session/s1/doc.txt',
            fileName: 'doc.txt',
            documentKind: 'text',
            text: 'text selection',
            location: { kind: 'lines', start: 1, end: 1 },
            rects: [],
            capturedAt: ctx.now,
          },
          rejectReason: null,
        }
      },
    }
    registry.register(textAdapter)

    const kernel = createSelectionKernel(registry)
    const feedback = createSelectionFeedback()
    const disposeLifecycle = installXlsxSelectionLifecycle(bridge, kernel, feedback)

    const address = 'dsh-resource://file/session/s1/book.xlsx'
    const root = createTestRoot(address)
    const owner = bridge.createOwner(address, root)

    // 1. XLSX selection active in kernel
    owner.publish({
      resourceAddress: address,
      root,
      sheet: 'Sheet1',
      range: 'A1:B2',
      values: [['A', 'B'], ['C', 'D']],
      cellCount: 4,
      rect: null,
    })
    expect(kernel.getSnapshot()?.adapterId).toBe(XLSX_SELECTION_ADAPTER_ID)

    // 2. User selects text on non-XLSX element (textTarget)
    const textContext = {
      selection: null,
      target: textTarget,
      now: 9999,
    }

    // XLSX adapter does NOT hijack this context because target is not inside XLSX root
    expect(xlsxAdapter.canHandle(textContext)).toBe(false)
    expect(textAdapter.canHandle(textContext)).toBe(true)

    const outcome = kernel.capture(textContext)
    expect(outcome.snapshot?.adapterId).toBe('dsh-builtin-text')
    expect(kernel.getSnapshot()?.adapterId).toBe('dsh-builtin-text')
    expect(kernel.getSnapshot()?.text).toBe('text selection')

    disposeLifecycle()
    root.remove()
    textTarget.remove()
  })
})
