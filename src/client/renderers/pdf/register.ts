/**
 * Register the plugin's selectable PDF renderer.
 *
 * Two registrations are needed and they are deliberately separate statements:
 * the DSH document-preview registry ranks *implementations* by file extension,
 * and the keyed `sidebar.right.tab.document` slot supplies the *component* for
 * one of them. A plugin that made only the first would be ranked, selected, and
 * then render nothing, because the preview owner looks the body up under the
 * definition's own `id`.
 *
 * ## What this registration does not do
 *
 * It does not remove, rename or shadow the DSH builtin PDF renderer
 * (`@deepseek-ai/dsh-client-ui-sidebar-documentpreview/pdf`). The builtin stays
 * registered at `priority: 'builtin'` while this one registers at
 * `priority: 'extension'`, and the installed rc.1 registry sorts the external
 * band first — `rank = definition.priority === 'builtin' ? 0 : 1`, descending —
 * so a `.pdf` address resolves to this renderer automatically while the builtin
 * remains available as the viewer's other candidate. Disabling the plugin
 * therefore restores the builtin preview exactly, which is the project's stated
 * requirement for plugin removal.
 *
 * ## Lifecycle
 *
 * The two registrations and the style sheet are aggregated here and released by
 * one idempotent disposer. Since Task 12 the plugin's client runtime is the single
 * top-level `ctx.effect` owner and this function takes the services it needs as an
 * explicit host, so nothing here reaches for a context: a registration that
 * cannot be made fails loudly at the runtime's own validation instead of
 * returning `false` into a half-installed boot.
 */

import type { DocumentPreviewDefinition, RendererRegistrationHost } from '../../dsh/contracts.js'
import { Disposer, rollback } from '../../selection/lifecycle.js'
import type { Dispose } from '../../selection/lifecycle.js'
import { PDF_RENDERER_ID } from './identity.js'
import { SelectablePdfBody } from './SelectablePdfBody.js'
import { installPdfStyles } from './styles.js'

/** The keyed list slot DSH mounts a selected document definition's body into. */
export const DOCUMENT_BODY_SLOT = 'sidebar.right.tab.document'

/** Injected callbacks the PDF renderer body receives from the plugin runtime. */
export interface PdfRendererInjectFace {
  /** Re-evaluate live selection when a populated text layer is invalidated. */
  readonly onSelectableDomInvalidated?: (() => void) | undefined
  /** Called when a resource stops owning a selectable selection. */
  readonly onResourceInvalidated?: ((resourceAddress: string) => void) | undefined
}

/**
 * The renderer's registration metadata.
 *
 * `loading: 'bytes-complete'` is the whole reason a PDF can be rendered at all:
 * the preview owner reads the file's complete contents and hands the body a
 * `Uint8Array` instead of a growing text prefix, and it selects that mode from
 * this definition. `wrap: false` states that this renderer does not consume the
 * toolbar's wrapping preference, because a page is laid out to the column's width
 * rather than to a text-wrapping rule.
 *
 * `title` is a thunk because the registry reads it whenever the viewer lists its
 * alternatives.
 *
 * @returns the definition to register.
 */
export function pdfRendererDefinition(): DocumentPreviewDefinition {
  return {
    id: PDF_RENDERER_ID,
    extensions: ['pdf'],
    priority: 'extension',
    loading: 'bytes-complete',
    wrap: false,
    title: () => 'PDF · Selectable',
  }
}

/**
 * Contribute the PDF renderer: its metadata, its style sheet, and its body.
 *
 * @param host - the resolved DSH services the registration contributes through.
 * @param inject - the callbacks the registered body is injected with.
 * @returns an idempotent disposer releasing the definition, the body and the sheet.
 */
export function registerPdfRenderer(
  host: RendererRegistrationHost,
  inject: PdfRendererInjectFace = {},
): Dispose {
  const disposer = new Disposer()

  try {
    if (host.document !== undefined) {
      disposer.add(installPdfStyles(host.document))
    }

    disposer.add(host.previews.register(pdfRendererDefinition()))

    disposer.add(
      host.slots.inject(DOCUMENT_BODY_SLOT, () =>
        host.slots.register(
          {
            name: DOCUMENT_BODY_SLOT,
            key: PDF_RENDERER_ID,
            // Session-scoped with invalidation callbacks: the slot gives the body
            // its session id, its content, its address and its tab, and this
            // injector connects text layer invalidation to the selection
            // lifecycle and resource teardown to the coordinator.
            inject: (): PdfRendererInjectFace => ({ ...inject }),
          },
          SelectablePdfBody,
        ),
      ),
    )
  } catch (error: unknown) {
    rollback(disposer, error)
  }

  return () => {
    disposer.disposeAll()
  }
}
