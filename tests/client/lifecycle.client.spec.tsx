// @vitest-environment jsdom
/**
 * The per-client selection lifecycle coordinator.
 *
 * Task 12's second half. Before it, the transient snapshot had no owner that
 * knew when the resource it describes stopped being selectable: a renderer could
 * unmount, a tab could be released, or the viewer could switch to another file,
 * and the Ask button stayed up describing text that no longer existed. The
 * coordinator is the one object that knows both halves — the browser selection
 * the reader makes and the semantic range the XLSX bridge publishes — and the
 * only one that may clear them.
 *
 * Four properties are load-bearing and each has its own cases below.
 *
 * **Invalidation is resource-scoped.** A cleanup that arrives late — the renderer
 * for file A unmounting after the reader has already selected in file B — must
 * not clear B's snapshot. `invalidateResource` therefore compares the snapshot's
 * own `resourceAddress` before it clears anything.
 *
 * **Scroll recaptures rather than clears.** A scroll with a live selection is not
 * a teardown: the snapshot is rebuilt from the live range so its rectangles match
 * where the text now is, and its text, resource and provenance survive.
 *
 * **Escape clears, and clears everything.** The kernel is shared by the browser
 * and semantic halves, so the Escape path clears a DOM snapshot and an XLSX range
 * alike, together with any rejection notice.
 *
 * **Dispose is final.** After it, a pending animation frame, a late bridge
 * publish and a late renderer callback are all inert.
 *
 * The renderer half is asserted against the four real bodies rather than against
 * the shared hook alone, because "the coordinator was told" is only worth
 * anything if each renderer actually tells it. Each body is mounted with a
 * non-byte content so it renders its status branch without starting an engine —
 * the question here is the lifetime notification, not the rendering.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'

import type { DocumentPreviewProps } from '../../src/client/dsh/contracts.js'
import { createXlsxSelectionAdapter } from '../../src/client/adapters/xlsx/adapter.js'
import { DocxBody } from '../../src/client/renderers/docx/DocxBody.js'
import { registerDocxRenderer } from '../../src/client/renderers/docx/register.js'
import type { DocxRendererInjectFace } from '../../src/client/renderers/docx/register.js'
import { PptxBody } from '../../src/client/renderers/pptx/PptxBody.js'
import { registerPptxRenderer } from '../../src/client/renderers/pptx/register.js'
import type { PptxRendererInjectFace } from '../../src/client/renderers/pptx/register.js'
import { SelectablePdfBody } from '../../src/client/renderers/pdf/SelectablePdfBody.js'
import { registerPdfRenderer } from '../../src/client/renderers/pdf/register.js'
import type { PdfRendererInjectFace } from '../../src/client/renderers/pdf/register.js'
import { XLSX_RESOURCE_ADDRESS_ATTRIBUTE } from '../../src/client/renderers/xlsx/identity.js'
import { registerXlsxRenderer } from '../../src/client/renderers/xlsx/register.js'
import { createXlsxSelectionBridge } from '../../src/client/renderers/xlsx/selection-bridge.js'
import type { XlsxSelectionBridge } from '../../src/client/renderers/xlsx/selection-bridge.js'
import { installXlsxSelectionLifecycle } from '../../src/client/renderers/xlsx/selection-lifecycle.js'
import { XlsxBody } from '../../src/client/renderers/xlsx/XlsxBody.js'
import type { XlsxBodyProps } from '../../src/client/renderers/xlsx/XlsxBody.js'
import { createSelectionFeedback } from '../../src/client/selection/feedback.js'
import type { SelectionFeedbackSource } from '../../src/client/selection/feedback.js'
import { installSelectionLifecycle } from '../../src/client/selection/lifecycle.js'
import type { SelectionLifecycleCoordinator } from '../../src/client/selection/lifecycle.js'
import { createSelectionKernel } from '../../src/client/selection/kernel.js'
import type { SelectionKernel } from '../../src/client/selection/kernel.js'
import { SelectionAdapterRegistry } from '../../src/client/selection/registry.js'
import type { SelectionAdapter, SelectionCapture, SelectionContext } from '../../src/client/selection/registry.js'
import type { SelectionLocation, SelectionSnapshot } from '../../src/client/selection/types.js'
// Side-effect import: it sets `IS_REACT_ACT_ENVIRONMENT`.
import './helpers/react-mount.js'

/**
 * The two browser APIs jsdom does not implement and the PDF body's layout effects
 * call unconditionally.
 *
 * They are installed so the body can commit at all: this suite is about the
 * lifetime notification, and a body that threw during its first commit would
 * never reach it. Nothing here asserts anything about either API — real layout
 * behaviour belongs to the Playwright suite, and no case below reads a rectangle.
 */
