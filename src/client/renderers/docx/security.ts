/**
 * DOCX hyperlink scheme policy and security boundary.
 *
 * Enforces an explicit scheme allowlist on all anchor elements generated
 * by third-party DOCX renderers before they are published to the live preview DOM.
 *
 * ## Policy
 *
 * - Allows fragment-only targets (`#...`) as internal Word bookmarks.
 * - Allows external `http:` and `https:` schemes, hardened with `target="_blank"`,
 *   `rel="noopener noreferrer"`, and `referrerpolicy="no-referrer"`.
 * - Allows `mailto:` and `tel:` external schemes without new-tab navigation.
 * - Blocks all other targets: missing schemes, relative paths, protocol-relative
 *   URLs, empty hrefs, and any unapproved external scheme.
 * - Blocked anchors have their navigation attributes stripped and receive the
 *   marker `data-dsa-docx-blocked-link=""` while preserving their text and children.
 */

import { DOCX_BLOCKED_LINK_ATTRIBUTE } from './identity.js'

export { DOCX_BLOCKED_LINK_ATTRIBUTE }

/**
 * Result counts from inspecting and hardening rendered anchor elements.
 */
export interface DocxLinkSanitizationResult {
  /** Count of allowed external links (http, https, mailto, tel). */
  readonly allowed: number
  /** Count of blocked unsafe, unknown, or malformed links. */
  readonly blocked: number
  /** Count of allowed internal bookmark references. */
  readonly internal: number
}

/** Explicit URI scheme grammar according to RFC 3986 section 3.1. */
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/

/** Explicit allowlist of permissible external schemes. */
const ALLOWED_EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])

/**
 * Inspect all anchor elements in the rendered DOM subtree and enforce the scheme policy.
 *
 * @param root - root container of the rendered DOM.
 * @returns counts of allowed, blocked, and internal links.
 */
export function sanitizeDocxLinks(root: ParentNode): DocxLinkSanitizationResult {
  let allowed = 0
  let blocked = 0
  let internal = 0

  const anchors = root.querySelectorAll('a')

  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i]!
    if (!anchor.hasAttribute('href')) {
      continue
    }

    const rawHref = anchor.getAttribute('href') ?? ''
    const trimmed = rawHref.trim()

    if (trimmed.startsWith('#') && trimmed.length > 0) {
      // Internal bookmark fragment: preserve target without opening new tabs
      internal += 1
      continue
    }

    const match = SCHEME_PATTERN.exec(trimmed)
    if (match !== null) {
      const scheme = match[0].slice(0, -1).toLowerCase()

      if (ALLOWED_EXTERNAL_SCHEMES.has(scheme)) {
        allowed += 1
        if (scheme === 'http' || scheme === 'https') {
          anchor.setAttribute('target', '_blank')
          anchor.setAttribute('rel', 'noopener noreferrer')
          anchor.setAttribute('referrerpolicy', 'no-referrer')
        }
        continue
      }
    }

    // Blocked link: missing scheme, relative/protocol-relative target, empty href, or unapproved scheme
    blocked += 1
    anchor.removeAttribute('href')
    anchor.removeAttribute('target')
    anchor.removeAttribute('rel')
    anchor.removeAttribute('referrerpolicy')
    anchor.setAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE, '')
  }

  return { allowed, blocked, internal }
}
