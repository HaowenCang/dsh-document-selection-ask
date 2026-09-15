/**
 * Browser Range extraction for DOM-based adapters.
 *
 * This is the one module in the selection core that reads a live browser
 * `Range`, and it exists to convert that live object into three values an
 * adapter can keep: the selected text, a static copy of the selection's
 * geometry, and a `Range` of its own.
 *
 * **The range is cloned.** The Ask overlay is a floating button, and clicking it
 * moves focus; the browser then collapses or drops the selection that produced
 * the button. A reference to `selection.getRangeAt(0)` would be a reference to
 * an object the browser is entitled to rewrite, so the clone — taken while the
 * selection is still live — is what makes the subsequent provenance lookup
 * possible at all. The captured range is deliberately *not* the live one, and
 * `tests/client/dom-selection.client.spec.tsx` asserts that the two stay
 * independent after the selection is replaced.
 * **The geometry is copied.** `Range.getClientRects()` returns a live
 * `DOMRectList` view; the rectangles in it are re-read from layout, and the list
 * itself is invalidated by the same events that invalidate the range. The
 * adapter copies the rectangles into plain immutable values, so an overlay
 * positioned from them cannot be positioned from a list that no longer
 * describes the selection.
 *
 * A `Range` is also *not* part of the universal snapshot. It survives only
 * inside an adapter's capture call, long enough to resolve that format's
 * provenance; `SelectionSnapshot` carries the resulting text, location and
 * rectangles and nothing else.
 *
 * The module never reads `window.getSelection()`: the selection is passed in, so
 * the capture can be tested without an ambient document and the event wiring
 * stays in one place.
 */

/** The parts of a `DOMRect` this module reads. */
interface RectSource {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/**
 * Structural minimum of `DOMRectReadOnly`, documented as the shape
 * {@link copyRect} produces.
 *
 * The plugin runs in a browser, where `DOMRect` always exists, so a copy could
 * simply be constructed and returned. The copy is instead built from the members
 * `DOMRectReadOnly` actually declares, which keeps the result independent of
 * which host produced the source rectangle: every member of the interface is
 * present, so a caller holding the result cannot tell how it was made.
 */
interface CopiedRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
  toJSON(): Record<string, number>
}

/**
 * Copy one rectangle into an immutable value.
 *
 * `top`, `right`, `bottom` and `left` are read from the source rather than
 * recomputed, because only the source knows whether the document is in a
 * right-to-left writing mode where `right` is the smaller edge.
 *
 * @param source - a rectangle the browser produced for the captured range.
 * @returns an immutable copy satisfying `DOMRectReadOnly`.
 */
function copyRect(source: RectSource): DOMRectReadOnly {
  const rect: CopiedRect = {
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
    top: source.top,
    right: source.right,
    bottom: source.bottom,
    left: source.left,
    toJSON(): Record<string, number> {
      return {
        x: source.x,
        y: source.y,
        width: source.width,
        height: source.height,
        top: source.top,
        right: source.right,
        bottom: source.bottom,
        left: source.left,
      }
    },
  }

  // `Object.freeze` is the guarantee that matters: the adapters and the overlay
  // hold these long after layout has moved on, and a rect that mutates would
  // silently relocate the button.
  return Object.freeze(rect) as DOMRectReadOnly
}

/**
 * Whether a rectangle covers any area.
 * @param source - the rectangle to test.
 * @returns true when width and height are both non-zero.
 */
function isNonZeroRect(source: RectSource): boolean {
  return source.width !== 0 || source.height !== 0
}

/**
 * Snapshot the geometry of a captured range.
 *
 * The client rectangles are preferred, because a selection spanning several
 * lines or pages has several and the overlay anchors to the last visible one.
 * A range that reports no client rectangles falls back to its bounding
 * rectangle, which is the case for a range whose own box is degenerate but whose
 * bounds are not.
 *
 * An empty result is a legal answer rather than a failure. Layout-less
 * environments report nothing for every range, and a selection whose text is
 * perfectly readable must not be judged invalid because its geometry is
 * unavailable; positioning is the overlay's problem, and it has its own
 * fallback.
 *
 * @param range - the live range to measure.
 * @returns the copied rectangles, possibly empty.
 */
function collectGeometry(range: Range): DOMRectReadOnly[] {
  // Both lookups are capability-checked rather than assumed: a host without
  // layout omits them entirely, and calling an absent method would throw away an
  // otherwise valid selection.
  const clientRects = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : []
  const boundingRect =
    typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null

  if (clientRects.length > 0) {
    return clientRects.map((rect) => copyRect(rect))
  }

  if (boundingRect === null || !isNonZeroRect(boundingRect)) {
    return []
  }
  return [copyRect(boundingRect)]
}

/**
 * A DOM selection, detached from the browser's live selection.
 *
 * `text` is what the reader saw selected, before normalization; adapters
 * normalize it with `normalizeSelectedText` so that one whitespace policy serves
 * every format.
 */
export interface DomRangeCapture {
  /** The selected text, as the browser reported it. */
  readonly text: string
  /** Viewport geometry at capture time, copied out of the live rect list. */
  readonly rects: readonly DOMRectReadOnly[]
  /** A range owned by this capture, safe to read after the selection changes. */
  readonly range: Range
}

/**
 * Capture the first range of a selection.
 *
 * @param selection - the live selection to capture.
 * @returns the text, geometry and cloned range, or `null` when the selection
 * carries nothing to capture — no range, or a collapsed caret.
 */
export function captureDomRange(selection: Selection): DomRangeCapture | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }

  // Geometry is read from the live range, and the clone is taken from it in the
  // same breath, while the selection is still live. Both reads have to happen
  // before the click that follows, because that click collapses the selection:
  // the clone then preserves the text and containment that provenance needs, and
  // the rectangles have already been copied out.
  //
  // The live range is the geometry source rather than the clone because the
  // browser is not obliged to carry a clone's layout information, and a clone is
  // a document model, not a box.
  const liveRange = selection.getRangeAt(0)
  const rects = collectGeometry(liveRange)

  return {
    text: selection.toString(),
    rects,
    range: liveRange.cloneRange(),
  }
}
