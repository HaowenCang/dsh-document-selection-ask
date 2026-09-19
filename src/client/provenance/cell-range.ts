/**
 * Strict Excel A1 cell range parser and canonicalizer.
 *
 * Enforces Excel worksheet limits (1..1,048,576 rows, A..XFD / 16,384 columns),
 * normalizes reversed ranges (e.g. `D4:B2` -> `B2:D4`), and computes the safe
 * rectangular cell count.
 */

/** Maximum column index in modern Excel (0-based, corresponds to XFD = 16,383). */
export const MAX_COLUMN_INDEX = 16383

/** Maximum column name in modern Excel. */
export const MAX_COLUMN_NAME = 'XFD'

/** Maximum row index in modern Excel (1-based, 1,048,576). */
export const MAX_ROW_INDEX = 1048576

/** A single cell coordinate. */
export interface CellCoordinate {
  readonly column: string
  readonly row: number
  readonly colIndex: number
  readonly rowIndex: number
}

/** Canonicalized rectangular cell range. */
export interface CanonicalCellRange {
  readonly startColumn: string
  readonly startRow: number
  readonly endColumn: string
  readonly endRow: number
  readonly startColIndex: number
  readonly endColIndex: number
  readonly startRowIndex: number
  readonly endRowIndex: number
  readonly rowCount: number
  readonly colCount: number
  readonly cellCount: number
  readonly range: string
}

const CELL_REGEX = /^([A-Z]+)([1-9]\d*)$/

/**
 * Convert column letters (A-Z, AA-ZZ, etc.) to 0-based column index.
 */
export function columnLettersToIndex(letters: string): number {
  let index = 0
  for (let i = 0; i < letters.length; i += 1) {
    const code = letters.charCodeAt(i) - 64 // 'A' is 65 -> 1
    if (code < 1 || code > 26) return -1
    index = index * 26 + code
  }
  return index - 1
}

/**
 * Convert 0-based column index to uppercase column letters.
 */
export function indexToColumnLetters(index: number): string {
  let letters = ''
  let current = index + 1
  while (current > 0) {
    const remainder = (current - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    current = Math.floor((current - 1) / 26)
  }
  return letters
}

/**
 * Parse a single cell address like `A1` or `XFD1048576`.
 */
export function parseCellAddress(address: string): CellCoordinate | null {
  const match = CELL_REGEX.exec(address.trim().toUpperCase())
  if (!match) return null

  const [, colStr, rowStr] = match
  if (!colStr || !rowStr) return null

  const colIndex = columnLettersToIndex(colStr)
  if (colIndex < 0 || colIndex > MAX_COLUMN_INDEX) return null

  const row = Number.parseInt(rowStr, 10)
  if (!Number.isSafeInteger(row) || row < 1 || row > MAX_ROW_INDEX) return null

  return {
    column: colStr,
    row,
    colIndex,
    rowIndex: row - 1,
  }
}

/**
 * Parse an A1 range string (single cell or range) and return its canonical form.
 * Returns null if the range is malformed or out of bounds.
 */
export function parseCellRange(rangeStr: string): CanonicalCellRange | null {
  if (typeof rangeStr !== 'string') return null
  const trimmed = rangeStr.trim()
  if (!trimmed) return null

  if (!trimmed.includes(':')) {
    const single = parseCellAddress(trimmed)
    if (!single) return null
    return {
      startColumn: single.column,
      startRow: single.row,
      endColumn: single.column,
      endRow: single.row,
      startColIndex: single.colIndex,
      endColIndex: single.colIndex,
      startRowIndex: single.rowIndex,
      endRowIndex: single.rowIndex,
      rowCount: 1,
      colCount: 1,
      cellCount: 1,
      range: `${single.column}${single.row}`,
    }
  }

  const parts = trimmed.split(':')
  if (parts.length !== 2) return null

  const cell1Str = parts[0]?.trim()
  const cell2Str = parts[1]?.trim()
  if (!cell1Str || !cell2Str) return null

  const cell1 = parseCellAddress(cell1Str)
  const cell2 = parseCellAddress(cell2Str)
  if (!cell1 || !cell2) return null

  const minCol = Math.min(cell1.colIndex, cell2.colIndex)
  const maxCol = Math.max(cell1.colIndex, cell2.colIndex)
  const minRow = Math.min(cell1.row, cell2.row)
  const maxRow = Math.max(cell1.row, cell2.row)

  const rowCount = maxRow - minRow + 1
  const colCount = maxCol - minCol + 1
  const cellCount = rowCount * colCount
  if (!Number.isSafeInteger(cellCount)) return null

  const startColLetters = indexToColumnLetters(minCol)
  const endColLetters = indexToColumnLetters(maxCol)

  const canonicalRange =
    minCol === maxCol && minRow === maxRow
      ? `${startColLetters}${minRow}`
      : `${startColLetters}${minRow}:${endColLetters}${maxRow}`

  return {
    startColumn: startColLetters,
    startRow: minRow,
    endColumn: endColLetters,
    endRow: maxRow,
    startColIndex: minCol,
    endColIndex: maxCol,
    startRowIndex: minRow - 1,
    endRowIndex: maxRow - 1,
    rowCount,
    colCount,
    cellCount,
    range: canonicalRange,
  }
}

/**
 * Return the canonical string representation of an A1 range (or null if invalid).
 */
export function canonicalizeCellRange(rangeStr: string): string | null {
  const parsed = parseCellRange(rangeStr)
  return parsed?.range ?? null
}
