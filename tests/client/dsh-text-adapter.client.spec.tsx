// @vitest-environment jsdom
/**
 * DSH builtin text / Markdown / code / CSV selection adapter.
 *
 * This spec covers the first adapter that faces a real product DOM rather than a
 * fixture invented for the test: the markup below reproduces what DSH
 * `0.1.5-rc.1` actually renders for a document preview, taken from the installed
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview@0.1.5-rc.1` bundle rather
 * than from the design documents.
 *
 * Three facts from that runtime decide most of the assertions here.
 *
 * The preview root is `[data-textpreview-state="text"][data-textpreview-url]
 * [data-document-preview]`, and the header, the change bar, the load-more button
 * and the document content are all inside it. Only `[data-textpreview-body]` is
 * document content, so the body — not the preview root — is the scope the
 * capture validates against.
 *
 * The plain renderer emits one `[data-textpreview-line="<1-based source line>"]`
 * row per source line, which is what makes exact line provenance provable
 * without guessing. The code renderer instead renders a Shiki block whose rows
 * are `[data-code-block-content] pre .line`, in source order — the same order
 * DSH's own `scrollToLine` navigates by.
 *
 * A rendered Markdown document contains Shiki blocks too, because code fences
 * are highlighted the same way. Its rows are still code-fence rows, not source
 * lines of the Markdown file, so the Markdown renderer must never produce line
 * provenance however code-like its DOM looks; that regression is the single most
 * important case in this file.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { createDshTextAdapter } from '../../src/client/adapters/dsh-text/adapter.js'
import { applyClient } from '../../src/client/dsh/register.js'
import { normalizeSelectedText } from '../../src/client/selection/normalize.js'
import { SelectionAdapterRegistry } from '../../src/client/selection/registry.js'
import type { SelectionContext } from '../../src/client/selection/registry.js'
import type { ClientContext } from '../../src/client/dsh/contracts.js'
import { rect, stubRangeGeometry } from './helpers/dom-range-fixtures.js'

/** Renderer identity of the DSH plain renderer, verified against rc.1. */
const PLAIN_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text'
/** Renderer identity of the DSH Markdown renderer, verified against rc.1. */
const MARKDOWN_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown'
/** Renderer identity of the DSH highlighted-code renderer, verified against rc.1. */
const CODE_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code'
/** Renderer identity of a DSH renderer this task must not claim. */
const PDF_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/pdf'

/** The adapter id every snapshot in this spec carries. */
const ADAPTER_ID = 'dsh-builtin-text'

/** Capture time used by every context in this spec. */
const NOW = 1_700_000_000_000

/** A source text long enough to exceed the documented selection limit. */
const OVERSIZED_TEXT = 'x'.repeat(16_385)

/** Label of the preview's reload control, which is chrome rather than content. */
const RELOAD_LABEL = '\u91cd\u65b0\u52a0\u8f7d'

/** Label of the preview's loading line. */
const LOADING_LABEL = '\u52a0\u8f7d\u4e2d'

/** File name used by the percent-encoding cases. */
const CJK_NAME = '\u4e2d\u6587'

/**
 * Build the preview shell DSH wraps every document in.
 *
 * The header carries a path, a viewer menu and a reload control, and the body
 * carries the renderer output; both are inside the preview root, which is what
 * makes "header is not document content" a real case rather than a hypothetical
 * one.
 * @param url - the `data-textpreview-url` resource address.
 * @param previewId - the `data-document-preview` renderer identity.
 * @param body - the renderer output element.
 * @returns the preview root element, not yet attached to the document.
 */
function previewShell(url: string, previewId: string, body: Element): HTMLElement {
  const root = document.createElement('div')
  root.setAttribute('data-textpreview-state', 'text')
  root.setAttribute('data-textpreview-url', url)
  root.setAttribute('data-document-preview', previewId)

  const header = document.createElement('div')
  header.setAttribute('data-textpreview-header', '')
  const path = document.createElement('div')
  path.setAttribute('data-textpreview-path', '')
  path.textContent = 'dsh-document-preview-fixture'
  const reload = document.createElement('button')
  reload.setAttribute('type', 'button')
  reload.setAttribute('data-textpreview-tool', 'reload')
  reload.textContent = RELOAD_LABEL
  header.append(path, reload)

  const bodyRoot = document.createElement('div')
  bodyRoot.setAttribute('data-textpreview-body', '')
  bodyRoot.append(body)

  root.append(header, bodyRoot)
  return root
}

/**
 * Build the plain renderer's output.
 *
 * Each row carries the source text followed by the newline the product renders
 * inside the row, which is what makes a multi-line selection reproduce the
 * document's own line breaks.
 * @param rows - one entry per row: its source line attribute and its text.
 * @returns the renderer root element.
 */