class StubResizeObserver {
  /** Accept an observation and report nothing, which is all this suite needs. */
  observe(): void {}
  /** Forget an observation. */
  unobserve(): void {}
  /** Release every observation. */
  disconnect(): void {}
}

globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
})) as unknown as typeof globalThis.matchMedia

/** Session the fixtures belong to. */
const SESSION = 'session-a'

/** Address of resource A. */
const RESOURCE_A = `dsh-resource://file/session/${SESSION}/alpha.txt`

/** Address of resource B. */
const RESOURCE_B = `dsh-resource://file/session/${SESSION}/beta.txt`

/** Address of the workbook the semantic cases publish against. */
const RESOURCE_XLSX = `dsh-resource://file/session/${SESSION}/book.xlsx`

/** Capture time the fixture document reports. */
const NOW = 1_700_000_000_000

/** The adapter id the harness's DOM adapter registers under. */
const BROWSER_ADAPTER_ID = 'harness-browser'

/**
 * The stand-in browser selection.
 *
 * The lifecycle only forwards whatever `getSelection()` returns, so this carries
 * exactly what the harness's adapter reads back out of the context.
 */
interface FakeSelection {
  readonly resource: string
  readonly text: string
  readonly location: SelectionLocation
}

/**
 * Read the harness selection back out of a capture context.
 * @param context - the context the coordinator captured with.
 * @returns the stand-in selection, or `null` when the browser has none.
 */
function fakeSelectionOf(context: SelectionContext): FakeSelection | null {
  const selection = context.selection
  return selection === null ? null : (selection as unknown as FakeSelection)
}

/**
 * A viewport rectangle for one capture generation.
 * @param top - the top offset this generation reports.
 * @returns the rectangle.
 */
function rect(top: number): DOMRectReadOnly {
  return { x: 0, y: top, width: 40, height: 12, top, right: 40, bottom: top + 12, left: 0 } as DOMRectReadOnly
}

/** The fake document and its inspection surface. */
interface FakeDocument {
  readonly document: Document
  /** The selection the lifecycle will read; `null` models a cleared one. */
  selection: Selection | null
  /** Rectangles the harness adapter copies into the next snapshot. */
  rects: readonly DOMRectReadOnly[]
  /**
   * Dispatch a document event.
   * @param type - the event type.
   * @param init - the target and any key the case needs.
   */
  fire(type: string, init?: { readonly target?: EventTarget | null; readonly key?: string }): void
  /**
   * Dispatch a window event, as the browser does for `resize`.
   * @param type - the event type.
   */
  fireOnWindow(type: string): void
  /** Run the scheduled animation frames, as the next paint would. */
  runFrames(): void
  /** Frames scheduled and not yet run. */
  pendingFrames(): number
  /**
   * Live listeners on the document for one event type.
   * @param type - the event type.
   * @returns the listener count.
   */
  documentListeners(type: string): number
  /**
   * Live listeners on the document's window for one event type.
   * @param type - the event type.
   * @returns the listener count.
   */
  windowListeners(type: string): number
}

/**
 * Build the fake document.
 * @returns the host and its inspection surface.
 */
