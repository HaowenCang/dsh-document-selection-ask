/**
 * Rendered page marker generation for docx-preview output.
 *
 * Scans the rendered DOCX DOM for the expected docx-preview wrapper and marks
 * direct child page sections with canonical 1-based `data-dsa-docx-page` attributes.
 *
 * If the DOM shape deviates from the expected pinned docx-preview 0.4.0 structure
 * (e.g. missing wrapper, multiple wrappers, or no direct section elements), this
 * helper fails softly and marks nothing, allowing the selection adapter to fall
 * back cleanly to document-level (file-only) provenance.
 */

import {
  DOCX_PAGE_ATTRIBUTE,
  DOCX_WRAPPER_CLASS_NAME,
} from './identity.js'

/**
 * Mark verified rendered page sections with 1-based page index attributes.
 *
 * @param body - the container holding docx-preview output.
 * @returns count of verified page sections marked, or 0 if pagination contract unfulfilled.
 */
export function markRenderedPages(body: HTMLElement): number {
  const wrappers = body.querySelectorAll(`.${DOCX_WRAPPER_CLASS_NAME}`)

  // Exactly one wrapper expected
  if (wrappers.length !== 1) {
    return 0
  }

  const wrapper = wrappers[0]
  if (wrapper === null || wrapper === undefined) {
    return 0
  }

  // Find direct child elements that are sections
  const sections: HTMLElement[] = []
  for (const child of Array.from(wrapper.children)) {
    if (child.tagName.toLowerCase() === 'section' && child instanceof HTMLElement) {
      sections.push(child)
    }
  }

  if (sections.length === 0) {
    return 0
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    if (section !== undefined) {
      section.setAttribute(DOCX_PAGE_ATTRIBUTE, String(i + 1))
    }
  }

  return sections.length
}
