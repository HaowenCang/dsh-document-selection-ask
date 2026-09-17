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
 * Both registrations happen inside a `ctx.effect` body, so the Cordis fiber owns
 * their teardown: the disposer returned by `documentPreviews.register` and the
 * one `slots.inject` returns are both collected when the plugin unloads. The
 * `inject` wrapper is not decoration — a `register` call made before the slot's
 * declaration exists throws, while `inject` waits for it and re-runs its callback
 * whenever the declaration returns.
 */

import type { DocumentPreviewDefinition } from '../../dsh/contracts.js'
import type { ClientContext } from '../../dsh/contracts.js'
import { PDF_RENDERER_ID } from './identity.js'
import { SelectablePdfBody } from './SelectablePdfBody.js'
import { installPdfStyles } from './styles.js'

/** The keyed list slot DSH mounts a selected document definition's body into. */
export const DOCUMENT_BODY_SLOT = 'sidebar.right.tab.document'

/** Injected callbacks the PDF renderer body receives from the plugin runtime. */
export interface PdfRendererInjectFace {
  /** Re-evaluate live selection when a populated text layer is invalidated. */
  readonly onSelectableDomInvalidated?: (() => void) | undefined
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
 * alternatives. The full localization of that string is Task 12's; this task
 * deliberately does not introduce a locale namespace for one label.
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
 * @param ctx - the client root context.
 * @param onSelectableDomInvalidated - called when a populated text layer is invalidated,
 * to trigger selection lifecycle recapture.
 * @returns whether the renderer was registered. `false` means the client context
 * has no document-preview registry to register into, which is a wiring failure of
 * the host composition rather than something this plugin can recover from.
 */
export function registerPdfRenderer(
  ctx: ClientContext,
  onSelectableDomInvalidated?: () => void,
): boolean {
  const previews = ctx.documentPreviews
  if (previews === undefined) {
    console.error('[dsa-pdf] the DSH document preview registry is not available; the PDF renderer was not registered')
    return false
  }

  const doc: Document | undefined = globalThis.document
  if (doc !== undefined) {
    // Installed from the registration rather than from the component so it exists
    // once per document for the plugin fiber's lifetime, and is removed with it.
    ctx.effect(() => installPdfStyles(doc), 'dsh-document-selection-ask: pdf renderer styles')
  }

  ctx.effect(() => previews.register(pdfRendererDefinition()), 'dsh-document-selection-ask: pdf renderer definition')

  ctx.slots.inject(DOCUMENT_BODY_SLOT, () =>
    ctx.slots.register(
      {
        name: DOCUMENT_BODY_SLOT,
        key: PDF_RENDERER_ID,
        // Session-scoped with invalidation callback: the slot gives the body its
        // session id, its content, its address and its tab, and this injector
        // connects text layer invalidation to the selection lifecycle.
        inject: (): PdfRendererInjectFace => ({
          onSelectableDomInvalidated,
        }),
      },
      SelectablePdfBody,
    ),
  )

  return true
}
