/**
 * Selection adapter for the DSH builtin text, Markdown, code and CSV previews.
 *
 * This is the first adapter that faces a real product DOM. Its whole job is to
 * turn a browser selection made inside an official DSH document preview into the
 * format-independent `SelectionSnapshot`, using the shared capture, scope,
 * normalization and limit helpers rather than reimplementing any of them.
 *
 * **It does not render anything.** The plain, Markdown and code renderers that
 * the sidebar already has are the ones on screen, they stay registered, and the
 * user can still switch between them from the viewer menu. The adapter reads the
 * DOM they produce — which is also why it reads no hashed CSS class: those class
 * names are generated per build, and the document's own structure is published
 * through `data-*` attributes, Shiki's `line` class and the `pre` element.
 *
 * Two boundaries are load-bearing.
 *
 * **The preview root is not the document.** The root element carries the file
 * path, the viewer menu, the wrap and reload controls, a file-changed bar, a
 * load-more control and failure lines, all of which are preview chrome around
 * the document. Ownership and scope therefore both stop at
 * `[data-textpreview-body]` rather than at the root: a selection of the file path
 * is not this adapter's selection at all, and a drag from the header into the
 * text is refused as `cross-root` instead of being quoted as file content.
 *
 * **Ownership is decided by the selection, not by the pointer.** A keyboard
 * selection has no meaningful pointer target, so the root is resolved from the
 * selection's own anchor and focus nodes and the context's `target` is only a
 * fallback. Ownership is claimed as soon as *either* endpoint is inside a
 * supported preview's document region, which is what lets this adapter report
 * `cross-root` for a selection that started in a document and ended in the chat —
 * rather than declining it and letting a more permissive adapter behind it
 * re-admit it.
 *
 * Line provenance is emitted only where the renderer proves it: the plain
 * renderer's `data-textpreview-line` rows and the code renderer's Shiki rows
 * inside their own content root. Rendered Markdown never produces lines, even
 * though code fences render as the same Shiki block, because a fence row is not
 * a line of the Markdown source file.
 */

import { fileNameFromResourceAddress } from '../../provenance/file-name.js'
import type { SelectionAdapter, SelectionCapture, SelectionContext } from '../../selection/registry.js'
import { captureDomRange } from '../../selection/dom-range.js'
import { validateSelectionSize } from '../../selection/limits.js'
import { normalizeSelectedText } from '../../selection/normalize.js'
import { closestElement, domSelectionRejectReason } from '../../selection/scope.js'
import type { DocumentKind, SelectionLocation } from '../../selection/types.js'
import { resolveCodeLineRange, resolvePlainLineRange } from './lines.js'
import {
  DSH_CODE_PREVIEW_ID,
  DSH_MARKDOWN_PREVIEW_ID,
  DSH_PLAIN_PREVIEW_ID,
  DSH_PREVIEW_ROOT_SELECTOR,
  PREVIEW_BODY_ATTRIBUTE,
  PREVIEW_RENDERER_ATTRIBUTE,
  PREVIEW_URL_ATTRIBUTE,
} from './preview-dom.js'

/**
 * Stable adapter id, recorded as `adapterId` in every snapshot this adapter
 * produces. Deliberately not a DSH renderer id: the adapter spans three
 * renderers, and the two identities answer different questions.
 */
export const DSH_TEXT_ADAPTER_ID = 'dsh-builtin-text'

/**
 * File suffixes that decide the document's kind rather than the renderer's.
 *
 * The list is short on purpose. Renderer identity answers "how is this drawn";
 * extension answers "what is this", and the two disagree in the cases that
 * matter: a Markdown file the user switched to the plain viewer is still
 * Markdown, and a CSV file shown by the code renderer is still a CSV. For every
 * other suffix the renderer is the better evidence, so no extension registry is
 * duplicated from DSH here.
 */
const MARKDOWN_SUFFIXES = ['.md', '.markdown']

/** Suffix of a comma-separated-values file, which stays CSV in any renderer. */
const CSV_SUFFIX = '.csv'

/** Location used whenever the renderer cannot prove an exact source position. */
const DOCUMENT_LOCATION: SelectionLocation = Object.freeze({ kind: 'document' })

/**
 * Whether this adapter understands a renderer identity.
 * @param rendererId - the preview root's `data-document-preview` value.
 * @returns true for the plain, Markdown and code renderers.
 */
function isSupportedRenderer(rendererId: string | null): boolean {
  return (
    rendererId === DSH_PLAIN_PREVIEW_ID ||
    rendererId === DSH_MARKDOWN_PREVIEW_ID ||
    rendererId === DSH_CODE_PREVIEW_ID
  )
}

/**
 * Classify the previewed file.
 *
 * @param fileName - the decoded file name, or `null` when the address was unusable.
 * @param rendererId - the renderer that drew the content.
 * @returns the document kind; `text` when nothing more specific is provable.
 */
function inferDocumentKind(fileName: string | null, rendererId: string): DocumentKind {
  const lower = (fileName ?? '').toLowerCase()

  if (MARKDOWN_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return 'markdown'
  }

  if (lower.endsWith(CSV_SUFFIX)) {
    return 'csv'
  }

  return rendererId === DSH_CODE_PREVIEW_ID ? 'code' : 'text'
}