function fakeDocument(): FakeDocument {
  const documentListeners = new Map<string, Set<EventListener>>()
  const windowListeners = new Map<string, Set<EventListener>>()
  const frames = new Map<number, () => void>()
  let handle = 0

  // The mutable half lives here so the document stub and the inspection surface
  // can share it without either one owning the other.
  const state: { selection: Selection | null; rects: readonly DOMRectReadOnly[] } = {
    selection: null,
    rects: [],
  }

  const add = (registry: Map<string, Set<EventListener>>, type: string, listener: EventListener): void => {
    const set = registry.get(type) ?? new Set<EventListener>()
    set.add(listener)
    registry.set(type, set)
  }
  const remove = (registry: Map<string, Set<EventListener>>, type: string, listener: EventListener): void => {
    registry.get(type)?.delete(listener)
  }
  const dispatch = (
    registry: Map<string, Set<EventListener>>,
    type: string,
    event: unknown,
  ): void => {
    for (const listener of [...(registry.get(type) ?? [])]) {
      listener(event as Event)
    }
  }

  const doc = {
    getSelection: (): Selection | null => state.selection,
    addEventListener: (type: string, listener: EventListener): void => {
      add(documentListeners, type, listener)
    },
    removeEventListener: (type: string, listener: EventListener): void => {
      remove(documentListeners, type, listener)
    },
    defaultView: {
      requestAnimationFrame(callback: () => void): number {
        handle += 1
        frames.set(handle, callback)
        return handle
      },
      cancelAnimationFrame(handleToCancel: number): void {
        frames.delete(handleToCancel)
      },
      addEventListener: (type: string, listener: EventListener): void => {
        add(windowListeners, type, listener)
      },
      removeEventListener: (type: string, listener: EventListener): void => {
        remove(windowListeners, type, listener)
      },
    },
  } as unknown as Document

  return {
    document: doc,
    get selection(): Selection | null {
      return state.selection
    },
    set selection(value: Selection | null) {
      state.selection = value
    },
    get rects(): readonly DOMRectReadOnly[] {
      return state.rects
    },
    set rects(value: readonly DOMRectReadOnly[]) {
      state.rects = value
    },
    fire(type, init = {}): void {
      dispatch(documentListeners, type, { type, target: init.target ?? null, key: init.key })
    },
    fireOnWindow(type): void {
      dispatch(windowListeners, type, { type, target: null })
    },
    runFrames(): void {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback()
    },
    pendingFrames(): number {
      return frames.size
    },
    documentListeners(type): number {
      return documentListeners.get(type)?.size ?? 0
    },
    windowListeners(type): number {
      return windowListeners.get(type)?.size ?? 0
    },
  }
}

/** The coordinator and everything it owns, for one case. */
interface Harness {
  readonly coordinator: SelectionLifecycleCoordinator
  readonly kernel: SelectionKernel
  readonly feedback: SelectionFeedbackSource
  readonly bridge: XlsxSelectionBridge
  readonly doc: FakeDocument
  /** Capture one DOM selection for a resource. */
  captureDom(resource: string, text: string): void
  /** Publish one semantic range selection for a workbook root. */
  captureXlsx(address: string): void
  /** The XLSX root the semantic cases publish against. */
  readonly xlsxRoot: HTMLElement
}

/**
 * Build the harness: a real kernel, real bridge, the real XLSX semantic
 * lifecycle, and a fake document for the browser half.
 *
 * @returns the harness.
 */
