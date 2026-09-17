/**
 * Selection adapter for the plugin's selectable PDF preview.
 *
 * Captures browser selections from PDF.js TextLayers, resolves 1-based source
 * page provenance from `[data-dsa-pdf-page]` wrappers, and constructs a format-
 * independent `SelectionSnapshot`.
 *
 * ## Ownership & boundaries
 *
 * - Ownership enters exclusively through `[data-dsa-pdf-text]` layers inside
 *   `[data-dsa-pdf-page]` page wrappers under a verified PDF document root.
 * - Non-text surfaces (canvas, loading/error placeholders, page margins) cannot
 *   claim selection ownership.
 * - If either selection endpoint starts inside a selectable PDF layer but the
 *   other endpoint leaves the document root or leaves selectable text layers,
 *   the adapter claims the context and authoritative rejection reports `cross-root`.
 * - Inverted or invalid page markers fail closed with `renderer-not-ready`.
 */

import { fileNameFromResourceAddress } from '../../provenance/file-name.js'
import { pageRangeLocation } from '../../provenance/page-range.js'
import {
  PDF_DOCUMENT_KIND,
  PDF_DOCUMENT_KIND_ATTRIBUTE,
  PDF_PAGE_ATTRIBUTE,
  PDF_RESOURCE_ADDRESS_ATTRIBUTE,
  PDF_TEXT_LAYER_ATTRIBUTE,
} from '../../renderers/pdf/identity.js'
import { captureDomRange } from '../../selection/dom-range.js'
import { validateSelectionSize } from '../../selection/limits.js'
import { normalizeSelectedText } from '../../selection/normalize.js'
import type { SelectionAdapter, SelectionCapture, SelectionContext } from '../../selection/registry.js'
import { closestElement, domSelectionRejectReason } from '../../selection/scope.js'
import type { SelectionSnapshot } from '../../selection/types.js'

/** Stable adapter id for the plugin's selectable PDF preview. */
export const PDF_SELECTION_ADAPTER_ID = 'dsh-selectable-pdf'

/** Selector matching the plugin's PDF preview document root. */
const PDF_ROOT_SELECTOR = `[${PDF_DOCUMENT_KIND_ATTRIBUTE}="${PDF_DOCUMENT_KIND}"][${PDF_RESOURCE_ADDRESS_ATTRIBUTE}]`

/**
 * Find the selectable PDF text layer owning a given node, if any.
 *
 * Validates that the node sits within `[data-dsa-pdf-text]`, which sits within
 * a `[data-dsa-pdf-page]` wrapper, within a valid PDF preview root.
 *
 * @param node - selection endpoint or event target.
 * @returns the text layer element, or `null` if the node is not in a selectable PDF text layer.
 */
function findPdfTextLayer(node: Node | null): Element | null {
  if (node === null) {
    return null
  }

  const element = closestElement(node)
  if (element === null) {
    return null
  }

  const textLayer = element.closest(`[${PDF_TEXT_LAYER_ATTRIBUTE}]`)
  if (textLayer === null) {
    return null
  }

  const root = textLayer.closest(PDF_ROOT_SELECTOR)
  if (root === null) {
    return null
  }

  return textLayer
}

/**
 * Find the PDF document root owning a selection context.
 *
 * Evaluates anchor, focus, then target nodes.
 *
 * @param context - selection context.
 * @returns the PDF document root element, or `null` if none found.
 */
function findPdfRoot(context: SelectionContext): Element | null {
  const { selection } = context

  for (const node of [selection?.anchorNode ?? null, selection?.focusNode ?? null, context.target]) {
    const textLayer = findPdfTextLayer(node)
    if (textLayer !== null) {
      const root = textLayer.closest(PDF_ROOT_SELECTOR)
      if (root !== null) {
        return root
      }
    }
  }

  return null
}

/**
 * Create the PDF selection adapter.
 *
 * @returns selection adapter instance.
 */
export function createPdfSelectionAdapter(): SelectionAdapter {
  return {
    id: PDF_SELECTION_ADAPTER_ID,

    canHandle(context: SelectionContext): boolean {
      const { selection } = context
      const anchor = selection?.anchorNode ?? null
      const focus = selection?.focusNode ?? null

      if (anchor !== null || focus !== null) {
        return findPdfTextLayer(anchor) !== null || findPdfTextLayer(focus) !== null
      }

      return findPdfTextLayer(context.target) !== null
    },

    capture(context: SelectionContext): SelectionCapture {
      const { selection } = context
      const root = findPdfRoot(context)

      if (selection === null || root === null) {
        return { snapshot: null, rejectReason: 'outside-supported-preview' }
      }

      const resourceAddress = root.getAttribute(PDF_RESOURCE_ADDRESS_ATTRIBUTE) ?? ''
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

      const startTextLayer = findPdfTextLayer(captured.range.startContainer)
      const endTextLayer = findPdfTextLayer(captured.range.endContainer)

      if (
        startTextLayer === null ||
        endTextLayer === null ||
        startTextLayer.closest(PDF_ROOT_SELECTOR) !== root ||
        endTextLayer.closest(PDF_ROOT_SELECTOR) !== root
      ) {
        return { snapshot: null, rejectReason: 'cross-root' }
      }

      const startPageWrapper = startTextLayer.closest(`[${PDF_PAGE_ATTRIBUTE}]`)
      const endPageWrapper = endTextLayer.closest(`[${PDF_PAGE_ATTRIBUTE}]`)

      if (
        startPageWrapper === null ||
        endPageWrapper === null ||
        startPageWrapper.closest(PDF_ROOT_SELECTOR) !== root ||
        endPageWrapper.closest(PDF_ROOT_SELECTOR) !== root
      ) {
        return { snapshot: null, rejectReason: 'renderer-not-ready' }
      }

      const startMarker = startPageWrapper.getAttribute(PDF_PAGE_ATTRIBUTE)
      const endMarker = endPageWrapper.getAttribute(PDF_PAGE_ATTRIBUTE)

      const location = pageRangeLocation(startMarker, endMarker, 'source')
      if (location === null) {
        return { snapshot: null, rejectReason: 'renderer-not-ready' }
      }

      const snapshot: SelectionSnapshot = {
        adapterId: PDF_SELECTION_ADAPTER_ID,
        resourceAddress,
        fileName,
        documentKind: 'pdf',
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