function plainBody(rows: readonly (readonly [string, string])[]): HTMLElement {
  const container = document.createElement('div')
  container.setAttribute('data-textpreview-plain', '')
  const page = document.createElement('pre')
  page.setAttribute('data-textpreview-page', '1')

  for (const [lineAttribute, text] of rows) {
    const row = document.createElement('div')
    row.setAttribute('data-textpreview-line', lineAttribute)
    row.append(document.createTextNode(text), document.createTextNode('\n'))
    page.append(row)
  }

  container.append(page)
  return container
}

/**
 * Build the highlighted-code renderer's output.
 *
 * The structure mirrors the product's Shiki block: a `[data-code-block-content]`
 * viewport holding `pre > code > span.line` rows in source order.
 * @param lines - one entry per source line: its tokens.
 * @returns the renderer root element.
 */
function codeBody(lines: readonly (readonly string[])[]): HTMLElement {
  const container = document.createElement('div')
  container.setAttribute('data-code-preview', '')
  const content = document.createElement('div')
  content.setAttribute('data-code-block-content', '')
  const pre = document.createElement('pre')
  pre.className = 'shiki'
  const code = document.createElement('code')

  for (const line of lines) {
    const row = document.createElement('span')
    row.className = 'line'
    for (const token of line) {
      const span = document.createElement('span')
      span.textContent = token
      row.append(span)
    }
    code.append(row)
  }

  pre.append(code)
  content.append(pre)
  container.append(content)
  return container
}

/**
 * Build a Markdown renderer output whose only content is a highlighted code
 * fence, which is what makes the "Markdown must not report code lines" case
 * indistinguishable from a real code document by DOM shape alone.
 * @param lines - one entry per fence line: its tokens.
 * @returns the renderer root element.
 */
function markdownBodyWithFence(lines: readonly (readonly string[])[]): HTMLElement {
  const prose = document.createElement('p')
  prose.append(document.createTextNode('Introduction'))

  const container = document.createElement('div')
  container.className = 'markdown-body'
  container.append(prose, codeBody(lines))
  return container
}

/**
 * Attach a fixture preview to the page, with a chat transcript beside it.
 * @param preview - the preview root to attach.
 * @returns the preview root.
 */