/**
 * Find the preview body that owns a node.
 *
 * @param node - one endpoint of the selection.
 * @returns the body element, or `null` when the node is in no supported preview.
 */
function ownedPreviewBody(node: Node | null): Element | null {
  if (node === null) {
    return null
  }

  const element = closestElement(node)
  if (element === null) {
    return null
  }

  const root = element.closest(DSH_PREVIEW_ROOT_SELECTOR)
  if (root === null || !isSupportedRenderer(root.getAttribute(PREVIEW_RENDERER_ATTRIBUTE))) {
    return null
  }

  const body = root.querySelector(`[${PREVIEW_BODY_ATTRIBUTE}]`)
  return body !== null && body.contains(element) ? body : null
}

/**
 * Find the preview root a selection was made in.
 *
 * The root is reached through a body, never directly: the header, the change bar
 * and the controls sit inside the same root as the document, so a root-level
 * test would treat a selection of the file path as a selection of file content.
 *
 * @param context - the candidate selection and its capture metadata.
 * @returns the root element, or `null` when no endpoint belongs to a supported
 * preview's document region.
 */
function ownedPreviewRoot(context: SelectionContext): Element | null {
  const { selection } = context

  for (const node of [selection?.anchorNode ?? null, selection?.focusNode ?? null, context.target]) {
    const body = ownedPreviewBody(node)
    const root = body?.closest(DSH_PREVIEW_ROOT_SELECTOR)
    if (root !== null && root !== undefined) {
      return root
    }
  }

  return null
}

/**
 * Create the builtin-text selection adapter.
 *
 * The adapter holds no state between calls, so one instance can be registered
 * for the lifetime of the plugin fiber and disposed with it.
 *
 * @returns the adapter, ready to register in a `SelectionAdapterRegistry`.
 */
export function createDshTextAdapter(): SelectionAdapter {
  return {
    id: DSH_TEXT_ADAPTER_ID,

    canHandle(context: SelectionContext): boolean {
      return ownedPreviewRoot(context) !== null
    },

    capture(context: SelectionContext): SelectionCapture {
      const { selection } = context
      const root = ownedPreviewRoot(context)

      if (selection === null || root === null) {
        return { snapshot: null, rejectReason: 'outside-supported-preview' }
      }

      const body = root.querySelector(`[${PREVIEW_BODY_ATTRIBUTE}]`)
      const fileName = fileNameFromResourceAddress(root.getAttribute(PREVIEW_URL_ATTRIBUTE) ?? '')
      const rendererId = root.getAttribute(PREVIEW_RENDERER_ATTRIBUTE) ?? ''

      // A preview whose address cannot be parsed has no document to attribute a
      // citation to, and the adapter must not throw into the DSH event path.
      if (body === null || fileName === null) {
        return { snapshot: null, rejectReason: 'outside-supported-preview' }
      }

      const captured = captureDomRange(selection)
      if (captured === null) {
        return { snapshot: null, rejectReason: 'collapsed' }
      }

      const text = normalizeSelectedText(captured.text)
      const rejectReason = domSelectionRejectReason(selection, body, text)
      if (rejectReason !== null) {
        return { snapshot: null, rejectReason }
      }

      const documentKind = inferDocumentKind(fileName, rendererId)
      const snapshot = {
        adapterId: DSH_TEXT_ADAPTER_ID,
        resourceAddress: root.getAttribute(PREVIEW_URL_ATTRIBUTE) ?? '',
        fileName,
        documentKind,
        text,
        location: resolveLocation(captured.range, body, rendererId, documentKind),
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

/**
 * Resolve the selection's position from the renderer that drew it.
 *
 * The renderer decides which mapping may be attempted, because only it knows
 * what its rows mean, and the document's kind decides whether that mapping would
 * be honest. Two combinations therefore fall through to a whole-document
 * location: a rendered Markdown document, whose code fences carry the same Shiki
 * rows as the code renderer — reading them would report a fence's own row number
 * as a line of the Markdown file — and any renderer whose rows are not source
 * lines at all.
 *
 * A Markdown file shown by the plain renderer keeps both Markdown as its kind and
 * exact lines, because the plain renderer really is a source-line renderer. The
 * kind describes the file; the location describes what this renderer proved.
 *
 * @param range - the captured range, read in document order.
 * @param body - the preview body the selection must stay inside.
 * @param rendererId - the renderer that drew the content.
 * @param documentKind - the document's own kind, which is not the renderer's.
 * @returns the exact line range when it is provable, otherwise a whole-document
 * location.
 */
function resolveLocation(
  range: Range,
  body: Element,
  rendererId: string,
  documentKind: DocumentKind,
): SelectionLocation {
  if (rendererId === DSH_CODE_PREVIEW_ID && documentKind !== 'markdown') {
    return resolveCodeLineRange(range, body) ?? DOCUMENT_LOCATION
  }

  if (rendererId === DSH_PLAIN_PREVIEW_ID) {
    return resolvePlainLineRange(range, body) ?? DOCUMENT_LOCATION
  }

  return DOCUMENT_LOCATION
}
