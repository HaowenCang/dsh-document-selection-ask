/**
 * Browser entry of `dsh-document-selection-ask` (`exports "./client"`).
 *
 * The DSH web boot loads this bundle through `window.__ModuleLoader__.load`
 * and activates the exported `apply` after the services named in `inject` are
 * available in the client context.
 */

import type { ClientContext } from './dsh/contracts.js'
import { applyClient } from './dsh/register.js'

/**
 * Client services this plugin's browser half requires before `apply` runs.
 *
 * `slots` is the renderer-owned slot registry. The Ask overlay is contributed
 * through `ctx.slots.inject`, which throws when the registry is absent rather
 * than waiting for it, and the PDF renderer's keyed body is contributed the same
 * way.
 *
 * `documentPreviews` is the extension-renderer registry Task 7 registers the PDF
 * implementation into. It is named here for the same reason, and the reason is
 * not theoretical: the first real boot after Task 7 failed with
 * `cannot get property "documentPreviews" without inject`, because the service is
 * exposed as a Cordis getter that refuses to be read before its provider has
 * loaded. The package edge in `dsh.client.inject` composes the module into the
 * boot graph; this list is what orders the *call*.
 *
 * The list stays explicit rather than wildcard — a package dependency edge in
 * `package.json` is not the same statement, and having the module on the graph
 * does not make the service available.
 */
export const inject: string[] = ['slots', 'documentPreviews']

/**
 * Client plugin body invoked by the DSH web boot.
 * @param ctx - the client root context.
 */
export function apply(ctx: ClientContext): void {
  applyClient(ctx)
}
