/**
 * Client registrar for `dsh-document-selection-ask`.
 *
 * This function is the single seam every later task extends: each contribution —
 * the DSH text adapter, the Ask overlay, the PDF/DOCX/PPTX/XLSX renderers —
 * arrives with its own task and its own registration call here.
 *
 * Task 4 registers the builtin-text selection adapter and nothing else. The
 * adapter is deliberately *not* a renderer: registering a replacement for the
 * plain, Markdown, code or CSV preview would replace the very DOM the adapter
 * reads, so this task creates no `ctx.documentPreviews.register` call at all.
 *
 * The registry is owned by this call and released through `ctx.effect`, which is
 * the plugin fiber's own lifecycle hook. It is not a module-level singleton: a
 * module-global registry would survive a hot reload and accumulate one adapter
 * per reload, and the second registration of the same id would then throw from
 * inside the reload that was supposed to be harmless.
 *
 * Browser event wiring is still outstanding and belongs to the overlay task. At
 * this point the registry holds a working adapter that nothing dispatches to
 * yet.
 */

import { createDshTextAdapter } from '../adapters/dsh-text/adapter.js'
import { SelectionAdapterRegistry } from '../selection/registry.js'
import type { ClientContext } from './contracts.js'

/**
 * Apply the plugin's browser contributions to the DSH client context.
 *
 * @param ctx - the client root context; its `effect` hook owns the teardown of
 * every registration made here.
 * @returns the adapter registry this call created, so a caller can dispatch
 * capture contexts through it.
 */
export function applyClient(ctx: ClientContext): SelectionAdapterRegistry {
  const registry = new SelectionAdapterRegistry()

  ctx.effect(
    () => registry.register(createDshTextAdapter()),
    'dsh-document-selection-ask: builtin text selection adapter',
  )

  return registry
}
