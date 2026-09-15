/**
 * Where the Ask overlay sits, and whether a selection belongs to this session.
 *
 * Two pure functions, kept out of the component for the usual reason: jsdom
 * implements no layout, so the only geometry a client spec can exercise is
 * geometry the decision logic receives as an argument. Everything that decides
 * a pixel lives here; the component measures the viewport and renders the
 * result.
 *
 * The fallback matters as much as the main path. A snapshot can carry no
 * rectangles at all — the XLSX adapter is expected to publish exactly that when
 * its viewer exposes no selection bounding box — and a component that assumed
 * geometry would then render at 0,0, half off the left edge of the window. The
 * fallback instead places the overlay at the composer's own top-right corner,
 * which is where the draft it will be appended to lives, so the button appears
 * next to the thing it affects.
 */

import { COMPOSER_CARD_SELECTOR } from '../dsh/focus-composer.js'
import { sessionIdFromResourceAddress } from '../provenance/file-name.js'
import type { SelectionSnapshot } from '../selection/types.js'
import { anchorRect, clampEdge, placeOverlay } from '../selection/viewport.js'

/** Gap between the fallback position and the composer card's own box. */
const FALLBACK_INSET = 12

/**
 * Whether a snapshot belongs to the session the overlay is rendering for.
 *
 * The comparison is the whole of the session-isolation rule, and it refuses in
 * both directions it cannot prove. A snapshot whose address has no session — an
 * `absolute` resource — is not treated as belonging to the current session:
 * nothing in such an address says which session is viewing the file, and
 * guessing would write one session's selection into another's draft.
 *
 * @param snapshot - the captured selection, or `null`.
 * @param sessionId - the session id the overlay's composer belongs to.
 * @returns true when the selection provably belongs to this session.
 */
export function isSameSession(snapshot: SelectionSnapshot | null, sessionId: string): boolean {
  if (snapshot === null) {
    return false
  }

  return sessionIdFromResourceAddress(snapshot.resourceAddress) === sessionId
}

/** Inline style for the fixed-position overlay. */
export interface OverlayPosition {
  /** Left edge in viewport coordinates. */
  readonly left: number
  /** Top edge in viewport coordinates. */
  readonly top: number
}

/**
 * Compute the overlay's fixed position.
 *
 * @param origin - the overlay's own root element, used to find the composer card
 * for the no-geometry fallback.
 * @param rects - the snapshot's frozen viewport rectangles.
 * @param size - the overlay's own measured size.
 * @param viewport - the current viewport size.
 * @returns the clamped viewport position.
 */
export function overlayPosition(
  origin: Element | null,
  rects: readonly DOMRectReadOnly[],
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): OverlayPosition {
  const anchor = anchorRect(rects, viewport)
  if (anchor !== null) {
    return placeOverlay(anchor, size, viewport)
  }

  const card = origin?.closest(COMPOSER_CARD_SELECTOR) ?? null
  const box = card?.getBoundingClientRect()
  // A card with no box carries no corner: jsdom reports an all-zero rectangle,
  // and a degenerate card in a real browser would too. Reading `right`/`top` off
  // it would place the button at the document origin, so the fallback drops to
  // the viewport's own bottom-right margin instead.
  const hasCard = box !== undefined && box.width > 0 && box.height > 0

  return {
    left:
      hasCard && box !== undefined
        ? clampEdge(box.right - size.width, size.width, viewport.width)
        : clampEdge(viewport.width - size.width - FALLBACK_INSET, size.width, viewport.width),
    top:
      hasCard && box !== undefined
        ? clampEdge(box.top + FALLBACK_INSET, size.height, viewport.height)
        : clampEdge(viewport.height - size.height - FALLBACK_INSET, size.height, viewport.height),
  }
}
