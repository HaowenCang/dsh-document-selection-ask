// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'
import { initWasm, type XlsxViewerController } from '@extend-ai/react-xlsx'

describe('XLSX Public API Displayed Values Integration', () => {
  let wasmBytes: Uint8Array

  beforeAll(async () => {
    const wasmPath = resolve(process.cwd(), 'node_modules/@extend-ai/react-xlsx/dist/duke_sheets_wasm_bg.wasm')
    wasmBytes = new Uint8Array(readFileSync(wasmPath))
    await initWasm(wasmBytes.buffer)
  })

  it('retrieves calculated and formatted displayed values from formula-values.xlsx via public API', async () => {
    const filePath = resolve(process.cwd(), 'tests/fixtures/xlsx/formula-values.xlsx')
    const fileBytes = new Uint8Array(readFileSync(filePath))

    const duke = await initWasm()
    const wb = duke.Workbook.fromBytes(fileBytes)
    expect(wb.sheetCount).toBe(1)
    const sheet = wb.getSheet(0)
    expect(sheet.name).toBe('Sheet1')

    // Formula cell: A3 is row 2, col 0
    const a3Formula = sheet.getFormulaAt(2, 0)
    const a3Display = sheet.getFormattedValueAt(2, 0)
    expect(a3Formula).toBe('=SUM(A1:A2)')
    expect(a3Display).toBe('30') // Must be calculated result 30, not formula string alone

    // Currency cell: B1 is row 0, col 1
    const b1Display = sheet.getFormattedValueAt(0, 1)
    expect(b1Display).toBe('$1,234.50')

    // Percentage cell: B2 is row 1, col 1
    const b2Display = sheet.getFormattedValueAt(1, 1)
    expect(b2Display).toBe('12.5%')

    // Date cell: B3 is row 2, col 1
    const b3Display = sheet.getFormattedValueAt(2, 1)
    expect(b3Display).toBe('2026-09-18')
  })

  it('reads simple.xlsx table structure via public API', async () => {
    const filePath = resolve(process.cwd(), 'tests/fixtures/xlsx/simple.xlsx')
    const fileBytes = new Uint8Array(readFileSync(filePath))

    const duke = await initWasm()
    const wb = duke.Workbook.fromBytes(fileBytes)
    const sheet = wb.getSheet(0)
    expect(sheet.name).toBe('Sheet1')

    // Row 0: Name, Qty, Price
    expect(sheet.getFormattedValueAt(0, 0)).toBe('Name')
    expect(sheet.getFormattedValueAt(0, 1)).toBe('Qty')
    expect(sheet.getFormattedValueAt(0, 2)).toBe('Price')

    // Row 1: Apple, 2, 3.50
    expect(sheet.getFormattedValueAt(1, 0)).toBe('Apple')
    expect(sheet.getFormattedValueAt(1, 1)).toBe('2')
    expect(sheet.getFormattedValueAt(1, 2)).toBe('3.50')

    // Row 3: 中文, 6, 1.00
    expect(sheet.getFormattedValueAt(3, 0)).toBe('中文')
    expect(sheet.getFormattedValueAt(3, 1)).toBe('6')
    expect(sheet.getFormattedValueAt(3, 2)).toBe('1.00')
  })

  it('reads sheet names with spaces and Unicode from multi-sheet.xlsx', async () => {
    const filePath = resolve(process.cwd(), 'tests/fixtures/xlsx/multi-sheet.xlsx')
    const fileBytes = new Uint8Array(readFileSync(filePath))

    const duke = await initWasm()
    const wb = duke.Workbook.fromBytes(fileBytes)
    expect(wb.sheetCount).toBe(3)
    expect(wb.getSheet(0).name).toBe('Summary')
    expect(wb.getSheet(1).name).toBe('Data 2026')
    expect(wb.getSheet(2).name).toBe('中文表')
  })
})
