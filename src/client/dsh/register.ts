/**
 * Client registrar for `dsh-document-selection-ask`.
 *
 * This function is the single seam every task extends: each contribution — the
 * DSH text adapter, the Ask surface, the PDF/DOCX/PPTX/XLSX renderers — arrives
 * with its own task and its own registration call here.
 *
 * ## One owner, one effect
 *
 * As of Task 12 this module is a **factory**, not a registrar: `applyClient`
 * creates one local runtime, registers every contribution into it, and hands back
 * an object whose `dispose` releases all of them exactly once. It calls
 * `ctx.effect` nowhere. `src/client/index.tsx` is the single top-level lifecycle
 * owner, and its one effect is the only thing the Cordis fiber has to unwind — so
 * "how many registrations does this plugin make" and "how many effects does the
 * fiber hold" stop being the same question.
 *
 * What the runtime owns:
 *
 * - a `SelectionAdapterRegistry` holding format adapters in strict priority:
 *   XLSX -> PDF -> DOCX -> PPTX -> builtin text;
 * - a `SelectionLifecycleCoordinator` over the browser lifecycle and the XLSX
 *   semantic subscription, which is the only object that clears the kernel;
 * - a `SelectionKernel` over the registry and a `SelectionFeedbackSource`;
 * - a `ComposerTargetRegistry` and the two Ask slot contributions;
 * - the overlay's style sheet;
 * - the four extension renderers, each with its definition, its keyed body and
 *   its own style sheet.
 *
 * ## Failure is all-or-nothing
 *
 * The two public services this half injects through are validated before anything
 * is registered, and a registration that throws anywhere releases everything
 * registered before it and rethrows the original failure. A half-installed
 * runtime is the one outcome this shape exists to prevent: before Task 12 a
 * missing preview registry produced a `console.error` and a plugin that had
 * contributed its adapters, its overlay and its slots but no renderers at all,
 * which no test could distinguish from a working boot.
 *
 * Every mutable object above is local to one `applyClient` call. Nothing is
 * stored at module scope and nothing is published on a global, so a plugin reload
 * cannot leave a previous runtime's registry, kernel or bridge reachable — which
 * is what makes a serial apply/dispose cycle leak-free rather than merely
 * usually clean.
 */

import { createDshTextAdapter } from '../adapters/dsh-text/adapter.js'
import { createDocxSelectionAdapter } from '../adapters/docx/adapter.js'
import { createPdfSelectionAdapter } from '../adapters/pdf/adapter.js'
import { createPptxSelectionAdapter } from '../adapters/pptx/adapter.js'
import { createXlsxSelectionAdapter } from '../adapters/xlsx/adapter.js'
import { registerDocxRenderer } from '../renderers/docx/register.js'
import { registerPdfRenderer } from '../renderers/pdf/register.js'
import { registerPptxRenderer } from '../renderers/pptx/register.js'
import { registerXlsxRenderer } from '../renderers/xlsx/register.js'
import { createXlsxSelectionBridge } from '../renderers/xlsx/selection-bridge.js'
import type { XlsxSelectionBridge } from '../renderers/xlsx/selection-bridge.js'
import { installXlsxSelectionLifecycle } from '../renderers/xlsx/selection-lifecycle.js'
import { createSelectionFeedback } from '../selection/feedback.js'
import type { SelectionFeedbackSource } from '../selection/feedback.js'
import { createSelectionKernel } from '../selection/kernel.js'
import type { SelectionKernel } from '../selection/kernel.js'
import { Disposer, installSelectionLifecycle, rollback } from '../selection/lifecycle.js'
import type { SelectionLifecycleCoordinator } from '../selection/lifecycle.js'
import { SelectionAdapterRegistry } from '../selection/registry.js'
import { ComposerTargetRegistrar } from '../ui/ComposerTargetRegistrar.js'
import { SelectionAskOverlay } from '../ui/SelectionAskOverlay.js'
import { installOverlayStyles } from '../ui/styles.js'
import { createComposerTargetRegistry } from './composer-target-registry.js'
import type { ComposerTargetRegistry } from './composer-target-registry.js'
import type {
  ClientContext,
  DocumentPreviewRegistry,
  RendererRegistrationHost,
} from './contracts.js'
import type { SlotRegistry } from './contracts.js'

/** The session-scoped list slot that publishes each session's composer target. */
export const COMPOSER_TARGET_SLOT = 'conversation.input.overlay'

