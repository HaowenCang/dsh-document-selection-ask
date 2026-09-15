// @vitest-environment jsdom
/**
 * Scoped DOM selection capture.
 *
 * This spec covers the seam between a real browser selection and the
 * format-independent snapshot: which selections are admitted, which are refused
 * and for what stated reason, and how much of the browser's live state survives
 * the capture. It runs against a real `Selection` and real `Range` from jsdom
 * rather than against hand-written stand-ins, because the ownership and
 * containment rules under test are the browser's semantics, not this plugin's.
 *
 * Geometry is the one browser behaviour jsdom does not implement, so the
 * rectangles are attached to specific range instances by
 * `tests/client/helpers/dom-range-fixtures.ts`. That is also why the geometry
 * assertions here are about the *copying contract* -- the adapter receives
 * rectangles of its own, and the live ones are read through `getClientRects()`
 * -- rather than about where a selection lands on screen. Real positioning is a
 * Playwright concern.
 *
 * The adapter in this file is a fake whose roots carry a test-only attribute
 * that appears nowhere in `src/`. The production capture path knows no document
 * formats and no DSH selectors; a fake whose root looked like a real preview
 * root would hide a regression in that boundary.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { captureDomRange } from '../../src/client/selection/dom-range.js'
import { createSelectionKernel } from '../../src/client/selection/kernel.js'
import type { SelectionKernel } from '../../src/client/selection/kernel.js'
import { normalizeSelectedText } from '../../src/client/selection/normalize.js'
import { SelectionAdapterRegistry } from '../../src/client/selection/registry.js'
import type { SelectionAdapter, SelectionCapture, SelectionContext } from '../../src/client/selection/registry.js'
import {
  closestElement,
  domSelectionRejectReason,
  isInteractiveSelectionNode,
  selectionLivesInSameRoot,
} from '../../src/client/selection/scope.js'
import { rect, stubRangeGeometry } from './helpers/dom-range-fixtures.js'

/** Root marker for the fake adapter; deliberately not a production selector. */
const ROOT_SELECTOR = '[data-test-selection-root]'

/** Capture time used by every context in this spec. */
const NOW = 1_700_000_000_000

beforeEach(() => {
  document.body.replaceChildren()

  const rootA = document.createElement('div')
  rootA.id = 'root-a'
  rootA.setAttribute('data-test-selection-root', '')
  rootA.textContent = 'alpha beta'

  const rootB = document.createElement('div')
  rootB.id = 'root-b'
  rootB.textContent = 'gamma'

  const outside = document.createElement('div')
  outside.id = 'outside'
  outside.textContent = 'delta'

  document.body.append(rootA, rootB, outside)
})

/**
 * Read a fixture element that must exist.
 * @param id - the element id set by the `beforeEach` fixture.
 * @returns the element.
 */
function elementById(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (element === null) {
    throw new Error(`fixture element #${id} is missing`)
  }
  return element
}

/**
 * Read the first text node of an element.
 * @param element - the parent element.
 * @returns the text node.
 */
function textNodeOf(element: Element): Text {
  const node = element.firstChild
  if (node === null || node.nodeType !== 3) {
    throw new Error('fixture element must start with a text node')
  }
  return node as Text
}

/**
 * Read the window's live selection.
 * @returns the current selection.
 */
function currentSelection(): Selection {
  const selection = window.getSelection()
  if (selection === null) {
    throw new Error('jsdom must expose window.getSelection()')
  }
  return selection
}

/**
 * Put a range into the live selection.
 * @param range - the range to select.
 * @returns the selection carrying it.
 */
function applyRange(range: Range): Selection {
  const selection = currentSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

/**
 * Select an element's text with both endpoints inside its text node.
 *
 * `selectNodeContents` is deliberately avoided: it places the endpoints on the
 * element itself, so the selection looks like it starts at the container rather
 * than inside the text, which is not the endpoint shape a real drag produces.
 * @param element - the element whose text node is selected.
 * @returns the live range, which is also `getRangeAt(0)` of the selection.
 */
function selectText(element: Element): Range {
  const text = textNodeOf(element)
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, text.data.length)
  applyRange(range)
  return range
}