function harness(): Harness {
  const doc = fakeDocument()
  const registry = new SelectionAdapterRegistry()
  const kernel = createSelectionKernel(registry)
  const feedback = createSelectionFeedback()
  const bridge = createXlsxSelectionBridge()

  const xlsxRoot = document.createElement('section')
  xlsxRoot.setAttribute(XLSX_RESOURCE_ADDRESS_ATTRIBUTE, RESOURCE_XLSX)
  document.body.append(xlsxRoot)

  // The semantic adapter is registered first, exactly as production registers it.
  registry.register(createXlsxSelectionAdapter(bridge))

  const browserAdapter: SelectionAdapter = {
    id: BROWSER_ADAPTER_ID,
    canHandle: (context) => fakeSelectionOf(context) !== null,
    capture: (context) => {
      const selection = fakeSelectionOf(context)
      if (selection === null) {
        return { snapshot: null, rejectReason: 'collapsed' }
      }
      const snapshot: SelectionSnapshot = {
        adapterId: BROWSER_ADAPTER_ID,
        resourceAddress: selection.resource,
        fileName: 'alpha.txt',
        documentKind: 'text',
        text: selection.text,
        location: selection.location,
        rects: [...doc.rects],
        capturedAt: NOW,
      }
      return { snapshot, rejectReason: null }
    },
  }
  registry.register(browserAdapter)

  const coordinator = installSelectionLifecycle({
    kernel,
    feedback,
    document: doc.document,
  })
  coordinator.own(installXlsxSelectionLifecycle(bridge, kernel, feedback))

  return {
    coordinator,
    kernel,
    feedback,
    bridge,
    doc,
    xlsxRoot,
    captureDom(resource, text): void {
      doc.selection = {
        resource,
        text,
        location: { kind: 'lines', start: 1, end: 1 },
      } as unknown as Selection
      doc.rects = [rect(10)]
      doc.fire('selectionchange')
      doc.runFrames()
    },
    captureXlsx(address): void {
      const owner = bridge.createOwner(address, xlsxRoot)
      owner.publish({
        resourceAddress: address,
        root: xlsxRoot,
        sheet: 'Sheet1',
        range: 'A1:B2',
        values: [
          ['a', 'b'],
          ['c', 'd'],
        ],
        cellCount: 4,
        rect: null,
      })
    },
  }
}

beforeEach(() => {
  document.body.replaceChildren()
  document.head.replaceChildren()
})

describe('resource-scoped invalidation', () => {
  it('clears the snapshot of the resource that was invalidated', () => {
    const fixture = harness()
    fixture.captureDom(RESOURCE_A, 'alpha')

    fixture.coordinator.invalidateResource(RESOURCE_A)

    expect(fixture.kernel.getSnapshot()).toBeNull()
  })

  it('clears a pending notice together with the snapshot it described', () => {
    const fixture = harness()
    fixture.captureDom(RESOURCE_A, 'alpha')
    fixture.feedback.report('too-large')

    fixture.coordinator.invalidateResource(RESOURCE_A)

    expect(fixture.kernel.getSnapshot()).toBeNull()
    expect(fixture.feedback.getSnapshot()).toBeNull()
  })

  it('does nothing when the snapshot belongs to another resource', () => {
    const fixture = harness()
    fixture.captureDom(RESOURCE_A, 'alpha')

    fixture.coordinator.invalidateResource(RESOURCE_B)

    expect(fixture.kernel.getSnapshot()?.text).toBe('alpha')
  })

  it('does nothing when no snapshot is live', () => {
    const fixture = harness()

    expect(() => {
      fixture.coordinator.invalidateResource(RESOURCE_A)
    }).not.toThrow()
    expect(fixture.kernel.getSnapshot()).toBeNull()
  })

  it('keeps B when the cleanup of A arrives late', () => {
    const fixture = harness()
    fixture.captureDom(RESOURCE_A, 'alpha')
    fixture.captureDom(RESOURCE_B, 'beta')
    const snapshotB = fixture.kernel.getSnapshot()
    expect(snapshotB?.resourceAddress).toBe(RESOURCE_B)

    // A renderer for A that unmounts after the reader moved to B.
    fixture.coordinator.invalidateResource(RESOURCE_A)

    expect(fixture.kernel.getSnapshot()).toBe(snapshotB)
    expect(fixture.kernel.getSnapshot()?.resourceAddress).toBe(RESOURCE_B)
    expect(fixture.kernel.getSnapshot()?.text).toBe('beta')
  })
})

