/**
 * DOM geometry fixtures for the client specs.
 *
 * A layout-less document reports no geometry at all, so every spec that needs
 * rectangles has to supply them. A browser reports geometry through
 * `Range.prototype`, which is not reachable from a helper module at runtime, so
 * the geometry is attached to the range instance instead: the capture path
 * clones the live range, and jsdom's clone preserves the range's text and
 * containment, which is what the capture actually reads.
 *
 * The rectangles are constructed through `DOMRect.fromRect` when the host
 * provides it, matching what a browser returns, and are otherwise built to the
 * same member set. Nothing here depends on layout having run.
 */

/** The parts of a `DOMRect` a fixture specifies. */
export interface RectInit {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Build a rectangle with the derived edges populated.
 * @param init - position and size.
 * @returns a rectangle satisfying `DOMRectReadOnly`.
 */
export function rect(init: RectInit): DOMRectReadOnly {
  const source = {
    x: init.x,
    y: init.y,
    width: init.width,
    height: init.height,
    top: init.y,
    right: init.x + init.width,
    bottom: init.y + init.height,
    left: init.x,
  }

  const RectConstructor: typeof DOMRect | undefined = globalThis.DOMRect
  if (RectConstructor !== undefined) {
    return RectConstructor.fromRect(source)
  }

  return Object.freeze({
    ...source,
    toJSON: (): Record<string, number> => ({ ...source }),
  }) as DOMRectReadOnly
}

/**
 * Make one range report the supplied geometry.
 *
 * @param range - the live range a capture will read.
 * @param clientRects - the rectangles `getClientRects()` reports; an empty array
 * models a range with no client boxes.
 * @param boundingRect - the rectangle `getBoundingClientRect()` reports.
 * @returns a disposer that removes the geometry from the range again.
 */
export function stubRangeGeometry(
  range: Range,
  clientRects: readonly DOMRectReadOnly[],
  boundingRect: DOMRectReadOnly,
): () => void {
  Object.defineProperty(range, 'getClientRects', {
    configurable: true,
    writable: true,
    value: (): DOMRectReadOnly[] => [...clientRects],
  })
  Object.defineProperty(range, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: (): DOMRectReadOnly => boundingRect,
  })

  return () => {
    delete (range as unknown as Record<string, unknown>)['getClientRects']
    delete (range as unknown as Record<string, unknown>)['getBoundingClientRect']
  }
}