function mount(preview: HTMLElement): HTMLElement {
  const chat = document.createElement('div')
  chat.setAttribute('data-chat', '')
  const chatLine = document.createElement('span')
  chatLine.className = 'line'
  chatLine.textContent = 'chat line'
  chat.append(chatLine)

  document.body.append(preview, chat)
  return preview
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
 * Find the first text node inside an element, at any depth.
 * @param element - the element to search.
 * @returns the text node, or `null` when the subtree holds none.
 */
function firstTextNodeIn(element: Element): Text | null {
  const walker = document.createTreeWalker(element, 4)
  const node = walker.nextNode()
  return node === null ? null : (node as Text)
}

/** Read the live selection, which jsdom always provides. */
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
 * Select the full text of one element.
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
 * Select everything inside an element.
 *
 * The plain renderer's rows start with their own text node, while a Shiki row is
 * a container of token spans. A real drag over one covers whichever shape the
 * renderer produced, so this helper handles both rather than assuming one.
 * @param element - the element to select the contents of.
 * @returns the live range.
 */
function selectInside(element: Element): Range {
  const text = firstTextNodeIn(element)
  if (text === null) {
    throw new Error('fixture element must contain text')
  }

  const range = document.createRange()
  if (element.firstChild !== null && element.firstChild.nodeType === 3) {
    range.setStart(text, 0)
    range.setEnd(text, text.data.length)
  } else {
    range.selectNodeContents(element)
  }
  applyRange(range)
  return range
}

/**
 * Select a span of characters inside one element's text node.
 * @param element - the element to select inside.
 * @param start - start offset within its text node.
 * @param end - end offset within its text node.
 * @returns the live range.
 */
function selectRange(element: Element, start: number, end: number): Range {
  const text = textNodeOf(element)
  const range = document.createRange()
  range.setStart(text, start)
  range.setEnd(text, end)
  applyRange(range)
  return range
}

/**
 * Build a selection whose anchor and focus have a caller-chosen direction.
 *
 * `setBaseAndExtent` is used rather than `addRange`, because it is the only way
 * to express a backwards drag: a `Range` is normalised to document order, so the
 * direction survives only in the selection's anchor and focus.
 * @param anchor - node holding the anchor.
 * @param anchorOffset - offset inside the anchor node.
 * @param focus - node holding the focus.
 * @param focusOffset - offset inside the focus node.
 * @returns the live selection.
 */
function selectDirected(
  anchor: Node,
  anchorOffset: number,
  focus: Node,
  focusOffset: number,
): Selection {
  const selection = currentSelection()
  selection.removeAllRanges()
  selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset)
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
 * Select from the start of one element's text to the end of another's.
 *
 * Both endpoints are resolved to a text node inside the element, so the helper
 * works whether the renderer emits a bare text node per row or a container of
 * token spans.
 * @param from - element holding the anchor.
 * @param to - element holding the focus.
 * @returns the live selection.
 */
function selectDirectedInside(from: Element, to: Element): Selection {
  const start = firstTextNodeIn(from)
  const end = firstTextNodeIn(to)
  if (start === null || end === null) {
    throw new Error('both fixture elements must contain text')
  }
  return selectDirected(start, 0, end, end.data.length)
}

/** Build a one-adapter registry around the production DSH text adapter. */
function adapterRegistry(): SelectionAdapterRegistry {
  const registry = new SelectionAdapterRegistry()
  registry.register(createDshTextAdapter())
  return registry
}

/**
 * A fake client context recording the effects `applyClient` registers.
 *
 * `effect` runs its body immediately and returns a disposer that runs whatever
 * the body returned, which is the contract `Fiber.effect` publishes.
 *
 * `slots` is stubbed to invoke `inject`'s callback synchronously, which is what
 * the real registry does once the slot's parent entry has declared it: the
 * conversation shell declares `conversation.input.overlay` during boot, so a
 * plugin loaded afterwards contributes immediately. The callback's own disposer
 * is recorded alongside the other effects, because the registry owns it through
 * the same fiber.
 */
function fakeClientContext(): { readonly ctx: ClientContext; readonly disposers: (() => void)[] } {
  const disposers: (() => void)[] = []
  const ctx = {
    effect: (execute: () => (() => void) | void): (() => void) => {
      const produced = execute()
      if (typeof produced !== 'function') {
        throw new Error('an effect body must return its disposer')
      }
      disposers.push(produced)
      return produced
    },
    slots: {
      inject: (_key: string, callback: () => () => void): (() => void) => {
        const produced = callback()
        if (typeof produced === 'function') {
          disposers.push(produced)
        }
        return produced
      },
      register: (): (() => void) => () => undefined,
    },
  } as unknown as ClientContext

  return { ctx, disposers }
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('dsh text adapter: plain renderer', () => {
  it('captures a single source line with exact provenance', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/notes.txt',
        PLAIN_ID,
        plainBody([
          ['1', 'alpha'],
          ['2', 'beta'],
        ]),
      ),
    )
    const rows = preview.querySelectorAll('[data-textpreview-line]')
    const second = rows[1]
    if (second === undefined) {
      throw new Error('fixture must render two source lines')
    }
    selectText(second)

    const result = adapterRegistry().capture(contextFrom(second))

    expect(result.rejectReason).toBeNull()
    expect(result.snapshot?.adapterId).toBe(ADAPTER_ID)
    expect(result.snapshot?.fileName).toBe('notes.txt')
    expect(result.snapshot?.documentKind).toBe('text')
    expect(result.snapshot?.location).toEqual({ kind: 'lines', start: 2, end: 2 })
    expect(result.snapshot?.text).toBe('beta')
    expect(result.snapshot?.resourceAddress).toBe('dsh-resource://file/session/s1/notes.txt')
    expect(result.snapshot?.capturedAt).toBe(NOW)
  })

  it('spans two source lines when the selection does', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/notes.txt',
        PLAIN_ID,
        plainBody([
          ['1', 'alpha'],
          ['2', 'beta'],
        ]),
      ),
    )
    const rows = preview.querySelectorAll('[data-textpreview-line]')
    const first = rows[0]
    const second = rows[1]
    if (first === undefined || second === undefined) {
      throw new Error('fixture must render two source lines')
    }
    selectDirected(textNodeOf(first), 0, textNodeOf(second), 4)

    const result = adapterRegistry().capture(contextFrom(first))

    expect(result.rejectReason).toBeNull()
    expect(result.snapshot?.location).toEqual({ kind: 'lines', start: 1, end: 2 })
    expect(result.snapshot?.text).toBe(normalizeSelectedText('alpha\nbeta\n'))
  })

  it('reports the same range for a backwards drag', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/notes.txt',
        PLAIN_ID,
        plainBody([
          ['1', 'alpha'],
          ['2', 'beta'],
        ]),
      ),
    )
    const rows = preview.querySelectorAll('[data-textpreview-line]')
    const first = rows[0]
    const second = rows[1]
    if (first === undefined || second === undefined) {
      throw new Error('fixture must render two source lines')
    }
    // Anchor below the focus: the drag ran upward, so provenance taken from the
    // anchor/focus pair would report an inverted, and wrong, range.
    const live = selectDirected(textNodeOf(second), 4, textNodeOf(first), 0)
    expect(live.anchorNode).not.toBe(live.focusNode)

    const result = adapterRegistry().capture(contextFrom(second))

    expect(result.snapshot?.location).toEqual({ kind: 'lines', start: 1, end: 2 })
  })

  it('falls back to document provenance when the line attribute is not a line number', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/notes.txt',
        PLAIN_ID,
        plainBody([
          ['banana', 'alpha'],
          ['2', 'beta'],
        ]),
      ),
    )
    const rows = preview.querySelectorAll('[data-textpreview-line]')
    const first = rows[0]
    if (first === undefined) {
      throw new Error('fixture must render two source lines')
    }
    selectText(first)

    const result = adapterRegistry().capture(contextFrom(first))

    expect(result.rejectReason).toBeNull()
    expect(result.snapshot?.location).toEqual({ kind: 'document' })
    expect(result.snapshot?.documentKind).toBe('text')
  })

  it.each([
    ['empty', ''],
    ['not-a-number', 'x'],
    ['nan', 'NaN'],
    ['zero', '0'],
    ['negative', '-3'],
    ['fractional', '1.5'],
    ['padded', ' 2'],
    ['exponent', '1e3'],
  ])('falls back to document provenance for a %s line marker', (_label, marker) => {
    const preview = mount(
      previewShell('dsh-resource://file/session/s1/notes.txt', PLAIN_ID, plainBody([[marker, 'alpha']])),
    )
    const row = preview.querySelector('[data-textpreview-line]')
    if (row === null) {
      throw new Error('fixture must render one source line')
    }
    selectText(row)

    const result = adapterRegistry().capture(contextFrom(row))

    expect(result.snapshot?.location).toEqual({ kind: 'document' })
  })

  it('normalizes CRLF and trailing spaces the way the shared normalizer does', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/notes.txt',
        PLAIN_ID,
        // One row holding a Windows line break and a padded line end, which is
        // what a renderer pastes into a row when it does not split lines itself.
        plainBody([['1', 'alpha   \r\nbeta  ']]),
      ),
    )
    const row = preview.querySelector('[data-textpreview-line]')
    if (row === null) {
      throw new Error('fixture must render one source line')
    }
    selectText(row)

    const result = adapterRegistry().capture(contextFrom(row))

    expect(result.snapshot?.text).toBe(normalizeSelectedText('alpha   \r\nbeta  \n'))
    expect(result.snapshot?.text).toBe('alpha\nbeta')
  })

  it('rejects a selection that normalizes to nothing', () => {
    const preview = mount(
      previewShell('dsh-resource://file/session/s1/notes.txt', PLAIN_ID, plainBody([['1', '   \t  ']])),
    )
    const row = preview.querySelector('[data-textpreview-line]')
    if (row === null) {
      throw new Error('fixture must render one source line')
    }
    selectText(row)

    const result = adapterRegistry().capture(contextFrom(row))

    expect(result.snapshot).toBeNull()
    expect(result.rejectReason).toBe('empty-after-normalization')
  })

  it('rejects a selection above the size limit without truncating it', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/notes.txt',
        PLAIN_ID,
        plainBody([['1', OVERSIZED_TEXT]]),
      ),
    )
    const row = preview.querySelector('[data-textpreview-line]')
    if (row === null) {
      throw new Error('fixture must render one source line')
    }
    selectText(row)

    const result = adapterRegistry().capture(contextFrom(row))

    expect(result.snapshot).toBeNull()
    expect(result.rejectReason).toBe('too-large')
  })

  it('keeps the rectangles the shared capture produced', () => {
    const preview = mount(
      previewShell('dsh-resource://file/session/s1/notes.txt', PLAIN_ID, plainBody([['1', 'alpha']])),
    )
    const row = preview.querySelector('[data-textpreview-line]')
    if (row === null) {
      throw new Error('fixture must render one source line')
    }
    const live = selectText(row)
    const geometry = rect({ x: 4, y: 8, width: 30, height: 12 })
    const restore = stubRangeGeometry(live, [geometry], geometry)

    const result = adapterRegistry().capture(contextFrom(row))
    restore()

    expect(result.snapshot?.rects).toHaveLength(1)
    expect(result.snapshot?.rects[0]?.width).toBe(30)
  })
})

