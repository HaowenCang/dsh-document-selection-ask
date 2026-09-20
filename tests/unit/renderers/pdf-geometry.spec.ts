/**
 * Canvas backing geometry: the raster cap, and nothing else.
 *
 * The algorithm is pure arithmetic over two CSS dimensions and a device pixel
 * ratio, so every boundary is checkable here without allocating a canvas. That
 * is deliberate rather than convenient: exercising the pixel cap through a real
 * canvas would need a 64-megapixel allocation per case, and the property under
 * test is the arithmetic, not the allocation.
 *
 * Three properties are load-bearing, and the first is the one the released
 * renderer got wrong:
 *
 * 1. on an ordinary display the factor is **exactly the device pixel ratio** at
 *    every ratio — 1, 1.25, 1.5, 2 and above. The backing store is the display's
 *    own resolution, and a backing store below it is the blur this module was
 *    corrected for;
 * 2. a cap lowers the factor and the **CSS geometry is untouched** — the cap is a
 *    raster budget, not a layout instruction;
 * 3. the reported canvas size stays an integer inside both caps for every input,
 *    including the degenerate ones.
 *
 * Nothing here is a function of a quality tier or of a text-layer scale, because
 * neither is a property of the raster; `--total-scale-factor` is the CSS viewport
 * scale and is asserted in the renderer's own client spec.
 */

import { describe, expect, it } from 'vitest'

import {
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS,
  backingGeometry,
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

/**
 * One entry of the display-ratio matrix.
 *
 * The ratios are the ones a real Windows display produces at 100 %, 125 %, 150 %,
 * 200 %, 250 % and 300 % scaling — the settings this renderer is actually opened
 * on, and the settings the released defect was reported at.
 */
const DISPLAY_RATIOS = [1, 1.25, 1.5, 2, 2.5, 3] as const

/** An A4 page at the renderer's own default fit width, in CSS pixels. */
const A4 = { width: 816, height: 1056 } as const

describe('an ordinary display keeps its own device pixel ratio', () => {
  for (const ratio of DISPLAY_RATIOS) {
    it(`backs an A4 page at exactly ${String(ratio)} device pixels per CSS pixel`, () => {
      const geometry = backingGeometry(A4.width, A4.height, ratio)

      expect(geometry.factor).toBe(ratio)
      expect(geometry.limitedBy).toBe('device-pixel-ratio')
      expect(geometry.width).toBe(Math.floor(A4.width * ratio))
      expect(geometry.height).toBe(Math.floor(A4.height * ratio))
      expectWithinCaps(geometry.width, geometry.height)
    })
  }

  it('never returns a backing factor below 1 on a high-resolution display', () => {
    // The released defect: a ratio at or above 1.5 selected a "finest" tier whose
    // factor was `devicePixelRatio / 2`, so a 150 % display was rendered at 0.75
    // device pixels per CSS pixel — blurrier than a 100 % display — and a 200 %
    // display at 1.0. Every ratio here must be at least 1, and equal to the ratio.
    for (const ratio of DISPLAY_RATIOS) {
      const geometry = backingGeometry(A4.width, A4.height, ratio)
      expect(geometry.factor, `ratio ${String(ratio)} must not be downsampled`).toBeGreaterThanOrEqual(1)
      expect(geometry.factor).toBe(ratio)
    }
  })

  it('scales the backing store linearly with the ratio while the CSS box stands still', () => {
    // 1.25 is the ratio that separates the two claims: it is above 1 and below the
    // old tier threshold, so an implementation that only halved the ratio above
    // 1.5 would still be caught here by the linearity check.
    const at1 = backingGeometry(600, 800, 1)
    const at125 = backingGeometry(600, 800, 1.25)
    const at2 = backingGeometry(600, 800, 2)

    expect(at1.width).toBe(600)
    expect(at125.width).toBe(750)
    expect(at2.width).toBe(1200)
    expect(at125.width / at1.width).toBeCloseTo(1.25, 10)
    expect(at2.height / at125.height).toBeCloseTo(1.6, 10)
  })
})

describe('the dimension cap', () => {
  it('reduces the factor to the largest one that fits the longer side', () => {
    const geometry = backingGeometry(400, 9000, 2)

    expect(geometry.limitedBy).toBe('max-dimension')
    expect(geometry.factor).toBeCloseTo(MAX_CANVAS_DIMENSION / 9000, 10)
    expect(geometry.factor).toBeLessThan(2)
    expectWithinCaps(geometry.width, geometry.height)
  })

  it('holds a page that fits at exactly the cap', () => {
    const geometry = backingGeometry(MAX_CANVAS_DIMENSION, 100, 1)

    expect(geometry.factor).toBe(1)
    // Nothing was capped: the factor the ratio asked for is the factor in force,
    // and `limitedBy` reports exactly that.
    expect(geometry.limitedBy).toBe('device-pixel-ratio')
    expect(geometry.width).toBe(MAX_CANVAS_DIMENSION)
    expectWithinCaps(geometry.width, geometry.height)
  })

  it('refuses to let a raised ratio break the dimension cap', () => {
    // The property the cap exists for: no ratio may push a side past the frozen
    // maximum, and the CSS box the caller asked for is not what gives way.
    for (const ratio of DISPLAY_RATIOS) {
      const geometry = backingGeometry(400, 9000, ratio)
      expect(geometry.width).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
      expect(geometry.height).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
      expect(geometry.height).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
    }
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

  it('never lets a raised ratio break the pixel cap', () => {
    for (const ratio of DISPLAY_RATIOS) {
      const geometry = backingGeometry(5000, 5000, ratio)
      expect(geometry.width * geometry.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
      expectWithinCaps(geometry.width, geometry.height)
    }
  })

  it('keeps the requested ratio for a page that only reaches the cap at a higher one', () => {
    // 2600 x 2600 CSS pixels: 6.76 megapixels, so the pixel budget allows a factor
    // of 3.07 and the frozen caps do not bind at 2.5 or 3. A cap that reduced the
    // factor for ordinary pages would show up here as a `limitedBy` that is not
    // the ratio.
    for (const ratio of [1, 1.25, 1.5, 2, 2.5, 3] as const) {
      const geometry = backingGeometry(2600, 2600, ratio)
      expect(geometry.limitedBy).toBe('device-pixel-ratio')
      expect(geometry.factor).toBe(ratio)
    }
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
      const geometry = backingGeometry(width, height, ratio)
      expect(Number.isFinite(geometry.factor)).toBe(true)
      expect(geometry.factor).toBeGreaterThan(0)
      expectWithinCaps(geometry.width, geometry.height)
    }
  })
})

describe('what the geometry no longer carries', () => {
  it('reports no quality tier and no text-layer factor', () => {
    // The released API carried `detail`, `scale` and `textScaleFactor`. The tier
    // inverted the meaning of its own name (its "finest" setting halved the
    // backing ratio) and the text factor encoded the wrong PDF.js contract; both
    // are gone rather than redefined, and this case fails if either returns.
    const geometry = backingGeometry(A4.width, A4.height, 2) as unknown as Record<string, unknown>

    expect(Object.keys(geometry).sort()).toEqual(['factor', 'height', 'limitedBy', 'width'])
    expect('detail' in geometry).toBe(false)
    expect('textScaleFactor' in geometry).toBe(false)
    expect('scale' in geometry).toBe(false)
  })
})
