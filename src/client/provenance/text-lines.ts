/**
 * Source-line location construction.
 *
 * A line range is the strongest provenance this plugin can state: `第 42–51 行`
 * claims the quoted text sits on those physical lines of the named file, and a
 * reader can check it. Two bounds are therefore validated before the location
 * exists at all, rather than at the point a prompt is formatted — a location
 * built from a renderer's row index, or from a parser that silently accepted an
 * empty attribute, would produce a citation that looks precise and is wrong.
 *
 * Both bounds are inclusive and 1-based, matching the numbering a line gutter
 * shows and the `data-textpreview-line` attribute the plain renderer emits.
 *
 * The module is pure and holds no DOM knowledge. Which rows of a renderer
 * correspond to which source line is an adapter question and is answered in
 * `adapters/dsh-text/lines.ts`; this layer only decides whether a pair of numbers
 * may be published as a source position.
 */

import type { SelectionLocation } from '../selection/types.js'

/**
 * Build a source-line selection location.
 *
 * @param start - inclusive first source line, 1-based.
 * @param end - inclusive last source line, 1-based.
 * @returns the line location.
 * @throws RangeError when either bound is not a positive integer, or when the
 * range is inverted. Both are programming errors: a renderer that cannot prove
 * the mapping must fall back to `{ kind: 'document' }` instead of guessing.
 */
export function textLineLocation(start: number, end: number): SelectionLocation {
  if (!Number.isInteger(start) || start < 1) {
    throw new RangeError(`Invalid source line: start must be a positive integer, received ${start}`)
  }

  if (!Number.isInteger(end) || end < 1) {
    throw new RangeError(`Invalid source line: end must be a positive integer, received ${end}`)
  }

  if (start > end) {
    throw new RangeError(`Invalid source line range: start ${start} exceeds end ${end}`)
  }

  return { kind: 'lines', start, end }
}
