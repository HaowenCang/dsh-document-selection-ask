import { describe, expect, it } from 'vitest'

import {
  canonicalizeCellRange,
  MAX_COLUMN_INDEX,
  MAX_COLUMN_NAME,
  MAX_ROW_INDEX,
  parseCellRange,
} from '../../../src/client/provenance/cell-range.js'

describe('cell range parsing and canonicalization', () => {
  it('parses valid single cells', () => {
    const a1 = parseCellRange('A1')
    expect(a1).toEqual({
      startColumn: 'A',
      startRow: 1,
      endColumn: 'A',
      endRow: 1,
      startColIndex: 0,
      endColIndex: 0,
      startRowIndex: 0,
      endRowIndex: 0,
      rowCount: 1,
      colCount: 1,
      cellCount: 1,
      range: 'A1',
    })

    const maxCell = parseCellRange('XFD1048576')
    expect(maxCell).toEqual({
      startColumn: 'XFD',
      startRow: 1048576,
      endColumn: 'XFD',
      endRow: 1048576,
      startColIndex: 16383,
      endColIndex: 16383,
      startRowIndex: 1048575,
      endRowIndex: 1048575,
      rowCount: 1,
      colCount: 1,
      cellCount: 1,
      range: 'XFD1048576',
    })
  })

  it('parses valid normal ranges', () => {
    const b2d4 = parseCellRange('B2:D4')
    expect(b2d4).toEqual({
      startColumn: 'B',
      startRow: 2,
      endColumn: 'D',
      endRow: 4,
      startColIndex: 1,
      endColIndex: 3,
      startRowIndex: 1,
      endRowIndex: 3,
      rowCount: 3,
      colCount: 3,
      cellCount: 9,
      range: 'B2:D4',
    })

    const aa10ac20 = parseCellRange('AA10:AC20')
    expect(aa10ac20?.rowCount).toBe(11)
    expect(aa10ac20?.colCount).toBe(3)
    expect(aa10ac20?.cellCount).toBe(33)
    expect(aa10ac20?.range).toBe('AA10:AC20')
  })

  it('canonicalizes reversed ranges into top-to-bottom left-to-right order', () => {
    const reversedBoth = parseCellRange('D4:B2')
    expect(reversedBoth?.range).toBe('B2:D4')
    expect(reversedBoth?.startColumn).toBe('B')
    expect(reversedBoth?.startRow).toBe(2)
    expect(reversedBoth?.endColumn).toBe('D')
    expect(reversedBoth?.endRow).toBe(4)
    expect(reversedBoth?.cellCount).toBe(9)

    const reversedCols = parseCellRange('D2:B4')
    expect(reversedCols?.range).toBe('B2:D4')

    const reversedRows = parseCellRange('B4:D2')
    expect(reversedRows?.range).toBe('B2:D4')

    const singleCellRange = parseCellRange('A1:A1')
    expect(singleCellRange?.range).toBe('A1')
  })

  it('canonicalizeCellRange helper function works', () => {
    expect(canonicalizeCellRange('B2:D4')).toBe('B2:D4')
    expect(canonicalizeCellRange('D4:B2')).toBe('B2:D4')
    expect(canonicalizeCellRange('A1')).toBe('A1')
  })

  it('rejects invalid, malformed, or out-of-bound cell ranges', () => {
    expect(parseCellRange('')).toBeNull()
    expect(parseCellRange('A0')).toBeNull()
    expect(parseCellRange('0')).toBeNull()
    expect(parseCellRange('A')).toBeNull()
    expect(parseCellRange('1')).toBeNull()
    expect(parseCellRange('A1:')).toBeNull()
    expect(parseCellRange(':A1')).toBeNull()
    expect(parseCellRange('A1:B')).toBeNull()
    expect(parseCellRange('R1C1')).toBeNull()
    expect(parseCellRange('A-1')).toBeNull()
    expect(parseCellRange('A1:B-2')).toBeNull()
    expect(parseCellRange('XFE1')).toBeNull() // column beyond XFD (16384)
    expect(parseCellRange(`A${MAX_ROW_INDEX + 1}`)).toBeNull() // row beyond 1048576
    expect(parseCellRange('A1:A1:A1')).toBeNull()
    expect(parseCellRange('invalid')).toBeNull()
  })

  it('exposes Excel limits constants', () => {
    expect(MAX_COLUMN_NAME).toBe('XFD')
    expect(MAX_COLUMN_INDEX).toBe(16383) // 0-based
    expect(MAX_ROW_INDEX).toBe(1048576) // 1-based max row
  })
})
