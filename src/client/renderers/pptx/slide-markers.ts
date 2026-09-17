/**
 * PPTX slide DOM marker assignments and validation.
 *
 * Marks rendered slide containers with `data-dsa-pptx-slide="<1-based index>"`
 * based on the renderer's public `onSlideRendered(index, element)` callback.
 *
 * Slide numbers are strictly 1-based canonical positive integers (1, 2, 3, ...).
 */

import { parseSlideMarker } from '../../provenance/slide-range.js'
import { PPTX_SLIDE_ATTRIBUTE } from './identity.js'

export { parseSlideMarker } from '../../provenance/slide-range.js'

/**
 * Assign the canonical slide provenance attribute to a rendered slide DOM element.
 *
 * @param element - the DOM element delivered by onSlideRendered.
 * @param slideIndex - 0-based slide index.
 */
export function markRenderedSlide(element: Element, slideIndex: number): void {
  if (!Number.isSafeInteger(slideIndex) || slideIndex < 0) {
    return
  }

  const slideNumber = slideIndex + 1
  element.setAttribute(PPTX_SLIDE_ATTRIBUTE, String(slideNumber))
}

/**
 * Read and validate the slide number from a slide element.
 *
 * @param element - element that may carry data-dsa-pptx-slide.
 * @returns 1-based slide number, or null if missing/invalid.
 */
export function readSlideMarker(element: Element): number | null {
  const marker = element.getAttribute(PPTX_SLIDE_ATTRIBUTE)
  return parseSlideMarker(marker)
}
