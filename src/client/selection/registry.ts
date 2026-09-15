/**
 * Format adapter registry.
 *
 * A preview root belongs to exactly one format, and that format is the only
 * component that can read its selection correctly: a PDF page knows which page
 * a text layer node sits on, an XLSX viewer knows the address of the cell under
 * the pointer, and neither can be reconstructed from the DOM afterwards. The
 * registry is therefore a dispatch table with two load-bearing rules.
 *
 * **Registration order decides ownership.** Adapters are consulted in the order
 * they were registered and the first one whose `canHandle` accepts the context
 * captures it. Registration order is how the plugin states its precedence — the
 * semantic XLSX range adapter before the generic DOM-root adapters, and the
 * DSH text adapter last — so a later adapter cannot silently take a selection
 * away from an earlier one. A "last registration wins" rule would make the
 * outcome depend on module evaluation order, which is exactly the kind of
 * accident that produces an intermittent provenance bug in a real app.
 *
 * **A claimed context is owned, including its rejection.** Once `canHandle`
 * returns true, that adapter's result is final, and a rejection is not retried
 * against the remaining adapters. The reason is a security property rather than
 * a tidiness one: the adapters that reject are the ones enforcing scope. A PDF
 * adapter rejecting a selection whose endpoints left its page, or a text adapter
 * rejecting a gesture that started in the composer, must not be second-guessed
 * by a more permissive adapter registered behind it. Falling through would let
 * the permissive adapter re-admit the selection the scoped adapter refused.
 *
 * The registry holds no selection state and reads no browser globals. The
 * caller supplies the {@link SelectionContext}, which keeps the whole module
 * testable without a DOM and keeps `window.getSelection()` confined to the
 * lifecycle layer that owns the event wiring.
 */

import type { SelectionRejectReason, SelectionSnapshot } from './types.js'

/**
 * Everything an adapter may look at while deciding whether a selection belongs
 * to it.
 *
 * `target` is the event target that produced the capture — for a `pointerup`
 * selection, the node under the pointer. It is a hint for root resolution, not
 * a substitute for validating the selection's own endpoints, because the target
 * of a keyboard-driven selection is the focused element rather than the
 * selected content.
 */
export interface SelectionContext {
  /** The live browser selection, or `null` when none exists. */
  readonly selection: Selection | null
  /** Node the capture was triggered from, when the caller has one. */
  readonly target: Node | null
  /** Capture time as `Date.now()` milliseconds; adapters copy it into snapshots. */
  readonly now: number
}

/**
 * An adapter's verdict on one context.
 *
 * Exactly one of the two fields is meaningful: a successful capture carries a
 * snapshot and no reason, a refusal carries a reason and no snapshot. The pair
 * is kept together rather than expressed as a nullable snapshot so that a
 * refusal cannot be confused with "this adapter declined to answer" — the
 * registry distinguishes those two cases, and so must the type.
 */
export interface SelectionCapture {
  /** The captured selection, or `null` when the capture was refused. */
  readonly snapshot: SelectionSnapshot | null
  /** Why the capture was refused, or `null` when a snapshot was produced. */
  readonly rejectReason: SelectionRejectReason | null
}

/**
 * One document format's selection implementation.
 *
 * `canHandle` must be a cheap, side-effect-free ownership test: it is called on
 * every capture attempt, for every registered adapter, until one accepts. It
 * should answer "is this selection inside a root I own", not "is this selection
 * valid" — validation, normalization and limit enforcement belong to `capture`,
 * whose rejection is authoritative for a root the adapter has claimed.
 */
export interface SelectionAdapter {
  /** Stable identifier; also the `adapterId` recorded in captured snapshots. */
  readonly id: string
  /**
   * Whether this adapter owns the context.
   * @param context - the candidate selection and its capture metadata.
   * @returns true when this adapter should capture the context.
   */
  canHandle(context: SelectionContext): boolean
  /**
   * Capture the selection, or refuse it with a reason.
   * @param context - the context this adapter claimed via `canHandle`.
   * @returns the snapshot or the rejection reason.
   */
  capture(context: SelectionContext): SelectionCapture
}

/**
 * Result for a context that no adapter claimed.
 *
 * A frozen constant rather than a fresh object per call, because the value is
 * the same fact every time and callers are expected to branch on
 * `rejectReason`, not to mutate the result.
 */
const NO_ADAPTER_CAPTURE: SelectionCapture = Object.freeze({
  snapshot: null,
  rejectReason: 'outside-supported-preview' as const,
})

/**
 * Ordered dispatch table of format adapters.
 *
 * Instances are created by the plugin's client entry and shared with the
 * selection kernel; the class is exported so tests can build an isolated
 * registry rather than reaching into a module-level singleton.
 */
export class SelectionAdapterRegistry {
  /** Live adapters in registration order. */
  readonly #adapters: SelectionAdapter[] = []

  /**
   * Register an adapter, giving it ownership of every context it later claims.
   *
   * @param adapter - the format adapter to add.
   * @returns an idempotent disposer that removes this registration.
   * @throws RangeError when a live adapter already uses the same `id`, which
   * would make snapshot `adapterId` ambiguous.
   */
  register(adapter: SelectionAdapter): () => void {
    if (this.#adapters.some((registered) => registered.id === adapter.id)) {
      throw new RangeError(`selection adapter id is already registered: ${adapter.id}`)
    }

    this.#adapters.push(adapter)
    let disposed = false

    return () => {
      // Idempotent: a disposer is commonly called from both a cleanup effect
      // and an error path, and a second call must be a no-op rather than a
      // removal of whatever now occupies the index.
      if (disposed) {
        return
      }
      disposed = true
      const index = this.#adapters.indexOf(adapter)
      if (index !== -1) {
        this.#adapters.splice(index, 1)
      }
    }
  }

  /**
   * Dispatch a context to the first adapter that claims it.
   *
   * @param context - the candidate selection and its capture metadata.
   * @returns the owning adapter's capture, or
   * `{ snapshot: null, rejectReason: 'outside-supported-preview' }` when no
   * adapter owns the context. Never throws and never returns `undefined`.
   */
  capture(context: SelectionContext): SelectionCapture {
    for (const adapter of this.#adapters) {
      if (!adapter.canHandle(context)) {
        continue
      }
      return adapter.capture(context)
    }

    return NO_ADAPTER_CAPTURE
  }
}
