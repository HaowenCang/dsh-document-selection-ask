/**
 * Browser entry of the test-only smoke driver (`exports "./client"`).
 *
 * The DSH web boot loads this bundle through `window.__ModuleLoader__.load` and
 * activates the exported `apply` after the services named in `inject` are
 * available in the client context.
 *
 * The imports at the top are load-bearing rather than incidental, and they are
 * the reason this file is the entry:
 *
 * - `@deepseek-ai/dsh-client-ui-sidebar-right/client` declares
 *   `Context.sidebarRight` and its `openResource` method. Importing the module
 *   is what brings that augmentation into the program, so the one navigation call
 *   the driver makes is checked against the published contract rather than
 *   against a locally invented shape.
 * - `@deepseek-ai/dsh-client-ui-conversation/client` declares the
 *   `conversation.input.overlay` list slot. The driver occupies it because it is
 *   **session-scoped**, which is how the control receives the session identity
 *   its fixture address has to name.
 *
 * Both packages are listed in this package's `dsh.client.inject`, so the host
 * composes their browser halves into the boot graph ahead of this one. That
 * graph edge is what makes the two bundles resolvable in the browser; the
 * runtime `inject` below is a different statement, and neither substitutes for
 * the other.
 */

// Value import: `ctx.sidebarRight` is a runtime service reached through the
// client context the framework passes to `apply`.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

import { SmokeDriverControl } from './SmokeDriverControl.js'

/**
 * Client services this driver requires before `apply` runs.
 *
 * `slots` is the renderer-owned slot registry; `ctx.slots.inject` throws when it
 * is absent rather than waiting for it. `sidebarRight` is the navigation face
 * the control calls, and naming it here keeps the driver from applying before
 * the right column exists.
 */
export const inject: string[] = ['slots', 'sidebarRight']

/** Registration id of the driver's control within the overlay slot. */
export const DRIVER_ENTRY_ID = 'dsa-smoke-driver'

/** The session-scoped list slot the driver's control occupies. */
export const DRIVER_SLOT = 'conversation.input.overlay'

/**
 * Client plugin body invoked by the DSH web boot.
 * @param ctx - the client root context.
 */
export function apply(ctx: Context): void {
  ctx.slots.inject(DRIVER_SLOT, () =>
    ctx.slots.register(
      {
        name: DRIVER_SLOT,
        id: DRIVER_ENTRY_ID,
        // The framework binds `sessionId` and the composer props into the
        // component; the driver adds only the context its one call needs.
        inject: () => ({ ctx }),
      },
      SmokeDriverControl,
    ),
  )
}
