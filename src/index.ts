/**
 * Host half of `dsh-document-selection-ask` (`exports "."`).
 *
 * The DSH loader loads this module in the host process and requires a plugin
 * body: a function, or an object carrying `apply`. This one is deliberately
 * inert — v1 is a client-only plugin, so the host contributes no service, no
 * tool, and no route — but it cannot be constants alone. A module with no
 * `apply` is rejected before activation with `invalid plugin, expect function or
 * object with an "apply" method`, and that failure takes down the whole loader
 * entry rather than only the browser half.
 *
 * `inject` is empty for the same reason: the browser half states what it needs
 * from the client context in `src/client/index.tsx`, and the host half depends
 * on nothing.
 *
 * This module is imported by the host process and must never reach browser-only
 * dependencies (React, DOM APIs, PDF.js, Office parsers). The browser half lives
 * behind `exports "./client"` and is loaded only by the web boot.
 */

/** Exact package name the DSH patch row and the loader entry both address. */
export const PLUGIN_NAME = 'dsh-document-selection-ask'

/** Package version, kept in step with `package.json`. */
export const PLUGIN_VERSION = '0.1.0'

/** Host-side services the plugin requires before activation; none in v1. */
export const inject: readonly string[] = []

/**
 * Apply the plugin's host contributions.
 *
 * Empty by design: every contribution this plugin makes is a browser one, and
 * registering nothing host-side keeps disabling the plugin a pure client
 * operation.
 */
export function apply(): void {
  // A host contribution is introduced only if a later version needs one.
}

/** The plugin body the DSH host loader activates. */
export const plugin = { name: PLUGIN_NAME, inject, apply } as const

export default plugin
