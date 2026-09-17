/**
 * DOCX preview rendering engine.
 *
 * Coordinates OOXML preflight security gating, docx-preview DOM rendering,
 * and rendered-page DOM marker assignment.
 *
 * ## Security boundaries
 *
 * - Every archive is subjected to `preflightOoxml` before any parsing library
 *   touches it: oversized archives, encrypted files, and path-traversal names
 *   are rejected before docx-preview can be called.
 * - `renderAltChunks: false` is strictly enforced to prevent arbitrary HTML
 *   injection from embedded DOCX chunks into the preview DOM.
 * - `useBase64URL: true` is explicitly chosen because docx-preview 0.4.0 lacks
 *   any public disposal or revoke hook for blob: URLs, ensuring DOM-bounded
 *   memory lifecycles without leaking to the browser Blob registry.
 * - `AbortSignal` checks occur before preflight, between preflight and render,
 *   and before marking/committing the DOM.
 */

import { renderAsync } from 'docx-preview'
import { DEFAULT_OOXML_LIMITS } from '../../ooxml/limits.js'
import { preflightOoxml } from '../../ooxml/preflight.js'
import { DOCX_ENGINE_CLASS_NAME } from './identity.js'
import { markRenderedPages } from './page-markers.js'

/**
 * The settled result of rendering a DOCX document into a host container.
 */
export interface DocxRenderResult {
  /** Count of reliably marked rendered pages (0 if pagination unavailable). */
  readonly renderedPages: number
  /** Synchronously dispose rendered DOM and styles. */
  dispose(): void
}

/**
 * Render a DOCX document into the provided DOM containers with security gating.
 *
 * @param bytes - raw DOCX binary data.
 * @param body - host container where the document DOM is mounted.
 * @param styleHost - host container where docx-preview injects document CSS.
 * @param signal - abort signal controlling the render lifecycle.
 * @returns result containing page count and disposal handle.
 */
export async function renderDocx(
  bytes: Uint8Array<ArrayBuffer>,
  body: HTMLElement,
  styleHost: HTMLElement,
  signal: AbortSignal,
): Promise<DocxRenderResult> {
  signal.throwIfAborted()

  // 1. Mandatory OOXML archive security preflight
  await preflightOoxml(bytes, DEFAULT_OOXML_LIMITS, signal)

  signal.throwIfAborted()

  // 2. Clear target hosts before rendering
  body.innerHTML = ''
  styleHost.innerHTML = ''

  // 3. Render into host elements using pinned docx-preview 0.4.0
  await renderAsync(bytes, body, styleHost, {
    className: DOCX_ENGINE_CLASS_NAME,
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderAltChunks: false, // Security constraint: no arbitrary HTML altChunk injection
    useBase64URL: true, // Asset lifecycle constraint: prevent un-revocable Blob URL leaks
    experimental: false,
    debug: false,
  })

  signal.throwIfAborted()

  // 4. Mark rendered page section containers with 1-based page indices
  const renderedPages = markRenderedPages(body)

  return {
    renderedPages,
    dispose() {
      body.innerHTML = ''
      styleHost.innerHTML = ''
    },
  }
}
