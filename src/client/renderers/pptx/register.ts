/**
 * Register the plugin's selectable PPTX renderer.
 *
 * Contributes the document preview definition to the document-preview registry
 * and registers the `PptxBody` component into the `sidebar.right.tab.document`
 * slot.
 *
 * As of Task 12 the two contributions, the style sheet and the keyed body are
 * aggregated here and released by one idempotent disposer; the client runtime is
 * the plugin's single top-level lifecycle owner. A failed registration releases
 * what it already installed and rethrows.
 */

import type { DocumentPreviewDefinition, RendererRegistrationHost } from '../../dsh/contracts.js'
import { Disposer, rollback } from '../../selection/lifecycle.js'
import type { Dispose } from '../../selection/lifecycle.js'
import { PPTX_RENDERER_ID } from './identity.js'
import { PptxBody } from './PptxBody.js'
import type { PptxRendererInjectFace } from './PptxBody.js'
import { installPptxStyles } from './styles.js'

// The injected face is declared beside the body that consumes it and re-exported
// here, so every renderer publishes the shape the runtime injects from the same
// module the runtime registers through.
export type { PptxRendererInjectFace }

/** The keyed list slot DSH mounts a selected document definition's body into. */
export const DOCUMENT_BODY_SLOT = 'sidebar.right.tab.document'

/**
 * The PPTX renderer's preview definition.
 *
 * @returns definition object registered with DSH documentPreviews.
 */
export function pptxRendererDefinition(): DocumentPreviewDefinition {
  return {
    id: PPTX_RENDERER_ID,
    extensions: ['pptx'],
    priority: 'extension',
    loading: 'bytes-complete',
    wrap: false,
    title: () => 'PPTX · Selectable',
  }
}

/**
 * Register the selectable PPTX renderer.
 *
 * @param host - the resolved DSH services the registration contributes through.
 * @param inject - the callbacks the registered body is injected with.
 * @returns an idempotent disposer releasing the definition, the body and the sheet.
 */
export function registerPptxRenderer(
  host: RendererRegistrationHost,
  inject: PptxRendererInjectFace = {},
): Dispose {
  const disposer = new Disposer()

  try {
    if (host.document !== undefined) {
      disposer.add(installPptxStyles(host.document))
    }

    disposer.add(host.previews.register(pptxRendererDefinition()))

    disposer.add(
      host.slots.inject(DOCUMENT_BODY_SLOT, () =>
        host.slots.register(
          {
            name: DOCUMENT_BODY_SLOT,
            key: PPTX_RENDERER_ID,
            inject: (): PptxRendererInjectFace => ({ ...inject }),
          },
          PptxBody,
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
