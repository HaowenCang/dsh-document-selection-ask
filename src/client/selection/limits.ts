/**
 * Selection size limit.
 *
 * The limit is one documented number, so this module holds one constant and one
 * comparison. It exists as its own module because the number must be read by the
 * capture path, the overlay, and the tests without any of them owning it, and
 * because "too large" is a rejection rather than a rewrite: a truncated
 * selection would quote a fragment the user never chose, and the model would
 * answer about text that is not on screen.
 *
 * The unit is UTF-16 code units, which is exactly `String.prototype.length` in
 * JavaScript. Counting code points or UTF-8 bytes instead would let a selection
 * of CJK text or emoji exceed the prompt budget the contract advertises.
 */

import type { SelectionRejectReason, SelectionSnapshot } from './types.js'

/** Maximum selection length in UTF-16 code units. */
export const MAX_SELECTION_CODE_UNITS = 16_384

/**
 * Check a snapshot's text against the size limit.
 *
 * The caller decides what to do with the reason: the capture path reports it to
 * the overlay and leaves the draft untouched. This function never truncates and
 * never mutates the snapshot.
 *
 * @param snapshot - the captured selection.
 * @returns `'too-large'` when the text exceeds the limit, otherwise `null`.
 */
export function validateSelectionSize(snapshot: SelectionSnapshot): SelectionRejectReason | null {
  return snapshot.text.length > MAX_SELECTION_CODE_UNITS ? 'too-large' : null
}
