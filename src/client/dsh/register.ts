/**
 * Client registrar for `dsh-document-selection-ask`.
 *
 * This function is the single seam every task extends: each contribution — the
 * DSH text adapter, the Ask surface, the PDF/DOCX/PPTX/XLSX renderers — arrives
 * with its own task and its own registration call here.
 *
 * As of Task 5C it composes five pieces into one runtime and gives that runtime
 * to the plugin fiber:
 *
 * - a `SelectionAdapterRegistry` holding the format adapters;
 * - a `SelectionKernel` over it, holding the one transient snapshot the Ask
 *   button quotes;
 * - a `SelectionFeedbackSource`, holding the one message the surface may show;
 * - a `ComposerTargetRegistry`, holding one composer contract per mounted
 *   session;
 * - a browser selection lifecycle, which is the only place in the plugin that
 *   reads `window.getSelection()`, and which owns every listener for it.
 *
 * Two of those are then delivered to **two different slots**, and the split is
 * the shape Task 5C exists to create:
 *
 * ```text
 * conversation.input.overlay  (session scope, inside the composer card)
 *   └─ ComposerTargetRegistrar   — publishes this session's ComposerTarget;
 *                                  draws nothing
 *
 * shell.overlay               (root scope, sibling of every column)
 *   └─ SelectionAskOverlay       — the visible button and notice, gated on
 *                                  snapshot === active session === registered
 *                                  target
 * ```
 *
 * The visible surface had to leave the composer: `conversation.input.overlay`
 * renders inside `wSkVaW_composerStack` (`z-index: 1`), so the expanded right
 * column painted over the button and a real pointer click could not reach it.
 * `shell.overlay` is a sibling of all three columns and is the shell's own
 * additive seat for a frame-wide surface. Both entries receive the **same**
 * registry, kernel and feedback instances, so the two halves cannot disagree
 * about which selection is live or which session owns it.
 *
 * Three ownership rules are deliberate. The runtime is created **per apply call**
 * rather than in module scope: a module-global kernel — or a module-global target
 * table — would survive a hot reload, and the second registration of an adapter
 * id would then throw from inside the reload that was supposed to be harmless,
 * while a surviving target would still answer for a composer generation that no
 * longer exists. Each slot is registered through its **own** `ctx.slots.inject`
 * call with its **own** disposer: the two declarations have independent
 * lifetimes, and a single combined registration would tie the Ask surface's
 * existence to the composer's. And the browser listeners are owned **once**, by
 * this call, rather than by each entry: one set per mounted composer would
 * multiply the captures, and the duplication would stay invisible until two
 * sessions were open at once.
 *
 * The exported `applyClient` returns the runtime so a test can drive the same
 * objects the plugin uses. It is deliberately not part of the package's public
 * contract — `src/client/index.tsx` is the DSH entry, and it discards the value.
 */

import { createDshTextAdapter } from '../adapters/dsh-text/adapter.js'
import { createDocxSelectionAdapter } from '../adapters/docx/adapter.js'
import { createPdfSelectionAdapter } from '../adapters/pdf/adapter.js'
import { registerDocxRenderer } from '../renderers/docx/register.js'
import { registerPdfRenderer } from '../renderers/pdf/register.js'
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
 *
 * The target table travels with the stores because all three are what the
 * surface's three-way gate reads, and they are created together by one
 * `applyClient` call.
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
 * Exported so a client spec can dispatch captures and inspect state through the
 * same instances the plugin registered, rather than reaching into a module
 * global. It is not re-exported from the package entry.
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

  ctx.effect(
    () => registry.register(createPdfSelectionAdapter()),
    'dsh-document-selection-ask: pdf selection adapter',
  )

  ctx.effect(
    () => registry.register(createDocxSelectionAdapter()),
    'dsh-document-selection-ask: docx selection adapter',
  )

  ctx.effect(
    () => registry.register(createDshTextAdapter()),
    'dsh-document-selection-ask: builtin text selection adapter',
  )

  let lifecycle: BrowserSelectionLifecycle | undefined
  const doc: Document | undefined = globalThis.document
  if (doc !== undefined) {
    // The style sheet is installed from here rather than from a component, so it
    // exists once per document regardless of how many composers are mounted, and
    // is removed with the plugin fiber.
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

  // Task 7: the selectable PDF body.
  registerPdfRenderer(ctx, () => {
    lifecycle?.refresh()
  })

  // Task 9: the selectable DOCX body. Registers document preview definition
  // and keyed body into the document slot.
  registerDocxRenderer(ctx)

  return { registry, kernel, feedback, composerTargets }
}

/**
 * Contribute the session-scoped composer target registrar.
 *
 * `ctx.slots.inject` is the published convention rather than a nicety: the entry
 * occupies a slot a parent entry declares, and a `register` call made before that
 * declaration exists throws. `inject` waits for the declaration and re-runs its
 * callback whenever the declaration comes back, so a plugin loaded before the
 * conversation shell still contributes, and one loaded after it contributes
 * immediately.
 *
 * The registrar draws nothing. It exists so the composer-local half of the
 * contract — the published draft, `setDraft`, and the anchor the focus walk
 * starts from — is still obtained from inside the composer that owns it.
 *
 * @param ctx - the client root context.
 * @param composerTargets - the target table both slot halves share.
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
 *
 * The component is handed the three stores explicitly rather than through the
 * framework's `hooks` compartment. The compartment binds a bare source into a
 * `use<Name>` selector hook, and those bound hooks reach the component as props —
 * which the client specs found React's `useSyncExternalStore` does not subscribe
 * from. The component therefore subscribes through its own `useSnapshotSource`,
 * and the stores are passed explicitly so the production path and the specs read
 * them the same way.
 *
 * `useSessions` is deliberately **not** injected here. It is a member of the
 * slot framework's global standard props, declared by
 * `@deepseek-ai/dsh-client-ui-session` and delivered to every entry by the
 * renderer, so the component receives it exactly as any other occupant of a
 * root-scoped slot does. Naming a runtime service for it would be a second,
 * weaker statement of the same edge.
 *
 * @param ctx - the client root context.
 * @param kernel - the transient selection store.
 * @param feedback - the rejection feedback slot.
 * @param composerTargets - the target table both slot halves share.
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
