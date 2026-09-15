/**
 * Client registrar for `dsh-document-selection-ask`.
 *
 * This function is the single seam every task extends: each contribution — the
 * DSH text adapter, the Ask overlay, the PDF/DOCX/PPTX/XLSX renderers — arrives
 * with its own task and its own registration call here.
 *
 * As of Task 5 it composes four pieces into one runtime and gives that runtime
 * to the plugin fiber:
 *
 * - a `SelectionAdapterRegistry` holding the format adapters;
 * - a `SelectionKernel` over it, holding the one transient snapshot the Ask
 *   button quotes;
 * - a `SelectionFeedbackSource`, holding the one message the overlay may show;
 * - a browser selection lifecycle, which is the only place in the plugin that
 *   reads `window.getSelection()`, and which owns every listener for it.
 *
 * Two ownership rules are deliberate. The runtime is created **per apply call**
 * rather than in module scope: a module-global kernel would survive a hot reload,
 * and the second registration of an adapter id would then throw from inside the
 * reload that was supposed to be harmless. And the browser listeners are owned
 * **once**, by this call, rather than by each overlay instance: one per mounted
 * composer would multiply the captures, and the duplication would stay invisible
 * until two sessions were open at once.
 *
 * The exported `applyClient` returns the runtime so a test can drive the same
 * objects the plugin uses. It is deliberately not part of the package's public
 * contract — `src/client/index.tsx` is the DSH entry, and it discards the value.
 */

import { createDshTextAdapter } from '../adapters/dsh-text/adapter.js'
import { installBrowserSelectionLifecycle } from '../selection/browser-lifecycle.js'
import { createSelectionFeedback } from '../selection/feedback.js'
import type { SelectionFeedbackSource } from '../selection/feedback.js'
import { createSelectionKernel } from '../selection/kernel.js'
import type { SelectionKernel } from '../selection/kernel.js'
import { SelectionAdapterRegistry } from '../selection/registry.js'
import { SelectionAskOverlay } from '../ui/SelectionAskOverlay.js'
import { installOverlayStyles } from '../ui/styles.js'
import type { ClientContext } from './contracts.js'

/** The `conversation.input.overlay` list slot the Ask button occupies. */
export const OVERLAY_SLOT = 'conversation.input.overlay'

/** Registration id of the overlay entry within that slot. */
export const OVERLAY_ENTRY_ID = 'dsh-document-selection-ask'

/** The observable sources and actions injected into the overlay component. */
interface OverlayInjectFace {
  /** The transient selection store. */
  readonly selection: SelectionKernel
  /** The rejection feedback store. */
  readonly feedback: SelectionFeedbackSource
  /** Clear the captured selection after a successful ask. */
  readonly clearSelection: () => void
  /** Drop the rejection feedback after a successful ask. */
  readonly clearFeedback: () => void
}

/**
 * The objects one `applyClient` call owns.
 *
 * Exported so a client spec can dispatch captures and inspect state through the
 * same instances the plugin registered, rather than reaching into a module
 * global. It is not re-exported from the package entry.
 */
export interface ClientRuntime {
  /** The adapter dispatch table. */
  readonly registry: SelectionAdapterRegistry
  /** The transient snapshot store the overlay renders. */
  readonly kernel: SelectionKernel
  /** The rejection feedback slot the overlay renders. */
  readonly feedback: SelectionFeedbackSource
}

/**
 * Apply the plugin's browser contributions to the DSH client context.
 *
 * @param ctx - the client root context; its `effect` hook owns the teardown of
 * every registration made here.
 * @returns the runtime this call created.
 */
export function applyClient(ctx: ClientContext): ClientRuntime {
  const registry = new SelectionAdapterRegistry()
  const kernel = createSelectionKernel(registry)
  const feedback = createSelectionFeedback()

  ctx.effect(
    () => registry.register(createDshTextAdapter()),
    'dsh-document-selection-ask: builtin text selection adapter',
  )

  const doc: Document | undefined = globalThis.document
  if (doc !== undefined) {
    // The style sheet is installed from here rather than from the component, so
    // it exists once per document regardless of how many composers are mounted,
    // and is removed with the plugin fiber.
    ctx.effect(() => installOverlayStyles(doc), 'dsh-document-selection-ask: overlay styles')

    const lifecycle = installBrowserSelectionLifecycle(doc, kernel, feedback)
    ctx.effect(
      () => () => {
        lifecycle.dispose()
      },
      'dsh-document-selection-ask: browser selection lifecycle',
    )

    registerOverlay(ctx, kernel, feedback)
  }

  return { registry, kernel, feedback }
}

/**
 * Contribute the Ask overlay into the composer.
 *
 * `ctx.slots.inject` is the published convention rather than a nicety: the
 * overlay occupies a slot a parent entry declares, and a `register` call made
 * before that declaration exists throws. `inject` waits for the declaration and
 * re-runs its callback whenever the declaration comes back, so a plugin loaded
 * before the conversation shell still contributes, and one loaded after it
 * contributes immediately.
 *
 * The face hands the component the two stores themselves rather than the
 * framework's `hooks` compartment. The compartment binds a bare source into a
 * `use<Name>` selector hook, and those bound hooks reach the component as props
 * — which the client specs found React's `useSyncExternalStore` does not
 * subscribe from. The component therefore subscribes through its own
 * `useSnapshotSource`, and the stores are passed explicitly so the production
 * path and the specs read them the same way. `useInput` and `inputActions` still
 * come from the framework, because they are the composer's own contract and no
 * second implementation of them exists.
 *
 * @param ctx - the client root context.
 * @param kernel - the transient selection store.
 * @param feedback - the rejection feedback slot.
 */
function registerOverlay(
  ctx: ClientContext,
  kernel: SelectionKernel,
  feedback: SelectionFeedbackSource,
): void {
  ctx.slots.inject(OVERLAY_SLOT, () =>
    ctx.slots.register(
      {
        name: OVERLAY_SLOT,
        id: OVERLAY_ENTRY_ID,
        inject: (): OverlayInjectFace => ({
          selection: kernel,
          feedback,
          clearSelection: () => {
            kernel.clear()
          },
          clearFeedback: () => {
            feedback.clear()
          },
        }),
      },
      SelectionAskOverlay,
    ),
  )
}
