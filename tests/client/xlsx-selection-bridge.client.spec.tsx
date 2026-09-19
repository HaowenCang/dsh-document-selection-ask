// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import {
  createXlsxSelectionBridge,
  type XlsxRangeSelection,
  type XlsxSelectionBridge,
} from '../../src/client/renderers/xlsx/selection-bridge.js'

describe('XlsxSelectionBridge', () => {
  function createTestRoot(address: string = 'test.xlsx'): HTMLElement {
    const root = document.createElement('section')
    root.setAttribute('data-dsa-document-kind', 'xlsx')
    root.setAttribute('data-dsa-resource-address', address)
    document.body.appendChild(root)
    return root
  }

  it('starts with empty selection', () => {
    const bridge = createXlsxSelectionBridge()
    expect(bridge.getSelection()).toBeNull()
  })

  it('allows owner to publish and read selection with immutable copy', () => {
    const bridge = createXlsxSelectionBridge()
    const root = createTestRoot('book1.xlsx')
    const owner = bridge.createOwner('book1.xlsx', root)

    const rawValues = [['A', 'B'], ['1', '2']]
    owner.publish({
      resourceAddress: 'book1.xlsx',
      root,
      sheet: 'Sheet1',
      range: 'A1:B2',
      values: rawValues,
      cellCount: 4,
      rect: null,
    })

    const sel = bridge.getSelection()
    expect(sel).not.toBeNull()
    expect(sel?.sheet).toBe('Sheet1')
    expect(sel?.range).toBe('A1:B2')
    expect(sel?.cellCount).toBe(4)
    expect(sel?.values).toEqual([['A', 'B'], ['1', '2']])

    // Mutating rawValues does not affect snapshot in bridge
    rawValues[0]![0] = 'MUTATED'
    expect(bridge.getSelection()?.values[0]![0]).toBe('A')

    root.remove()
  })

  it('notifies subscribers on publish and clear', () => {
    const bridge = createXlsxSelectionBridge()
    const root = createTestRoot()
    const owner = bridge.createOwner('book.xlsx', root)
    const listener = vi.fn()

    const unsubscribe = bridge.subscribe(listener)

    owner.publish({
      resourceAddress: 'book.xlsx',
      root,
      sheet: 'Data',
      range: 'C3',
      values: [['42']],
      cellCount: 1,
      rect: null,
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ sheet: 'Data', range: 'C3' }),
    )

    owner.clear()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenLastCalledWith(null)

    unsubscribe()
    owner.publish({
      resourceAddress: 'book.xlsx',
      root,
      sheet: 'Data',
      range: 'C4',
      values: [['43']],
      cellCount: 1,
      rect: null,
    })
    expect(listener).toHaveBeenCalledTimes(2)

    root.remove()
  })

  it('enforces owner token isolation: old owner clear cannot clear new owner selection', () => {
    const bridge = createXlsxSelectionBridge()
    const rootA = createTestRoot('bookA.xlsx')
    const rootB = createTestRoot('bookB.xlsx')

    const ownerA = bridge.createOwner('bookA.xlsx', rootA)
    const ownerB = bridge.createOwner('bookB.xlsx', rootB)

    // Owner A publishes
    ownerA.publish({
      resourceAddress: 'bookA.xlsx',
      root: rootA,
      sheet: 'SheetA',
      range: 'A1:A2',
      values: [['1'], ['2']],
      cellCount: 2,
      rect: null,
    })
    expect(bridge.getSelection()?.resourceAddress).toBe('bookA.xlsx')

    // Owner B becomes active and publishes
    ownerB.publish({
      resourceAddress: 'bookB.xlsx',
      root: rootB,
      sheet: 'SheetB',
      range: 'B1',
      values: [['100']],
      cellCount: 1,
      rect: null,
    })
    expect(bridge.getSelection()?.resourceAddress).toBe('bookB.xlsx')

    // Old Owner A unmounts / clears: MUST NOT clear Owner B's selection!
    ownerA.clear()
    expect(bridge.getSelection()?.resourceAddress).toBe('bookB.xlsx')
    expect(bridge.getSelection()?.sheet).toBe('SheetB')

    // Owner A dispose also cannot clear Owner B's selection
    ownerA.dispose()
    expect(bridge.getSelection()?.resourceAddress).toBe('bookB.xlsx')

    // Owner B clear clears Owner B's selection
    ownerB.clear()
    expect(bridge.getSelection()).toBeNull()

    rootA.remove()
    rootB.remove()
  })

  it('disposed owner cannot publish', () => {
    const bridge = createXlsxSelectionBridge()
    const root = createTestRoot()
    const owner = bridge.createOwner('book.xlsx', root)

    owner.dispose()
    owner.publish({
      resourceAddress: 'book.xlsx',
      root,
      sheet: 'Sheet1',
      range: 'A1',
      values: [['x']],
      cellCount: 1,
      rect: null,
    })

    expect(bridge.getSelection()).toBeNull()
    root.remove()
  })
})
