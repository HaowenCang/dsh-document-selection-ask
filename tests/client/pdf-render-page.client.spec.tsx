// @vitest-environment jsdom
/**
 * The per-render abort listener's lifecycle in `render-page.ts`.
 *
 * A page render registers one listener on the lifetime it is handed — the tab's
 * signal, which outlives every page, every resize re-render and every page that
 * scrolls back out of the lazy range. Registering on a long-lived signal is the
 * point of the design and also its hazard: `{ once: true }` releases the listener
 * only when the signal eventually aborts, so a render that has already finished
 * still holds the operation's closure — the page proxy, the render task, the text
 * render — until the tab closes. Twenty resize re-renders would leave twenty
 * finished closures on the tab signal, which is a retention defect rather than a
 * tidiness one.
 *
 * Two listeners are attached to that signal per render, and they are counted
 * separately here. The text layer registers its own and has always released it
 * when the layer settles (`text-layer.ts`); the outer one `render-page.ts`
 * registers is what this spec is about. Both are named `onAbort`, so they are
 * told apart by identity — the outer one is the listener present the moment
 * `renderPdfPage` returns, because it attaches before its first `await`.
 *
 * ```text
 * outer page-render listener:  registered in renderPdfPage, argued here
 * TextLayer's own listener:    registered in renderTextLayer, out of scope
 * ```
 *
 * The signal is an ordinary `AbortController`'s. No `abort()` is called in the
 * accumulation cases: the defect is a listener that is still attached before any
 * abort happens, and an abort followed by "everything went away" would report the
 * platform's `{ once: true }` rather than this module's release.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { renderPdfPage } from '../../src/client/renderers/pdf/render-page.js'
import type { PdfPageRender } from '../../src/client/renderers/pdf/render-page.js'
import { FakePage, addPage, control } from './helpers/pdfjs-mock.js'

/** The `Worker` constructor the PDF runtime is stubbed with. */
let workerConstructor: ReturnType<typeof vi.fn>

/** The `URL.createObjectURL` this environment is restored to. */
const originalCreateObjectURL = URL.createObjectURL
/** The `URL.revokeObjectURL` this environment is restored to. */
const originalRevokeObjectURL = URL.revokeObjectURL

beforeEach(() => {
  control.reset()

  // `renderPdfPage` does not build a worker; the runtime does. The stub is
  // installed anyway, so no case here can reach the platform's real `Worker`.
  workerConstructor = vi.fn()
  Object.assign(URL, {
    createObjectURL: (): string => 'blob:dsa-render-page/0',
    revokeObjectURL: (): void => undefined,
  })
  vi.stubGlobal('Worker', workerConstructor)
})

afterEach(() => {
  vi.unstubAllGlobals()
  Object.assign(URL, {
    createObjectURL: originalCreateObjectURL,
    revokeObjectURL: originalRevokeObjectURL,
  })
})

/** Let every pending microtask run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve()
  }
}

/** The hosts one page render writes into. */
function hosts(): { canvas: HTMLCanvasElement; textLayer: HTMLElement } {
  const canvas = document.createElement('canvas')
  const textLayer = document.createElement('div')
  document.body.append(canvas, textLayer)
  return { canvas, textLayer }
}

/**
 * A loaded document over the stand-in pages this file scripted.
 *
 * `renderPdfPage` reads `getPage` off the document and nothing else.
 *
 * @returns the document to hand the renderer.
 */
function loadedDocument(): PDFDocumentProxy {
  return {
    getPage: async (pageNumber: number): Promise<FakePage> => {
      const script = control.pages[pageNumber - 1]
      if (script === undefined) throw new Error(`No such page: ${String(pageNumber)}`)
      return new FakePage(script)
    },
  } as unknown as PDFDocumentProxy
}

