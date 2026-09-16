/**
 * Shared shell preparation for the real-DSH browser suites.
 *
 * Both suites drive a live DSH instance through the published
 * `ctx.sidebarRight.openResource` navigation, and both address their fixtures by
 * a **session-scoped** `dsh-resource://file/session/<id>/<path>` address. Such an
 * address resolves against the Session's workspace root, so the run is only
 * meaningful when that root is this repository.
 *
 * That is a property of the *instance*, not of the plugin: the instance keeps
 * whatever workspace its last user selected, and a run against the wrong root
 * fails with `workspace-file/not-found` for every fixture — which reads like a
 * renderer defect rather than a setup one. A fresh Playwright browser context
 * starts with no `localStorage` at all, so the selection is made per context
 * rather than assumed.
 *
 * Nothing here touches the plugin. The picker and its menu are the shell's own
 * controls, and the routine clicks the shell's list rather than typing a path or
 * reading a store.
 */

import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/** The shell's workspace picker, addressed by its published accessible name. */
export const WORKSPACE_PICKER = '[aria-label="选择工作区"]'

/**
 * The workspace group whose root is this repository.
 *
 * The group's name is the checkout directory's name, which is also what the
 * shell shows in the picker button.
 */
export const SMOKE_WORKSPACE = 'dsh-universal-document-selection'

/**
 * Point the shell at this repository, so a session-scoped fixture address
 * resolves.
 *
 * @param page - the browser page.
 * @param workspace - the group to select; defaults to the checkout's own name.
 */
export async function ensureWorkspace(page: Page, workspace: string = SMOKE_WORKSPACE): Promise<void> {
  const picker = page.locator(WORKSPACE_PICKER).first()
  await expect(picker).toBeVisible({ timeout: 30_000 })

  if (((await picker.textContent()) ?? '').includes(workspace)) return

  await picker.click()
  await page.getByRole('menuitem', { name: workspace, exact: true }).click()
  await expect(picker).toContainText(workspace, { timeout: 15_000 })
  await page.waitForTimeout(1500)
}
