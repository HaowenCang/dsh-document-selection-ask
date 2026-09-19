/**
 * Register the plugin's selectable DOCX renderer.
 *
 * Contributes the document preview definition to the document-preview registry
 * and registers the `DocxBody` component into the `sidebar.right.tab.document`
 * slot.
 *
 * ## Lifecycle
 *
 * As of Task 12 this function owns its own contributions and hands back one
 * idempotent disposer instead of wrapping each one in a `ctx.effect`. The client
 * runtime is the single top-level lifecycle owner; a registration that took a
 * context and registered effects of its own would multiply the plugin's
 * top-level effects with the number of renderers, and the runtime would have no
 * single point at which the whole contribution set could be released — which is
 * exactly how the two Ask slot entries were leaked before this task.
 *
 * A registration that throws halfway releases what it already installed and
 * rethrows the original failure, so a failed renderer never leaves a definition
 * or a body behind.
 */

import type { RendererRegistrationHost } from '../../dsh/contracts.js'
import type { DocumentPreviewDefinition } from '../../dsh/contracts.js'
import { Disposer, rollback } from '../../selection/lifecycle.js'
import type { Dispose } from '../../selection/lifecycle.js'
import { DocxBody } from './DocxBody.js'
import { DOCX_RENDERER_ID } from './identity.js'
import { installDocxStyles } from './styles.js'

/** The keyed list slot DSH mounts a selected document definition's body into. */
export const DOCUMENT_BODY_SLOT = 'sidebar.right.tab.document'

/** Injected callbacks the DOCX renderer body receives from the plugin runtime. */
export interface DocxRendererInjectFace {
  /** Called when a resource stops owning a selectable selection. */
  readonly onResourceInvalidated?: ((resourceAddress: string) => void) | undefined
}

/**
 * The DOCX renderer's preview definition.
 *
 * @returns definition object registered with DSH documentPreviews.
 */
export function docxRendererDefinition(): DocumentPreviewDefinition {
  return {
    id: DOCX_RENDERER_ID,
    extensions: ['docx'],
    priority: 'extension',
    loading: 'bytes-complete',
    wrap: false,
    title: () => 'DOCX · Selectable',
  }
}

/**
 * Register the selectable DOCX renderer.
 *
 * @param host - the resolved DSH services the registration contributes through.
 * @param inject - the callbacks the registered body is injected with.
 * @returns an idempotent disposer releasing the definition, the body and the sheet.
 */
export function registerDocxRenderer(
  host: RendererRegistrationHost,
  inject: DocxRendererInjectFace = {},
): Dispose {
  const disposer = new Disposer()

  try {
    if (host.document !== undefined) {
      // Installed from the registration rather than from the component so it
      // exists once per document for the runtime's lifetime, and is removed with
      // it.
      disposer.add(installDocxStyles(host.document))
    }

    disposer.add(host.previews.register(docxRendererDefinition()))

    disposer.add(
      host.slots.inject(DOCUMENT_BODY_SLOT, () =>
        host.slots.register(
          {
            name: DOCUMENT_BODY_SLOT,
            key: DOCX_RENDERER_ID,
            inject: (): DocxRendererInjectFace => ({ ...inject }),
          },
          DocxBody,
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
