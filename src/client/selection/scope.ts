/**
 * Selection scope checks.
 *
 * Every DOM adapter has to answer the same two questions before it may look at
 * a selection, and both answers are safety properties rather than conveniences.
 *
 * The first is *where the selection is*. A preview root is a subtree of the DSH
 * page, and the page around it contains the composer, the transcript, menus and
 * dialogs. A selection whose endpoints are not both inside the adapter's root is
 * not this adapter's selection, however plausible its text looks.
 *
 * The second is *what kind of surface it is*. Text inputs and contenteditable
 * regions own their own selection semantics — an input's selection is a private
 * caret range, and dragging across one is how the user edits a draft, not how
 * they quote a document. Treating those as document selections would let the
 * composer's own text be quoted back into the composer.
 *
 * The helpers below therefore take plain nodes and return plain answers. They
 * hold no state, touch no global, and never read `window.getSelection()`: the
 * selection arrives from the caller, so the checks can be exercised against a
 * constructed document instead of the ambient one.
 */

import type { SelectionRejectReason } from './types.js'

/**
 * `input`, `textarea`, `select`, both spellings of a contenteditable region, and
 * an explicit textbox role.
 *
 * `contenteditable=""` is not the same attribute value as
 * `contenteditable="true"` and both are in use, so both are matched. Buttons are
 * deliberately absent: a PPTX or SVG renderer may wrap selectable text in a
 * button-like control, and excluding those is the adapter's decision about its
 * own chrome, not a rule the shared layer can make.
 */
const INTERACTIVE_TEXT_SURFACE_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'

/**
 * Find the element a node belongs to.
 *
 * A node is often a text node — that is what a selection endpoint usually is —
 * so the node's own type decides the first step: an element is its own answer,
 * a text node answers with its parent, and anything without an element ancestor
 * (a detached node, a `Document`, a `DocumentFragment`) answers `null`.
 *
 * Ancestors are walked rather than calling `closest` on a cast: `Element.closest`
 * does not exist on the other node types, and casting a text node to `Element`
 * to reach it would compile while failing at runtime for every real selection.
 *
 * @param node - the node to resolve, typically a selection endpoint.
 * @returns the node itself when it is an element, otherwise its nearest element
 * ancestor, or `null` when there is none.
 */
export function closestElement(node: Node | null): Element | null {
  if (node === null) {
    return null
  }

  if (node.nodeType === 1) {
    return node as Element
  }

  if (node.nodeType === 3) {
    return node.parentElement
  }

  // A `Document` has no parent element, and a detached fragment has none either;
  // walking upward answers `null` for both without a special case.
  let ancestor: Node | null = node.parentNode
  while (ancestor !== null) {
    if (ancestor.nodeType === 1) {
      return ancestor as Element
    }
    ancestor = ancestor.parentNode
  }
  return null
}

/**
 * Whether a node sits on a text-editing surface that must never be quoted.
 *
 * The test walks the whole ancestor chain, because a selection endpoint is
 * normally the innermost text node: with `<div contenteditable="true"><span>`
 * the span matches nothing on its own, and only its ancestor declares the
 * region editable.
 *
 * @param node - a selection endpoint, or any node inside one.
 * @returns true when the node or an ancestor is an input-like surface.
 */
export function isInteractiveSelectionNode(node: Node | null): boolean {
  const element = closestElement(node)
  if (element === null) {
    return false
  }

  // Reachability is the precondition here rather than the question: this is
  // called with endpoints that came out of the live document, and a match
  // against an interactive surface is the only outcome that changes behaviour.
  return element.closest(INTERACTIVE_TEXT_SURFACE_SELECTOR) !== null
}

/**
 * Whether both endpoints of a selection are inside one root.
 *
 * Both endpoints are checked rather than the range's common ancestor, and that
 * choice is the whole point of the function. A drag that starts in a document
 * preview and ends in the chat transcript has the DSH page shell as its common
 * ancestor, so a common-ancestor test would report "inside the root" for
 * precisely the gesture that must be refused.
 *
 * @param selection - the live selection to validate.
 * @param root - the adapter's preview root element.
 * @returns true only when the selection has both endpoints and both are
 * contained by `root`. A selection with no endpoints returns false, not null.
 */
export function selectionLivesInSameRoot(selection: Selection, root: Element): boolean {
  const anchor = selection.anchorNode
  const focus = selection.focusNode

  if (anchor === null || focus === null) {
    return false
  }

  return root.contains(anchor) && root.contains(focus)
}

/**
 * Classify a DOM selection that must not produce a snapshot.
 *
 * The order of the checks is the contract, because the first matching rule is
 * the reason the caller reports. A bare click inside an input is `collapsed`
 * rather than `interactive-control`: nothing was selected, and naming the
 * surface would suggest the plugin had considered the gesture. Only a real,
 * non-empty selection on an input-like surface is reported as
 * `interactive-control`, which is the case a user could otherwise mistake for
 * the plugin ignoring them.
 *
 * `empty-after-normalization` is the last check because it costs the most: the
 * selected text has to be normalized. Its result depends on the caller's
 * normalizer, so the selection's text is passed in rather than read here.
 *
 * @param selection - the live selection to classify.
 * @param root - the preview root the calling adapter owns.
 * @param normalizedText - the selection's text after normalization.
 * @returns the reason to refuse the selection, or `null` when it is capturable.
 */
export function domSelectionRejectReason(
  selection: Selection,
  root: Element,
  normalizedText: string,
): SelectionRejectReason | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return 'collapsed'
  }

  if (!selectionLivesInSameRoot(selection, root)) {
    return 'cross-root'
  }

  if (isInteractiveSelectionNode(selection.anchorNode) || isInteractiveSelectionNode(selection.focusNode)) {
    return 'interactive-control'
  }

  if (normalizedText === '') {
    return 'empty-after-normalization'
  }

  return null
}
