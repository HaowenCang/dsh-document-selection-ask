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
 * rectangles at all — the XLSX adapter publishes exactly that on every semantic
 * selection, because its viewer exposes no selection bounding box — and a
 * component that assumed geometry would then render at 0,0, half off the left
 * edge of the window. The fallback instead places the overlay just above the
 * composer card's own top-right corner, which is where the draft it will be
 * appended to lives, so the button appears next to the thing it affects without
 * covering the editable surface itself.
 */

import { COMPOSER_CARD_SELECTOR } from '../dsh/focus-composer.js'
import { sessionIdFromResourceAddress } from '../provenance/file-name.js'
import type { SelectionSnapshot } from '../selection/types.js'
import { anchorRect, clampEdge, placeOverlay, VIEWPORT_MARGIN } from '../selection/viewport.js'

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
 * @param origin - an element inside the composer card the selection belongs to;
 * since Task 5C this is the session registrar's own DOM anchor, because the
 * visible surface lives in `shell.overlay` and is no longer inside the composer
 * it writes to. `null` is legal and means only the geometry path is available.
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

  // The fallback clears the card rather than landing inside it. Task 15U
  // measured the earlier placement — flush with the card's top-right *inner*
  // corner — against the live composer: the button covered the right 98 px of the
  // editable surface's own box, so a press aimed at the end of the first line hit
  // Ask instead of placing the caret, and a long first line ran underneath it.
  // Every XLSX selection took that path, because the spreadsheet adapter
  // publishes no rectangles. The button therefore sits one inset clear of the
  // card, above it by preference and below it only when the card is pinned so
  // close to the top edge that there is no room above; either way the editable
  // surface and its controls stay uncovered.
  const above = hasCard && box !== undefined ? box.top - size.height - FALLBACK_INSET : null
  const fallbackTop =
    above === null || box === undefined
      ? clampEdge(viewport.height - size.height - FALLBACK_INSET, size.height, viewport.height)
      : above >= VIEWPORT_MARGIN
        ? clampEdge(above, size.height, viewport.height)
        // Read the lower edge from `top + height` rather than from `bottom`: the
        // degenerate-box check above already trusts the size fields, and a box
        // whose derived edges disagree must not decide where the button goes.
        : clampEdge(box.top + box.height + FALLBACK_INSET, size.height, viewport.height)

  return {
    left:
      hasCard && box !== undefined
        ? clampEdge(box.right - size.width, size.width, viewport.width)
        : clampEdge(viewport.width - size.width - FALLBACK_INSET, size.width, viewport.width),
    top: fallbackTop,
  }
}
