/**
 * DOCX preview rendering engine.
 *
 * Coordinates OOXML preflight security gating, docx-preview DOM rendering into
 * a detached staging DOM, hyperlink scheme sanitization, and rendered-page DOM marker assignment
 * before atomic publication to live preview hosts.
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
 * - Detached staging DOM: third-party rendering occurs entirely in disconnected
 *   staging containers. Unsanitized anchors or transient DOM nodes never reach
 *   the live DOM before security policy enforcement.
 * - Hyperlink sanitization: all anchor elements are inspected and hardened against
 *   an explicit allowlist before publication. Unapproved or dangerous schemes,
 *   relative paths, and malformed targets have navigation attributes stripped.
 * - `AbortSignal` checks occur before preflight, between preflight and render,
 *   after render, and before atomic publication. If aborted, staging DOM is discarded
 *   and live hosts remain pristine.
 */

import { renderAsync } from 'docx-preview'
import { DEFAULT_OOXML_LIMITS } from '../../ooxml/limits.js'
import { preflightOoxml } from '../../ooxml/preflight.js'
import { DOCX_ENGINE_CLASS_NAME } from './identity.js'
import { markRenderedPages } from './page-markers.js'
import { sanitizeDocxLinks } from './security.js'

/** Optional renderer injection type for internal testing without ESM mock overhead. */
export type DocxRenderFunction = typeof renderAsync

/**
 * The settled result of rendering a DOCX document into a host container.
 */
export interface DocxRenderResult {
  /** Count of reliably marked rendered pages (0 if pagination unavailable). */
  readonly renderedPages: number
  /** Synchronously dispose rendered DOM and styles. */
  readonly dispose: () => void
}

/**
 * Render a DOCX document into the provided DOM containers with security gating
 * and detached staging publication.
 *
 * @param bytes - raw DOCX binary data.
 * @param body - host container where the document DOM is mounted.
 * @param styleHost - host container where docx-preview injects document CSS.
 * @param signal - abort signal controlling the render lifecycle.
 * @param renderFn - optional internal renderer implementation (defaults to docx-preview renderAsync).
 * @returns result containing page count and disposal handle.
 */
export async function renderDocx(
  bytes: Uint8Array<ArrayBuffer>,
  body: HTMLElement,
  styleHost: HTMLElement,
  signal: AbortSignal,
  renderFn: DocxRenderFunction = renderAsync,
): Promise<DocxRenderResult> {
  signal.throwIfAborted()

  // 1. Mandatory OOXML archive security preflight
  await preflightOoxml(bytes, DEFAULT_OOXML_LIMITS, signal)

  signal.throwIfAborted()

  // 2. Clear target hosts before rendering new generation
  body.replaceChildren()
  styleHost.replaceChildren()

  // 3. Create detached staging hosts to prevent un-sanitized DOM from leaking to live preview
  const doc = body.ownerDocument ?? document
  const stagingBody = doc.createElement('div')
  const stagingStyleHost = doc.createElement('div')

  // 4. Render into detached staging elements using pinned docx-preview 0.4.0
  await renderFn(bytes, stagingBody, stagingStyleHost, {
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

  // 5. Hardened security boundary: sanitize all hyperlinks before publication
  sanitizeDocxLinks(stagingBody)

  // 6. Mark rendered page section containers with 1-based page indices
  const renderedPages = markRenderedPages(stagingBody)

  signal.throwIfAborted()

  // 7. Atomically publish detached staging nodes into live hosts
  body.replaceChildren(...Array.from(stagingBody.childNodes))
  styleHost.replaceChildren(...Array.from(stagingStyleHost.childNodes))

  return {
    renderedPages,
    dispose() {
      body.replaceChildren()
      styleHost.replaceChildren()
    },
  }
}
