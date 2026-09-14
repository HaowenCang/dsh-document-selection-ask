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
 * Task 1 needs none; later tasks add the registries they actually consume, and
 * the list is deliberately explicit rather than a wildcard.
 */
export const inject: string[] = []

/**
 * Client plugin body invoked by the DSH web boot.
 * @param ctx - the client root context.
 */
export function apply(ctx: ClientContext): void {
  applyClient(ctx)
}
