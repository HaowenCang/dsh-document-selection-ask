/**
 * Disposal aggregation for the selection core.
 *
 * The selection core hands out three kinds of disposer: an adapter registration
 * from `SelectionAdapterRegistry.register`, a listener subscription from
 * `SelectionKernel.subscribe`, and whichever teardown the plugin's client entry
 * adds later. A caller that unregisters its adapters and drops its subscriptions
 * has to hold all of them somewhere, and doing that with a hand-written array and
 * a flag at each call site is how a teardown ends up running twice, or not at
 * all on one of its paths.
 *
 * This module owns that bookkeeping and nothing else. It does not listen for
 * events: wiring `selectionchange`, `pointerup`, `resize` or `Escape` to the
 * kernel is the lifecycle work of the overlay task, and it belongs in the module
 * that owns the events rather than in a helper that would have to grow a
 * `document` parameter to do it.
 *
 * Dispose order is call order — the order the disposers were handed over —
 * because that is the order that mirrors registration, and reversing it would
 * take a decision this layer is not in a position to make.
 */

/** A teardown callback. Calling it more than once is expected to be harmless. */
export type Dispose = () => void

/**
 * Collect disposers and release them together.
 *
 * The aggregator is idempotent: after it has run, the individual disposers are
 * dropped and a second `disposeAll` call is a no-op. A disposer added to an
 * already-released aggregator is called immediately, so a component that
 * registers something during its own teardown cannot leak it.
 */
export class Disposer {
  readonly #disposers: Dispose[] = []
  #released = false

  /**
   * Track a disposer, or release it at once when this aggregator has already run.
   * @param disposer - the teardown callback to own.
   * @returns the same callback, so a caller can keep using it directly.
   */
  add(disposer: Dispose): Dispose {
    if (this.#released) {
      disposer()
      return disposer
    }

    this.#disposers.push(disposer)
    return disposer
  }

  /**
   * Call every tracked disposer in the order it was added.
   *
   * Each disposer is called once and removed before the call, so a disposer that
   * triggers another release cannot cause its siblings to be run twice or
   * skipped. An exception from one disposer propagates and leaves the remaining
   * ones uncalled, but the aggregation is still marked released: the contract is
   * idempotence and ordering, and a teardown that must survive a throwing step
   * needs per-step isolation that this helper deliberately does not add.
   */
  disposeAll(): void {
    if (this.#released) {
      return
    }
    this.#released = true

    while (this.#disposers.length > 0) {
      this.#disposers.shift()?.()
    }
  }
}

/**
 * Release a fixed set of disposers.
 *
 * The functional form for a caller that already holds its disposers as a list
 * and does not need the aggregator's lifetime management.
 *
 * @param disposers - the teardown callbacks to call, in order.
 */
export function disposeAll(disposers: readonly Dispose[]): void {
  for (const disposer of disposers) {
    disposer()
  }
}
