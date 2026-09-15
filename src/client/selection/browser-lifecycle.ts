/**
 * Browser selection event wiring.
 *
 * This is the module the selection core deliberately left out. `SelectionKernel`
 * receives a `SelectionContext` from its caller rather than reading
 * `window.getSelection()` itself, which is what keeps the capture rules testable
 * without a document; the caller that reads the browser is this one, and there
 * is exactly one of it per plugin fiber. A listener installed per overlay
 * instance would instead multiply with the number of mounted composers, and the
 * duplicate captures would be invisible until two sessions were open at once.
 *
 * Three decisions shape the wiring.
 *
 * **`selectionchange` is coalesced into an animation frame.** The browser fires
 * it for every intermediate state of a drag, so a long selection across a large
 * document produces one event per character boundary. Reading the range and
 * copying its rectangles on each of them would do the whole capture a hundred
 * times for one gesture, and the value kept would be an intermediate one. One
 * frame per gesture is enough: the last state within the frame is the state the
 * reader sees, because rendering happens on the same boundary.
 *
 * **Pointer movement is not observed.** `pointermove` and `mousemove` fire
 * continuously and answer no question this module has — the selection is read
 * when it settles, on `pointerup`, `keyup` or `selectionchange`. Listening to
 * movement would trade the frame coalescing above for a busy loop.
 *
 * **Scroll and resize recapture rather than recompute.** The rectangles in a
 * snapshot are viewport geometry captured at a moment, so after the preview
 * scrolls they describe where the text used to be. The position is rebuilt by
 * capturing the live range again, never by applying a scroll delta to the old
 * rectangles: a delta cannot know that the selected rows were recycled,
 * re-wrapped or unmounted, and it would keep a button floating over whatever now
 * occupies those coordinates. When the selection is gone, the kernel is cleared
 * instead.
 *
 * The two viewport events do not share a target, and the difference is a
 * browser contract rather than a preference. `scroll` is dispatched at the
 * element that scrolled — a preview body with its own overflow, or the document
 * when the page itself scrolls — so only a capture-phase listener on the
 * document sees a descendant's scroll at all. `resize` is not a document event:
 * the browser dispatches it at the `Window` the document belongs to, which is
 * `doc.defaultView`, and a listener installed on the document therefore never
 * runs in a real browser however plausible the code looks. The two are installed
 * accordingly, and the resize listener is released from the same window it was
 * added to.
 *
 * The document is a constructor argument rather than a module global for the
 * same reason the kernel takes its context from the caller: a spec can drive
 * this lifecycle against a fixture document, and the plugin never assumes which
 * document it is running in.
 */

import type { SelectionFeedbackSource } from './feedback.js'
import type { SelectionCapture, SelectionContext } from './registry.js'
import type { SelectionKernel } from './kernel.js'

/** The events that invalidate or re-anchor a captured selection. */
const SELECTION_EVENTS = ['selectionchange', 'pointerup', 'keyup'] as const

/**
 * The viewport event a document can be made to report.
 *
 * A scroll is dispatched at the element that scrolled, so the capture-phase
 * listener on the document is what receives a preview body's own scrolling as
 * well as the page's.
 */
const SCROLL_EVENT = 'scroll'

/**
 * The viewport event only the window receives.
 *
 * Kept apart from {@link SCROLL_EVENT} because the listener target is part of
 * the browser contract, not an implementation detail: `document.addEventListener('resize', …)`
 * installs a listener that no browser ever calls.
 */
const RESIZE_EVENT = 'resize'

/**
 * The events whose `target` is a meaningful pointer or key target.
 *
 * A `selectionchange` is not one of them. The browser dispatches it on the
 * document and the selection it reports may have been extended by the keyboard
 * with the pointer somewhere else entirely, so the node it happens to be
 * associated with is not evidence about where the selection came from. The
 * remaining document events are all produced by a gesture that has a position —
 * a pointer release, a key release, a scroll — and their target is a useful hint
 * for root resolution.
 *
 * A `resize` is absent for a second reason as well: its target is the `Window`,
 * which is not a `Node`, so there is no target this lifecycle could report even
 * if it wanted one.
 */
const TARGETED_EVENTS: ReadonlySet<string> = new Set(['pointerup', 'keyup', SCROLL_EVENT])

/**
 * The browser surface this lifecycle drives.
 *
 * Narrowed to the members actually used so a spec can drive the wiring against a
 * fixture document without stubbing an entire `Document`, and so the module's
 * browser dependency is stated in one auditable place.
 */
export interface BrowserSelectionLifecycle {
  /**
   * Re-read the browser selection on the next animation frame.
   *
   * The event listeners call this; it is also the entry point for a caller that
   * knows the selection changed without an event — a programmatic selection, a
   * restored draft, or a spec driving the lifecycle directly. Repeated calls
   * within one frame collapse into one capture.
   */
  refresh(): void
  /** Remove every listener and cancel any scheduled frame. Idempotent. */
  dispose(): void
}