describe('semantic selection ownership', () => {
  it('captures an XLSX range through the bridge', () => {
    const fixture = harness()

    fixture.captureXlsx(RESOURCE_XLSX)

    expect(fixture.kernel.getSnapshot()?.resourceAddress).toBe(RESOURCE_XLSX)
    expect(fixture.kernel.getSnapshot()?.location).toEqual({
      kind: 'cells',
      sheet: 'Sheet1',
      range: 'A1:B2',
    })
  })

  it('invalidates a semantic snapshot by its own resource address', () => {
    const fixture = harness()
    fixture.captureXlsx(RESOURCE_XLSX)

    fixture.coordinator.invalidateResource(RESOURCE_XLSX)

    expect(fixture.kernel.getSnapshot()).toBeNull()
  })

  it('keeps a DOM snapshot when an unrelated resource is invalidated', () => {
    const fixture = harness()
    fixture.captureDom(RESOURCE_A, 'alpha')
    fixture.captureXlsx(RESOURCE_XLSX)
    fixture.captureDom(RESOURCE_A, 'alpha again')

    fixture.coordinator.invalidateResource(RESOURCE_XLSX)

    expect(fixture.kernel.getSnapshot()?.resourceAddress).toBe(RESOURCE_A)
    expect(fixture.kernel.getSnapshot()?.text).toBe('alpha again')
  })

  it('clears the semantic snapshot when the owner of the newer workbook is disposed', () => {
    const fixture = harness()
    const older = fixture.bridge.createOwner(RESOURCE_XLSX, fixture.xlsxRoot)
    const newer = fixture.bridge.createOwner(RESOURCE_XLSX, fixture.xlsxRoot)
    newer.publish({
      resourceAddress: RESOURCE_XLSX,
      root: fixture.xlsxRoot,
      sheet: 'Sheet1',
      range: 'A1:B2',
      values: [
        ['a', 'b'],
        ['c', 'd'],
      ],
      cellCount: 4,
      rect: null,
    })
    expect(fixture.kernel.getSnapshot()).not.toBeNull()

    // The older workbook's owner cannot clear a range the newer one published.
    older.dispose()
    expect(fixture.kernel.getSnapshot()).not.toBeNull()

    newer.dispose()
    expect(fixture.kernel.getSnapshot()).toBeNull()
  })
})

describe('Escape', () => {
  it('clears a DOM snapshot', () => {
    const fixture = harness()
    fixture.captureDom(RESOURCE_A, 'alpha')

    fixture.doc.fire('keydown', { key: 'Escape' })

    expect(fixture.kernel.getSnapshot()).toBeNull()
  })

  it('clears a semantic XLSX snapshot through the shared kernel', () => {
    const fixture = harness()
    fixture.captureXlsx(RESOURCE_XLSX)

    fixture.doc.fire('keydown', { key: 'Escape' })

    expect(fixture.kernel.getSnapshot()).toBeNull()
  })

  it('clears the rejection notice', () => {
    const fixture = harness()
    fixture.feedback.report('too-large')

    fixture.doc.fire('keydown', { key: 'Escape' })

    expect(fixture.feedback.getSnapshot()).toBeNull()
  })

  it('cancels a capture scheduled by the same keypress', () => {
    const fixture = harness()
    fixture.doc.selection = {
      resource: RESOURCE_A,
      text: 'alpha',
      location: { kind: 'lines', start: 1, end: 1 },
    } as unknown as Selection
    fixture.doc.fire('selectionchange')
    expect(fixture.doc.pendingFrames()).toBe(1)

    fixture.doc.fire('keydown', { key: 'Escape' })
    fixture.doc.runFrames()

    expect(fixture.kernel.getSnapshot()).toBeNull()
  })

  it('leaves the reader’s own browser selection alone', () => {
    const fixture = harness()
    const live = { resource: RESOURCE_A, text: 'alpha' } as unknown as Selection
    fixture.doc.selection = live

    fixture.doc.fire('keydown', { key: 'Escape' })

    // Nothing here calls `removeAllRanges`: the plugin clears its own snapshot,
    // never the selection the reader made in the document.
    expect(fixture.doc.selection).toBe(live)
  })
})