describe('dsh text adapter: code renderer', () => {
  it('maps a selection in the second code row to source line 2', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/src/main.ts',
        CODE_ID,
        codeBody([['alpha'], ['beta']]),
      ),
    )
    const lines = preview.querySelectorAll('[data-code-block-content] pre .line')
    const second = lines[1]
    if (second === undefined) {
      throw new Error('fixture must render two code lines')
    }
    selectInside(second)

    const result = adapterRegistry().capture(contextFrom(second))

    expect(result.rejectReason).toBeNull()
    expect(result.snapshot?.fileName).toBe('main.ts')
    expect(result.snapshot?.documentKind).toBe('code')
    expect(result.snapshot?.location).toEqual({ kind: 'lines', start: 2, end: 2 })
    expect(result.snapshot?.text).toBe('beta')
  })

  it('spans the rows a multi-line code selection covers', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/src/main.ts',
        CODE_ID,
        codeBody([['one'], ['two'], ['three'], ['four']]),
      ),
    )
    const lines = preview.querySelectorAll('[data-code-block-content] pre .line')
    const second = lines[1]
    const fourth = lines[3]
    if (second === undefined || fourth === undefined) {
      throw new Error('fixture must render four code lines')
    }
    selectDirectedInside(second, fourth)

    const result = adapterRegistry().capture(contextFrom(second))

    expect(result.snapshot?.location).toEqual({ kind: 'lines', start: 2, end: 4 })
    expect(result.snapshot?.documentKind).toBe('code')
  })

  it('ignores .line elements outside the code content root', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/src/main.ts',
        CODE_ID,
        codeBody([['alpha'], ['beta']]),
      ),
    )
    // Three `span.line` elements now exist in the page: two inside the code
    // block and one in the chat transcript mounted beside it. Counting the page
    // instead of the content root would report line 2 for this selection.
    expect(document.querySelectorAll('span.line')).toHaveLength(3)
    const beta = preview.querySelectorAll('[data-code-block-content] pre .line')[1]
    if (beta === undefined) {
      throw new Error('fixture must render two code lines')
    }
    selectInside(beta)

    const result = adapterRegistry().capture(contextFrom(beta))

    expect(result.snapshot?.location).toEqual({ kind: 'lines', start: 2, end: 2 })
  })

  it('falls back to document provenance when the code renderer exposes no line rows', () => {
    const container = document.createElement('div')
    container.setAttribute('data-code-preview', '')
    const content = document.createElement('div')
    content.setAttribute('data-code-block-content', '')
    const pre = document.createElement('pre')
    pre.textContent = 'not line structured'
    content.append(pre)
    container.append(content)
    const preview = mount(
      previewShell('dsh-resource://file/session/s1/src/main.ts', CODE_ID, container),
    )
    const target = preview.querySelector('pre')
    if (target === null) {
      throw new Error('fixture must render one pre element')
    }
    selectText(target)

    const result = adapterRegistry().capture(contextFrom(target))

    expect(result.rejectReason).toBeNull()
    expect(result.snapshot?.location).toEqual({ kind: 'document' })
    expect(result.snapshot?.documentKind).toBe('code')
  })

  it('falls back to document provenance when the rows are not in one content root', () => {
    const container = document.createElement('div')
    container.setAttribute('data-code-preview', '')
    const first = document.createElement('div')
    first.setAttribute('data-code-block-content', '')
    const firstPre = document.createElement('pre')
    const firstLine = document.createElement('span')
    firstLine.className = 'line'
    firstLine.textContent = 'alpha'
    firstPre.append(firstLine)
    first.append(firstPre)
    const second = document.createElement('div')
    second.setAttribute('data-code-block-content', '')
    const secondPre = document.createElement('pre')
    const secondLine = document.createElement('span')
    secondLine.className = 'line'
    secondLine.textContent = 'beta'
    secondPre.append(secondLine)
    second.append(secondPre)
    container.append(first, second)

    const preview = mount(
      previewShell('dsh-resource://file/session/s1/src/main.ts', CODE_ID, container),
    )
    const rows = preview.querySelectorAll('span.line')
    const firstRow = rows[0]
    const lastRow = rows[1]
    if (firstRow === undefined || lastRow === undefined) {
      throw new Error('fixture must render two code rows')
    }
    selectDirectedInside(firstRow, lastRow)

    const result = adapterRegistry().capture(contextFrom(firstRow))

    expect(result.rejectReason).toBeNull()
    expect(result.snapshot?.location).toEqual({ kind: 'document' })
  })
})

