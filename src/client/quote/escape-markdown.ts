/**
 * Minimal Markdown escaping for generated content.
 *
 * The generated quote is a blockquote, and blockquote structure is carried by
 * the `> ` prefix that the quote formatter adds to every line — not by escaping
 * the selected text. That is deliberate: the operator asked for their selection
 * to survive verbatim, and rewriting `#` or `*` inside a code selection would
 * corrupt exactly the text they wanted to ask about.
 *
 * Two characters cannot be left alone, and only one construct needs them.
 * Markdown table cells are delimited by `|` and `\` introduces an escape, so a
 * cell value containing either would break the column structure of a generated
 * table. Both helpers here are therefore scoped to table cells and to fence
 * delimiters; nothing in this module rewrites ordinary prose.
 */

/** Backslash first: escaping it after `|` would double the escape it introduces. */
const BACKSLASH = /\\/g
const PIPE = /\|/g

/** Zero-width space, inserted to stop ``` runs from closing an enclosing fence. */
const FENCE_BREAKER = '\u200b'

const FENCE_RUN = /`{3,}/g

/**
 * Escape one Markdown table cell.
 *
 * @param cell - the raw cell text.
 * @returns the cell with backslashes and pipes escaped, newlines untouched.
 */
export function escapeMarkdownTableCell(cell: string): string {
  return cell.replace(BACKSLASH, '\\\\').replace(PIPE, '\\|')
}

/**
 * Split a ``` run that would otherwise close an enclosing code fence.
 *
 * A zero-width space is inserted between the first two backticks, so the run is
 * no longer a fence delimiter and the visible text is unchanged.
 *
 * @param line - one line of fenced-block content.
 * @returns the line with any run of three or more backticks broken.
 */
export function breakFenceRun(line: string): string {
  return line.replace(FENCE_RUN, (run) => `${run.slice(0, 2)}${FENCE_BREAKER}${run.slice(2)}`)
}
