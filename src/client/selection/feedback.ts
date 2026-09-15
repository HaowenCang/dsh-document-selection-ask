/**
 * Transient rejection feedback for the Ask flow.
 *
 * Most of the ways a capture can come back empty are not failures at all: the
 * reader clicked into a paragraph, dragged across an input, released over the
 * transcript, or started a selection in the chat and finished it in the preview.
 * Those are ordinary gestures and the product stays silent for them. The size
 * limit is different. `too-large` means a real selection inside a supported
 * preview that this plugin declines to quote, and staying silent there would
 * read as a broken button rather than as a documented limit.
 *
 * The rejection is deliberately **not** stored on the snapshot.
 * `SelectionSnapshot` describes a selection that exists; a refused capture
 * produced no selection, and widening the snapshot to carry its own refusal
 * would make every consumer handle a state that cannot be quoted. The two live
 * on separate sources, so a capture that succeeded and a capture that was
 * refused cannot be confused by whoever reads them.
 *
 * This module imports no React: it is the store the overlay observes, not part
 * of the overlay, and the browser lifecycle owns the reporting side.
 */

import type { SelectionRejectReason } from './types.js'

/** The one thing the Ask UI has to say about a refused capture. */
export type SelectionFeedback = { readonly kind: 'too-large' } | null

/**
 * Map a rejection reason to what the reader is told.
 *
 * Only the size limits are surfaced. `too-many-cells` is the same class of
 * statement as `too-large`: a real selection inside a supported preview that the
 * product declines, with a limit the reader can act on. Everything else —
 * `collapsed`, `outside-supported-preview`, `cross-root`, `interactive-control`,
 * `empty-after-normalization`, `renderer-not-ready` — describes an ordinary
 * gesture rather than a refusal, and reporting it would put an error in front of
 * the reader for clicking in a paragraph.
 *
 * @param reason - the reason a capture was refused.
 * @returns the feedback to publish, or `null` when the reason stays silent.
 */
function feedbackFor(reason: SelectionRejectReason): SelectionFeedback {
  switch (reason) {
    case 'too-large':
      return { kind: 'too-large' }
    default:
      return null
  }
}

/**
 * Observable feedback slot the overlay renders.
 *
 * The shape is the framework's own snapshot-source currency (`getSnapshot` plus
 * `subscribe`), which is what lets the overlay hand it straight to the slot
 * `inject` hooks compartment instead of wrapping it in a component-local
 * subscription.
 */
export interface SelectionFeedbackSource {
  /**
   * Read the current feedback.
   * @returns the live feedback, or `null` when there is nothing to say.
   */
  getSnapshot(): SelectionFeedback
  /**
   * Observe feedback changes.
   * @param listener - called after each change, never for an unchanged value.
   * @returns an idempotent disposer that stops further calls to `listener`.
   */
  subscribe(listener: () => void): () => void
  /**
   * Publish the feedback implied by one capture outcome.
   * @param reason - the reason a capture was refused, or `null` for a capture
   * that succeeded; a reason outside the reported set clears the feedback.
   */
  report(reason: SelectionRejectReason | null): void
  /** Drop the current feedback. Idempotent, and silent when already clear. */
  clear(): void
}

/**
 * Build a feedback source.
 *
 * One instance is owned by the client registration and shared by the browser
 * lifecycle, which reports, and the overlay, which renders. It holds no
 * module-level state, so a hot reload cannot leave two instances disagreeing
 * about what the reader is being told.
 *
 * @returns a source with no feedback and no listeners.
 */
export function createSelectionFeedback(): SelectionFeedbackSource {
  let current: SelectionFeedback = null
  const listeners = new Set<() => void>()

  /** Publish a state change to every live listener, in subscription order. */
  function notify(): void {
    for (const listener of [...listeners]) {
      listener()
    }
  }

  return {
    getSnapshot(): SelectionFeedback {
      return current
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      let disposed = false

      return () => {
        if (disposed) {
          return
        }
        disposed = true
        listeners.delete(listener)
      }
    },

    report(reason: SelectionRejectReason | null): void {
      const next = reason === null ? null : feedbackFor(reason)
      if (next === null) {
        // A silent reason clears rather than being ignored: the reader has moved
        // on from the refused selection, so a stale limit notice must not stay
        // on screen while their next gesture does nothing.
        this.clear()
        return
      }

      if (current !== null && current.kind === next.kind) {
        return
      }
      current = next
      notify()
    },

    clear(): void {
      if (current === null) {
        return
      }
      current = null
      notify()
    },
  }
}
