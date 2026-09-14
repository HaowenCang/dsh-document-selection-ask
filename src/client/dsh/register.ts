/**
 * Client registrar for `dsh-document-selection-ask`.
 *
 * Task 1 scope: this function is the single seam later tasks extend. It
 * currently registers nothing — the DSH text adapter, the selection kernel, the
 * Ask overlay, and the PDF/DOCX/PPTX/XLSX renderers each arrive with their own
 * task and their own registration call here.
 */

import type { ClientContext } from './contracts.js'

/**
 * Apply the plugin's browser contributions to the DSH client context.
 * @param _ctx - the client root context; unused until a later task registers a
 * contribution. The parameter stays in the signature so the registration shape
 * is fixed now and does not change when the first contribution lands.
 */
export function applyClient(_ctx: ClientContext): void {
  // Registration is introduced by later tasks.
}