/**
 * Build a selection whose anchor and focus live in different subtrees.
 * @param from - node holding the anchor.
 * @param to - node holding the focus.
 * @returns the live selection.
 */
function selectAcross(from: Node, to: Node): Selection {
  const selection = currentSelection()
  selection.removeAllRanges()
  selection.setBaseAndExtent(from, 0, to, to.nodeType === 3 ? (to.textContent ?? '').length : 0)
  return selection
}

/**
 * Build the capture context for the current live selection.
 * @param target - the node the capture was triggered from.
 * @returns the context handed to the registry.
 */
function contextFrom(target: Node | null): SelectionContext {
  return { selection: window.getSelection(), target, now: NOW }
}

/**
 * Read the eight readable members of a rectangle.
 *
 * The comparison is on these members rather than on the object, because a
 * `DOMRect` also carries a `toJSON` method and a structural equality check
 * against a plain object would report a difference that is not one.
 * @param source - the rectangle to read, if the capture produced one.
 * @returns the member values, or `null` when there is no rectangle.
 */
function rectMembers(source: DOMRectReadOnly | undefined): Record<string, number> | null {
  if (source === undefined) {
    return null
  }
  return {
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
    top: source.top,
    right: source.right,
    bottom: source.bottom,
    left: source.left,
  }
}

/**
 * A DOM adapter that owns a page shell and captures selections inside the
 * preview roots within it.
 *
 * It mirrors what a real format adapter does with the shared helpers: claim a
 * subtree, refuse what the core forbids, then read the selection through
 * `captureDomRange` and normalize the text it returns. It is a fake in one
 * respect only: it recognizes roots by a test-only attribute rather than by a
 * DSH preview root.
 * @param shell - the element this adapter claims.
 * @returns the adapter.
 */
function fakeShellAdapter(shell: Element): SelectionAdapter {
  const roots = (): readonly Element[] => [...shell.querySelectorAll(ROOT_SELECTOR)]

  return {
    id: 'fake-shell',
    canHandle: (context) => {
      const { selection } = context
      if (selection === null) {
        return false
      }
      const anchor = closestElement(selection.anchorNode)
      const focus = closestElement(selection.focusNode)
      if (anchor === null || focus === null) {
        return false
      }
      // Ownership is "either endpoint is in a root I recognize": that is what
      // lets this adapter report `cross-root` for a selection that started in
      // one of its roots and ended outside it, rather than staying silent.
      return roots().some((root) => root.contains(anchor) || root.contains(focus))
    },
    capture: (context): SelectionCapture => {
      const { selection } = context
      if (selection === null) {
        return { snapshot: null, rejectReason: 'collapsed' }
      }

      const captured = captureDomRange(selection)
      const text = normalizeSelectedText(captured?.text ?? '')

      const root = roots().find((candidate) => {
        const anchor = selection.anchorNode
        const focus = selection.focusNode
        return (
          (anchor !== null && candidate.contains(anchor)) || (focus !== null && candidate.contains(focus))
        )
      })
      const rejectReason = domSelectionRejectReason(selection, root ?? shell, text)
      if (rejectReason !== null) {
        return { snapshot: null, rejectReason }
      }
      if (captured === null || root === undefined) {
        return { snapshot: null, rejectReason: 'outside-supported-preview' }
      }

      return {
        snapshot: {
          adapterId: 'fake-shell',
          resourceAddress: 'test://selection-root',
          fileName: 'fixture.txt',
          documentKind: 'text',
          text,
          location: { kind: 'lines', start: 1, end: 1 },
          rects: captured.rects,
          capturedAt: context.now,
        },
        rejectReason: null,
      }
    },
  }
}

/**
 * Build a kernel whose only adapter owns the whole document shell.
 * @returns the kernel under test.
 */
function shellKernel(): SelectionKernel {
  const registry = new SelectionAdapterRegistry()
  registry.register(fakeShellAdapter(document.body))
  return createSelectionKernel(registry)
}

