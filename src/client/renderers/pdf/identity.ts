/**
 * The stable identity and DOM contract of this plugin's PDF renderer.
 *
 * Three of these names are contracts rather than conveniences, and each is
 * stated once here so a later task consumes the same value the renderer emits:
 *
 * - `PDF_RENDERER_ID` is the implementation name the document-preview registry
 *   ranks and the key the document slot's body registers under. The DSH document
 *   body looks its component up by the definition's own `id`, so the registration
 *   and the slot key must be the same string.
 * - `PDF_PAGE_ATTRIBUTE` marks one page wrapper with its **1-based** page number.
 *   Task 8 resolves a selection's page provenance from it, which is why the
 *   numbering is fixed here rather than derived at the point of use.
 * - `PDF_DOCUMENT_KIND_ATTRIBUTE` and `PDF_RESOURCE_ADDRESS_ATTRIBUTE` mark the
 *   renderer root. The address is copied verbatim from the public
 *   `DocumentPreviewProps.resourceAddress`; nothing in this plugin infers it from
 *   the shell's DOM or from `location`.
 */

/**
 * The renderer's implementation id.
 *
 * It is namespaced by the package rather than by a registry band: the DSH
 * builtin PDF renderer keeps
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/pdf`, and two distinct
 * ids are what allows both to stay registered at once — the plugin's at
 * `priority: 'extension'`, the builtin one at `priority: 'builtin'` — so the
 * builtin remains selectable as a fallback rather than being replaced.
 */
export const PDF_RENDERER_ID = 'dsh-document-selection-ask/pdf'

/** Page-wrapper attribute carrying the 1-based page number. */
export const PDF_PAGE_ATTRIBUTE = 'data-dsa-pdf-page'

/** Renderer-root attribute naming the document class. */
export const PDF_DOCUMENT_KIND_ATTRIBUTE = 'data-dsa-document-kind'

/** Renderer-root attribute carrying the exact resource address. */
export const PDF_RESOURCE_ADDRESS_ATTRIBUTE = 'data-dsa-resource-address'

/** Value of `PDF_DOCUMENT_KIND_ATTRIBUTE` for this renderer's root. */
export const PDF_DOCUMENT_KIND = 'pdf'