describe('dsh text adapter: semantic document kind', () => {
  it('reports Markdown with file-only provenance for the Markdown renderer', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/README.md',
        MARKDOWN_ID,
        markdownBodyWithFence([['const answer = 42'], ['export default answer']]),
      ),
    )
    const fenceLine = preview.querySelector('[data-code-block-content] pre .line')
    if (fenceLine === null) {
      throw new Error('fixture must render a highlighted fence')
    }
    selectInside(fenceLine)

    const result = adapterRegistry().capture(contextFrom(fenceLine))

    expect(result.rejectReason).toBeNull()
    expect(result.snapshot?.documentKind).toBe('markdown')
    // The fence rows are rows of the embedded snippet, not source lines of
    // README.md; reporting line 1 here would cite a line that does not hold the
    // selected text.
    expect(result.snapshot?.location).toEqual({ kind: 'document' })
  })

  it('keeps Markdown as the kind and allows exact lines in the plain viewer', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/README.md',
        PLAIN_ID,
        plainBody([
          ['1', '# Title'],
          ['2', 'body'],
        ]),
      ),
    )
    const rows = preview.querySelectorAll('[data-textpreview-line]')
    const second = rows[1]
    if (second === undefined) {
      throw new Error('fixture must render two source lines')
    }
    selectText(second)

    const result = adapterRegistry().capture(contextFrom(second))

    expect(result.snapshot?.documentKind).toBe('markdown')
    expect(result.snapshot?.location).toEqual({ kind: 'lines', start: 2, end: 2 })
  })

  it('reports CSV with exact physical lines when the plain renderer shows it', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/data.csv',
        PLAIN_ID,
        plainBody([
          ['1', 'name,count'],
          ['2', 'alpha,1'],
        ]),
      ),
    )
    const rows = preview.querySelectorAll('[data-textpreview-line]')
    const second = rows[1]
    if (second === undefined) {
      throw new Error('fixture must render two source lines')
    }
    selectText(second)

    const result = adapterRegistry().capture(contextFrom(second))

    expect(result.snapshot?.documentKind).toBe('csv')
    expect(result.snapshot?.fileName).toBe('data.csv')
    expect(result.snapshot?.location).toEqual({ kind: 'lines', start: 2, end: 2 })
  })

  it('reports CSV through the code renderer as well', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/data.csv',
        CODE_ID,
        codeBody([['name,count'], ['alpha,1']]),
      ),
    )
    const row = preview.querySelectorAll('[data-code-block-content] pre .line')[0]
    if (row === undefined) {
      throw new Error('fixture must render two code lines')
    }
    selectInside(row)

    const result = adapterRegistry().capture(contextFrom(row))

    expect(result.snapshot?.documentKind).toBe('csv')
    expect(result.snapshot?.location).toEqual({ kind: 'lines', start: 1, end: 1 })
  })

  it('treats a Markdown-suffixed file in the code viewer as Markdown without lines', () => {
    const preview = mount(
      previewShell(
        'dsh-resource://file/session/s1/guide.markdown',
        CODE_ID,
        codeBody([['# Title'], ['body']]),
      ),
    )
    const row = preview.querySelectorAll('[data-code-block-content] pre .line')[0]
    if (row === undefined) {
      throw new Error('fixture must render two code lines')
    }
    selectInside(row)

    const result = adapterRegistry().capture(contextFrom(row))

    expect(result.snapshot?.documentKind).toBe('markdown')
    expect(result.snapshot?.location).toEqual({ kind: 'document' })
  })
})

