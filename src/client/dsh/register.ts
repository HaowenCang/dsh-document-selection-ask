/**
 * Client registrar for `dsh-document-selection-ask`.
 *
 * This function is the single seam every task extends: each contribution — the
 * DSH text adapter, the Ask surface, the PDF/DOCX/PPTX/XLSX renderers — arrives
 * with its own task and its own registration call here.
 *
 * As of Task 11 it composes the pieces into one runtime and gives that runtime
 * to the plugin fiber:
 *
 * - a `SelectionAdapterRegistry` holding format adapters in strict priority:
 *   XLSX -> PDF -> DOCX -> PPTX -> builtin text
 * - an isolated `XlsxSelectionBridge` per applyClient;
 * - an XLSX semantic selection lifecycle driving kernel captures;
 * - a `SelectionKernel` over it;
 * - a `SelectionFeedbackSource`;
 * - a `ComposerTargetRegistry`;
 * - a browser selection lifecycle for DOM-based formats.
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
import { installBrowserSelectionLifecycle } from '../selection/browser-lifecycle.js'
import type { BrowserSelectionLifecycle } from '../selection/browser-lifecycle.js'
import { createSelectionFeedback } from '../selection/feedback.js'
import type { SelectionFeedbackSource } from '../selection/feedback.js'
import { createSelectionKernel } from '../selection/kernel.js'
import type { SelectionKernel } from '../selection/kernel.js'
import { SelectionAdapterRegistry } from '../selection/registry.js'
import { ComposerTargetRegistrar } from '../ui/ComposerTargetRegistrar.js'
import { SelectionAskOverlay } from '../ui/SelectionAskOverlay.js'
import { installOverlayStyles } from '../ui/styles.js'
import { createComposerTargetRegistry } from './composer-target-registry.js'
import type { ComposerTargetRegistry } from './composer-target-registry.js'
import type { ClientContext } from './contracts.js'

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
  const composerTargets = createComposerTargetRegistry()
  const xlsxBridge = createXlsxSelectionBridge()

  // Priority 1: Semantic XLSX cell-range adapter
  ctx.effect(
    () => registry.register(createXlsxSelectionAdapter(xlsxBridge)),
    'dsh-document-selection-ask: xlsx selection adapter',
  )

  // Priority 2: PDF selection adapter
  ctx.effect(
    () => registry.register(createPdfSelectionAdapter()),
    'dsh-document-selection-ask: pdf selection adapter',
  )

  // Priority 3: DOCX selection adapter
  ctx.effect(
    () => registry.register(createDocxSelectionAdapter()),
    'dsh-document-selection-ask: docx selection adapter',
  )

  // Priority 4: PPTX selection adapter
  ctx.effect(
    () => registry.register(createPptxSelectionAdapter()),
    'dsh-document-selection-ask: pptx selection adapter',
  )

  // Priority 5: Builtin text selection adapter
  ctx.effect(
    () => registry.register(createDshTextAdapter()),
    'dsh-document-selection-ask: builtin text selection adapter',
  )

  // XLSX semantic selection lifecycle
  ctx.effect(
    () => installXlsxSelectionLifecycle(xlsxBridge, kernel, feedback),
    'dsh-document-selection-ask: xlsx semantic selection lifecycle',
  )

  let lifecycle: BrowserSelectionLifecycle | undefined
  const doc: Document | undefined = globalThis.document
  if (doc !== undefined) {
    ctx.effect(() => installOverlayStyles(doc), 'dsh-document-selection-ask: overlay styles')

    lifecycle = installBrowserSelectionLifecycle(doc, kernel, feedback)
    ctx.effect(
      () => () => {
        lifecycle?.dispose()
      },
      'dsh-document-selection-ask: browser selection lifecycle',
    )

    registerComposerTarget(ctx, composerTargets)
    registerAskSurface(ctx, kernel, feedback, composerTargets)
  }

  // Task 11: the selectable XLSX body.
  registerXlsxRenderer(ctx, xlsxBridge)

  // Task 7: the selectable PDF body.
  registerPdfRenderer(ctx, () => {
    lifecycle?.refresh()
  })

  // Task 9: the selectable DOCX body.
  registerDocxRenderer(ctx)

  // Task 10: the selectable PPTX body.
  registerPptxRenderer(ctx, () => {
    lifecycle?.refresh()
  })

  return { registry, kernel, feedback, composerTargets, xlsxBridge }
}

/**
 * Contribute the session-scoped composer target registrar.
 */
function registerComposerTarget(ctx: ClientContext, composerTargets: ComposerTargetRegistry): void {
  ctx.slots.inject(COMPOSER_TARGET_SLOT, () =>
    ctx.slots.register(
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
 */
function registerAskSurface(
  ctx: ClientContext,
  kernel: SelectionKernel,
  feedback: SelectionFeedbackSource,
  composerTargets: ComposerTargetRegistry,
): void {
  ctx.slots.inject(ASK_SURFACE_SLOT, () =>
    ctx.slots.register(
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
