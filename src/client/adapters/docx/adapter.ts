/**
 * Selection adapter for the plugin's selectable DOCX preview.
 *
 * Captures browser selections from rendered DOCX document content, resolves
 * rendered-page provenance when reliable page section markers exist, and
 * constructs a format-independent `SelectionSnapshot`.
 *
 * ## Ownership & boundaries
 *
 * - Ownership enters exclusively through `[data-dsa-docx-content]` hosts under
 *   a verified DOCX document root (`[data-dsa-document-kind="docx"][data-dsa-resource-address]`).
 * - Non-content surfaces (style hosts, loading/error chrome, page margins)
 *   cannot claim selection ownership.
 * - If either selection endpoint starts inside selectable DOCX content but the
 *   other endpoint leaves the document root or leaves selectable content, the
 *   adapter claims the context and authoritative rejection reports `cross-root`.
 * - If page markers are missing, incomplete, or non-canonical, the adapter
 *   falls back cleanly to `{ kind: 'document' }` (file-only) provenance rather
 *   than refusing the selection.
 */

import { fileNameFromResourceAddress } from '../../provenance/file-name.js'
import { pageRangeLocation } from '../../provenance/page-range.js'
import {
  DOCX_DOCUMENT_KIND,
  DOCX_DOCUMENT_KIND_ATTRIBUTE,
  DOCX_PAGE_ATTRIBUTE,
  DOCX_RESOURCE_ADDRESS_ATTRIBUTE,
  DOCX_SELECTABLE_ATTRIBUTE,
  DOCX_SELECTION_ADAPTER_ID,
} from '../../renderers/docx/identity.js'
import { captureDomRange } from '../../selection/dom-range.js'
import { validateSelectionSize } from '../../selection/limits.js'
import { normalizeSelectedText } from '../../selection/normalize.js'
import type { SelectionAdapter, SelectionCapture, SelectionContext } from '../../selection/registry.js'
import { closestElement, domSelectionRejectReason } from '../../selection/scope.js'
import type { SelectionLocation, SelectionSnapshot } from '../../selection/types.js'

export { DOCX_SELECTION_ADAPTER_ID } from '../../renderers/docx/identity.js'

/** Selector matching the plugin's DOCX preview document root. */
const DOCX_ROOT_SELECTOR = `[${DOCX_DOCUMENT_KIND_ATTRIBUTE}="${DOCX_DOCUMENT_KIND}"][${DOCX_RESOURCE_ADDRESS_ATTRIBUTE}]`

/**
 * Find the selectable DOCX content host owning a given node, if any.
 *
 * Validates that the node sits within `[data-dsa-docx-content]`, which sits
 * within a valid DOCX preview root.
 *
 * @param node - selection endpoint or event target.
 * @returns the content host element, or `null` if the node is not in selectable DOCX content.
 */
function findDocxContent(node: Node | null): Element | null {
  if (node === null) {
    return null
  }

  const element = closestElement(node)
  if (element === null) {
    return null
  }

  const contentHost = element.closest(`[${DOCX_SELECTABLE_ATTRIBUTE}]`)
  if (contentHost === null) {
    return null
  }

  const root = contentHost.closest(DOCX_ROOT_SELECTOR)
  if (root === null) {
    return null
  }

  return contentHost
}

/**
 * Find the DOCX document root owning a selection context.
 *
 * Evaluates anchor, focus, then target nodes.
 *
 * @param context - selection context.
 * @returns the DOCX document root element, or `null` if none found.
 */
function findDocxRoot(context: SelectionContext): Element | null {
  const { selection } = context

  for (const node of [selection?.anchorNode ?? null, selection?.focusNode ?? null, context.target]) {
    const content = findDocxContent(node)
    if (content !== null) {
      const root = content.closest(DOCX_ROOT_SELECTOR)
      if (root !== null) {
        return root
      }
    }
  }

  return null
}

/**
 * Create the DOCX selection adapter.
 *
 * @returns selection adapter instance.
 */
export function createDocxSelectionAdapter(): SelectionAdapter {
  return {
    id: DOCX_SELECTION_ADAPTER_ID,

    canHandle(context: SelectionContext): boolean {
      const { selection } = context
      const anchor = selection?.anchorNode ?? null
      const focus = selection?.focusNode ?? null

      if (anchor !== null || focus !== null) {
        return findDocxContent(anchor) !== null || findDocxContent(focus) !== null
      }

      return findDocxContent(context.target) !== null
    },

    capture(context: SelectionContext): SelectionCapture {
      const { selection } = context
      const root = findDocxRoot(context)

      if (selection === null || root === null) {
        return { snapshot: null, rejectReason: 'outside-supported-preview' }
      }

      const resourceAddress = root.getAttribute(DOCX_RESOURCE_ADDRESS_ATTRIBUTE) ?? ''
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

      const startContent = findDocxContent(captured.range.startContainer)
      const endContent = findDocxContent(captured.range.endContainer)

      if (
        startContent === null ||
        endContent === null ||
        startContent.closest(DOCX_ROOT_SELECTOR) !== root ||
        endContent.closest(DOCX_ROOT_SELECTOR) !== root
      ) {
        return { snapshot: null, rejectReason: 'cross-root' }
      }

      // Resolve page provenance if both endpoints sit within reliable rendered page sections
      const startElement = closestElement(captured.range.startContainer)
      const endElement = closestElement(captured.range.endContainer)

      const startPage = startElement?.closest(`[${DOCX_PAGE_ATTRIBUTE}]`) ?? null
      const endPage = endElement?.closest(`[${DOCX_PAGE_ATTRIBUTE}]`) ?? null

      let location: SelectionLocation = { kind: 'document' }

      if (
        startPage !== null &&
        endPage !== null &&
        startPage.closest(DOCX_ROOT_SELECTOR) === root &&
        endPage.closest(DOCX_ROOT_SELECTOR) === root
      ) {
        const startMarker = startPage.getAttribute(DOCX_PAGE_ATTRIBUTE)
        const endMarker = endPage.getAttribute(DOCX_PAGE_ATTRIBUTE)
        const pagesLocation = pageRangeLocation(startMarker, endMarker, 'rendered')
        if (pagesLocation !== null) {
          location = pagesLocation
        }
      }

      const snapshot: SelectionSnapshot = {
        adapterId: DOCX_SELECTION_ADAPTER_ID,
        resourceAddress,
        fileName,
        documentKind: 'docx',
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
