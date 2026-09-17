/**
 * Page-range provenance helpers.
 *
 * This module converts raw page markers from the DOM into a validated
 * `SelectionLocation` of kind `pages`.
 *
 * Page markers must be canonical positive decimal integers. Any non-canonical
 * formatting (leading zeroes, whitespace, decimals, scientific notation,
 * negative numbers, zero, non-integers, or values exceeding safe integer
 * bounds) fails closed by returning `null`.
 *
 * Inverted ranges (`start > end`) are also rejected as `null` rather than being
 * silently sorted or normalized, because document order must be preserved.
 */

import type { SelectionLocation } from '../selection/types.js'

/** Canonical positive decimal integer pattern (no leading zero, no signs, no decimals). */
const CANONICAL_POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/

/**
 * Parse and validate a page marker string.
 *
 * @param marker - raw marker string from DOM attribute.
 * @returns validated safe integer, or `null` if invalid.
 */
function parsePageMarker(marker: string | null): number | null {
  if (marker === null || !CANONICAL_POSITIVE_INTEGER_PATTERN.test(marker)) {
    return null
  }

  const value = Number(marker)
  if (!Number.isSafeInteger(value) || value <= 0) {
    return null
  }

  return value
}

/**
 * Build a page-range `SelectionLocation` from start and end page markers.
 *
 * @param startMarker - start page attribute value.
 * @param endMarker - end page attribute value.
 * @param fidelity - whether pagination is source-proven or rendered.
 * @returns validated `SelectionLocation` or `null` if invalid/inverted.
 */
export function pageRangeLocation(
  startMarker: string | null,
  endMarker: string | null,
  fidelity: 'source' | 'rendered',
): SelectionLocation | null {
  const start = parsePageMarker(startMarker)
  const end = parsePageMarker(endMarker)

  if (start === null || end === null || start > end) {
    return null
  }

  return {
    kind: 'pages',
    start,
    end,
    fidelity,
  }
}
