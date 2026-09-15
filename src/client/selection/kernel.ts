/**
 * Transient selection state.
 *
 * The kernel owns the one piece of mutable state the Ask flow has: the selection
 * captured most recently, held between the moment the reader releases the mouse
 * and the moment they click the Ask button. That interval is why the state
 * exists at all — a click on a floating button moves focus and collapses the
 * browser selection, so anything read at click time would already be gone.
 *
 * Two behaviours follow from that purpose, and both are asserted in
 * `tests/unit/selection/kernel.spec.ts` rather than left to convention.
 *
 * A capture that produced no selection **clears** the stored snapshot. Skipping
 * the clear would leave the overlay offering to quote text the reader has since
 * deselected, and the failure would look like a stale-overlay bug rather than a
 * state bug.
 *
 * Notification is edge-triggered on object identity, not on a text comparison.
 * Every successful capture stores a new snapshot object, so every successful
 * capture is a state change; `clear()` and a rejection are changes only when a
 * snapshot was actually present. Comparing snapshot contents instead would be
 * both more expensive and wrong: two selections of the same words at different
 * positions are different selections, and the overlay has to move.
 *
 * The kernel reads no browser globals and imports no React. It receives the
 * context from the caller, which is what keeps the capture order — validate,
 * then store, then notify — testable without a document.
 */

import type { SelectionAdapterRegistry, SelectionCapture, SelectionContext } from './registry.js'
import type { SelectionSnapshot } from './types.js'

/**
 * The transient selection store the Ask UI observes.
 *
 * Obtain one from {@link createSelectionKernel}; the interface is exported so
 * consumers and tests can depend on the contract without constructing the
 * implementation.
 */
export interface SelectionKernel {
  /**
   * Dispatch a context through the registry and store the outcome.
   * @param context - the candidate selection and its capture metadata.
   * @returns the registry's verdict, rejection reason included, unchanged.
   */
  capture(context: SelectionContext): SelectionCapture
  /** Drop the stored snapshot. Idempotent, and silent when already empty. */
  clear(): void
  /**
   * Read the stored snapshot.
   * @returns the snapshot captured most recently, or `null` when none is live.
   */
  getSnapshot(): SelectionSnapshot | null
  /**
   * Observe state changes.
   * @param listener - called after each capture or clear that changed the state.
   * @returns an idempotent disposer that stops further calls to `listener`.
   */
  subscribe(listener: () => void): () => void
}

/**
 * Build a kernel over a registry.
 *
 * The registry is injected rather than imported so an application and its tests
 * can each own an isolated adapter set, and so the kernel holds no module-level
 * state: two kernels over one registry stay independent, which is what lets a
 * test construct a kernel per case without resetting a singleton.
 *
 * @param registry - the adapter dispatch table to capture through.
 * @returns a kernel with no snapshot and no listeners.
 */
export function createSelectionKernel(registry: SelectionAdapterRegistry): SelectionKernel {
  let current: SelectionSnapshot | null = null
  const listeners = new Set<() => void>()

  /** Publish a state change to every live listener, in subscription order. */
  function notify(): void {
    for (const listener of [...listeners]) {
      listener()
    }
  }

  return {
    capture(context: SelectionContext): SelectionCapture {
      const result = registry.capture(context)
      const next = result.snapshot

      if (next !== null) {
        current = next
        notify()
        return result
      }

      // A rejection is not a no-op: it is the statement that no selection is
      // live right now, which is exactly what invalidates the previous one.
      if (current !== null) {
        current = null
        notify()
      }
      return result
    },

    clear(): void {
      if (current === null) {
        return
      }
      current = null
      notify()
    },

    getSnapshot(): SelectionSnapshot | null {
      return current
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      let disposed = false

      return () => {
        // Idempotent for the same reason the registry disposer is: cleanup
        // paths run more than once, and a second call must not remove a
        // different listener that happens to be at the same position.
        if (disposed) {
          return
        }
        disposed = true
        listeners.delete(listener)
      }
    },
  }
}