/** Registration id of the target registrar within that slot. */
export const COMPOSER_TARGET_ENTRY_ID = 'dsh-document-selection-ask:composer-target'

/** The root-scoped list slot the visible Ask surface occupies. */
export const ASK_SURFACE_SLOT = 'shell.overlay'

/** Registration id of the Ask surface within that slot. */
export const ASK_SURFACE_ENTRY_ID = 'dsh-document-selection-ask:surface'

/**
 * The observable sources and actions injected into the Ask surface.
 */
interface AskSurfaceInjectFace {
  /** The transient selection store. */
  readonly selection: SelectionKernel
  /** The rejection feedback store. */
  readonly feedback: SelectionFeedbackSource
  /** The per-session composer target table. */
  readonly composerTargets: ComposerTargetRegistry
  /** Clear the captured selection after a successful ask. */
  readonly clearSelection: () => void
  /** Drop the rejection feedback after a successful ask. */
  readonly clearFeedback: () => void
}

/** The one thing the session registrar is injected with. */
interface ComposerTargetInjectFace {
  /** The per-session composer target table. */
  readonly composerTargets: ComposerTargetRegistry
}

/**
 * The objects one `applyClient` call owns.
 *
 * Everything here is local to the call that created it, and every one of them is
 * released by {@link ClientRuntime.dispose}. The renderer internals are
 * deliberately absent: a renderer's engine, session or WASM state is its own
 * business, and exposing it here would invite a later task to reach into it.
 */
export interface ClientRuntime {
  /** The adapter dispatch table. */
  readonly registry: SelectionAdapterRegistry
  /** The transient snapshot store the Ask surface renders. */
  readonly kernel: SelectionKernel
  /** The rejection feedback slot the Ask surface renders. */
  readonly feedback: SelectionFeedbackSource
  /** The per-session composer target table the two slot halves share. */
  readonly composerTargets: ComposerTargetRegistry
  /** The per-client XLSX semantic selection bridge. */
  readonly xlsxBridge: XlsxSelectionBridge
  /**
   * The one object that may clear the transient stores, and the only one that
   * knows which resource a snapshot belongs to.
   */
  readonly selectionLifecycle: SelectionLifecycleCoordinator
  /**
   * Release every registration this runtime made. Idempotent: the second call is
   * a no-op, and a failure inside one child does not skip its siblings.
   */
  dispose(): void
}

/**
 * Read the document-preview registry, or refuse to register anything.
 * @param ctx - the client root context.
 * @returns the live registry.
 * @throws Error when the service is absent, which is a composition failure.
 */
function requireDocumentPreviews(ctx: ClientContext): DocumentPreviewRegistry {
  const previews = ctx.documentPreviews
  if (previews === undefined) {
    throw new Error(
      'dsh-document-selection-ask: the DSH document preview registry is not available; ' +
        'the plugin declares it in `inject` and cannot register its renderers without it',
    )
  }
  return previews
}

/**
 * Read the slot registry, or refuse to register anything.
 * @param ctx - the client root context.
 * @returns the live registry.
 * @throws Error when the service is absent, which is a composition failure.
 */
function requireSlots(ctx: ClientContext): SlotRegistry {
  const slots = ctx.slots
  if (slots === undefined) {
    throw new Error(
      'dsh-document-selection-ask: the DSH slot registry is not available; ' +
        'the plugin declares it in `inject` and cannot contribute its surfaces without it',
    )
  }
  return slots
}

/**
 * Apply the plugin's browser contributions to the DSH client context.
 *
 * The caller owns the returned runtime and must call its `dispose` when the
 * plugin unloads. `src/client/index.tsx` does exactly that from the plugin's one
 * top-level effect.
 *
 * @param ctx - the client root context, read for its two required services.
 * @returns the runtime this call created.
 * @throws Error when a required service is absent, or whatever a registration
 * threw — after releasing everything registered before it.
 */
