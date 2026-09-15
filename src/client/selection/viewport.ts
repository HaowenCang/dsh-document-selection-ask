/**
 * Viewport geometry for the Ask overlay.
 *
 * Two decisions live here, and both are pure functions of data the snapshot
 * already froze: which rectangle the overlay anchors to, and where inside the
 * viewport that anchor may place the button. Keeping them here rather than in
 * the component is what makes them checkable without a browser, because jsdom
 * implements no layout and every rectangle a client spec can supply is one this
 * module receives as an argument.
 *
 * The anchor rule prefers the **last rectangle that intersects the viewport**
 * rather than the last rectangle outright. A selection that spans several lines
 * reports one rectangle per line, and the last of them is the one nearest the
 * pointer that just finished the drag — but a selection dragged past the bottom
 * edge also reports a rectangle for the part that scrolled out of view, and
 * anchoring there would place the button where the reader cannot see it.
 *
 * Clamping is not a cosmetic adjustment. The rectangles are viewport geometry
 * copied at capture time, so a selection at the right edge of the preview would
 * put a fixed-position button past the viewport's own edge, where the only way
 * to reach it is to change the selection that produced it.
 */

/** Minimum distance between the button and any viewport edge, in CSS pixels. */
export const VIEWPORT_MARGIN = 8

/** Decode a rect's edges without trusting its own derived fields. */
function edgesOf(rect: DOMRectReadOnly): {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
} {
  const left = Math.min(rect.left, rect.right)
  const right = Math.max(rect.left, rect.right)
  const top = Math.min(rect.top, rect.bottom)
  const bottom = Math.max(rect.top, rect.bottom)
  return { left, top, right, bottom }
}

/**
 * Whether a rectangle overlaps the viewport.
 *
 * A zero-area point still counts when it lies inside the viewport: a caret-like
 * rectangle is the normal shape for a single-character selection in some
 * renderers, and refusing it would drop a real selection's only anchor.
 *
 * @param rect - the candidate rectangle.
 * @param viewport - viewport size in CSS pixels.
 * @returns true when the rectangle and the viewport share any area.
 */
export function rectIntersectsViewport(
  rect: DOMRectReadOnly,
  viewport: { readonly width: number; readonly height: number },
): boolean {
  const { left, top, right, bottom } = edgesOf(rect)
  return right >= 0 && bottom >= 0 && left <= viewport.width && top <= viewport.height
}

/**
 * Choose the rectangle the overlay anchors to.
 *
 * @param rects - the viewport rectangles a snapshot froze; may be empty.
 * @param viewport - viewport size in CSS pixels.
 * @returns the last rectangle intersecting the viewport, the last rectangle when
 * none does, or `null` when there is no geometry at all.
 */
export function anchorRect(
  rects: readonly DOMRectReadOnly[],
  viewport: { readonly width: number; readonly height: number },
): DOMRectReadOnly | null {
  if (rects.length === 0) {
    return null
  }

  for (let index = rects.length - 1; index >= 0; index -= 1) {
    const candidate = rects[index]
    if (candidate !== undefined && rectIntersectsViewport(candidate, viewport)) {
      return candidate
    }
  }

  return rects[rects.length - 1] ?? null
}

/**
 * Place a fixed-position box near an anchor without leaving the viewport.
 *
 * The box is centred on the anchor's horizontal midpoint and sits one gap above
 * the anchor's top edge, which is where a reader who has just finished a drag
 * looks first. Both axes are then clamped to the viewport margins, and a box
 * larger than the space it has is pinned to the leading margin rather than
 * pushed off the opposite edge.
 *
 * @param anchor - the anchor rectangle, as returned by {@link anchorRect}.
 * @param size - the box's own size in CSS pixels.
 * @param viewport - viewport size in CSS pixels.
 * @returns the clamped top-left position in viewport coordinates.
 */
export function placeOverlay(
  anchor: DOMRectReadOnly,
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number } {
  const { left, top, right } = edgesOf(anchor)

  return {
    left: clampEdge((left + right) / 2 - size.width / 2, size.width, viewport.width),
    top: clampEdge(top - size.height - VIEWPORT_MARGIN, size.height, viewport.height),
  }
}

/**
 * Keep one leading edge inside the viewport.
 *
 * The upper bound never falls below the margin, so a box taller or wider than
 * the space it has is pinned to the leading margin instead of being pushed off
 * the opposite edge — a box partly past the right edge is worse than one flush
 * against the left, because the far edge is the one that cannot be reached.
 *
 * @param position - the preferred leading edge.
 * @param extent - the box's size on this axis.
 * @param limit - the viewport's size on this axis.
 * @returns the clamped leading edge.
 */
export function clampEdge(position: number, extent: number, limit: number): number {
  const max = Math.max(VIEWPORT_MARGIN, limit - extent - VIEWPORT_MARGIN)
  return Math.min(Math.max(position, VIEWPORT_MARGIN), max)
}

/**
 * Restrict a value to an inclusive range.
 * @param value - the candidate value.
 * @param min - the smallest permitted value.
 * @param max - the largest permitted value, never below `min`.
 * @returns the clamped value.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Read the current viewport size from a document's window.
 *
 * @param doc - the document whose window is measured.
 * @returns the inner viewport size, or `null` when the document has no window
 * (an unmounted tree, or a non-browser host).
 */
export function viewportOf(doc: Document): { readonly width: number; readonly height: number } | null {
  const view = doc.defaultView
  if (view === null) {
    return null
  }

  return { width: view.innerWidth, height: view.innerHeight }
}