describe('scroll', () => {
  it('recaptures a live selection and updates its geometry', () => {
    const fixture = harness()
    fixture.captureDom(RESOURCE_A, 'alpha')
    const before = fixture.kernel.getSnapshot()
    expect(before?.rects[0]?.top).toBe(10)

    fixture.doc.rects = [rect(240)]
    fixture.doc.fire('scroll')
    fixture.doc.runFrames()

    const after = fixture.kernel.getSnapshot()
    expect(after).not.toBeNull()
    expect(after?.text).toBe(before?.text)
    expect(after?.resourceAddress).toBe(before?.resourceAddress)
    expect(after?.location).toEqual(before?.location)
    expect(after?.rects[0]?.top).toBe(240)
  })

  it('recaptures on resize as well', () => {
    const fixture = harness()
    fixture.captureDom(RESOURCE_A, 'alpha')

    fixture.doc.rects = [rect(320)]
    fixture.doc.fireOnWindow('resize')
    fixture.doc.runFrames()

    expect(fixture.kernel.getSnapshot()?.rects[0]?.top).toBe(320)
  })

  it('clears when the selection did not survive the scroll', () => {
    const fixture = harness()
    fixture.captureDom(RESOURCE_A, 'alpha')

    // A virtualized renderer that recycled the selected rows: the endpoints are
    // gone, so the browser reports no selection at all.
    fixture.doc.selection = null
    fixture.doc.fire('scroll')
    fixture.doc.runFrames()

    expect(fixture.kernel.getSnapshot()).toBeNull()
  })
})

describe('dispose', () => {
  it('cancels a pending capture frame', () => {
    const fixture = harness()
    fixture.doc.selection = { resource: RESOURCE_A, text: 'alpha' } as unknown as Selection
    fixture.doc.fire('selectionchange')
    expect(fixture.doc.pendingFrames()).toBe(1)

    fixture.coordinator.dispose()
    fixture.doc.runFrames()

    expect(fixture.kernel.getSnapshot()).toBeNull()
  })

  it('removes every listener it installed', () => {
    const fixture = harness()
    expect(fixture.doc.documentListeners('selectionchange')).toBe(1)
    expect(fixture.doc.windowListeners('resize')).toBe(1)

    fixture.coordinator.dispose()

    expect(fixture.doc.documentListeners('selectionchange')).toBe(0)
    expect(fixture.doc.documentListeners('scroll')).toBe(0)
    expect(fixture.doc.documentListeners('keydown')).toBe(0)
    expect(fixture.doc.windowListeners('resize')).toBe(0)
  })

  it('clears the snapshot and the notice', () => {
    const fixture = harness()
    fixture.captureDom(RESOURCE_A, 'alpha')
    fixture.feedback.report('too-large')

    fixture.coordinator.dispose()

    expect(fixture.kernel.getSnapshot()).toBeNull()
    expect(fixture.feedback.getSnapshot()).toBeNull()
  })

  it('ignores a bridge publish that arrives after it', () => {
    const fixture = harness()
    fixture.coordinator.dispose()

    fixture.captureXlsx(RESOURCE_XLSX)

    expect(fixture.kernel.getSnapshot()).toBeNull()
  })

  it('ignores a resource callback that arrives after it', () => {
    const fixture = harness()
    fixture.captureDom(RESOURCE_A, 'alpha')
    fixture.coordinator.dispose()

    fixture.coordinator.invalidateResource(RESOURCE_A)

    expect(fixture.kernel.getSnapshot()).toBeNull()
  })

  it('is idempotent and releases a late child at once', () => {
    const fixture = harness()
    const calls: string[] = []

    fixture.coordinator.dispose()
    fixture.coordinator.dispose()
    fixture.coordinator.own(() => {
      calls.push('late')
    })

    expect(calls).toEqual(['late'])
  })

  it('releases every child even when one of them throws', () => {
    const fixture = harness()
    const released: string[] = []
    fixture.coordinator.own(() => {
      released.push('first')
      throw new Error('injected cleanup failure')
    })
    fixture.coordinator.own(() => {
      released.push('second')
    })

    expect(() => {
      fixture.coordinator.dispose()
    }).toThrow('injected cleanup failure')

    expect(released).toEqual(['first', 'second'])
    expect(fixture.doc.documentListeners('selectionchange')).toBe(0)
  })
})

/** The four renderer bodies, with the inject face each one publishes. */
interface BodyCase {
  readonly name: string
  readonly mount: (
    props: DocumentPreviewProps,
    inject: { onResourceInvalidated?: (resourceAddress: string) => void },
  ) => JSX.Element
}