describe('dsh text adapter: file name resolution', () => {
  it.each([
    ['a plain file', 'dsh-resource://file/session/s1/notes.txt', 'notes.txt'],
    ['a nested path', 'dsh-resource://file/session/s1/src/main.ts', 'main.ts'],
    ['an absolute scope', 'dsh-resource://file/absolute/C%3A/work/data.csv', 'data.csv'],
    ['an encoded space', 'dsh-resource://file/session/s1/my%20file.txt', 'my file.txt'],
    ['an encoded separator in the name', 'dsh-resource://file/session/s1/a%2Fb.txt', 'a/b.txt'],
    [
      'CJK percent encoding',
      'dsh-resource://file/session/s1/%E4%B8%AD%E6%96%87.txt',
      `${CJK_NAME}.txt`,
    ],
    ['raw CJK', `dsh-resource://file/session/s1/${CJK_NAME}.md`, `${CJK_NAME}.md`],
    ['a trailing query', 'dsh-resource://file/session/s1/notes.txt?v=2', 'notes.txt'],
  ])('resolves %s', (_label, address, expected) => {
    const preview = mount(previewShell(address, PLAIN_ID, plainBody([['1', 'alpha']])))
    const row = preview.querySelector('[data-textpreview-line]')
    if (row === null) {
      throw new Error('fixture must render one source line')
    }
    selectText(row)

    const result = adapterRegistry().capture(contextFrom(row))

    expect(result.rejectReason).toBeNull()
    expect(result.snapshot?.fileName).toBe(expected)
  })

  it.each([
    ['a non-DSH scheme', 'https://example.invalid/notes.txt'],
    ['a missing path', 'dsh-resource://file/session/s1'],
    ['a missing scope', 'dsh-resource://file/'],
    ['an unknown scope', 'dsh-resource://file/workspace/s1/notes.txt'],
    ['a malformed escape', 'dsh-resource://file/session/s1/%E0%A4%A.txt'],
    ['a trailing separator', 'dsh-resource://file/session/s1/'],
    ['an empty address', ''],
  ])('refuses %s without throwing', (_label, address) => {
    const preview = mount(previewShell(address, PLAIN_ID, plainBody([['1', 'alpha']])))
    const row = preview.querySelector('[data-textpreview-line]')
    if (row === null) {
      throw new Error('fixture must render one source line')
    }
    selectText(row)

    const result = adapterRegistry().capture(contextFrom(row))

    expect(result.snapshot).toBeNull()
    expect(result.rejectReason).toBe('outside-supported-preview')
  })
})

