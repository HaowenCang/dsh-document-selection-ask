/**
 * XLSX cell-range serialization.
 *
 * A cell range has no text to quote: what the user selected is a rectangle of
 * displayed values. This module renders that rectangle as data, in one of two
 * shapes chosen by a fixed policy — a Markdown table while the range is small and
 * no cell holds a line break, a TSV fenced block otherwise. The policy is frozen
 * here rather than decided per call site, because the same selection must always
 * produce the same prompt.
 *
 * The header row is synthetic. A spreadsheet range carries no header semantics,
 * so promoting the first selected row to a header would drop a data row into
 * chrome; labelling the columns keeps every selected value as data.
 *
 * `MAX_XLSX_SELECTED_CELLS` lives here as the documented limit, but the
 * enforcement point is the adapter, which is the only layer that knows a cell
 * count. Keeping the count out of `SelectionSnapshot` is deliberate: it would be
 * an XLSX-only field on all eight formats.
 */

import { breakFenceRun, escapeMarkdownTableCell } from './escape-markdown.js'

/** Documented per-selection cell limit; enforced by the XLSX adapter. */
export const MAX_XLSX_SELECTED_CELLS = 200

/** Largest row count that still renders as a Markdown table. */
const MAX_TABLE_ROWS = 20

/** Largest column count that still renders as a Markdown table. */
const MAX_TABLE_COLUMNS = 12

/** Language tag for the TSV fallback fence. */
const TSV_FENCE_LANGUAGE = 'tsv'

/** Line breaks that force the TSV fallback: a Markdown table cell cannot hold one. */
const LINE_BREAK = /\r\n|[\r\n\u2028\u2029]/

/** Tab breaks a TSV cell, since the tab is the delimiter. */
const TAB = /\t/g

/**
 * Serialize a selected rectangle of displayed cell values.
 *
 * @param values - rows of displayed values, in sheet order.
 * @returns a Markdown table, a TSV fenced block, or the empty string when there
 * is nothing to serialize.
 */
export function formatXlsxValues(values: readonly (readonly string[])[]): string {
  const rows = values.filter((row) => row.length > 0)
  const first = rows[0]
  if (first === undefined) return ''

  const columns = Math.max(...rows.map((row) => row.length))
  const needsTsv =
    rows.length > MAX_TABLE_ROWS ||
    columns > MAX_TABLE_COLUMNS ||
    rows.some((row) => row.some((cell) => LINE_BREAK.test(cell)))

  return needsTsv ? formatTsv(rows, columns) : formatMarkdownTable(rows, columns)
}

/**
 * Read one cell, padding a short row rather than leaving a ragged table.
 * @param row - the row.
 * @param index - the column index.
 * @returns the cell value, or the empty string when the row is short.
 */
function cellAt(row: readonly string[], index: number): string {
  return row[index] ?? ''
}

/**
 * Render rows as a GitHub-flavoured Markdown table.
 * @param rows - non-empty rows of cell values.
 * @param columns - column count, already bounded by the policy.
 * @returns the table.
 */
function formatMarkdownTable(rows: readonly (readonly string[])[], columns: number): string {
  const indexes = Array.from({ length: columns }, (_unused, index) => index)
  const header = `| ${indexes.map((index) => `Column ${index + 1}`).join(' | ')} |`
  const separator = `| ${indexes.map(() => '---').join(' | ')} |`
  const body = rows.map(
    (row) => `| ${indexes.map((index) => escapeMarkdownTableCell(cellAt(row, index))).join(' | ')} |`,
  )

  return [header, separator, ...body].join('\n')
}

/**
 * Render rows as a tab-separated fenced block.
 *
 * The fallback is neither escaped nor truncated: a line break inside a cell
 * becomes a space, because a line-based format cannot carry one without
 * corrupting the row structure. Fence delimiters inside the values are split so
 * document content cannot close the block early.
 *
 * @param rows - non-empty rows of cell values.
 * @param columns - column count to pad each row to.
 * @returns the fenced block.
 */
function formatTsv(rows: readonly (readonly string[])[], columns: number): string {
  const indexes = Array.from({ length: columns }, (_unused, index) => index)
  const body = rows.map((row) =>
    breakFenceRun(
      indexes
        .map((index) => cellAt(row, index).replace(LINE_BREAK, ' ').replace(TAB, ' '))
        .join('\t'),
    ),
  )

  return [`\`\`\`${TSV_FENCE_LANGUAGE}`, ...body, '```'].join('\n')
}