/** Every abort-listener registration and release seen on one signal. */
interface SignalTracker {
  /** Every abort listener registered on the signal, in order. */
  readonly added: (() => void)[]
  /** Every abort listener released from the signal, in order. */
  readonly removed: (() => void)[]
  /** How many registrations have no matching release. */
  live(): number
  /** Whether one particular registration has been released. */
  detached(listener: () => void): boolean
}

/** The tracker each watched signal was given, for `startRender` to read back. */
const trackers = new WeakMap<AbortSignal, SignalTracker>()

/**
 * Record every `abort` listener added to and removed from one signal.
 *
 * @param signal - the signal a page render is handed.
 * @returns the two histories, the outstanding count and the per-listener check.
 */
function trackSignal(signal: AbortSignal): SignalTracker {
  const added: (() => void)[] = []
  const removed: (() => void)[] = []

  vi.spyOn(signal, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void => {
    if (type === 'abort' && typeof listener === 'function') added.push(listener as () => void)
    EventTarget.prototype.addEventListener.call(signal, type, listener, options)
  }) as typeof signal.addEventListener)

  vi.spyOn(signal, 'removeEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void => {
    if (type === 'abort' && typeof listener === 'function') removed.push(listener as () => void)
    EventTarget.prototype.removeEventListener.call(signal, type, listener, options)
  }) as typeof signal.removeEventListener)

  const tracker: SignalTracker = {
    added,
    removed,
    live: (): number => added.length - removed.length,
    detached: (listener: () => void): boolean => removed.includes(listener),
  }
  trackers.set(signal, tracker)
  return tracker
}

/**
 * Start one page render, returning the listener it registered itself.
 *
 * `renderPdfPage` attaches its listener synchronously, before it awaits anything,
 * and the text layer — which attaches a second listener for the same event — is
 * constructed only after `getPage` has resolved. The listener present the moment
 * the call returns is therefore the outer one.
 *
 * @param document - the document to render from.
 * @param signal - the lifetime the render owns.
 * @param elements - the canvas and text-layer elements.
 * @returns the render handle and the outer listener.
 */
function startRender(
  document: PDFDocumentProxy,
  signal: AbortSignal,
  elements: { canvas: HTMLCanvasElement; textLayer: HTMLElement },
): { readonly render: PdfPageRender; readonly outer: () => void } {
  const render = renderPdfPage(document, 1, elements, 816, 1, signal)
  const outer = trackers.get(signal)?.added.at(-1)
  if (outer === undefined) throw new Error('renderPdfPage registered no abort listener')
  return { render, outer }
}

/**
 * Assert that the page's two renders actually started.
 *
 * A settlement assertion about a render that never began would pass for the wrong
 * reason, so each case below states that the raster task and the text read existed
 * first.
 *
 * @param pageNumber - the page under test.
 */
function expectRendersStarted(pageNumber: number): void {
  const script = control.pages[pageNumber - 1]
  expect(script?.tasks).toHaveLength(1)
  expect(script?.renders).toHaveLength(1)
}

