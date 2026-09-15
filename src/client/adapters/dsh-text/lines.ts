/**
 * DOM-to-source-line mapping for the DSH builtin text renderers.
 *
 * Two renderers can show a file's real lines, and they expose that structure in
 * two different ways. Both are read here rather than inferred, because a line
 * number is a citation: the plugin may only publish one it can point at in the
 * DOM.
 *
 * The plain renderer emits one row per source line carrying
 * `data-textpreview-line="<1-based source line>"`. That attribute is the line
 * number, so this module reads it and never counts rows — counting would be
 * correct only while the renderer happens to start at line 1 and to render every
 * line, neither of which the attribute promises.
 *
 * The code renderer emits a Shiki block whose rows are `pre .line` in source
 * order. There is no line attribute, so the row's position within its own
 * `[data-code-block-content]` viewport is the mapping — the same contract DSH's
 * own line navigation uses. The search is scoped to that viewport: a page-wide
 * `querySelectorAll('pre .line')` would also match code fences inside rendered
 * Markdown, the chat transcript, and any other pasted code block.
 *
 * Both functions answer `null` rather than throwing when the mapping cannot be
 * proven — an endpoint outside a row, a row without a valid numeric marker,
 * endpoints under two different content roots, a malformed attribute. The caller
 * turns `null` into a whole-document location, which is the honest weaker claim.
 *
 * The reader is `Range.startContainer` / `range.endContainer`, never the
 * selection's anchor and focus: a `Range` is normalised to document order, while
 * anchor and focus keep the drag's direction, so a selection made bottom-to-top
 * would otherwise report an inverted, and false, range.
 */

import { textLineLocation } from '../../provenance/text-lines.js'
import type { SelectionLocation } from '../../selection/types.js'
import {
  CODE_CONTENT_ATTRIBUTE,
  CODE_LINE_SELECTOR,
  PREVIEW_LINE_ATTRIBUTE,
} from './preview-dom.js'

/**
 * A positive integer without sign, padding or exponent.
 *
 * The pattern is stricter than `Number()` on purpose: `Number(' 2')`, `Number('')`
 * and `Number('1e3')` all produce numbers that cannot have come from a line
 * marker, and accepting them would attach a fabricated citation to a renderer
 * that is not providing line metadata at all.
 */
const POSITIVE_INTEGER = /^[0-9]+$/

/**
 * Read a source-line number from a `data-textpreview-line` attribute value.
 * @param raw - the attribute value, or `null` when the attribute is absent.
 * @returns the 1-based line number, or `null` when the value is not one.
 */
function sourceLineOf(raw: string | null): number | null {
  if (raw === null || !POSITIVE_INTEGER.test(raw)) {
    return null
  }

  const line = Number(raw)
  return line >= 1 ? line : null
}

/**
 * Find the nearest ancestor of a node that satisfies a test, starting at the
 * node itself.
 *
 * `Element.closest` is not used because the node is usually a text node, where
 * `closest` does not exist; casting one to `Element` to reach it would compile
 * and then fail for every real selection.
 *
 * @param node - the node to walk up from.
 * @param matches - the predicate to test each element against.
 * @param stopAt - the last element to test; walking stops after it.
 * @returns the matching element, or `null` when none is found.
 */
function closestMatching(
  node: Node,
  matches: (element: Element) => boolean,
  stopAt: Element,
): Element | null {
  let current: Node | null = node

  while (current !== null) {
    if (current.nodeType === 1) {
      const element = current as Element
      if (matches(element)) {
        return element
      }
      if (element === stopAt) {
        return null
      }
    }
    current = current.parentNode
  }

  return null
}

/**
 * Resolve a selection to a range of plain-renderer source lines.
 *
 * @param range - the captured range, whose endpoints decide the line span.
 * @param body - the preview body the range must stay inside.
 * @returns the line location, or `null` when either endpoint has no usable line
 * marker.
 */
export function resolvePlainLineRange(range: Range, body: Element): SelectionLocation | null {
  const startRow = closestMatching(
    range.startContainer,
    (element) => element.hasAttribute(PREVIEW_LINE_ATTRIBUTE),
    body,
  )
  const endRow = closestMatching(
    range.endContainer,
    (element) => element.hasAttribute(PREVIEW_LINE_ATTRIBUTE),
    body,
  )

  if (startRow === null || endRow === null) {
    return null
  }

  const start = sourceLineOf(startRow.getAttribute(PREVIEW_LINE_ATTRIBUTE))
  const end = sourceLineOf(endRow.getAttribute(PREVIEW_LINE_ATTRIBUTE))

  if (start === null || end === null || start > end) {
    return null
  }

  return textLineLocation(start, end)
}

/**
 * Resolve a selection to a range of highlighted-code source lines.
 *
 * @param range - the captured range, whose endpoints decide the line span.
 * @param body - the preview body the range must stay inside.
 * @returns the line location, or `null` when both endpoints do not resolve to
 * rows of one code content root.
 */
export function resolveCodeLineRange(range: Range, body: Element): SelectionLocation | null {
  const startContent = codeContentOf(range.startContainer, body)
  const endContent = codeContentOf(range.endContainer, body)

  // Two content roots means the selection left the block the row indices belong
  // to, so a row number taken from either one would describe only part of it.
  if (startContent === null || endContent === null || startContent !== endContent) {
    return null
  }

  const rows = [...startContent.querySelectorAll(CODE_LINE_SELECTOR)]
  const startIndex = rowIndexOf(rows, range.startContainer, startContent)
  const endIndex = rowIndexOf(rows, range.endContainer, startContent)

  if (startIndex < 0 || endIndex < 0) {
    return null
  }

  return textLineLocation(startIndex + 1, endIndex + 1)
}

/**
 * Find the code content viewport an endpoint belongs to.
 * @param node - the endpoint node.
 * @param body - the preview body the endpoint must stay inside.
 * @returns the content root, or `null` when the endpoint is outside the body.
 */
function codeContentOf(node: Node, body: Element): Element | null {
  if (!body.contains(node)) {
    return null
  }

  return closestMatching(node, (element) => element.hasAttribute(CODE_CONTENT_ATTRIBUTE), body)
}

/**
 * Locate the code row holding a node.
 *
 * The row is resolved by containment rather than by identity, because an
 * endpoint is normally a text node inside a token span inside the row.
 *
 * @param rows - the content root's rows, in source order.
 * @param node - the endpoint node.
 * @param content - the content root, used to refuse a row from another block.
 * @returns the zero-based row index, or `-1` when the node is in no row.
 */
function rowIndexOf(rows: readonly Element[], node: Node, content: Element): number {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (row !== undefined && row !== content && row.contains(node)) {
      return index
    }
  }

  return -1
}
