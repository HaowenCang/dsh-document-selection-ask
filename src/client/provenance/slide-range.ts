/**
 * Slide-range provenance helpers.
 *
 * Converts raw slide markers from the DOM into a validated `SelectionLocation`
 * of kind `slides`.
 *
 * Slide markers must be canonical positive decimal integers. Any non-canonical
 * formatting (leading zeroes, whitespace, decimals, scientific notation,
 * negative numbers, zero, non-integers, or values exceeding safe integer
 * bounds) fails closed by returning `null`.
 *
 * Inverted ranges (`start > end`) are rejected as `null` rather than being
 * silently sorted or normalized, because presentation slide order must be preserved.
 */

import type { SelectionLocation } from '../selection/types.js'

/** Canonical positive decimal integer pattern (no leading zero, no signs, no decimals). */
const CANONICAL_POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/

/**
 * Parse and validate a slide marker string.
 *
 * @param marker - raw marker string from DOM attribute.
 * @returns validated safe integer, or `null` if invalid.
 */
export function parseSlideMarker(marker: string | null): number | null {
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
 * Build a slide-range `SelectionLocation` from start and end slide markers.
 *
 * @param startMarker - start slide attribute value.
 * @param endMarker - end slide attribute value.
 * @returns validated `SelectionLocation` or `null` if invalid/inverted.
 */
export function slideRangeLocation(
  startMarker: string | null,
  endMarker: string | null,
): SelectionLocation | null {
  const start = parseSlideMarker(startMarker)
  const end = parseSlideMarker(endMarker)

  if (start === null || end === null || start > end) {
    return null
  }

  return {
    kind: 'slides',
    start,
    end,
  }
}
