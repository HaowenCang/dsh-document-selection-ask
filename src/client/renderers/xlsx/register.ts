/**
 * Register the plugin's XLSX spreadsheet renderer.
 *
 * Contributes the document preview definition to the document-preview registry
 * and registers the `XlsxBody` component into the `sidebar.right.tab.document`
 * slot, injecting the per-client semantic selection bridge the body publishes
 * range selections to.
 *
 * As of Task 12 the three contributions are aggregated here and released by one
 * idempotent disposer; the client runtime is the plugin's single top-level
 * lifecycle owner, and a failed registration releases what it already installed
 * before rethrowing.
 */

import type { DocumentPreviewDefinition, RendererRegistrationHost } from '../../dsh/contracts.js'
import { Disposer, rollback } from '../../selection/lifecycle.js'
import type { Dispose } from '../../selection/lifecycle.js'
import { XLSX_RENDERER_ID } from './identity.js'
import type { XlsxSelectionBridge } from './selection-bridge.js'
import { installXlsxStyles } from './styles.js'
import { XlsxBody } from './XlsxBody.js'

/** The keyed list slot DSH mounts a selected document definition's body into. */
export const DOCUMENT_BODY_SLOT = 'sidebar.right.tab.document'

/** Injected callbacks the XLSX renderer body receives from the plugin runtime. */
export interface XlsxRendererInjectFace {
  /** The per-client semantic selection bridge the body publishes ranges to. */
  readonly bridge: XlsxSelectionBridge
  /** Called when a resource stops owning a selectable selection. */
  readonly onResourceInvalidated?: ((resourceAddress: string) => void) | undefined
}

/**
 * The XLSX renderer's preview definition.
 *
 * @returns definition object registered with DSH documentPreviews.
 */
export function xlsxRendererDefinition(): DocumentPreviewDefinition {
  return {
    id: XLSX_RENDERER_ID,
    extensions: ['xlsx'],
    priority: 'extension',
    loading: 'bytes-complete',
    wrap: false,
    title: () => 'XLSX • Read-only',
  }
}

/**
 * Register the XLSX renderer.
 *
 * @param host - the resolved DSH services the registration contributes through.
 * @param inject - the bridge and callbacks the registered body is injected with.
 * @returns an idempotent disposer releasing the definition, the body and the sheet.
 */
export function registerXlsxRenderer(
  host: RendererRegistrationHost,
  inject: XlsxRendererInjectFace,
): Dispose {
  const disposer = new Disposer()

  try {
    if (host.document !== undefined) {
      disposer.add(installXlsxStyles(host.document))
    }

    disposer.add(host.previews.register(xlsxRendererDefinition()))

    disposer.add(
      host.slots.inject(DOCUMENT_BODY_SLOT, () =>
        host.slots.register(
          {
            name: DOCUMENT_BODY_SLOT,
            key: XLSX_RENDERER_ID,
            inject: (): XlsxRendererInjectFace => ({ ...inject }),
          },
          XlsxBody as never,
        ),
      ),
    )
  } catch (error: unknown) {
    rollback(disposer, error)
  }

  return () => {
    disposer.disposeAll()
  }
}
