/**
 * Identity constants for the plugin's selectable PPTX preview.
 *
 * Exposes the stable renderer id, selection adapter id, document kind, and DOM
 * attribute names used to bind PPTX document previews and provenance markers.
 */

import type { DocumentKind } from '../../selection/types.js'

/** The renderer id registered with `ctx.documentPreviews.register`. */
export const PPTX_RENDERER_ID = 'dsh-document-selection-ask/pptx'

/** The selection adapter id registered with the selection lifecycle. */
export const PPTX_SELECTION_ADAPTER_ID = 'dsh-selectable-pptx'

/** Document kind recognized by the selection core for PPTX previews. */
export const PPTX_DOCUMENT_KIND: DocumentKind = 'pptx'

/** Root attribute identifying document kind on preview hosts. */
export const PPTX_DOCUMENT_KIND_ATTRIBUTE = 'data-dsa-document-kind'

/** Root attribute identifying the canonical resource address on preview hosts. */
export const PPTX_RESOURCE_ADDRESS_ATTRIBUTE = 'data-dsa-resource-address'

/** Attribute marking the selectable content root container. */
export const PPTX_SELECTABLE_ATTRIBUTE = 'data-dsa-pptx-content'

/**
 * Attribute marking an individual rendered slide element.
 * Value is a 1-based canonical integer string (e.g. "1", "2").
 */
export const PPTX_SLIDE_ATTRIBUTE = 'data-dsa-pptx-slide'