describe('dsh text adapter: ownership', () => {
  it('handles a preview selection when no pointer target was recorded', () => {
    const preview = mount(
      previewShell('dsh-resource://file/session/s1/notes.txt', PLAIN_ID, plainBody([['1', 'alpha']])),
    )
    const row = preview.querySelector('[data-textpreview-line]')
    if (row === null) {
      throw new Error('fixture must render one source line')
    }
    selectText(row)

    const adapter = createDshTextAdapter()
    const context: SelectionContext = { selection: window.getSelection(), target: null, now: NOW }

    expect(adapter.canHandle(context)).toBe(true)
    expect(adapter.capture(context).snapshot?.fileName).toBe('notes.txt')
    expect(preview.isConnected).toBe(true)
  })

  it('does not claim a selection that only touches a sibling chat transcript', () => {
    mount(previewShell('dsh-resource://file/session/s1/notes.txt', PLAIN_ID, plainBody([['1', 'alpha']])))
    const chatLine = document.querySelector('[data-chat] .line')
    if (chatLine === null) {
      throw new Error('fixture must render a chat transcript')
    }
    selectText(chatLine)

    const result = adapterRegistry().capture(contextFrom(chatLine))

    expect(createDshTextAdapter().canHandle(contextFrom(chatLine))).toBe(false)
    expect(result.snapshot).toBeNull()
    expect(result.rejectReason).toBe('outside-supported-preview')
  })

  it('does not claim a selection in the preview header, change bar or toolbar', () => {
    const preview = mount(
      previewShell('dsh-resource://file/session/s1/notes.txt', PLAIN_ID, plainBody([['1', 'alpha']])),
    )
    const path = preview.querySelector('[data-textpreview-path]')
    const reload = preview.querySelector('[data-textpreview-tool="reload"]')
    if (path === null || reload === null) {
      throw new Error('fixture must render a header and a reload control')
    }
    selectInside(path)

    const pathResult = adapterRegistry().capture(contextFrom(path))
    const reloadResult = adapterRegistry().capture(contextFrom(reload))

    expect(createDshTextAdapter().canHandle(contextFrom(path))).toBe(false)
    expect(pathResult.snapshot).toBeNull()
    expect(reloadResult.snapshot).toBeNull()
  })

  it('claims a selection that starts in the body and refuses it as cross-root when it leaves', () => {
    const preview = mount(
      previewShell('dsh-resource://file/session/s1/notes.txt', PLAIN_ID, plainBody([['1', 'alpha']])),
    )
    const row = preview.querySelector('[data-textpreview-line]')
    const path = preview.querySelector('[data-textpreview-path]')
    const chatLine = document.querySelector('[data-chat] .line')
    if (row === null || path === null || chatLine === null) {
      throw new Error('fixture must render a body, a header and a chat line')
    }

    selectDirected(textNodeOf(row), 0, textNodeOf(path), 3)
    const toHeader = adapterRegistry().capture(contextFrom(row))

    selectDirected(textNodeOf(row), 0, textNodeOf(chatLine), 3)
    const toChat = adapterRegistry().capture(contextFrom(row))

    // Both cases are the adapter's own rejection rather than a fall-through to a
    // permissive adapter registered behind it, which is the safety property the
    // registry's "first matching adapter owns rejection" rule provides.
    expect(toHeader.snapshot).toBeNull()
    expect(toHeader.rejectReason).toBe('cross-root')
    expect(toChat.snapshot).toBeNull()
    expect(toChat.rejectReason).toBe('cross-root')
  })

  it('does not claim a preview whose renderer this task does not support', () => {
    const body = document.createElement('div')
    body.textContent = 'page 1'
    const preview = mount(previewShell('dsh-resource://file/session/s1/paper.pdf', PDF_ID, body))
    const row = preview.querySelector('[data-textpreview-body] div')
    if (row === null) {
      throw new Error('fixture must render a body')
    }
    selectText(row)

    const result = adapterRegistry().capture(contextFrom(row))

    expect(createDshTextAdapter().canHandle(contextFrom(row))).toBe(false)
    expect(result.snapshot).toBeNull()
    expect(result.rejectReason).toBe('outside-supported-preview')
  })

  it('does not claim a preview that is still loading', () => {
    const loading = document.createElement('div')
    loading.setAttribute('data-textpreview-state', 'loading')
    loading.setAttribute('data-textpreview-url', 'dsh-resource://file/session/s1/notes.txt')
    const status = document.createElement('p')
    status.textContent = LOADING_LABEL
    loading.append(status)
    document.body.append(loading)
    selectText(status)

    const result = adapterRegistry().capture(contextFrom(status))

    expect(createDshTextAdapter().canHandle(contextFrom(status))).toBe(false)
    expect(result.snapshot).toBeNull()
  })

  it('rejects a collapsed caret inside the body', () => {
    const preview = mount(
      previewShell('dsh-resource://file/session/s1/notes.txt', PLAIN_ID, plainBody([['1', 'alpha']])),
    )
    const row = preview.querySelector('[data-textpreview-line]')
    if (row === null) {
      throw new Error('fixture must render one source line')
    }
    const text = textNodeOf(row)
    const range = document.createRange()
    range.setStart(text, 1)
    range.collapse(true)
    applyRange(range)

    const result = adapterRegistry().capture(contextFrom(row))

    expect(createDshTextAdapter().canHandle(contextFrom(row))).toBe(true)
    expect(result.snapshot).toBeNull()
    expect(result.rejectReason).toBe('collapsed')
  })

  it('reports outside-supported-preview when there is no live selection', () => {
    currentSelection().removeAllRanges()

    const result = adapterRegistry().capture(contextFrom(null))

    expect(result.snapshot).toBeNull()
    expect(result.rejectReason).toBe('outside-supported-preview')
  })
})

