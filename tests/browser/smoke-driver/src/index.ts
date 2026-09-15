/**
 * Host half of the test-only smoke driver.
 *
 * It does nothing, and that is the whole design. A DSH bundle row is a package,
 * and a package whose `dsh.client` declaration asks for a browser half is still
 * composed through `exports "."` on the host side; naming a real module here
 * keeps the row resolvable without teaching the profile about a special case.
 *
 * The driver owns no host service, registers no tool, and reads nothing. Its one
 * contribution is the browser control that calls the public
 * `ctx.sidebarRight.openResource` navigation service.
 */

/** Stable plugin name for the loader row. */
export const name = '@dsh-smoke/dsa-smoke-driver'

/**
 * Host body: intentionally empty.
 * @returns nothing.
 */
export function apply(): void {
  // No host contribution. See the module comment.
}
