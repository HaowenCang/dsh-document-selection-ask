/**
 * Disposal aggregation and the one lifetime owner of the selection core.
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
 * `document` parameter to do it. {@link installSelectionLifecycle} is the
 * per-client coordinator that composes the pieces — the browser event wiring, the
 * format-specific semantic subscriptions a renderer adds through
 * {@link SelectionLifecycleCoordinator.own}, and the transient state they all
 * write to — into one object with one `dispose`.
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
 * The same fault tolerance is what a **failed registration** needs, and
 * {@link rollback} is the spelling of it: a registration that throws halfway has
 * already contributed to registries the caller never received a handle to, and
 * releasing those contributions is the sweep the aggregator already knows how to
 * run. The failure stays primary — a cleanup that throws as well is reported with
 * it rather than instead of it.
 *
 * Teardown stays synchronous. `Dispose` is `() => void`, and an async variant is
 * deferred until a renderer actually needs one, rather than being guessed at
 * from a shape that has not been exercised.
 */

import { installBrowserSelectionLifecycle } from './browser-lifecycle.js'
import type { BrowserSelectionLifecycle } from './browser-lifecycle.js'
import type { SelectionFeedbackSource } from './feedback.js'
import type { SelectionKernel } from './kernel.js'

/** A teardown callback. Calling it more than once is expected to be harmless. */
export type Dispose = () => void

/** The message carried by the aggregate raised when several disposers fail. */
const MULTIPLE_FAILURES_MESSAGE = 'Multiple errors occurred while disposing resources'

/** The message carried when a registration failed and its cleanup failed too. */
const ROLLBACK_FAILURE_MESSAGE =
  'A registration failed and releasing its partial contributions failed as well'

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

/**
 * Release everything a failed registration installed, then rethrow the failure.
 *
 * A registration that throws halfway leaves the contributions it already made
 * live in registries the caller never received a handle to — an adapter in a
 * dispatch table, a renderer definition in the document-preview registry, a body
 * in the keyed document slot, a style node in the head. The aggregator that was
 * collecting them is the only object that knows what they are, so the sweep that
 * clears them is the same one an ordinary teardown runs; only the trigger differs.
 *
 * The registration failure stays primary. A cleanup that throws as well is
 * reported **with** it rather than instead of it: the caller receives an
 * `AggregateError` whose first element and whose `cause` are the original
 * failure, followed by the cleanup failures in execution order. A single cleanup
 * failure does not replace the primary either, which is the difference between
 * this function and calling `disposeAll` in a `catch` block.
 *
 * @param disposer - the aggregator holding the contributions made so far.
 * @param failure - the registration failure to rethrow.
 * @returns never; the function always throws.
 */
export function rollback(disposer: Disposer, failure: unknown): never {
  try {
    disposer.disposeAll()
  } catch (cleanupFailure: unknown) {
    throw new AggregateError([failure, cleanupFailure], ROLLBACK_FAILURE_MESSAGE, {
      cause: failure,
    })
  }

  throw failure
}

/**
 * The lifetime face of one client's selection: recapture, invalidate, clear,
 * release.
 *
 * It exists because "the selection is over" has three different causes that all
 * end in the same clear, and none of them is in a position to perform it. A
 * renderer knows its own resource lifetime and nothing about the kernel; the
 * browser lifecycle knows the live selection and nothing about which resource a
 * renderer was showing; the XLSX bridge knows its semantic range and nothing
 * about the DOM. Each of them reports what it knows to this object, and this
 * object owns the kernel and the feedback slot they share.
 *
 * The distinction between {@link refreshBrowser} and
 * {@link invalidateResource} is the substance of the contract, not a naming
 * preference. A renderer whose selectable DOM was replaced — a re-rendered PDF
 * page, a PPTX slide whose window was recycled — has invalidated its *geometry*,
 * and the reader's browser selection may well still be live over the replacement,
 * so the answer is to read it again. A renderer that is being torn down, or whose
 * resource address changed, has invalidated the *selection* itself, and the
 * answer is to drop the snapshot — but only the snapshot that belongs to that
 * resource, because a cleanup can arrive after the reader has already selected in
 * another file.
 */
export interface SelectionLifecycleCoordinator {
  /**
   * Re-read the live browser selection on the next animation frame.
   *
   * A no-op when the runtime was installed without a document, which is what
   * keeps a host without a DOM from having to special-case its callers.
   */
  refreshBrowser(): void
  /**
   * Drop the snapshot when — and only when — it belongs to this resource.
   *
   * @param resourceAddress - the address of the resource whose selectable
   * lifetime just ended, exactly as the renderer received it.
   */
  invalidateResource(resourceAddress: string): void
  /** Drop the snapshot and the rejection notice, whatever they describe. */
  clear(): void
  /**
   * Hand this coordinator another subscription to release with the runtime.
   *
   * The seam for a format-specific semantic lifecycle — the XLSX bridge
   * subscription — so that it is released by the same `dispose` as the browser
   * wiring rather than by a second owner. A disposer added after `dispose` has run
   * is released immediately, which is the aggregator's own contract.
   *
   * @param disposer - the teardown to own.
   * @returns the same teardown.
   */
  own(disposer: Dispose): Dispose
  /** Release every owned subscription and listener. Idempotent. */
  dispose(): void
}

/** What {@link installSelectionLifecycle} needs from its caller. */
export interface SelectionLifecycleOptions {
  /** The transient snapshot store to own. */
  readonly kernel: SelectionKernel
  /** The rejection feedback slot to own. */
  readonly feedback: SelectionFeedbackSource
  /**
   * The document whose selection and events are observed, or `undefined` in a
   * host without one — in which case only the resource-scoped half is installed.
   */
  readonly document?: Document | undefined
}

/**
 * Install the per-client selection coordinator.
 *
 * @param options - the shared stores and the document to observe.
 * @returns the coordinator the client runtime owns.
 */
export function installSelectionLifecycle(
  options: SelectionLifecycleOptions,
): SelectionLifecycleCoordinator {
  const { kernel, feedback, document: doc } = options
  const disposer = new Disposer()

  const browser: BrowserSelectionLifecycle | null =
    doc === undefined ? null : installBrowserSelectionLifecycle(doc, kernel, feedback)
  if (browser !== null) {
    disposer.add(() => {
      browser.dispose()
    })
  }

  let disposed = false

  return {
    refreshBrowser(): void {
      if (disposed) return
      browser?.refresh()
    },

    invalidateResource(resourceAddress: string): void {
      if (disposed) return
      const snapshot = kernel.getSnapshot()
      // The comparison is the whole safety property: a renderer for file A that is
      // unmounted after the reader has selected in file B must not take B's
      // snapshot with it, and the snapshot's own address is the only evidence of
      // which resource it describes.
      if (snapshot === null || snapshot.resourceAddress !== resourceAddress) {
        return
      }
      kernel.clear()
      feedback.clear()
    },

    clear(): void {
      if (disposed) return
      // Both stores, unconditionally: the kernel is shared by the DOM and semantic
      // halves, so an Escape that cleared only one of them would leave the other's
      // notice on screen describing a selection that is gone.
      kernel.clear()
      feedback.clear()
    },

    own(child: Dispose): Dispose {
      return disposer.add(child)
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      // Clear before the sweep so a subscription that is released below cannot
      // publish into a kernel whose owner is already gone.
      kernel.clear()
      feedback.clear()
      disposer.disposeAll()
    },
  }
}