describe('scoped DOM selection capture', () => {
  it('rejects a collapsed selection', () => {
    const rootA = elementById('root-a')
    const text = textNodeOf(rootA)
    const range = document.createRange()
    range.setStart(text, 2)
    range.collapse(true)
    applyRange(range)

    const result = shellKernel().capture(contextFrom(text))

    expect(result.snapshot).toBeNull()
    expect(result.rejectReason).toBe('collapsed')
  })

  it('rejects a selection whose endpoints are in different roots', () => {
    const rootA = elementById('root-a')
    selectAcross(rootA, elementById('root-b'))

    const result = shellKernel().capture(contextFrom(rootA))

    // The document has a higher common ancestor, so an endpoint-only check is
    // the only one that can decide this case; a `commonAncestorContainer` test
    // would report the selection as inside `root-a`.
    expect(result.snapshot).toBeNull()
    expect(result.rejectReason).toBe('cross-root')
  })

  it('rejects a selection whose endpoint is a textarea', () => {
    const textarea = document.createElement('textarea')
    textarea.value = 'typed content'
    document.body.append(textarea)
    // A form control has no text node to select: jsdom models its value as a
    // property, and so does a browser. A real drag across one therefore leaves
    // the endpoint on the control element itself, which is the shape reproduced
    // here.
    expect(textarea.firstChild).toBeNull()

    const rootA = elementById('root-a')
    const range = document.createRange()
    range.setStart(textNodeOf(rootA), 0)
    range.setEnd(textarea, 0)
    applyRange(range)

    expect(isInteractiveSelectionNode(textarea)).toBe(true)
    expect(currentSelection().focusNode).toBe(textarea)
    // The root is the document here so that scope is satisfied and the surface
    // check is the rule under test.
    expect(domSelectionRejectReason(currentSelection(), document.body, 'alpha beta')).toBe(
      'interactive-control',
    )
  })

  it('rejects a selection whose endpoint is an input', () => {
    const input = document.createElement('input')
    input.value = 'query'
    document.body.append(input)
    expect(input.firstChild).toBeNull()

    const range = document.createRange()
    range.setStart(textNodeOf(elementById('root-a')), 0)
    range.setEnd(input, 0)
    applyRange(range)

    expect(isInteractiveSelectionNode(input)).toBe(true)
    expect(domSelectionRejectReason(currentSelection(), document.body, 'alpha beta')).toBe(
      'interactive-control',
    )
  })

  it('rejects a selection nested inside a contenteditable region', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const span = document.createElement('span')
    span.textContent = 'alpha'
    editable.append(span)
    document.body.append(editable)
    const text = textNodeOf(span)
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 5)
    applyRange(range)

    // The endpoint is the innermost text node, which matches no selector on its
    // own; only the ancestor chain identifies the region as editable. This is
    // the case a `matches()`-only implementation silently admits.
    expect(span.matches('[contenteditable="true"]')).toBe(false)
    expect(span.closest('[contenteditable="true"]')).toBe(editable)
    expect(isInteractiveSelectionNode(text)).toBe(true)
    expect(domSelectionRejectReason(currentSelection(), editable, 'alpha')).toBe('interactive-control')
  })

  it('rejects a selection inside a bare contenteditable attribute', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', '')
    editable.textContent = 'plain'
    document.body.append(editable)
    const text = textNodeOf(editable)
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 5)
    applyRange(range)

    expect(isInteractiveSelectionNode(text)).toBe(true)
  })

  it('leaves button-like content capturable for adapters that need it', () => {
    const button = document.createElement('button')
    button.textContent = 'slide text'
    document.body.append(button)
    const text = textNodeOf(button)
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 5)
    applyRange(range)

    // A PPTX or SVG renderer may wrap its text in a button-like control; the
    // shared layer must not decide that for a format it does not know.
    expect(isInteractiveSelectionNode(text)).toBe(false)
  })

  it('reports outside-supported-preview when no adapter owns the context', () => {
    const outside = elementById('outside')
    selectText(outside)

    const result = new SelectionAdapterRegistry().capture(contextFrom(outside))

    expect(result.snapshot).toBeNull()
    expect(result.rejectReason).toBe('outside-supported-preview')
  })

  it('captures a valid same-root selection with normalized text', () => {
    const rootA = elementById('root-a')
    selectText(rootA)

    const result = shellKernel().capture(contextFrom(rootA))

    expect(result.rejectReason).toBeNull()
    expect(result.snapshot?.text).toBe('alpha beta')
    expect(result.snapshot?.capturedAt).toBe(NOW)
    expect(result.snapshot?.adapterId).toBe('fake-shell')
  })

  it('rejects a selection that normalizes to nothing', () => {
    const blank = document.createElement('div')
    blank.id = 'blank'
    blank.setAttribute('data-test-selection-root', '')
    // Whitespace only, and preserved verbatim: whitespace in markup must not be
    // collapsed by the fixture, or the case would test something else.
    blank.textContent = '   \n\t  '
    document.body.append(blank)
    selectText(blank)

    const result = shellKernel().capture(contextFrom(blank))

    expect(result.snapshot).toBeNull()
    expect(result.rejectReason).toBe('empty-after-normalization')
  })
})