/**
 * Install the browser selection listeners.
 *
 * @param doc - the document whose selection and events are observed.
 * @param kernel - the transient store a successful capture writes to.
 * @param feedback - the slot a size refusal is reported to.
 * @param onCapture - called with each capture outcome, for diagnostics and for a
 * caller that wants to react to refusals without subscribing to the kernel.
 * @returns the lifecycle handle owned by the client registration.
 */
export function installBrowserSelectionLifecycle(
  doc: Document,
  kernel: SelectionKernel,
  feedback: SelectionFeedbackSource,
  onCapture: (capture: SelectionCapture) => void = () => undefined,
): BrowserSelectionLifecycle {
  let frame: number | null = null
  let eventTargetNode: Node | null = null
  let disposed = false

  /**
   * Capture the current browser selection.
   *
   * `target` is the node the triggering event came from, or `null`. A
   * `selectionchange` has no meaningful pointer target — the selection may have
   * been extended by a keyboard gesture with the pointer somewhere else — so it
   * reports `null` and lets the selection's own endpoints decide ownership, which
   * every adapter in the registry already does.
   */
  function captureNow(targetNode: Node | null): void {
    const context: SelectionContext = {
      selection: doc.getSelection(),
      target: targetNode,
      now: Date.now(),
    }

    const capture = kernel.capture(context)
    onCapture(capture)

    if (capture.snapshot === null) {
      feedback.report(capture.rejectReason)
    } else {
      feedback.clear()
    }
  }

  /**
   * Run the capture a scheduled frame was queued for.
   *
   * The target is handed over rather than read back out of the field: with one
   * pending frame per gesture, the node an event recorded is the node this frame
   * must report, and reading a shared variable at frame time is how an
   * intermediate `selectionchange` would arrive with the wrong target.
   */
  function runFrame(): void {
    frame = null
    const targetNode = eventTargetNode
    eventTargetNode = null
    captureNow(targetNode)
  }

  /** Schedule the next capture, folding a repeat call into the pending frame. */
  function refresh(): void {
    if (disposed || frame !== null) {
      return
    }
    frame = doc.defaultView?.requestAnimationFrame(runFrame) ?? null
    if (frame === null) {
      // A document with no window cannot schedule; capture inline rather than
      // dropping the event, so a host without rAF still sees one capture.
      runFrame()
    }
  }

  /**
   * Re-read the selection for an event that may carry a pointer or key target.
   * @param event - the event that triggered the capture.
   */
  function onSelectionEvent(event: Event): void {
    if (TARGETED_EVENTS.has(event.type)) {
      // The listeners are installed on the document, so a target is always a
      // node; the check states that rather than widening `SelectionContext.target`
      // to `EventTarget`, which no adapter can use.
      eventTargetNode = event.target instanceof Node ? event.target : null
    }
    refresh()
  }

  /**
   * Re-read the selection after the viewport changed size.
   *
   * The target is deliberately not recorded. The window dispatches this event,
   * and a `Window` is not a `Node`, so there is no node an adapter could resolve
   * a preview root from — the selection's own endpoints are the only evidence,
   * which is what every adapter already prefers. Recording a target anyway would
   * mean either a cast to `Node` that lies to the registry or a widening of
   * `SelectionContext.target` that every adapter would then have to defend
   * against.
   */
  function onViewportResize(): void {
    refresh()
  }

  /** Clear everything a live selection contributed. */
  function onEscape(): void {
    // Escape dismisses; it never edits. Cancelling the pending frame first keeps
    // a capture scheduled by the same keypress from restoring what was cleared.
    cancelFrame()
    kernel.clear()
    feedback.clear()
  }

  /** Cancel a scheduled capture, if one is pending. */
  function cancelFrame(): void {
    if (frame !== null) {
      doc.defaultView?.cancelAnimationFrame(frame)
      frame = null
    }
  }

  /**
   * Handle Escape from the document.
   * @param event - the keydown event.
   */
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      onEscape()
    }
  }

  for (const type of SELECTION_EVENTS) {
    doc.addEventListener(type, onSelectionEvent, true)
  }
  doc.addEventListener(SCROLL_EVENT, onSelectionEvent, true)
  doc.addEventListener('keydown', onKeyDown, true)

  // Read through `defaultView` rather than reaching for the ambient `window`:
  // the document this lifecycle was handed decides which window it listens to,
  // which is what keeps the module usable against a fixture document and safe in
  // a host that owns more than one.
  const view = doc.defaultView
  view?.addEventListener(RESIZE_EVENT, onViewportResize)

  return {
    refresh,
    dispose(): void {
      if (disposed) {
        return
      }
      disposed = true
      cancelFrame()

      for (const type of SELECTION_EVENTS) {
        doc.removeEventListener(type, onSelectionEvent, true)
      }
      doc.removeEventListener(SCROLL_EVENT, onSelectionEvent, true)
      doc.removeEventListener('keydown', onKeyDown, true)
      view?.removeEventListener(RESIZE_EVENT, onViewportResize)
    },
  }
}
