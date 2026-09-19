/**
 * XLSX Semantic Selection Lifecycle.
 *
 * Listens to range selection changes from the `XlsxSelectionBridge` and drives
 * `kernel.capture` and feedback reporting.
 */

import { XLSX_SELECTION_ADAPTER_ID } from './identity.js'
import type { XlsxSelectionBridge } from './selection-bridge.js'
import type { SelectionFeedbackSource } from '../../selection/feedback.js'
import type { SelectionKernel } from '../../selection/kernel.js'
import type { SelectionContext } from '../../selection/registry.js'

/**
 * Install the XLSX semantic selection lifecycle.
 *
 * @param bridge - semantic selection bridge.
 * @param kernel - transient selection store.
 * @param feedback - rejection feedback slot.
 * @returns disposer removing the subscription.
 */
export function installXlsxSelectionLifecycle(
  bridge: XlsxSelectionBridge,
  kernel: SelectionKernel,
  feedback: SelectionFeedbackSource,
): () => void {
  return bridge.subscribe((selection) => {
    if (selection === null) {
      if (kernel.getSnapshot()?.adapterId === XLSX_SELECTION_ADAPTER_ID) {
        kernel.clear()
        feedback.clear()
      }
      return
    }

    const context: SelectionContext = {
      selection: null,
      target: selection.root,
      now: Date.now(),
    }

    const capture = kernel.capture(context)
    if (capture.snapshot === null) {
      feedback.report(capture.rejectReason)
    } else {
      feedback.clear()
    }
  })
}