const BODIES: readonly BodyCase[] = [
  {
    name: 'DOCX',
    mount: (props, inject) =>
      createElement(DocxBody, { ...props, ...(inject as DocxRendererInjectFace) }),
  },
  {
    name: 'PPTX',
    mount: (props, inject) =>
      createElement(PptxBody, { ...props, ...(inject as PptxRendererInjectFace) }),
  },
  {
    name: 'PDF',
    mount: (props, inject) =>
      createElement(SelectablePdfBody, { ...props, ...(inject as PdfRendererInjectFace) }),
  },
  {
    name: 'XLSX',
    mount: (props, inject) =>
      createElement(XlsxBody, {
        ...props,
        ...(inject as { onResourceInvalidated?: (resourceAddress: string) => void }),
        bridge: createXlsxSelectionBridge(),
      } as unknown as XlsxBodyProps),
  },
]

/**
 * Build the standard document props one body receives.
 *
 * `content` is deliberately not a byte array: every body then renders its status
 * branch, so the case is about the lifetime notification rather than about an
 * engine the renderer tasks already cover.
 *
 * @param address - the resource address the body is showing.
 * @param signal - the owning tab's lifetime.
 * @returns the props.
 */
function bodyProps(address: string, signal: AbortSignal): DocumentPreviewProps {
  return {
    resourceAddress: address,
    content: { kind: 'text', text: '', pages: [], eof: true },
    wrap: false,
    scrollportRef: () => undefined,
    useTabInfo: () => ({ tab: { signal } }),
  } as unknown as DocumentPreviewProps
}

/** A mounted body with a re-render and unmount surface. */
interface BodyTree {
  /** Render the body again with a different resource address. */
  rerender(address: string): void
  /** Unmount and detach. */
  unmount(): void
}

/**
 * Mount one body.
 * @param body - the body case to mount.
 * @param address - the resource address it starts on.
 * @param signal - the owning tab's lifetime.
 * @param onResourceInvalidated - the callback every invalidated address is recorded in.
 * @returns the tree.
 */
function mountBody(
  body: BodyCase,
  address: string,
  signal: AbortSignal,
  onResourceInvalidated: (resourceAddress: string) => void,
): BodyTree {
  const container = document.createElement('div')
  document.body.append(container)
  let root: Root | null = null
  act(() => {
    root = createRoot(container)
    root.render(body.mount(bodyProps(address, signal), { onResourceInvalidated }))
  })

  return {
    rerender(next: string): void {
      act(() => {
        root?.render(body.mount(bodyProps(next, signal), { onResourceInvalidated }))
      })
    },
    unmount(): void {
      const mounted = root
      root = null
      if (mounted !== null) {
        act(() => {
          mounted.unmount()
        })
      }
      container.remove()
    },
  }
}

describe('renderer resource invalidation', () => {
  it.each(BODIES.map((body) => [body.name, body] as const))(
    '%s notifies the coordinator when its resource is invalidated on unmount',
    (_name, body) => {
      const signal = new AbortController().signal
      const invalidated: string[] = []
      const tree = mountBody(body, RESOURCE_A, signal, (address) => invalidated.push(address))

      tree.unmount()

      expect(invalidated).toEqual([RESOURCE_A])
    },
  )

  it.each(BODIES.map((body) => [body.name, body] as const))(
    '%s notifies the coordinator when its tab is aborted',
    (_name, body) => {
      const controller = new AbortController()
      const invalidated: string[] = []
      const tree = mountBody(body, RESOURCE_A, controller.signal, (address) => invalidated.push(address))

      act(() => {
        controller.abort()
      })

      expect(invalidated).toEqual([RESOURCE_A])
      tree.unmount()
    },
  )

  it.each(BODIES.map((body) => [body.name, body] as const))(
    '%s invalidates the resource it leaves when the body switches to another',
    (_name, body) => {
      const signal = new AbortController().signal
      const invalidated: string[] = []
      const tree = mountBody(body, RESOURCE_A, signal, (address) => invalidated.push(address))

      tree.rerender(RESOURCE_B)
      tree.unmount()

      expect(invalidated).toEqual([RESOURCE_A, RESOURCE_B])
    },
  )

  it('does not clear a newer snapshot when an old renderer is unmounted late', () => {
    const fixture = harness()
    const docxBody = BODIES[0]
    if (docxBody === undefined) throw new Error('the body table must not be empty')
    const signal = new AbortController().signal
    const tree = mountBody(docxBody, RESOURCE_A, signal, (address) => {
      fixture.coordinator.invalidateResource(address)
    })

    fixture.captureDom(RESOURCE_B, 'beta')
    const snapshotB = fixture.kernel.getSnapshot()

    // The reader moved to B; A's renderer only now goes away.
    tree.unmount()
    fixture.captureDom(RESOURCE_B, 'beta again')

    expect(fixture.kernel.getSnapshot()).not.toBeNull()
    expect(fixture.kernel.getSnapshot()?.resourceAddress).toBe(RESOURCE_B)
    expect(fixture.kernel.getSnapshot()).not.toBe(snapshotB)
    expect(fixture.kernel.getSnapshot()?.text).toBe('beta again')
  })
})

