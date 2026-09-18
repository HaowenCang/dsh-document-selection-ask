/**
 * Register the plugin's selectable PPTX renderer.
 *
 * Contributes the document preview definition to `ctx.documentPreviews`
 * and registers the `PptxBody` component into the `sidebar.right.tab.document` slot.
 */

import type { ClientContext, DocumentPreviewDefinition } from '../../dsh/contracts.js'
import { PPTX_RENDERER_ID } from './identity.js'
import { PptxBody, type PptxRendererInjectFace } from './PptxBody.js'
import { installPptxStyles } from './styles.js'

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
 * Register the selectable PPTX renderer into the client context.
 *
 * @param ctx - the client root context.
 * @param onSelectableDomInvalidated - callback when rendered slide DOM is invalidated.
 * @returns whether the renderer was successfully registered.
 */
export function registerPptxRenderer(
  ctx: ClientContext,
  onSelectableDomInvalidated?: () => void,
): boolean {
  const previews = ctx.documentPreviews
  if (previews === undefined) {
    console.error(
      '[dsa-pptx] the DSH document preview registry is not available; the PPTX renderer was not registered',
    )
    return false
  }

  const doc: Document | undefined = globalThis.document
  if (doc !== undefined) {
    ctx.effect(() => installPptxStyles(doc), 'dsh-document-selection-ask: pptx renderer styles')
  }

  ctx.effect(
    () => previews.register(pptxRendererDefinition()),
    'dsh-document-selection-ask: pptx renderer definition',
  )

  ctx.slots.inject(DOCUMENT_BODY_SLOT, () =>
    ctx.slots.register(
      {
        name: DOCUMENT_BODY_SLOT,
        key: PPTX_RENDERER_ID,
        inject: (): PptxRendererInjectFace => ({
          onSelectableDomInvalidated,
        }),
      },
      PptxBody,
    ),
  )

  return true
}
