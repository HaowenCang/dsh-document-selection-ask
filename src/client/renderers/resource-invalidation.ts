/**
 * Resource-lifetime notification for the plugin's renderer bodies.
 *
 * A renderer knows something no other part of the plugin knows: which resource
 * its selectable DOM currently belongs to. When that stops being true — the body
 * unmounts, the tab is released, or the viewer switches to another file — any
 * snapshot captured from its DOM describes a document the reader is no longer
 * looking at, and the Ask button hanging over the new document is the visible
 * failure.
 *
 * The renderer does not get to act on that knowledge itself. It publishes one
 * fact, "this resource no longer owns a sendable selection", through the injected
 * `onResourceInvalidated` callback, and the client runtime's
 * `SelectionLifecycleCoordinator` decides what to clear. That keeps the kernel out
 * of the renderer graph entirely, and it keeps the resource comparison in the one
 * module that can make it: the callback carries the address rather than the
 * coordinator holding the renderer's state.
 *
 * Three invocation points, and nothing else:
 *
 * - **Unmount** — the effect cleanup. The React lifetime *is* the selectable
 *   lifetime: no observer, no timer and no polling is involved, which is what
 *   makes this exact rather than eventual.
 * - **Address change** — the same cleanup, one render earlier, because the
 *   dependency is the address. The body that is switching from A to B invalidates
 *   A as it goes.
 * - **Tab abort** — the tab's own `AbortSignal`. Removing a renderer's DOM does
 *   not reliably produce a `selectionchange`, so the browser's own event is not
 *   sufficient evidence that the selectable lifetime ended; the tab's signal is.
 *
 * The callback is optional, and an absent one is not an error: a body rendered
 * outside the plugin runtime — a component spec, an alternative composition — has
 * no coordinator to tell, and the hook then does nothing rather than acquiring an
 * owner of its own.
 */

import { useEffect } from 'react'

/**
 * Tell the runtime when the resource this body renders stops being selectable.
 *
 * @param resourceAddress - the exact address the body received from its props.
 * @param tabSignal - the owning tab's lifetime.
 * @param onResourceInvalidated - the runtime's callback, or `undefined` outside it.
 */
export function useResourceInvalidation(
  resourceAddress: string,
  tabSignal: AbortSignal,
  onResourceInvalidated?: ((resourceAddress: string) => void) | undefined,
): void {
  useEffect(() => {
    const invalidate = (): void => {
      onResourceInvalidated?.(resourceAddress)
    }

    const onAbort = (): void => {
      invalidate()
    }
    tabSignal.addEventListener('abort', onAbort, { once: true })

    return () => {
      tabSignal.removeEventListener('abort', onAbort)
      invalidate()
    }
  }, [resourceAddress, tabSignal, onResourceInvalidated])
}