describe('the per-render abort listener', () => {
  it('detaches the outer listener when the render completes', async () => {
    addPage(['Alpha', 'Beta'])
    const controller = new AbortController()
    const tracker = trackSignal(controller.signal)
    const elements = hosts()

    const { render, outer } = startRender(loadedDocument(), controller.signal, elements)
    // The page proxy has not resolved yet, so this is the outer listener alone.
    expect(tracker.added).toEqual([outer])
    await render.done

    // The render really happened, so the release below is the release of a
    // listener that a completed operation had attached.
    expect(elements.textLayer.querySelectorAll('span')).toHaveLength(2)
    expectRendersStarted(1)
    expect(tracker.detached(outer)).toBe(true)
    // The text layer's own listener came off in the same settlement, and the tab
    // signal is still live: nothing here was released by aborting it.
    expect(tracker.live()).toBe(0)
    expect(controller.signal.aborted).toBe(false)
    expect(control.pages[0]?.cleanups).toBe(1)
  })

  it('detaches the outer listener when the raster fails', async () => {
    addPage(['Alpha'], { renderError: new Error('raster failed') })
    const controller = new AbortController()
    const tracker = trackSignal(controller.signal)

    const { render, outer } = startRender(loadedDocument(), controller.signal, hosts())

    await expect(render.done).rejects.toThrowError('raster failed')
    expectRendersStarted(1)
    expect(tracker.detached(outer)).toBe(true)
    expect(tracker.live()).toBe(0)
    expect(control.pages[0]?.cleanups).toBe(1)
  })

  it('detaches the outer listener when the text layout fails', async () => {
    addPage(['Alpha'], { textError: new Error('text layout failed') })
    const controller = new AbortController()
    const tracker = trackSignal(controller.signal)

    const { render, outer } = startRender(loadedDocument(), controller.signal, hosts())

    await expect(render.done).rejects.toThrowError('text layout failed')
    // The raster had already drawn and is not cancelled by a text failure; the
    // listener release is independent of which of the two paths failed.
    expectRendersStarted(1)
    expect(control.pages[0]?.tasks[0]?.cancelled).toBe(false)
    expect(tracker.detached(outer)).toBe(true)
    expect(tracker.live()).toBe(0)
    expect(control.pages[0]?.cleanups).toBe(1)
  })

  it('detaches the outer listener on an explicit cancel, before the promise settles', async () => {
    addPage(['Alpha'], { holdRender: true })
    const controller = new AbortController()
    const tracker = trackSignal(controller.signal)

    const { render, outer } = startRender(loadedDocument(), controller.signal, hosts())
    await settle()
    expectRendersStarted(1)

    render.cancel()

    // Promptness is the assertion: the operation is no longer reachable from the
    // tab signal the moment `cancel()` returns, while `done` is still pending.
    expect(tracker.detached(outer)).toBe(true)
    expect(tracker.live()).toBe(0)
    expect(control.pages[0]?.tasks[0]?.cancelled).toBe(true)
    expect(control.pages[0]?.textCancelled).toBe(true)
    expect(controller.signal.aborted).toBe(false)

    control.releaseRender()
    await render.done

    expect(control.pages[0]?.cleanups).toBe(1)
    expect(control.pages[0]?.cleanedUpWhileRendering).toBe(false)
  })

  it('detaches the outer listener when the tab signal aborts', async () => {
    addPage(['Alpha'], { holdRender: true })
    const controller = new AbortController()
    const tracker = trackSignal(controller.signal)

    const { render, outer } = startRender(loadedDocument(), controller.signal, hosts())
    await settle()
    expectRendersStarted(1)

    controller.abort()
    control.releaseRender()
    await render.done

    expect(tracker.detached(outer)).toBe(true)
    expect(tracker.live()).toBe(0)
    expect(control.pages[0]?.tasks[0]?.cancelled).toBe(true)
    expect(control.pages[0]?.textCancelled).toBe(true)
    expect(control.pages[0]?.cleanups).toBe(1)
  })

  it('never attaches a listener to a signal that has already aborted', async () => {
    addPage(['Alpha'])
    const controller = new AbortController()
    controller.abort()
    const tracker = trackSignal(controller.signal)

    const render = renderPdfPage(loadedDocument(), 1, hosts(), 816, 1, controller.signal)
    expect(() => {
      render.cancel()
    }).not.toThrow()
    await render.done

    expect(tracker.added).toHaveLength(0)
    expect(tracker.removed).toHaveLength(0)
    expect(control.pages[0]?.cleanups).toBe(1)
  })

  it('releases every finished listener across twenty renders on one tab signal', async () => {
    addPage(['Alpha'])
    const controller = new AbortController()
    const tracker = trackSignal(controller.signal)
    const document_ = loadedDocument()

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { render, outer } = startRender(document_, controller.signal, hosts())
      await render.done
      // Two registrations per render — the outer one and the text layer's — and
      // two releases, asserted while the signal is still live: twenty renders
      // must not leave twenty finished closures attached to it.
      expect(tracker.detached(outer)).toBe(true)
      expect(tracker.added).toHaveLength((attempt + 1) * 2)
      expect(tracker.removed).toHaveLength((attempt + 1) * 2)
      expect(tracker.live()).toBe(0)
    }

    expect(controller.signal.aborted).toBe(false)
    // Each render owned its own page object and released it exactly once.
    expect(control.pages[0]?.cleanups).toBe(20)
    expect(control.pages[0]?.cleanedUpWhileRendering).toBe(false)
  })

  describe('selectable DOM invalidation callback contract', () => {
    it('notifies synchronously when replacing a populated text layer', async () => {
      addPage(['Alpha'])
      const signal = new AbortController().signal
      const h = hosts()
      const span = document.createElement('span')
      span.textContent = 'old generation'
      h.textLayer.appendChild(span)

      const onSelectableDomInvalidated = vi.fn()
      const render = renderPdfPage(loadedDocument(), 1, h, 816, 1, signal, {
        onSelectableDomInvalidated,
      })

      expect(h.textLayer.childNodes.length).toBe(0)
      expect(onSelectableDomInvalidated).toHaveBeenCalledTimes(1)

      await render.done
    })

    it('does not notify when initial text layer is empty', async () => {
      addPage(['Alpha'])
      const signal = new AbortController().signal
      const h = hosts()
      expect(h.textLayer.childNodes.length).toBe(0)

      const onSelectableDomInvalidated = vi.fn()
      const render = renderPdfPage(loadedDocument(), 1, h, 816, 1, signal, {
        onSelectableDomInvalidated,
      })

      expect(onSelectableDomInvalidated).toHaveBeenCalledTimes(0)
      await render.done
    })

    it('notifies exactly once on second generation when layer was populated by first generation', async () => {
      addPage(['Alpha'])
      const signal = new AbortController().signal
      const h = hosts()
      const doc = loadedDocument()

      const onFirst = vi.fn()
      const first = renderPdfPage(doc, 1, h, 816, 1, signal, {
        onSelectableDomInvalidated: onFirst,
      })
      expect(onFirst).toHaveBeenCalledTimes(0)
      await first.done

      expect(h.textLayer.childNodes.length).toBeGreaterThan(0)

      const onSecond = vi.fn()
      const second = renderPdfPage(doc, 1, h, 816, 1, signal, {
        onSelectableDomInvalidated: onSecond,
      })
      expect(onSecond).toHaveBeenCalledTimes(1)
      await second.done
    })

    it('does not notify for empty or image-only layer across generations', async () => {
      addPage([])
      const signal = new AbortController().signal
      const h = hosts()
      const doc = loadedDocument()

      const onFirst = vi.fn()
      const first = renderPdfPage(doc, 1, h, 816, 1, signal, {
        onSelectableDomInvalidated: onFirst,
      })
      expect(onFirst).toHaveBeenCalledTimes(0)
      await first.done

      expect(h.textLayer.childNodes.length).toBe(0)

      const onSecond = vi.fn()
      const second = renderPdfPage(doc, 1, h, 816, 1, signal, {
        onSelectableDomInvalidated: onSecond,
      })
      expect(onSecond).toHaveBeenCalledTimes(0)
      await second.done
    })

    it('swallows errors thrown by onSelectableDomInvalidated without failing render', async () => {
      addPage(['Alpha'])
      const signal = new AbortController().signal
      const h = hosts()
      const span = document.createElement('span')
      span.textContent = 'old generation'
      h.textLayer.appendChild(span)

      const throwingCallback = vi.fn(() => {
        throw new Error('lifecycle failure')
      })
      const render = renderPdfPage(loadedDocument(), 1, h, 816, 1, signal, {
        onSelectableDomInvalidated: throwingCallback,
      })

      expect(throwingCallback).toHaveBeenCalledTimes(1)
      await expect(render.done).resolves.toBeUndefined()
    })
  })
})
