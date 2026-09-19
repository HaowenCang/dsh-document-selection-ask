/**
 * Compile probe for the public DSH navigation contract the real-preview smoke
 * driver depends on.
 *
 * Task 5A established that the shell's client runtime publishes no `Context` on
 * the page, so the only route to `ctx.sidebarRight.openResource` is a real
 * client plugin. That route is worth taking only while the contract it uses is
 * public, so this file states the contract explicitly and lets `pnpm typecheck`
 * fail when the primary runtime renames, moves, or withdraws it.
 *
 * The rules are the ones `contracts.compile.ts` already sets out, and they hold
 * here unchanged: no `any`, no `as`, no suppression comment, no
 * `@deepseek-ai/.../src/...` import. A contract that is absent must fail the
 * build rather than degrade, because a named import from a package the
 * installation does not ship resolves to `any` *silently* — every member access
 * below would then "pass" while checking nothing.
 *
 * This probe is separate from `contracts.compile.ts` on purpose. That file
 * states what the **shipped plugin** depends on; everything here belongs to the
 * test-only smoke driver and is not part of the package's contract.
 *
 * Verified against the installed
 * `@deepseek-ai/dsh-client-ui-sidebar-right@0.1.5-rc.2`, whose `./client` entry
 * is the public module that declares both the `sidebarRight` service and
 * `openResource`. Task 13 recorded the same contract against `0.1.5-rc.1`; from
 * Task 14 the compile baseline is `0.1.5-rc.2`, and the rc.1 run is retained as
 * historical backward-compatibility evidence rather than as a current pin.
 *
 * ```ts
 * declare module '@deepseek-ai/cordis' {
 *   interface Context {
 *     sidebarRight: SidebarRightController
 *     sidebarRightTabs: SidebarRightTabRegistry
 *   }
 * }
 *
 * interface ISidebarRight {
 *   openResource(address: string, options?: SidebarRightOpenResourceOptions): void
 * }
 * ```
 */

import type { Context } from '@deepseek-ai/cordis'
// The public module that declares `Context.sidebarRight`. Importing it is what
// brings the augmentation into the program; the value is never used.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// The public module that declares the session-scoped `conversation.input.overlay`
// list slot the driver's test-only control occupies.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

declare const ctx: Context
declare const overlayProps: PropsRuntime<'conversation.input.overlay'>

/**
 * Read every public member the smoke driver relies on.
 *
 * Each access is annotated, so an unresolved package turns into a compile error
 * instead of an `any` that would accept anything.
 * @returns one entry per verified contract, for a reader who wants the list.
 */
export function probeSmokeDriverContracts(): readonly unknown[] {
  // 1. The navigation service itself. Reading it through `Context` is the whole
  //    statement: the name, not a located instance.
  const sidebarRight = ctx.sidebarRight

  // 2. `openResource` — the only navigation call the driver makes. Its second
  //    parameter is optional; the driver passes no options, so the call below is
  //    the exact shape production would use.
  const open: (address: string, options?: { readonly kind?: string }) => void =
    sidebarRight.openResource
  open('dsh-resource://file/session/contract-probe/smoke-fixtures/probe.txt')

  // 3. A second public member, so the probe distinguishes "the service exists"
  //    from "the service has the shape this module names".
  const expanded: boolean = sidebarRight.isExpanded()

  // 4. The session-scoped slot the driver's test-only control is contributed
  //    through: the session identity a resource address has to name arrives as
  //    a standard prop, and it is a string rather than a branded type at this
  //    boundary.
  const sessionId: string = overlayProps.sessionId

  // 5. The runtime service key a client plugin requests this navigation face
  //    under. It is stated here as the literal the driver's `inject` array uses,
  //    so a rename is a compile error rather than a plugin that never applies.
  const runtimeServiceKeys: readonly string[] = ['slots', 'sidebarRight']

  return [sidebarRight, open, expanded, sessionId, runtimeServiceKeys]
}