describe('scope helpers', () => {
  it('resolves a text node to its parent element', () => {
    const rootA = elementById('root-a')

    expect(closestElement(textNodeOf(rootA))).toBe(rootA)
  })

  it('resolves an element to itself without walking upward', () => {
    const rootA = elementById('root-a')

    expect(closestElement(rootA)).toBe(rootA)
  })

  it('resolves a node with no element ancestor to null', () => {
    expect(closestElement(null)).toBeNull()
    expect(closestElement(document)).toBeNull()
    expect(closestElement(document.createDocumentFragment())).toBeNull()
    expect(closestElement(document.createTextNode('detached'))).toBeNull()
  })

  it('requires both endpoints to be contained by the root', () => {
    const rootA = elementById('root-a')
    const selection = selectAcross(rootA, elementById('root-b'))

    expect(selectionLivesInSameRoot(selection, document.body)).toBe(true)
    expect(selectionLivesInSameRoot(selection, rootA)).toBe(false)
  })

  it('returns false when the selection has no endpoints', () => {
    const selection = currentSelection()
    selection.removeAllRanges()

    expect(selectionLivesInSameRoot(selection, document.body)).toBe(false)
  })

  it('reports collapsed before interactive-control for a caret in an input', () => {
    const input = document.createElement('input')
    input.value = 'query'
    document.body.append(input)
    const range = document.createRange()
    range.setStart(input, 0)
    range.collapse(true)
    applyRange(range)

    // Nothing was selected, so the surface is not the interesting fact.
    expect(domSelectionRejectReason(currentSelection(), input, '')).toBe('collapsed')
  })

  it('reports cross-root before interactive-control', () => {
    const textarea = document.createElement('textarea')
    textarea.value = 'draft'
    document.body.append(textarea)
    const rootA = elementById('root-a')
    // The anchor is a text node inside the root and the focus is the control
    // element, which is the shape a drag ending over a form control produces.
    const live = selectAcross(textNodeOf(rootA), textarea)
    expect(live.rangeCount).toBe(1)
    expect(live.isCollapsed).toBe(false)

    // The scope failure is the safety-relevant fact; the surface type is
    // secondary, and the first matching rule is the one reported.
    expect(domSelectionRejectReason(live, rootA, 'alpha beta')).toBe('cross-root')
  })

  it('reports interactive-control when the surface is inside the checked root', () => {
    // The control has to be a descendant of the checked root for this case, so
    // the root is a form that holds both the text and the control. A real page
    // has no such markup, but the classification rule under test needs scope to
    // hold while the surface check refuses the selection.
    const form = document.createElement('form')
    const seed = document.createElement('span')
    seed.textContent = 'alpha beta'
    const input = document.createElement('input')
    input.value = 'query'
    form.append(seed, input)
    document.body.append(form)

    const range = document.createRange()
    range.setStart(textNodeOf(seed), 0)
    range.setEnd(input, 0)
    applyRange(range)

    expect(isInteractiveSelectionNode(currentSelection().focusNode)).toBe(true)
    expect(domSelectionRejectReason(currentSelection(), form, 'alpha beta')).toBe('interactive-control')
  })

  it('admits a capturable selection with no reason', () => {
    const rootA = elementById('root-a')
    selectText(rootA)
    const selection = currentSelection()

    expect(selectionLivesInSameRoot(selection, rootA)).toBe(true)
    expect(domSelectionRejectReason(selection, rootA, 'alpha beta')).toBeNull()
  })
})

