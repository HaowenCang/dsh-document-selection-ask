/**
 * Register the plugin's XLSX spreadsheet renderer.
 *
 * Contributes the document preview definition to `ctx.documentPreviews`
 * and registers the `XlsxBody` component into the `sidebar.right.tab.document` slot.
 */

import type { ClientContext, DocumentPreviewDefinition } from '../../dsh/contracts.js'
import { XLSX_RENDERER_ID } from './identity.js'
import type { XlsxSelectionBridge } from './selection-bridge.js'
import { installXlsxStyles } from './styles.js'
import { XlsxBody } from './XlsxBody.js'

export const DOCUMENT_BODY_SLOT = 'sidebar.right.tab.document'

/**
 * The XLSX renderer's preview definition.
 */
export function xlsxRendererDefinition(): DocumentPreviewDefinition {
  return {
    id: XLSX_RENDERER_ID,
    extensions: ['xlsx'],
    priority: 'extension',
    loading: 'bytes-complete',
    wrap: false,
    title: () => 'XLSX • Read-only',
  }
}

/**
 * Register the XLSX renderer into the client context.
 *
 * @param ctx - client root context.
 * @param bridge - per-client semantic selection bridge.
 * @returns whether registration succeeded.
 */
export function registerXlsxRenderer(ctx: ClientContext, bridge: XlsxSelectionBridge): boolean {
  const previews = ctx.documentPreviews
  if (previews === undefined) {
    console.error(
      '[dsa-xlsx] the DSH document preview registry is not available; the XLSX renderer was not registered',
    )
    return false
  }

  const doc: Document | undefined = globalThis.document
  if (doc !== undefined) {
    ctx.effect(() => installXlsxStyles(doc), 'dsh-document-selection-ask: xlsx renderer styles')
  }

  ctx.effect(
    () => previews.register(xlsxRendererDefinition()),
    'dsh-document-selection-ask: xlsx renderer definition',
  )

  ctx.slots.inject(DOCUMENT_BODY_SLOT, () =>
    ctx.slots.register(
      {
        name: DOCUMENT_BODY_SLOT,
        key: XLSX_RENDERER_ID,
        inject: () => ({
          bridge,
        }),
      },
      XlsxBody as any,
    ),
  )

  return true
}
