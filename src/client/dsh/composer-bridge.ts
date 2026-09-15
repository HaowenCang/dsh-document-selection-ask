/**
 * The composer bridge: the only place this plugin writes to a draft.
 *
 * Its whole job is one sentence — take the frozen selection, put it in the
 * composer the reader is looking at, and give the caret back — and every
 * constraint the product has is expressed as what this module refuses to do.
 *
 * **It never submits.** The reader sends their own message, after adding the
 * question they actually want answered. `InputActions` does publish `submit`,
 * and this module deliberately does not name it: a bridge that could send would
 * eventually send, and the failure would be a message the reader never wrote
 * arriving in their conversation.
 *
 * **The draft is read at click time, not at capture time.** The reader may
 * select text, type a paragraph, and only then press Ask. Freezing the draft
 * alongside the snapshot would silently discard everything typed in between,
 * because the write replaces the whole draft. The current value therefore comes
 * from the composer's own published state through the hook the slot hands the
 * overlay, and the argument that is frozen is the selection, which is the thing
 * that really cannot be re-read after the click.
 *
 * **The append is additive.** `appendSelectionToDraft` is reused rather than
 * reimplemented, so a draft that already contains a quoted block — including one
 * with the same question suffix — keeps it and gains a second block below. No
 * existing text is rewritten, moved or removed.
 *
 * **A refused write changes nothing.** If `setDraft` throws, the snapshot stays
 * in the kernel, the feedback stays untouched and focus is not moved: the reader
 * keeps the button, and with it the opportunity to retry. Clearing the selection
 * on a failed write would leave them with the text gone from the document, gone
 * from the composer, and no way back.
 */

import { appendSelectionToDraft } from '../quote/format-selection.js'
import { validateSelectionSize } from '../selection/limits.js'
import type { SelectionSnapshot } from '../selection/types.js'

/**
 * Why an Ask transaction produced no draft.
 *
 * This union belongs to the writer, not to the selection pipeline, and the split
 * is a domain statement rather than a naming one. `SelectionRejectReason` answers
 * "why did capture produce no snapshot"; by the time either of these reasons is
 * produced a valid snapshot exists. Folding a refused write into that union would
 * file it beside `collapsed` and `renderer-not-ready` and invite a diagnosis of
 * the document renderer for a failure that happened in the composer.
 *
 * Two members, each with a distinct consequence for the caller, and no catch-all:
 *
 * - `too-large` — the snapshot exceeds the documented limit. Nothing was read
 *   and nothing was written; the selection is not quotable at all.
 * - `draft-write-failed` — the composer refused the write. The snapshot is still
 *   valid and still stored, so the reader keeps the button and can retry.
 *
 * A member is added here only when the bridge itself can prove it produces that
 * failure. `reason: string` would move the same confusion to the type level and
 * make every caller's handling unverifiable.
 */
export type AskFailureReason = 'too-large' | 'draft-write-failed'

/** What the Ask transaction produced. */
export type AskOutcome =
  | { readonly ok: true; readonly draft: string }
  | { readonly ok: false; readonly reason: AskFailureReason }

/**
 * The composer contract the bridge writes through.
 *
 * Both members are injected, never looked up. `setDraft` is the public action
 * face; `focus` is a callback the overlay supplies, because only the overlay
 * knows the DOM position of the composer it belongs to.
 */
export interface ComposerTarget {
  /**
   * Read the current draft.
   * @returns the draft as the composer holds it right now.
   */
  readDraft(): string
  /**
   * Replace the whole draft through the public action face.
   * @param text - the complete next draft.
   */
  setDraft(text: string): void
  /** Return keyboard focus to this composer. */
  focus(): void
}

/** The bridge, as the overlay consumes it. */
export interface ComposerBridge {
  /**
   * Append one selection's quote block to the current draft.
   * @param snapshot - the frozen selection to quote.
   * @returns the outcome; on failure nothing has been written or cleared.
   */
  appendSelection(snapshot: SelectionSnapshot): AskOutcome
  /** Return keyboard focus to the composer. Safe to call when it is already focused. */
  focus(): void
}

/**
 * Build the composer bridge over a composer target.
 *
 * @param target - the injected composer contract.
 * @returns the bridge.
 */
export function createComposerBridge(target: ComposerTarget): ComposerBridge {
  return {
    appendSelection(snapshot: SelectionSnapshot): AskOutcome {
      // The limit is re-checked here rather than trusted from capture time: the
      // bridge is the last point before a write, and a snapshot that reached it
      // must satisfy the same contract the capture path enforces. A refusal
      // writes nothing.
      //
      // The comparison is the one case that can actually occur, not a test for
      // "any rejection": the limit check answers with `'too-large'` or nothing,
      // so the branch is exhaustive by construction and no cast is needed to
      // bring its answer into this module's own failure union.
      const reason = validateSelectionSize(snapshot)
      if (reason === 'too-large') {
        return { ok: false, reason: 'too-large' }
      }

      const nextDraft = appendSelectionToDraft(target.readDraft(), snapshot)

      try {
        target.setDraft(nextDraft)
      } catch (error) {
        // Swallowed deliberately: this runs inside a click handler in the DSH
        // UI, where an exception would surface as a component crash on top of a
        // draft the reader can still recover. The failure is reported as an
        // outcome so the caller can leave the selection intact. Nothing about
        // the draft or the captured text is logged: both are the reader's
        // content, and a selection may be a confidential document.
        void error
        return { ok: false, reason: 'draft-write-failed' }
      }

      target.focus()
      return { ok: true, draft: nextDraft }
    },

    focus(): void {
      target.focus()
    },
  }
}
