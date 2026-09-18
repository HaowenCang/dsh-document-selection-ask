/**
 * Host half of `dsh-document-selection-ask` (`exports "."`).
 *
 * The DSH loader loads this module in the host process and requires a plugin
 * body: a function, or an object carrying `apply`.
 *
 * `inject` is empty: the plugin declares no required host dependencies at
 * root activation, but if `webServer` is present in the host composition, it
 * hooks asset routes for the local Duke WASM binary and the Web Worker bundle.
 *
 * This module is imported by the host process and must never reach browser-only
 * dependencies (React, DOM APIs, PDF.js, Office parsers). The browser half lives
 * behind `exports "./client"` and is loaded only by the web boot.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

/** Exact package name the DSH patch row and the loader entry both address. */
export const PLUGIN_NAME = 'dsh-document-selection-ask'

/** Package version, kept in step with `package.json`. */
export const PLUGIN_VERSION = '0.1.0'

/** Host-side services the plugin requires before activation; none in v1. */
export const inject: readonly string[] = []

/**
 * Apply the plugin's host contributions.
 *
 * If `webServer` is present on the host context, registers local asset routes
 * for the Duke WASM binary and the Web Worker bundle so no remote CDN is ever
 * contacted.
 *
 * When called with no context (e.g. unit test probe), returns undefined cleanly.
 */
export function apply(ctx?: Context): void {
  if (!ctx || typeof ctx.get !== 'function') {
    return
  }

  const registerAssets = (carrierCtx: Context): void => {
    const webServer = carrierCtx.get('webServer') as any
    if (!webServer || typeof webServer.register !== 'function') {
      return
    }

    const wasmPath = join(import.meta.dirname, 'assets', 'duke_sheets_wasm_bg.wasm')
    const workerPath = join(import.meta.dirname, 'assets', 'xlsx-worker.js')

    carrierCtx.effect(() => {
      return webServer.register({
        kind: 'exact',
        path: '/dsa-assets/duke_sheets_wasm_bg.wasm',
        handler(_req: any, res: any) {
          if (!existsSync(wasmPath)) {
            res.writeHead(404)
            res.end()
            return
          }
          const bytes = readFileSync(wasmPath)
          res.writeHead(200, {
            'content-type': 'application/wasm',
            'cache-control': 'public, max-age=31536000, immutable',
          })
          res.end(bytes)
        },
      })
    }, 'dsa: wasm asset route')

    carrierCtx.effect(() => {
      return webServer.register({
        kind: 'exact',
        path: '/dsa-assets/xlsx-worker.js',
        handler(_req: any, res: any) {
          if (!existsSync(workerPath)) {
            res.writeHead(404)
            res.end()
            return
          }
          const code = readFileSync(workerPath)
          res.writeHead(200, {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'public, max-age=31536000, immutable',
          })
          res.end(code)
        },
      })
    }, 'dsa: worker asset route')
  }

  if (ctx.get('webServer') === undefined) {
    ctx.inject(['webServer'], registerAssets)
  } else {
    registerAssets(ctx)
  }
}

/** The plugin body the DSH host loader activates. */
export const plugin = { name: PLUGIN_NAME, inject, apply } as const

export default plugin