describe('client registration', () => {
  it('registers the adapter on the client context and releases it on disposal', () => {
    const { ctx, disposers } = fakeClientContext()

    const { registry } = applyClient(ctx)

    const preview = mount(
      previewShell('dsh-resource://file/session/s1/notes.txt', PLAIN_ID, plainBody([['1', 'alpha']])),
    )
    const row = preview.querySelector('[data-textpreview-line]')
    if (row === null) {
      throw new Error('fixture must render one source line')
    }
    selectText(row)
    const context = contextFrom(row)

    const captured = registry.capture(context)
    expect(captured.snapshot?.adapterId).toBe(ADAPTER_ID)
    expect(captured.snapshot?.fileName).toBe('notes.txt')

    // Every contribution the fiber owns hands back a real disposer: the adapter
    // registration, the overlay's style sheet, the browser selection lifecycle
    // and the slot injection. Unloading the plugin fiber must release all of
    // them rather than leaving one behind for the next hot reload.
    expect(disposers.length).toBeGreaterThan(0)
    for (const dispose of disposers) {
      expect(typeof dispose).toBe('function')
      dispose()
    }

    expect(registry.capture(context)).toEqual({
      snapshot: null,
      rejectReason: 'outside-supported-preview',
    })
  })

  it('registers no replacement renderer for the builtin text classes', () => {
    const registered: string[] = []
    const ctx = {
      effect: (execute: () => (() => void) | void): (() => void) => {
        const produced = execute()
        return typeof produced === 'function' ? produced : () => undefined
      },
      slots: {
        inject: (_key: string, callback: () => () => void): (() => void) => callback(),
        register: (): (() => void) => () => undefined,
      },
      documentPreviews: {
        register: (definition: { readonly id: string }): (() => void) => {
          registered.push(definition.id)
          return () => undefined
        },
      },
    } as unknown as ClientContext

    applyClient(ctx)

    // Task 4 reuses the builtin renderers; registering a replacement for text,
    // Markdown, code or CSV would replace the very DOM this adapter reads. Task 7
    // added one extension renderer for PDF, which is a class no builtin adapter
    // reads — so the set is asserted exactly rather than as "nothing at all",
    // which would have to be loosened again by every later renderer task and
    // would stop meaning anything.
    expect(registered).toEqual(['dsh-document-selection-ask/pdf'])
  })
})