describe('captureDomRange', () => {
  it('returns null for a collapsed selection', () => {
    const rootA = elementById('root-a')
    const text = textNodeOf(rootA)
    const range = document.createRange()
    range.setStart(text, 1)
    range.collapse(true)
    const selection = applyRange(range)

    expect(captureDomRange(selection)).toBeNull()
  })

  it('returns null when the selection carries no range', () => {
    const selection = currentSelection()
    selection.removeAllRanges()

    expect(captureDomRange(selection)).toBeNull()
  })

  it('keeps a range that is independent of the live selection', () => {
    const rootA = elementById('root-a')
    const liveRange = selectText(rootA)
    const selection = currentSelection()
    const startContainer = liveRange.startContainer

    const captured = captureDomRange(selection)

    expect(captured).not.toBeNull()
    expect(captured?.range).not.toBe(liveRange)
    expect(captured?.text).toBe('alpha beta')

    // The click that follows a capture collapses or replaces the selection; the
    // captured range is what provenance is resolved from afterwards.
    const other = document.createRange()
    const otherText = textNodeOf(rootA)
    other.setStart(otherText, 0)
    other.setEnd(otherText, 5)
    applyRange(other)

    expect(selection.toString()).toBe('alpha')
    expect(captured?.range.toString()).toBe('alpha beta')
    expect(captured?.range.startContainer).toBe(startContainer)
    expect(captured?.range.startOffset).toBe(liveRange.startOffset)
    expect(captured?.range.endOffset).toBe(liveRange.endOffset)
  })

  it('copies the client rectangles the live range reports', () => {
    const rootA = elementById('root-a')
    const liveRange = selectText(rootA)
    const first = rect({ x: 10, y: 20, width: 30, height: 12 })
    const second = rect({ x: 10, y: 34, width: 18, height: 12 })
    const restore = stubRangeGeometry(liveRange, [first, second], rect({ x: 10, y: 20, width: 30, height: 26 }))

    const captured = captureDomRange(currentSelection())
    restore()

    expect(captured?.rects).toHaveLength(2)
    expect(rectMembers(captured?.rects[0])).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 12,
      top: 20,
      right: 40,
      bottom: 32,
      left: 10,
    })
    expect(rectMembers(captured?.rects[1])).toEqual({
      x: 10,
      y: 34,
      width: 18,
      height: 12,
      top: 34,
      right: 28,
      bottom: 46,
      left: 10,
    })
  })

  it('copies the rectangles rather than retaining the live objects', () => {
    const rootA = elementById('root-a')
    const liveRange = selectText(rootA)
    const live = rect({ x: 1, y: 2, width: 3, height: 4 })
    const restore = stubRangeGeometry(liveRange, [live], live)

    const first = captureDomRange(currentSelection())
    const second = captureDomRange(currentSelection())
    restore()

    // The capture keeps its own values: a browser may hand back the same
    // rectangle object for the next capture, and a retained reference would let
    // two captures of different selections share one geometry.
    expect(first?.rects[0]).not.toBe(live)
    expect(second?.rects[0]).not.toBe(first?.rects[0])
    expect(rectMembers(second?.rects[0])).toEqual(rectMembers(first?.rects[0]))
  })

  it('falls back to the bounding rectangle when the range reports no client rectangles', () => {
    const rootA = elementById('root-a')
    const liveRange = selectText(rootA)
    const restore = stubRangeGeometry(liveRange, [], rect({ x: 5, y: 6, width: 7, height: 8 }))

    const captured = captureDomRange(currentSelection())
    restore()

    expect(captured?.rects).toHaveLength(1)
    expect(captured?.rects[0]?.width).toBe(7)
    expect(captured?.rects[0]?.height).toBe(8)
  })

  it('captures text with an empty rect list when the host reports no geometry', () => {
    const rootA = elementById('root-a')
    // jsdom implements neither geometry method on `Range`, which models a host
    // without layout. A readable selection must survive it: positioning has its
    // own fallback and is not the capture path's decision.
    selectText(rootA)

    const captured = captureDomRange(currentSelection())

    expect(captured?.text).toBe('alpha beta')
    expect(captured?.rects).toEqual([])
  })
})
