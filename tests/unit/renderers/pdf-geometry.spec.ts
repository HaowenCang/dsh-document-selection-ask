/**
 * Canvas backing geometry: the raster cap, and the text-layer factor that has to
 * agree with it.
 *
 * The algorithm is pure arithmetic over two dimensions, a device pixel ratio and
 * a tier, so every boundary is checkable here without allocating a canvas. That
 * is deliberate rather than convenient: exercising the pixel cap through a real
 * canvas would need a 64-megapixel allocation per case, and the property under
 * test is the arithmetic, not the allocation.
 *
 * Three properties are load-bearing:
 *
 * 1. below both caps the factor is exactly the requested one, so an ordinary
 *    display is not silently downsampled;
 * 2. above a cap the factor is reduced and the **CSS geometry is untouched** —
 *    the cap is a raster budget, not a layout instruction;
 * 3. the reported canvas size stays an integer inside both caps for every input,
 *    including the degenerate ones.
 */

import { describe, expect, it } from 'vitest'

import {
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS,
  backingGeometry,
  pageBackingGeometry,
} from '../../../src/client/renderers/pdf/geometry.js'

/**
 * Assert the frozen caps hold for a computed canvas size.
 * @param width - buffered width.
 * @param height - buffered height.
 */
function expectWithinCaps(width: number, height: number): void {
  expect(Number.isInteger(width)).toBe(true)
  expect(Number.isInteger(height)).toBe(true)
  expect(width).toBeGreaterThanOrEqual(1)
  expect(height).toBeGreaterThanOrEqual(1)
  expect(width).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  expect(height).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  expect(width * height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
}

describe('ordinary device pixel ratios', () => {
  it('keeps the requested factor at 1x', () => {
    const geometry = backingGeometry(816, 1056, 1)

    expect(geometry.factor).toBe(1)
    expect(geometry.limitedBy).toBe('device-pixel-ratio')
    expect(geometry.detail).toBe('normal')
    expect(geometry.width).toBe(816)
    expect(geometry.height).toBe(1056)
    expectWithinCaps(geometry.width, geometry.height)
  })

  it('honours the normal tier at 2x exactly as it was requested', () => {
    const geometry = backingGeometry(816, 1056, 2, 'normal')

    expect(geometry.factor).toBe(2)
    expect(geometry.limitedBy).toBe('device-pixel-ratio')
    expect(geometry.width).toBe(1632)
    expect(geometry.height).toBe(2112)
    expectWithinCaps(geometry.width, geometry.height)
  })

  it('takes the finest tier from 1.5x upward, which asks for half the ratio', () => {
    const geometry = backingGeometry(816, 1056, 2)

    expect(geometry.detail).toBe('finest')
    expect(geometry.factor).toBe(1)
    expect(geometry.width).toBe(816)
  })

  it('keeps the normal tier below the threshold', () => {
    const geometry = backingGeometry(816, 1056, 1)

    expect(geometry.detail).toBe('normal')
  })

  it('never requests more than the ratio on a fractional display', () => {
    const geometry = backingGeometry(600, 800, 1.25)

    expect(geometry.factor).toBeCloseTo(1.25, 10)
    expect(geometry.limitedBy).toBe('device-pixel-ratio')
    expectWithinCaps(geometry.width, geometry.height)
  })
})

describe('the dimension cap', () => {
  it('reduces the factor to the largest one that fits the longer side', () => {
    // 9000 CSS pixels tall, and the area budget is generous: the dimension cap is
    // what binds. A normal tier is named because the default tier at this ratio
    // would be bound by the area instead.
    const geometry = backingGeometry(400, 9000, 2, 'normal')

    expect(geometry.limitedBy).toBe('max-dimension')
    expect(geometry.factor).toBeCloseTo(MAX_CANVAS_DIMENSION / 9000, 10)
    expect(geometry.factor).toBeLessThan(2)
    expectWithinCaps(geometry.width, geometry.height)
  })

  it('holds a page that fits at exactly the cap', () => {
    const geometry = backingGeometry(MAX_CANVAS_DIMENSION, 100, 1)

    expect(geometry.factor).toBe(1)
    // Nothing was capped: the factor the tier asked for is the factor in force,
    // and `limitedBy` reports exactly that.
    expect(geometry.limitedBy).toBe('device-pixel-ratio')
    expect(geometry.width).toBe(MAX_CANVAS_DIMENSION)
    expectWithinCaps(geometry.width, geometry.height)
  })
})

describe('the pixel cap', () => {
  it('reduces the factor when the area would exceed the frozen budget', () => {
    // 20000 x 20000 CSS pixels at 1x is 400 megapixels; the dimension cap is not
    // what binds first here, the area is.
    const geometry = backingGeometry(20000, 20000, 1)

    expect(geometry.limitedBy).toBe('max-pixels')
    expect(geometry.factor).toBeLessThan(1)
    expectWithinCaps(geometry.width, geometry.height)
  })

  it('binds before the dimension cap for a page whose area is large but whose sides are not', () => {
    const geometry = backingGeometry(16000, 16000, 1)

    expect(geometry.limitedBy).toBe('max-pixels')
    expect(geometry.factor).toBeCloseTo(Math.sqrt(MAX_CANVAS_PIXELS) / 16000, 10)
  })
})

describe('degenerate and hostile inputs', () => {
  it('refuses a dimension that is not a positive finite number', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => backingGeometry(bad, 100, 1)).toThrowError(RangeError)
      expect(() => backingGeometry(100, bad, 1)).toThrowError(RangeError)
    }
  })

  it('treats an unusable device pixel ratio as the identity rather than as a disabled resample', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const geometry = backingGeometry(800, 1000, bad)
      expect(geometry.factor).toBe(1)
      expectWithinCaps(geometry.width, geometry.height)
    }
  })

  it('always reports a positive finite factor and canvas size', () => {
    const cases: readonly (readonly [number, number, number])[] = [
      [1, 1, 1],
      [1, 1, 4],
      [100_000, 100_000, 8],
      [0.5, 0.5, 3],
      [10_000_000, 1, 2],
      [1, 10_000_000, 2],
      [816, 1056, 100],
    ]

    for (const [width, height, ratio] of cases) {
      for (const detail of ['normal', 'finest'] as const) {
        const geometry = backingGeometry(width, height, ratio, detail)
        expect(Number.isFinite(geometry.factor)).toBe(true)
        expect(geometry.factor).toBeGreaterThan(0)
        expectWithinCaps(geometry.width, geometry.height)
      }
    }
  })
})

