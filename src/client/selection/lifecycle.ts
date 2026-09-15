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
 * Two properties make the aggregation safe to use as the single teardown of a
 * component. Dispose order is call order — the order the disposers were handed
 * over — because that is the order that mirrors registration, and reversing it
 * would take a decision this layer is not in a position to make. And a disposer
 * that throws does not end the teardown: the remaining disposers still run, and
 * the failures are raised together once the sweep is complete. A half-finished
 * teardown is the one outcome this helper exists to prevent, because the
 * resources released after the throwing step — a worker, an object URL, a viewer
 * session — would otherwise outlive the component that owned them with nothing
 * left to release them.
 *
 * Teardown stays synchronous. `Dispose` is `() => void`, and an async variant is
 * deferred until a renderer actually needs one, rather than being guessed at
 * from a shape that has not been exercised.
 */

/** A teardown callback. Calling it more than once is expected to be harmless. */
export type Dispose = () => void

/** The message carried by the aggregate raised when several disposers fail. */
const MULTIPLE_FAILURES_MESSAGE = 'Multiple errors occurred while disposing resources'

/**
 * Call every disposer in order, then rethrow what failed.
 *
 * The sweep itself is the whole of the mechanism: each disposer is taken off the
 * list and called once, and a throw is recorded rather than propagated, so the
 * only way a sibling is skipped is for the list to be empty. Failures are
 * reported once the sweep has run out of disposers: the original error alone when
 * only one was recorded, an `AggregateError` in execution order when there were
 * several. A clean sweep throws nothing and allocates nothing beyond the loop.
 *
 * @param disposers - the callbacks to call, in order; drained as they are called.
 */
function runFaultTolerant(disposers: Dispose[]): void {
  let failure: { readonly error: unknown } | null = null
  let failures: unknown[] | null = null

  while (disposers.length > 0) {
    const disposer = disposers.shift()
    if (disposer === undefined) {
      break
    }

    try {
      disposer()
    } catch (error: unknown) {
      if (failure === null) {
        // Wrapped rather than held directly, because a disposer is free to throw
        // `undefined` and a bare sentinel could not tell that from a clean sweep.
        failure = { error }
        continue
      }

      if (failures === null) {
        // Collecting starts only once there is a second failure to report; a
        // sweep with one failure never allocates the list.
        failures = [failure.error]
      }
      failures?.push(error)
    }
  }

  if (failures !== null) {
    // `AggregateError.errors`, not `cause`: consumers already read the standard
    // field, and the order is execution order, so `errors[0]` is the failure the
    // sweep hit first.
    throw new AggregateError(failures, MULTIPLE_FAILURES_MESSAGE)
  }

  if (failure !== null) {
    // A single failure keeps its own identity so a caller can still match on
    // `instanceof` or on a custom `name`.
    throw failure.error
  }
}

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
   * Call every tracked disposer in the order it was added, then report failures.
   *
   * Each disposer is taken off the list before it is called, so a disposer that
   * triggers another release cannot cause its siblings to run twice or be
   * skipped, and every disposer runs at most once even when the sweep throws.
   *
   * A failure is rethrown once the sweep is finished: the original error when
   * exactly one disposer threw, and an `AggregateError` carrying them in
   * execution order when several did. Either way the aggregation is marked
   * released before anything is called, so a retry is a no-op — it neither runs
   * the remaining children again nor repeats a failure the caller has already
   * seen.
   */
  disposeAll(): void {
    if (this.#released) {
      return
    }
    this.#released = true

    runFaultTolerant(this.#disposers)
  }
}

/**
 * Release a fixed set of disposers.
 *
 * The functional form for a caller that already holds its disposers as a list
 * and does not need the aggregator's lifetime management. It applies the same
 * contract as {@link Disposer.disposeAll}: call order, every disposer still runs
 * after an earlier failure, and the failures are rethrown together — the
 * original error for one, an `AggregateError` in execution order for several.
 * The list is never drained from the caller's copy, and unlike the aggregator
 * this form holds no released flag, so calling it twice calls the disposers
 * twice; that is what the caller passed in.
 *
 * @param disposers - the teardown callbacks to call, in order.
 */
export function disposeAll(disposers: readonly Dispose[]): void {
  runFaultTolerant([...disposers])
}
