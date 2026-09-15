/**
 * Selection text normalization.
 *
 * A captured selection is transport noise wrapped around content: the browser
 * hands back `\r\n` on Windows line breaks, renderers leave markup padding at
 * line ends, and a drag across an empty region yields nothing but whitespace.
 * The prompt contract, by contrast, must quote exactly what the reader selected.
 *
 * The rules below therefore stay conservative. They remove padding and bound
 * pathological blank runs, while leaving internal spacing, tabs, indentation and
 * every Unicode code point untouched: a collapsed `a    b` would silently
 * rewrite source code, and a re-indented line would misreport a code selection
 * the user can still see on screen.
 *
 * Renderer-specific repair — PDF TextLayer glyph breaks, for example — is
 * deliberately out of scope. Each adapter owns the fake line breaks its own
 * renderer introduces, and applies that repair before calling this function.
 */

/** Two blank lines: the largest blank run a selection may carry. */
const MAX_BLANK_LINES = 2

/**
 * Run of three or more newlines means more than two blank lines: `a\n\nb` is one
 * blank line, `a\n\n\nb` is two, so the first run that must be bounded starts at
 * four and is rewritten to the three that encode the documented maximum.
 */
const LEADING_BLANK_LINES = /^\n+/
const TRAILING_BLANK_LINES = /\n+$/
const EXCESSIVE_BLANK_RUN = new RegExp(`\\n{${MAX_BLANK_LINES + 2},}`, 'g')
const BOUNDED_BLANK_RUN = '\n'.repeat(MAX_BLANK_LINES + 1)

/** Spaces and tabs only: parity with `String.prototype.trimEnd`, no Unicode spaces. */
const LINE_END_PADDING = /[ \t]+$/

/**
 * Normalize captured selection text for the prompt contract.
 *
 * The transformation, in order: `\r\n` and lone `\r` become `\n`; spaces and
 * tabs are stripped from every line end; leading and trailing blank lines are
 * dropped; and any run of more than two blank lines is reduced to exactly two.
 * Whitespace-only input normalizes to the empty string, which callers treat as
 * `empty-after-normalization` rather than as a selectable region.
 *
 * @param text - the raw selection text as the active adapter captured it.
 * @returns the normalized text, possibly empty.
 */
export function normalizeSelectedText(text: string): string {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(LINE_END_PADDING, ''))

  return lines
    .join('\n')
    .replace(EXCESSIVE_BLANK_RUN, BOUNDED_BLANK_RUN)
    .replace(LEADING_BLANK_LINES, '')
    .replace(TRAILING_BLANK_LINES, '')
}