describe('the viewport scale and the text factor', () => {
  it('scales the CSS viewport by the same factor the raster was computed with', () => {
    const cssPixelsPerUnit = 96 / 72
    const geometry = pageBackingGeometry(816, 1056, cssPixelsPerUnit, 2)

    // The default tier at 2× is the finest tier, whose factor is 1, so the
    // viewport scale is exactly the CSS one and the canvas is not resampled.
    expect(geometry.factor).toBe(1)
    expect(geometry.scale).toBeCloseTo(cssPixelsPerUnit, 10)
    expect(geometry.width).toBe(816)

    const normal = pageBackingGeometry(816, 1056, cssPixelsPerUnit, 2, 'normal')
    expect(normal.factor).toBe(2)
    expect(normal.scale).toBeCloseTo(cssPixelsPerUnit * 2, 10)
    expect(normal.width).toBe(1632)
  })

  it('cancels the device ratio the normal tier spends', () => {
    // The normal tier renders the canvas at 2× on a 2× display, which is one
    // device pixel per CSS pixel per ratio — so PDF.js's own ratio factor is
    // already right and this plugin contributes nothing.
    expect(pageBackingGeometry(816, 1056, 1, 2, 'normal').textScaleFactor).toBe(1)
    expect(pageBackingGeometry(816, 1056, 1, 1).textScaleFactor).toBe(1)
  })

  it('halves the ratio in the finest tier, because the canvas spends half of it', () => {
    expect(pageBackingGeometry(816, 1056, 1, 2).textScaleFactor).toBe(0.5)
    expect(pageBackingGeometry(816, 1056, 1, 3, 'finest').textScaleFactor).toBe(0.5)
  })

  it('passes a capped factor through unchanged', () => {
    const capped = pageBackingGeometry(20_000, 20_000, 1, 1)
    expect(capped.limitedBy).toBe('max-pixels')
    expect(capped.textScaleFactor).toBeCloseTo(capped.factor, 10)
    expect(capped.textScaleFactor).toBeLessThan(1)
  })

  it('refuses a viewport scale that is not a positive finite number', () => {
    expect(() => pageBackingGeometry(100, 100, 0, 1)).toThrowError(RangeError)
    expect(() => pageBackingGeometry(100, 100, Number.NaN, 1)).toThrowError(RangeError)
  })
})