export function applyClient(ctx: ClientContext): ClientRuntime {
  const disposer = new Disposer()

  try {
    const previews = requireDocumentPreviews(ctx)
    const slots = requireSlots(ctx)
    const doc: Document | undefined = globalThis.document

    const registry = new SelectionAdapterRegistry()
    const kernel = createSelectionKernel(registry)
    const feedback = createSelectionFeedback()
    const composerTargets = createComposerTargetRegistry()
    const xlsxBridge = createXlsxSelectionBridge()

    // Priority 1: Semantic XLSX cell-range adapter
    disposer.add(registry.register(createXlsxSelectionAdapter(xlsxBridge)))
    // Priority 2: PDF selection adapter
    disposer.add(registry.register(createPdfSelectionAdapter()))
    // Priority 3: DOCX selection adapter
    disposer.add(registry.register(createDocxSelectionAdapter()))
    // Priority 4: PPTX selection adapter
    disposer.add(registry.register(createPptxSelectionAdapter()))
    // Priority 5: Builtin text selection adapter
    disposer.add(registry.register(createDshTextAdapter()))

    // The selection lifetime: browser events, the XLSX semantic subscription and
    // the resource-scoped invalidation the renderers report through.
    const lifecycle = installSelectionLifecycle({ kernel, feedback, document: doc })
    disposer.add(() => {
      lifecycle.dispose()
    })
    lifecycle.own(installXlsxSelectionLifecycle(xlsxBridge, kernel, feedback))

    if (doc !== undefined) {
      disposer.add(installOverlayStyles(doc))
      disposer.add(registerComposerTarget(slots, composerTargets))
      disposer.add(registerAskSurface(slots, kernel, feedback, composerTargets))
    }

    const host: RendererRegistrationHost = { previews, slots, document: doc }

    /**
     * The callback every renderer body publishes its own resource lifetime
     * through. One function per runtime, so a body's identity comparison of the
     * injected face is stable across renders.
     * @param resourceAddress - the address of the resource that ended.
     */
    const onResourceInvalidated = (resourceAddress: string): void => {
      lifecycle.invalidateResource(resourceAddress)
    }

    // Task 11: the selectable XLSX body.
    disposer.add(registerXlsxRenderer(host, { bridge: xlsxBridge, onResourceInvalidated }))

    // Task 7: the selectable PDF body. Text layer invalidation is a recapture —
    // the reader's browser selection may still be live over the replacement — so
    // it is routed to `refreshBrowser` rather than to the invalidation callback.
    disposer.add(
      registerPdfRenderer(host, {
        onSelectableDomInvalidated: () => {
          lifecycle.refreshBrowser()
        },
        onResourceInvalidated,
      }),
    )

    // Task 9: the selectable DOCX body.
    disposer.add(registerDocxRenderer(host, { onResourceInvalidated }))

    // Task 10: the selectable PPTX body.
    disposer.add(
      registerPptxRenderer(host, {
        onSelectableDomInvalidated: () => {
          lifecycle.refreshBrowser()
        },
        onResourceInvalidated,
      }),
    )

    let disposed = false

    return {
      registry,
      kernel,
      feedback,
      composerTargets,
      xlsxBridge,
      selectionLifecycle: lifecycle,

      dispose(): void {
        if (disposed) return
        disposed = true
        // Clear first: a listener or bridge subscription released by the sweep
        // below cannot then publish into a kernel whose owner is gone.
        kernel.clear()
        feedback.clear()
        disposer.disposeAll()
      },
    }
  } catch (error: unknown) {
    rollback(disposer, error)
  }
}

/**
 * Contribute the session-scoped composer target registrar.
 *
 * @param slots - the resolved slot registry.
 * @param composerTargets - the per-session target table the registrar publishes into.
 * @returns the disposer releasing the contribution.
 */
function registerComposerTarget(
  slots: SlotRegistry,
  composerTargets: ComposerTargetRegistry,
): () => void {
  return slots.inject(COMPOSER_TARGET_SLOT, () =>
    slots.register(
      {
        name: COMPOSER_TARGET_SLOT,
        id: COMPOSER_TARGET_ENTRY_ID,
        inject: (): ComposerTargetInjectFace => ({ composerTargets }),
      },
      ComposerTargetRegistrar,
    ),
  )
}

/**
 * Contribute the visible Ask surface into the frame-wide overlay layer.
 *
 * @param slots - the resolved slot registry.
 * @param kernel - the transient selection store the surface renders.
 * @param feedback - the rejection feedback slot the surface renders.
 * @param composerTargets - the per-session target table the surface writes through.
 * @returns the disposer releasing the contribution.
 */
function registerAskSurface(
  slots: SlotRegistry,
  kernel: SelectionKernel,
  feedback: SelectionFeedbackSource,
  composerTargets: ComposerTargetRegistry,
): () => void {
  return slots.inject(ASK_SURFACE_SLOT, () =>
    slots.register(
      {
        name: ASK_SURFACE_SLOT,
        id: ASK_SURFACE_ENTRY_ID,
        inject: (): AskSurfaceInjectFace => ({
          selection: kernel,
          feedback,
          composerTargets,
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
