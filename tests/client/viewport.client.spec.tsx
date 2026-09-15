/**
 * Overlay placement arithmetic.
 *
 * These are the only geometry decisions the plugin makes, so they are pure
 * functions of data: the rectangles a snapshot froze, the box's own size, and
 * the viewport. That is what makes them checkable here — jsdom implements no
 * layout, so a case that measured a rendered element would be measuring the
 * fixture rather than the rule. The browser suite covers the fact that a real
 * selection produces real rectangles; this spec covers what is done with them.
 */

import { describe, expect, it } from 'vitest'

import {
  VIEWPORT_MARGIN,
  anchorRect,
  clampEdge,
  placeOverlay,
  rectIntersectsViewport,
} from '../../src/client/selection/viewport.js'
import { rect } from './helpers/dom-range-fixtures.js'

/** A typical desktop viewport. */
const VIEWPORT = { width: 1024, height: 768 }

/** A button-sized box. */
const BUTTON = { width: 110, height: 30 }

describe('anchor selection', () => {
  it('answers null when there is no geometry at all', () => {
    expect(anchorRect([], VIEWPORT)).toBeNull()
  })

  it('prefers the last rectangle that is on screen', () => {
    const first = rect({ x: 10, y: 10, width: 100, height: 12 })
    const second = rect({ x: 10, y: 30, width: 100, height: 12 })

    expect(anchorRect([first, second], VIEWPORT)).toBe(second)
  })

  it('skips a rectangle that scrolled past the bottom edge', () => {
    const visible = rect({ x: 10, y: 700, width: 100, height: 12 })
    const past = rect({ x: 10, y: 900, width: 100, height: 12 })

    // The trailing rectangle belongs to the part of the selection that is off
    // screen; anchoring there would put the button where it cannot be seen.
    expect(anchorRect([visible, past], VIEWPORT)).toBe(visible)
  })

  it('skips a rectangle that scrolled past the top edge', () => {
    const past = rect({ x: 10, y: -200, width: 100, height: 12 })
    const visible = rect({ x: 10, y: 120, width: 100, height: 12 })

    expect(anchorRect([past, visible], VIEWPORT)).toBe(visible)
  })

  it('skips a rectangle entirely to the right of the viewport', () => {
    const past = rect({ x: 2000, y: 10, width: 100, height: 12 })
    const visible = rect({ x: 10, y: 10, width: 100, height: 12 })

    expect(anchorRect([visible, past], VIEWPORT)).toBe(visible)
  })

  it('falls back to the last rectangle when none is on screen', () => {
    const first = rect({ x: 10, y: -400, width: 100, height: 12 })
    const second = rect({ x: 10, y: -200, width: 100, height: 12 })

    // Nothing is visible, so the reading position is still the last one; the
    // clamp is what keeps the result inside the viewport.
    expect(anchorRect([first, second], VIEWPORT)).toBe(second)
  })

  it('counts a zero-area rectangle inside the viewport as visible', () => {
    const caret = rect({ x: 40, y: 40, width: 0, height: 0 })

    expect(anchorRect([caret], VIEWPORT)).toBe(caret)
    expect(rectIntersectsViewport(caret, VIEWPORT)).toBe(true)
  })

  it('rejects a rectangle that only touches the far edges', () => {
    expect(rectIntersectsViewport(rect({ x: -50, y: 10, width: 49, height: 12 }), VIEWPORT)).toBe(false)
    expect(rectIntersectsViewport(rect({ x: 1024, y: 10, width: 50, height: 12 }), VIEWPORT)).toBe(true)
    expect(rectIntersectsViewport(rect({ x: 10, y: 768, width: 50, height: 12 }), VIEWPORT)).toBe(true)
    expect(rectIntersectsViewport(rect({ x: 10, y: -20, width: 50, height: 19 }), VIEWPORT)).toBe(false)
  })
})

describe('overlay placement', () => {
  it('centres the box above the anchor', () => {
    const anchor = rect({ x: 400, y: 300, width: 100, height: 20 })

    const placed = placeOverlay(anchor, BUTTON, VIEWPORT)

    expect(placed.left).toBe(400 + 50 - BUTTON.width / 2)
    expect(placed.top).toBe(300 - BUTTON.height - VIEWPORT_MARGIN)
  })

  it('keeps the box inside the right edge for a selection at the far right', () => {
    const anchor = rect({ x: 1000, y: 300, width: 24, height: 20 })

    const placed = placeOverlay(anchor, BUTTON, VIEWPORT)

    expect(placed.left).toBe(VIEWPORT.width - BUTTON.width - VIEWPORT_MARGIN)
  })

  it('keeps the box inside the left edge for a selection at the far left', () => {
    const anchor = rect({ x: 0, y: 300, width: 4, height: 20 })

    const placed = placeOverlay(anchor, BUTTON, VIEWPORT)

    expect(placed.left).toBe(VIEWPORT_MARGIN)
  })

  it('pushes the box below the anchor when the anchor is at the top edge', () => {
    // A selection on the first line has no room above it; the clamp pins the box
    // to the top margin, which is the only position that keeps it visible.
    const anchor = rect({ x: 400, y: 0, width: 100, height: 20 })

    const placed = placeOverlay(anchor, BUTTON, VIEWPORT)

    expect(placed.top).toBe(VIEWPORT_MARGIN)
  })

  it('sits above the anchor when there is room at the bottom of the viewport', () => {
    const anchor = rect({ x: 400, y: 760, width: 100, height: 8 })

    const placed = placeOverlay(anchor, BUTTON, VIEWPORT)

    // 760 - 30 - 8 = 722: the box is fully on screen without any clamping.
    expect(placed.top).toBe(722)
  })

  it('clamps the box when the anchor itself is off the bottom edge', () => {
    const anchor = rect({ x: 400, y: 900, width: 100, height: 8 })

    const placed = placeOverlay(anchor, BUTTON, VIEWPORT)

    expect(placed.top).toBe(VIEWPORT.height - BUTTON.height - VIEWPORT_MARGIN)
  })

  it('pins an oversized box to the leading margin rather than pushing it off', () => {
    const placed = placeOverlay(rect({ x: 500, y: 400, width: 10, height: 10 }), { width: 2000, height: 2000 }, VIEWPORT)

    expect(placed.left).toBe(VIEWPORT_MARGIN)
    expect(placed.top).toBe(VIEWPORT_MARGIN)
  })
})

describe('edge clamping', () => {
  it('never returns a negative leading edge', () => {
    expect(clampEdge(-40, 100, 1024)).toBe(VIEWPORT_MARGIN)
  })

  it('never returns a trailing edge past the viewport', () => {
    expect(clampEdge(5000, 100, 1024)).toBe(1024 - 100 - VIEWPORT_MARGIN)
  })

  it('accepts a value that already fits', () => {
    expect(clampEdge(320, 100, 1024)).toBe(320)
  })
})
