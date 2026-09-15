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
 * `slots` is the renderer-owned slot registry, and it is listed here for the
 * reason the runtime dependency list exists: the Ask overlay is contributed
 * through `ctx.slots.inject`, which throws when the registry is absent rather
 * than waiting for it. The DSH fiber resolves `inject` before calling `apply`,
 * so a plugin that names the service loads after the renderer and never sees
 * the failure. The list stays explicit rather than wildcard — a package
 * dependency edge in `package.json` is not the same statement, and having the
 * module on the graph does not make the service available.
 */
export const inject: string[] = ['slots']

/**
 * Client plugin body invoked by the DSH web boot.
 * @param ctx - the client root context.
 */
export function apply(ctx: ClientContext): void {
  applyClient(ctx)
}