describe('the browser selection reader stays unique', () => {
  it('reads the browser selection in exactly one production module', () => {
    // The auxiliary source gate for the boundary this whole file rests on: the
    // coordinator, the renderers and the Ask surface all act on snapshots, never
    // on the live browser selection. A `getSelection()` call added to any of them
    // would make the lifetime rules above unenforceable — a late cleanup could
    // then re-read a selection that belongs to another document.
    //
    // The XLSX bridge's own `getSelection()` is the semantic accessor, not the
    // browser API, so calls on that object are excluded by name.
    const files: string[] = []
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.tsx?$/u.test(entry.name)) files.push(path)
      }
    }
    walk(join(process.cwd(), 'src', 'client'))

    const readers = files.filter((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/u.test(line))
        .some((line) => line.includes('.getSelection()') && !line.includes('bridge.getSelection()')),
    )

    expect(files.length).toBeGreaterThan(10)
    expect(readers.map((path) => path.replaceAll('\\', '/').split('/src/client/')[1])).toEqual([
      'selection/browser-lifecycle.ts',
    ])
  })
})

describe('renderer inject faces', () => {  /**
   * Register one renderer against a fake host and read back the inject face its
   * registered body would receive.
   *
   * The faces are what the mounted bodies actually get, so a callback that only
   * existed as a type — or that one renderer forgot to forward — is caught here
   * rather than in a browser.
   *
   * @param register - the renderer registration under test.
   * @param inject - the callbacks the runtime would hand it.
   * @returns the face the registered body is injected with.
   */
  function registeredFace(
    register: (host: never, inject: never) => unknown,
    inject: Record<string, unknown>,
  ): Record<string, unknown> {
    const faces: Record<string, unknown>[] = []
    const host = {
      previews: { register: () => () => undefined },
      slots: {
        inject: (_slot: string, callback: () => () => void): (() => void) => callback(),
        register: (options: { inject?: () => Record<string, unknown> }): (() => void) => {
          faces.push(options.inject?.() ?? {})
          return () => undefined
        },
      },
      document: undefined,
    }

    register(host as never, inject as never)

    const face = faces[0]
    if (face === undefined) throw new Error('the renderer must register exactly one body')
    return face
  }

  it('forwards the invalidation callback to all four bodies', () => {
    const invalidated: string[] = []
    const inject = { onResourceInvalidated: (address: string) => invalidated.push(address) }

    for (const register of [registerXlsxRenderer, registerPdfRenderer, registerDocxRenderer, registerPptxRenderer]) {
      const face = registeredFace(
        register as never,
        register === (registerXlsxRenderer as never)
          ? { bridge: createXlsxSelectionBridge(), ...inject }
          : inject,
      )
      const callback = face['onResourceInvalidated'] as ((address: string) => void) | undefined
      callback?.(RESOURCE_A)
    }

    expect(invalidated).toEqual([RESOURCE_A, RESOURCE_A, RESOURCE_A, RESOURCE_A])
  })

  it('hands a body it was given no callback an empty face', () => {
    expect(registeredFace(registerDocxRenderer as never, {})).toEqual({})
  })
})
