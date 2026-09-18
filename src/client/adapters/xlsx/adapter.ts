/**
 * Selection adapter for the XLSX spreadsheet preview.
 *
 * Translates semantic spreadsheet range selections published to the
 * `XlsxSelectionBridge` into universal `SelectionSnapshot` instances.
 *
 * ## Ownership & boundaries
 * - Does not read browser text selections (`window.getSelection()`).
 * - Enforces the strict 200-cell hard limit before constructing drafts.
 * - Formats display values into Markdown table or TSV using `formatXlsxValues`.
 * - Rejects stale, disconnected, or cross-document selections.
 */

import { fileNameFromResourceAddress } from '../../provenance/file-name.js'
import { parseCellRange } from '../../provenance/cell-range.js'
import { formatXlsxValues, MAX_XLSX_SELECTED_CELLS } from '../../quote/format-xlsx.js'
import {
  XLSX_RESOURCE_ADDRESS_ATTRIBUTE,
  XLSX_SELECTION_ADAPTER_ID,
} from '../../renderers/xlsx/identity.js'
import type { XlsxSelectionBridge } from '../../renderers/xlsx/selection-bridge.js'
import { validateSelectionSize } from '../../selection/limits.js'
import type { SelectionAdapter, SelectionCapture, SelectionContext } from '../../selection/registry.js'
import type { SelectionSnapshot } from '../../selection/types.js'

export { XLSX_SELECTION_ADAPTER_ID } from '../../renderers/xlsx/identity.js'

/**
 * Create the XLSX selection adapter bound to a specific semantic bridge.
 *
 * @param bridge - the per-client XLSX selection bridge.
 * @returns selection adapter instance.
 */
export function createXlsxSelectionAdapter(bridge: XlsxSelectionBridge): SelectionAdapter {
  return {
    id: XLSX_SELECTION_ADAPTER_ID,

    canHandle(context: SelectionContext): boolean {
      const sel = bridge.getSelection()
      if (sel === null || !sel.root.isConnected) {
        return false
      }

      if (context.target === null) {
        return false
      }

      return context.target === sel.root || sel.root.contains(context.target as Node)
    },

    capture(context: SelectionContext): SelectionCapture {
      const sel = bridge.getSelection()
      if (sel === null) {
        return { snapshot: null, rejectReason: 'outside-supported-preview' }
      }

      if (!sel.root.isConnected) {
        return { snapshot: null, rejectReason: 'renderer-not-ready' }
      }

      const rootAddress = sel.root.getAttribute(XLSX_RESOURCE_ADDRESS_ATTRIBUTE)
      if (rootAddress !== sel.resourceAddress) {
        return { snapshot: null, rejectReason: 'renderer-not-ready' }
      }

      const fileName = fileNameFromResourceAddress(sel.resourceAddress)
      if (fileName === null) {
        return { snapshot: null, rejectReason: 'outside-supported-preview' }
      }

      const parsedRange = parseCellRange(sel.range)
      if (parsedRange === null) {
        return { snapshot: null, rejectReason: 'renderer-not-ready' }
      }

      if (parsedRange.cellCount > MAX_XLSX_SELECTED_CELLS) {
        return { snapshot: null, rejectReason: 'too-many-cells' }
      }

      const text = formatXlsxValues(sel.values)
      if (!text) {
        return { snapshot: null, rejectReason: 'empty-after-normalization' }
      }

      const snapshot: SelectionSnapshot = {
        adapterId: XLSX_SELECTION_ADAPTER_ID,
        resourceAddress: sel.resourceAddress,
        fileName,
        documentKind: 'xlsx',
        text,
        location: {
          kind: 'cells',
          sheet: sel.sheet,
          range: parsedRange.range,
        },
        rects: sel.rect !== null ? [sel.rect] : [],
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
