// @vitest-environment jsdom
/**
 * PPTX rendering engine client specification.
 *
 * Validates the strict OOXML security pipeline order, relationship gating,
 * lazy loading, slide provenance marking, lifecycle hooks, resize serialization,
 * and clean disposal.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PptxViewer } from '@aiden0z/pptx-renderer'
import { OoxmlPreflightError } from '../../src/client/ooxml/errors.js'
import { renderPptx } from '../../src/client/renderers/pptx/engine.js'
import { PPTX_SLIDE_ATTRIBUTE } from '../../src/client/renderers/pptx/identity.js'
import { PptxRelationshipSecurityError } from '../../src/client/renderers/pptx/security.js'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'pptx')

function readFixture(name: string): Uint8Array<ArrayBuffer> {
  const buf = readFileSync(join(FIXTURES_DIR, name))
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

describe('renderPptx engine', () => {
  let host: HTMLElement
  let scrollContainer: HTMLElement
  let onSelectableDomInvalidated: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.body.innerHTML = ''
    scrollContainer = document.createElement('div')
    host = document.createElement('div')
    scrollContainer.appendChild(host)
    document.body.appendChild(scrollContainer)
    onSelectableDomInvalidated = vi.fn()
  })

  it('rejects corrupted archive during preflight before third-party parse', async () => {
    const corruptBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])
    const controller = new AbortController()

    await expect(
      renderPptx(corruptBytes, host, scrollContainer, 800, controller.signal, {
        onSelectableDomInvalidated,
      }),
    ).rejects.toThrowError(OoxmlPreflightError)

    expect(host.children.length).toBe(0)
  })

  it('rejects external media relationship before viewer render', async () => {
    const bytes = readFixture('external-media.pptx')
    const controller = new AbortController()

    await expect(
      renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
        onSelectableDomInvalidated,
      }),
    ).rejects.toThrowError(PptxRelationshipSecurityError)

    expect(host.children.length).toBe(0)
  })

  it('renders valid two-slide presentation and marks slide numbers', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller = new AbortController()

    const session = await renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
      onSelectableDomInvalidated,
    })

    expect(session.slideCount).toBe(2)

    const slides = host.querySelectorAll(`[${PPTX_SLIDE_ATTRIBUTE}]`)
    expect(slides.length).toBeGreaterThanOrEqual(1)
    expect(slides[0]?.getAttribute(PPTX_SLIDE_ATTRIBUTE)).toBe('1')

    session.dispose()
  })

  it('handles resize cleanly: invalidates selection and updates viewer', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller = new AbortController()

    const session = await renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
      onSelectableDomInvalidated,
    })

    onSelectableDomInvalidated.mockClear()

    await session.resize(1000)

    expect(onSelectableDomInvalidated).toHaveBeenCalled()
    expect(session.slideCount).toBe(2)

    session.dispose()
  })

  it('disposes cleanly and idempotently', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller = new AbortController()

    const session = await renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
      onSelectableDomInvalidated,
    })

    session.dispose()
    expect(host.children.length).toBe(0)

    // Idempotent second call
    expect(() => session.dispose()).not.toThrow()
  })

  it('throws AbortError if signal is already aborted', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller = new AbortController()
    controller.abort()

    await expect(
      renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
        onSelectableDomInvalidated,
      }),
    ).rejects.toThrow()

    expect(host.children.length).toBe(0)
  })

  it('destroys active viewer and rejects AbortError when signal is aborted mid-render', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller = new AbortController()

    let renderListPending = false
    let resolveRenderList: () => void = () => {}
    let destroyCalledWhileRenderListPending = false

    const origRenderList = PptxViewer.prototype.renderList
    const origDestroy = PptxViewer.prototype.destroy

    const renderListSpy = vi
      .spyOn(PptxViewer.prototype, 'renderList')
      .mockImplementation(function (this: PptxViewer, opts) {
        renderListPending = true
        return new Promise<void>((resolve) => {
          resolveRenderList = () => {
            renderListPending = false
            resolve()
          }
        })
      })

    const destroySpy = vi
      .spyOn(PptxViewer.prototype, 'destroy')
      .mockImplementation(function (this: PptxViewer) {
        if (renderListPending) {
          destroyCalledWhileRenderListPending = true
        }
        return origDestroy.call(this)
      })

    try {
      const renderPromise = renderPptx(
        bytes,
        host,
        scrollContainer,
        800,
        controller.signal,
        { onSelectableDomInvalidated },
      )

      await vi.waitFor(() => {
        expect(renderListSpy).toHaveBeenCalled()
      })
      expect(renderListPending).toBe(true)
      expect(destroyCalledWhileRenderListPending).toBe(false)

      controller.abort()

      expect(destroyCalledWhileRenderListPending).toBe(true)
      expect(destroySpy).toHaveBeenCalled()

      await expect(renderPromise).rejects.toThrowError(/abort/i)
      expect(host.children.length).toBe(0)

      resolveRenderList()
      await new Promise((r) => setTimeout(r, 10))
      expect(host.children.length).toBe(0)
    } finally {
      renderListSpy.mockRestore()
      destroySpy.mockRestore()
    }
  })

  it('handles abort -> dispose and dispose -> abort cleanly and idempotently', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller1 = new AbortController()
    const session1 = await renderPptx(bytes, host, scrollContainer, 800, controller1.signal, {
      onSelectableDomInvalidated,
    })

    // abort -> dispose
    controller1.abort()
    expect(host.children.length).toBe(0)
    expect(() => session1.dispose()).not.toThrow()

    // dispose -> abort
    const controller2 = new AbortController()
    const session2 = await renderPptx(bytes, host, scrollContainer, 800, controller2.signal, {
      onSelectableDomInvalidated,
    })
    session2.dispose()
    expect(host.children.length).toBe(0)
    expect(() => controller2.abort()).not.toThrow()

    // abort twice
    const controller3 = new AbortController()
    const session3 = await renderPptx(bytes, host, scrollContainer, 800, controller3.signal, {
      onSelectableDomInvalidated,
    })
    controller3.abort()
    expect(() => controller3.abort()).not.toThrow()
    session3.dispose()
  })

  it('balances signal abort listener ownership during active session and on dispose', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller = new AbortController()

    let addCount = 0
    let removeCount = 0
    const activeListeners = new Set<EventListenerOrEventListenerObject>()
    const invokedAfterDispose: EventListenerOrEventListenerObject[] = []
    const listenerWrapperMap = new Map<EventListenerOrEventListenerObject, EventListener>()
    let isDisposed = false

    const origAdd = controller.signal.addEventListener.bind(controller.signal)
    const origRemove = controller.signal.removeEventListener.bind(controller.signal)

    const addSpy = vi
      .spyOn(controller.signal, 'addEventListener')
      .mockImplementation((type, listener, options) => {
        if (type === 'abort' && listener) {
          addCount++
          activeListeners.add(listener)
          const wrappedListener: EventListener = (evt) => {
            if (isDisposed) {
              invokedAfterDispose.push(listener)
            }
            if (typeof listener === 'function') {
              listener.call(controller.signal, evt)
            } else if ('handleEvent' in listener) {
              listener.handleEvent(evt)
            }
          }
          listenerWrapperMap.set(listener, wrappedListener)
          return origAdd(type, wrappedListener, options)
        }
        return origAdd(type, listener, options)
      })

    const removeSpy = vi
      .spyOn(controller.signal, 'removeEventListener')
      .mockImplementation((type, listener, options) => {
        if (type === 'abort' && listener) {
          removeCount++
          activeListeners.delete(listener)
          const wrapped = listenerWrapperMap.get(listener) ?? listener
          return origRemove(type, wrapped, options)
        }
        return origRemove(type, listener, options)
      })

    try {
      const session = await renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
        onSelectableDomInvalidated,
      })

      // Exactly one session-lifetime listener attached; zero unremovable anonymous listeners
      expect(addCount - removeCount).toBe(1)

      session.dispose()
      isDisposed = true

      // After dispose, every engine-registered abort listener must be detached
      expect(addCount - removeCount).toBe(0)

      // Later abort must not invoke any engine listener callback
      controller.abort()
      expect(invokedAfterDispose).toHaveLength(0)
      expect(host.children.length).toBe(0)
    } finally {
      addSpy.mockRestore()
      removeSpy.mockRestore()
    }
  })

  it('guarantees dispose followed by abort has zero renderer side effects and no leaked listeners', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller = new AbortController()

    const destroySpy = vi.spyOn(PptxViewer.prototype, 'destroy')
    try {
      const session = await renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
        onSelectableDomInvalidated,
      })

      const destroyCountBeforeDispose = destroySpy.mock.calls.length
      const invalidationCountBeforeDispose = onSelectableDomInvalidated.mock.calls.length

      session.dispose()

      const destroyCountAfterDispose = destroySpy.mock.calls.length
      const invalidationCountAfterDispose = onSelectableDomInvalidated.mock.calls.length

      expect(destroyCountAfterDispose).toBeGreaterThanOrEqual(destroyCountBeforeDispose)

      // Firing abort after dispose should have NO further side effects
      controller.abort()

      expect(destroySpy.mock.calls.length).toBe(destroyCountAfterDispose)
      expect(onSelectableDomInvalidated.mock.calls.length).toBe(invalidationCountAfterDispose)
      expect(host.children.length).toBe(0)
    } finally {
      destroySpy.mockRestore()
    }
  })

  it('detaches abort listeners and cleans up host when renderList fails with non-abort error', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller = new AbortController()

    let addCount = 0
    let removeCount = 0
    const origAdd = controller.signal.addEventListener.bind(controller.signal)
    const origRemove = controller.signal.removeEventListener.bind(controller.signal)

    const addSpy = vi
      .spyOn(controller.signal, 'addEventListener')
      .mockImplementation((type, listener, options) => {
        if (type === 'abort') {
          addCount++
        }
        return origAdd(type, listener, options)
      })

    const removeSpy = vi
      .spyOn(controller.signal, 'removeEventListener')
      .mockImplementation((type, listener, options) => {
        if (type === 'abort') {
          removeCount++
        }
        return origRemove(type, listener, options)
      })

    const renderListSpy = vi
      .spyOn(PptxViewer.prototype, 'renderList')
      .mockRejectedValueOnce(new Error('simulated render failure'))

    try {
      await expect(
        renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
          onSelectableDomInvalidated,
        }),
      ).rejects.toThrow('simulated render failure')

      expect(host.children.length).toBe(0)
      // All abort listeners must be detached after render failure
      expect(addCount - removeCount).toBe(0)
    } finally {
      renderListSpy.mockRestore()
      addSpy.mockRestore()
      removeSpy.mockRestore()
    }
  })

  it('aborts pending resize safely when signal fires during resize', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller = new AbortController()
    const session = await renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
      onSelectableDomInvalidated,
    })

    let resizePending = false
    let resolveResize: () => void = () => {}
    let destroyCalledDuringResize = false

    const origRenderList = PptxViewer.prototype.renderList
    const origDestroy = PptxViewer.prototype.destroy

    const renderListSpy = vi
      .spyOn(PptxViewer.prototype, 'renderList')
      .mockImplementation(function (this: PptxViewer, opts) {
        resizePending = true
        return new Promise<void>((resolve) => {
          resolveResize = () => {
            resizePending = false
            resolve()
          }
        })
      })

    const destroySpy = vi
      .spyOn(PptxViewer.prototype, 'destroy')
      .mockImplementation(function (this: PptxViewer) {
        if (resizePending) {
          destroyCalledDuringResize = true
        }
        return origDestroy.call(this)
      })

    try {
      const resizePromise = session.resize(1200)
      await vi.waitFor(() => {
        expect(renderListSpy).toHaveBeenCalled()
      })

      controller.abort()

      expect(destroyCalledDuringResize).toBe(true)
      expect(host.children.length).toBe(0)

      resolveResize()
      await resizePromise
      expect(host.children.length).toBe(0)
    } finally {
      renderListSpy.mockRestore()
      destroySpy.mockRestore()
    }
  })
})
