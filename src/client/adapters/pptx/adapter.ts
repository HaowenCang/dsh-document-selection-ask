/**
 * Selection adapter for the plugin's selectable PPTX preview.
 *
 * Captures browser selections from rendered PPTX presentation content, resolves
 * slide-range provenance from verified `data-dsa-pptx-slide` markers, and constructs
 * a format-independent `SelectionSnapshot`.
 *
 * ## Ownership & boundaries
 *
 * - Ownership enters exclusively through `[data-dsa-pptx-content]` hosts under
 *   a verified PPTX document root (`[data-dsa-document-kind="pptx"][data-dsa-resource-address]`).
 * - Non-content surfaces cannot claim selection ownership.
 * - If either selection endpoint starts inside selectable PPTX content but the
 *   other endpoint leaves the document root or leaves selectable content, the
 *   adapter claims the context and authoritative rejection reports `cross-root`.
 * - Unlike DOCX, PPTX has **no file-only fallback**. If slide markers are missing
 *   or invalid, the adapter returns `renderer-not-ready`.
 */

import { fileNameFromResourceAddress } from '../../provenance/file-name.js'
import { slideRangeLocation } from '../../provenance/slide-range.js'
import {
  PPTX_DOCUMENT_KIND,
  PPTX_DOCUMENT_KIND_ATTRIBUTE,
  PPTX_RESOURCE_ADDRESS_ATTRIBUTE,
  PPTX_SELECTABLE_ATTRIBUTE,
  PPTX_SELECTION_ADAPTER_ID,
  PPTX_SLIDE_ATTRIBUTE,
} from '../../renderers/pptx/identity.js'
import { captureDomRange } from '../../selection/dom-range.js'
import { validateSelectionSize } from '../../selection/limits.js'
import { normalizeSelectedText } from '../../selection/normalize.js'
import type { SelectionAdapter, SelectionCapture, SelectionContext } from '../../selection/registry.js'
import { closestElement, domSelectionRejectReason } from '../../selection/scope.js'
import type { SelectionSnapshot } from '../../selection/types.js'

export { PPTX_SELECTION_ADAPTER_ID } from '../../renderers/pptx/identity.js'

/** Selector matching the plugin's PPTX preview document root. */
const PPTX_ROOT_SELECTOR = `[${PPTX_DOCUMENT_KIND_ATTRIBUTE}="${PPTX_DOCUMENT_KIND}"][${PPTX_RESOURCE_ADDRESS_ATTRIBUTE}]`

/**
 * Find the selectable PPTX content host owning a given node, if any.
 *
 * @param node - selection endpoint or event target.
 * @returns the content host element, or `null` if the node is not in selectable PPTX content.
 */
function findPptxContent(node: Node | null): Element | null {
  if (node === null) {
    return null
  }

  const element = closestElement(node)
  if (element === null) {
    return null
  }

  const contentHost = element.closest(`[${PPTX_SELECTABLE_ATTRIBUTE}]`)
  if (contentHost === null) {
    return null
  }

  const root = contentHost.closest(PPTX_ROOT_SELECTOR)
  if (root === null) {
    return null
  }

  return contentHost
}

/**
 * Find the PPTX document root owning a selection context.
 *
 * Evaluates anchor, focus, then target nodes.
 *
 * @param context - selection context.
 * @returns the PPTX document root element, or `null` if none found.
 */
function findPptxRoot(context: SelectionContext): Element | null {
  const { selection } = context

  for (const node of [selection?.anchorNode ?? null, selection?.focusNode ?? null, context.target]) {
    const content = findPptxContent(node)
    if (content !== null) {
      const root = content.closest(PPTX_ROOT_SELECTOR)
      if (root !== null) {
        return root
      }
    }
  }

  return null
}

/**
 * Create the PPTX selection adapter.
 *
 * @returns selection adapter instance.
 */
export function createPptxSelectionAdapter(): SelectionAdapter {
  return {
    id: PPTX_SELECTION_ADAPTER_ID,

    canHandle(context: SelectionContext): boolean {
      const { selection } = context
      const anchor = selection?.anchorNode ?? null
      const focus = selection?.focusNode ?? null

      if (anchor !== null || focus !== null) {
        return findPptxContent(anchor) !== null || findPptxContent(focus) !== null
      }

      return findPptxContent(context.target) !== null
    },

    capture(context: SelectionContext): SelectionCapture {
      const { selection } = context
      const root = findPptxRoot(context)

      if (selection === null || root === null) {
        return { snapshot: null, rejectReason: 'outside-supported-preview' }
      }

      const resourceAddress = root.getAttribute(PPTX_RESOURCE_ADDRESS_ATTRIBUTE) ?? ''
      const fileName = fileNameFromResourceAddress(resourceAddress)

      if (!resourceAddress || fileName === null) {
        return { snapshot: null, rejectReason: 'outside-supported-preview' }
      }

      const captured = captureDomRange(selection)
      if (captured === null) {
        return { snapshot: null, rejectReason: 'collapsed' }
      }

      const text = normalizeSelectedText(captured.text)
      const rejectReason = domSelectionRejectReason(selection, root, text)
      if (rejectReason !== null) {
        return { snapshot: null, rejectReason }
      }

      const startContent = findPptxContent(captured.range.startContainer)
      const endContent = findPptxContent(captured.range.endContainer)

      if (
        startContent === null ||
        endContent === null ||
        startContent.closest(PPTX_ROOT_SELECTOR) !== root ||
        endContent.closest(PPTX_ROOT_SELECTOR) !== root
      ) {
        return { snapshot: null, rejectReason: 'cross-root' }
      }

      // Resolve slide provenance: find nearest [data-dsa-pptx-slide]
      const startElement = closestElement(captured.range.startContainer)
      const endElement = closestElement(captured.range.endContainer)

      const startSlide = startElement?.closest(`[${PPTX_SLIDE_ATTRIBUTE}]`) ?? null
      const endSlide = endElement?.closest(`[${PPTX_SLIDE_ATTRIBUTE}]`) ?? null

      if (
        startSlide === null ||
        endSlide === null ||
        startSlide.closest(PPTX_ROOT_SELECTOR) !== root ||
        endSlide.closest(PPTX_ROOT_SELECTOR) !== root
      ) {
        return { snapshot: null, rejectReason: 'renderer-not-ready' }
      }

      const startMarker = startSlide.getAttribute(PPTX_SLIDE_ATTRIBUTE)
      const endMarker = endSlide.getAttribute(PPTX_SLIDE_ATTRIBUTE)
      const location = slideRangeLocation(startMarker, endMarker)

      if (location === null) {
        return { snapshot: null, rejectReason: 'renderer-not-ready' }
      }

      const snapshot: SelectionSnapshot = {
        adapterId: PPTX_SELECTION_ADAPTER_ID,
        resourceAddress,
        fileName,
        documentKind: 'pptx',
        text,
        location,
        rects: captured.rects,
        capturedAt: context.now,
      }

      const sizeReason = validateSelectionSize(snapshot)
      if (sizeReason !== null) {
        return { snapshot: null, rejectReason: sizeReason }
      }

      return { snapshot, rejectReason: null }
    },
  }
}
