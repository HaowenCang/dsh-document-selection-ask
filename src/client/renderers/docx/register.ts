/**
 * Register the plugin's selectable DOCX renderer.
 *
 * Contributes the document preview definition to `ctx.documentPreviews`
 * and registers the `DocxBody` component into the `sidebar.right.tab.document` slot.
 */

import type { ClientContext, DocumentPreviewDefinition } from '../../dsh/contracts.js'
import { DocxBody } from './DocxBody.js'
import { DOCX_RENDERER_ID } from './identity.js'
import { installDocxStyles } from './styles.js'

/** The keyed list slot DSH mounts a selected document definition's body into. */
export const DOCUMENT_BODY_SLOT = 'sidebar.right.tab.document'

/**
 * The DOCX renderer's preview definition.
 *
 * @returns definition object registered with DSH documentPreviews.
 */
export function docxRendererDefinition(): DocumentPreviewDefinition {
  return {
    id: DOCX_RENDERER_ID,
    extensions: ['docx'],
    priority: 'extension',
    loading: 'bytes-complete',
    wrap: false,
    title: () => 'DOCX · Selectable',
  }
}

/**
 * Register the selectable DOCX renderer into the client context.
 *
 * @param ctx - the client root context.
 * @returns whether the renderer was successfully registered.
 */
export function registerDocxRenderer(ctx: ClientContext): boolean {
  const previews = ctx.documentPreviews
  if (previews === undefined) {
    console.error(
      '[dsa-docx] the DSH document preview registry is not available; the DOCX renderer was not registered',
    )
    return false
  }

  const doc: Document | undefined = globalThis.document
  if (doc !== undefined) {
    ctx.effect(() => installDocxStyles(doc), 'dsh-document-selection-ask: docx renderer styles')
  }

  ctx.effect(() => previews.register(docxRendererDefinition()), 'dsh-document-selection-ask: docx renderer definition')

  ctx.slots.inject(DOCUMENT_BODY_SLOT, () =>
    ctx.slots.register(
      {
        name: DOCUMENT_BODY_SLOT,
        key: DOCX_RENDERER_ID,
      },
      DocxBody,
    ),
  )

  return true
}
