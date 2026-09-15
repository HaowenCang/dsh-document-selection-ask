/**
 * XLSX table serialization contract.
 *
 * A cell range has no text to quote: what the user selected is a rectangle of
 * displayed values, and the honest rendering of a rectangle is a table. The
 * policy is frozen at the design level — a Markdown table while the shape is
 * small and no cell holds a line break, a TSV fenced block otherwise — and the
 * two shapes are asserted here rather than chosen per call site, because a
 * workbook that renders as a table in one range and as TSV in the next would
 * make the same selection produce two different prompts.
 *
 * The header row is synthetic (`Column 1`, `Column 2`, …). A spreadsheet range
 * has no header semantics: treating the first selected row as a header would
 * silently drop a data row into the header, so the formatter labels the columns
 * instead and keeps every selected value as data.
 *
 * Cell count is deliberately absent from this module and from
 * `SelectionSnapshot`. The 200-cell limit belongs to the XLSX adapter, which is
 * the only layer holding the cell count; adding `cellCount` to the universal
 * snapshot would put an XLSX-only field on all eight formats.
 */

import { describe, expect, it } from 'vitest'

import { MAX_XLSX_SELECTED_CELLS, formatXlsxValues } from '../../../src/client/quote/format-xlsx.js'

/** The B2:D4 range from the design specification. */
const revenue = [
  ['Revenue', '120', '135'],
  ['Cost', '80', '92'],
  ['Margin', '40', '43'],
]

describe('formatXlsxValues', () => {
  it('renders a small range as a Markdown table with synthetic column headers', () => {
    expect(formatXlsxValues(revenue)).toBe(
      '| Column 1 | Column 2 | Column 3 |\n' +
        '| --- | --- | --- |\n' +
        '| Revenue | 120 | 135 |\n' +
        '| Cost | 80 | 92 |\n' +
        '| Margin | 40 | 43 |',
    )
  })

  it('escapes pipes so a cell cannot break the column structure', () => {
    expect(formatXlsxValues([['A | B', '2']])).toBe(
      '| Column 1 | Column 2 |\n| --- | --- |\n| A \\| B | 2 |',
    )
  })

  it('escapes backslashes before pipes', () => {
    // A backslash escaped after its `|` would double the escape it introduces.
    expect(formatXlsxValues([['C:\\path']])).toBe('| Column 1 |\n| --- |\n| C:\\\\path |')
    expect(formatXlsxValues([['a\\|b']])).toBe('| Column 1 |\n| --- |\n| a\\\\\\|b |')
  })

  it('pads a short row so the table keeps a rectangular shape', () => {
    expect(formatXlsxValues([['A', 'B'], ['C']])).toBe(
      '| Column 1 | Column 2 |\n| --- | --- |\n| A | B |\n| C |  |',
    )
  })

  it('renders a single cell as a one-column table', () => {
    expect(formatXlsxValues([['42']])).toBe('| Column 1 |\n| --- |\n| 42 |')
  })

  it('keeps empty cells as empty table cells', () => {
    expect(formatXlsxValues([['', 'B']])).toBe('| Column 1 | Column 2 |\n| --- | --- |\n|  | B |')
  })

  it('stays a Markdown table at the 20-row and 12-column bounds', () => {
    const rows = Array.from({ length: 20 }, (_unused, index) => [`r${index}`])
    const columns = [Array.from({ length: 12 }, (_unused, index) => `c${index}`)]

    expect(formatXlsxValues(rows).split('\n')).toHaveLength(22)
    expect(formatXlsxValues(columns).split('\n')[0]).toBe(
      `| ${Array.from({ length: 12 }, (_unused, index) => `Column ${index + 1}`).join(' | ')} |`,
    )
  })

  it('falls back to TSV when a cell contains a line break', () => {
    // A line-based format cannot carry an embedded newline without corrupting
    // the row structure, so the break becomes a space.
    expect(formatXlsxValues([['A', 'B\nC']])).toBe('```tsv\nA\tB C\n```')
    expect(formatXlsxValues([['A', 'B\r\nC']])).toBe('```tsv\nA\tB C\n```')
  })

  it('falls back to TSV when there are more than 12 columns', () => {
    const row = Array.from({ length: 13 }, (_unused, index) => `c${index}`)
    const result = formatXlsxValues([row])

    expect(result.startsWith('```tsv\n')).toBe(true)
    expect(result).toBe(`\`\`\`tsv\n${row.join('\t')}\n\`\`\``)
  })

  it('falls back to TSV when there are more than 20 rows', () => {
    const rows = Array.from({ length: 21 }, (_unused, index) => [`r${index}`, 'x'])
    const result = formatXlsxValues(rows)

    expect(result.startsWith('```tsv\n')).toBe(true)
    expect(result.split('\n')).toHaveLength(23)
  })

  it('preserves row order and empty cells in the TSV fallback', () => {
    const rows = [
      ['A', ''],
      ['', 'D'],
      ...Array.from({ length: 19 }, () => ['', '']),
    ]

    expect(formatXlsxValues(rows).split('\n').slice(1, 3)).toEqual(['A\t', '\tD'])
    expect(formatXlsxValues(rows).split('\n')).toHaveLength(23)
  })

  it('replaces tabs inside a TSV cell, since the tab is the delimiter', () => {
    const rows = [['A\tB'], ...Array.from({ length: 20 }, () => ['x'])]

    expect(formatXlsxValues(rows).split('\n')[1]).toBe('A B')
  })

  it('splits a fence run inside TSV content so it cannot close the block', () => {
    expect(formatXlsxValues([['```', 'B\nC']])).toBe('```tsv\n``\u200b`\tB C\n```')
  })

  it('returns the empty string for no values', () => {
    expect(formatXlsxValues([])).toBe('')
    expect(formatXlsxValues([[]])).toBe('')
  })

  it('does not mutate the values it is given', () => {
    const values = [['A | B']]
    formatXlsxValues(values)

    expect(values).toEqual([['A | B']])
  })
})

describe('MAX_XLSX_SELECTED_CELLS', () => {
  it('is the documented 200 cells', () => {
    expect(MAX_XLSX_SELECTED_CELLS).toBe(200)
  })
})
