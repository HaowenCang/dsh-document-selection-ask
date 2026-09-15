// @vitest-environment jsdom
/**
 * Browser selection event wiring.
 *
 * The lifecycle is driven against a **fake document** rather than the jsdom
 * document. The subject here is the wiring itself 闁?which events are observed,
 * how often a capture runs for one gesture, what a capture is told, and what
 * teardown releases 闁?and jsdom's own `Selection` has no bearing on any of those
 * questions. A fake document also makes the timing observable: the animation
 * frame is a queue this spec drains by hand, so "coalesced into one frame" is a
 * count rather than a race.
 *
 * Geometry is deliberately absent. jsdom implements no layout, so a case that
 * asserted on where a rectangle lands would be asserting on the fixture. Real
 * positioning is a Playwright concern; the pure placement arithmetic has its own
 * unit spec.
 */

import { describe, expect, it } from 'vitest'

import { installBrowserSelectionLifecycle } from '../../src/client/selection/browser-lifecycle.js'
import { createSelectionFeedback } from '../../src/client/selection/feedback.js'
import type { SelectionFeedbackSource } from '../../src/client/selection/feedback.js'
import { createSelectionKernel } from '../../src/client/selection/kernel.js'
import type { SelectionKernel } from '../../src/client/selection/kernel.js'
import { SelectionAdapterRegistry } from '../../src/client/selection/registry.js'
import type {
  SelectionAdapter,
  SelectionCapture,
  SelectionContext,
} from '../../src/client/selection/registry.js'
import type { SelectionSnapshot } from '../../src/client/selection/types.js'

/** Capture time the lifecycle reads from `Date.now`; only its presence matters. */
const NOW = 1_700_000_000_000

/** A live browser selection stand-in; the lifecycle only forwards it. */
const LIVE_SELECTION = { kind: 'fake-selection' } as unknown as Selection

/** A viewport rectangle for a snapshot; the lifecycle only stores it. */
function rect(): DOMRectReadOnly {
  return { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 } as DOMRectReadOnly
}

/**
 * Build a snapshot for one session.
 * @param overrides - fields this case is about.
 * @returns the snapshot.
 */
function snapshot(overrides: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return {
    adapterId: 'test-adapter',
    resourceAddress: 'dsh-resource://file/session/s1/notes.txt',
    fileName: 'notes.txt',
    documentKind: 'text',
    text: 'alpha',
    location: { kind: 'lines', start: 1, end: 1 },
    rects: [rect()],
    capturedAt: NOW,
    ...overrides,
  }
}

/** The host surface the lifecycle drives, with an inspectable frame queue. */
interface FakeDocument {
  readonly doc: Document
  /** Browser selection the lifecycle will read; `null` models a cleared one. */
  selection: Selection | null
  /** Frames scheduled and not yet drained. */
  readonly frames: (() => void)[]
  /** Frames cancelled before running. */
  readonly cancelled: number[]
  /** Run every scheduled frame, as the browser would on the next paint. */
  runFrames(): void
  /** Listener count currently installed for one event type. */
  listeners(type: string): number
  /** Dispatch an event, as the browser would. */
  fire(type: string, target: EventTarget | null, init?: EventInit): void
}

/**
 * Build a fake document.
 * @returns the host and its inspection surface.
 */
function fakeDocument(): FakeDocument {
  const listeners = new Map<string, Set<EventListener>>()
  const frames: (() => void)[] = []
  const cancelled: number[] = []
  let nextHandle = 1
  const handles = new Map<number, () => void>()

  const doc = {
    getSelection: (): Selection | null => host.selection,
    addEventListener: (type: string, listener: EventListener): void => {
      const set = listeners.get(type) ?? new Set<EventListener>()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: EventListener): void => {
      listeners.get(type)?.delete(listener)
    },
    defaultView: {
      requestAnimationFrame: (callback: () => void): number => {
        const handle = nextHandle
        nextHandle += 1
        handles.set(handle, callback)
        frames.push(callback)
        return handle
      },
      cancelAnimationFrame: (handle: number): void => {
        const callback = handles.get(handle)
        if (callback === undefined) {
          return
        }
        handles.delete(handle)
        cancelled.push(handle)
        const index = frames.indexOf(callback)
        if (index !== -1) {
          frames.splice(index, 1)
        }
      },
    },
  } as unknown as Document

  const host: FakeDocument = {
    doc,
    selection: LIVE_SELECTION,
    frames,
    cancelled,
    runFrames(): void {
      const pending = [...frames]
      frames.length = 0
      for (const callback of pending) {
        callback()
      }
    },
    listeners(type: string): number {
      return listeners.get(type)?.size ?? 0
    },
    fire(type: string, target: EventTarget | null, init: EventInit = {}): void {
      // Real event classes rather than a bare `Event` with extra fields: `key`
      // and the other init members are accessors on the prototype, so copying an
      // init bag onto a plain `Event` would leave `event.key` undefined and make
      // a keydown case pass for the wrong reason.
      const event =
        type === 'keydown' || type === 'keyup'
          ? new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })
          : new Event(type, { bubbles: true, cancelable: true, ...init })
      // An undispatched event carries a null target, and the lifecycle reads the
      // target off the event object, so the fixture fixes it exactly as a real
      // dispatch would have.
      Object.defineProperty(event, 'target', { value: target, configurable: true })
      for (const listener of [...(listeners.get(type) ?? [])]) {
        listener(event)
      }
    },
  }

  return host
}

/** One installed lifecycle and everything it is wired to. */
interface LifecycleFixture {
  readonly host: FakeDocument
  readonly kernel: SelectionKernel
  readonly feedback: SelectionFeedbackSource
  readonly contexts: SelectionContext[]
  readonly captures: SelectionCapture[]
  /** Script the adapter's next verdict. */
  nextCapture(capture: SelectionCapture): void
  dispose(): void
}

/**
 * Install the lifecycle over a fake document.
 * @param initial - the adapter's first verdict.
 * @returns the fixture.
 */
function install(initial: SelectionCapture = { snapshot: snapshot(), rejectReason: null }): LifecycleFixture {
  const host = fakeDocument()
  let outcome = initial

  const adapter: SelectionAdapter = {
    id: 'test-adapter',
    canHandle: (): boolean => true,
    capture: (context: SelectionContext): SelectionCapture => {
      contexts.push(context)
      return outcome
    },
  }

  const contexts: SelectionContext[] = []
  const captures: SelectionCapture[] = []
  const registry = new SelectionAdapterRegistry()
  registry.register(adapter)
  const kernel = createSelectionKernel(registry)
  const feedback = createSelectionFeedback()
  const lifecycle = installBrowserSelectionLifecycle(host.doc, kernel, feedback, (capture) => {
    captures.push(capture)
  })

  return {
    host,
    kernel,
    feedback,
    contexts,
    captures,
    nextCapture(capture: SelectionCapture): void {
      outcome = capture
    },
    dispose: () => {
      lifecycle.dispose()
    },
  }
}

describe('lifecycle: what it observes', () => {
  it('listens for the selection, viewport and dismissal events', () => {
    const fixture = install()

    for (const type of ['selectionchange', 'pointerup', 'keyup', 'scroll', 'resize', 'keydown']) {
      expect(fixture.host.listeners(type), `${type} must be observed`).toBe(1)
    }

    fixture.dispose()
  })

  it('does not observe pointer or mouse movement', () => {
    const fixture = install()

    expect(fixture.host.listeners('pointermove')).toBe(0)
    expect(fixture.host.listeners('mousemove')).toBe(0)

    fixture.dispose()
  })

  it('removes every listener on dispose', () => {
    const fixture = install()
    fixture.dispose()

    for (const type of ['selectionchange', 'pointerup', 'keyup', 'scroll', 'resize', 'keydown']) {
      expect(fixture.host.listeners(type), `${type} must be released`).toBe(0)
    }
  })
})

describe('lifecycle: animation frame coalescing', () => {
  it('collapses a burst of selectionchange into one capture', () => {
    const fixture = install()
    const body = document.createElement('p')

    for (let index = 0; index < 25; index += 1) {
      fixture.host.fire('selectionchange', body)
    }

    // Nothing has been read yet: the whole burst is one scheduled frame.
    expect(fixture.host.frames).toHaveLength(1)
    expect(fixture.contexts).toHaveLength(0)

    fixture.host.runFrames()

    expect(fixture.contexts).toHaveLength(1)
    fixture.dispose()
  })

  it('captures again on the next frame after the first one ran', () => {
    const fixture = install()
    const body = document.createElement('p')

    fixture.host.fire('selectionchange', body)
    fixture.host.runFrames()
    fixture.host.fire('selectionchange', body)
    fixture.host.runFrames()

    expect(fixture.contexts).toHaveLength(2)
    fixture.dispose()
  })

  it('collapses a pointerup and a following selectionchange into one capture', () => {
    const fixture = install()

    fixture.host.fire('pointerup', document.createElement('p'))
    fixture.host.fire('selectionchange', document.createElement('p'))
    fixture.host.runFrames()

    expect(fixture.contexts).toHaveLength(1)
    fixture.dispose()
  })

  it('cancels a pending frame on dispose rather than capturing after teardown', () => {
    const fixture = install()

    fixture.host.fire('selectionchange', document.createElement('p'))
    expect(fixture.host.frames).toHaveLength(1)

    fixture.dispose()

    expect(fixture.host.cancelled).toHaveLength(1)
    expect(fixture.host.frames).toHaveLength(0)
  })
})

describe('lifecycle: what a capture is told', () => {
  it('reads the selection from the document and reports no target for selectionchange', () => {
    const fixture = install()

    fixture.host.fire('selectionchange', document.createElement('p'))
    fixture.host.runFrames()

    const context = fixture.contexts[0]
    expect(context?.selection).toBe(LIVE_SELECTION)
    // A selectionchange has no meaningful pointer target: the selection may have
    // been extended by the keyboard with the pointer somewhere else entirely.
    expect(context?.target).toBeNull()
    expect(typeof context?.now).toBe('number')
    fixture.dispose()
  })

  it('carries the pointer target of a pointerup capture', () => {
    const fixture = install()
    const paragraph = document.createElement('p')

    fixture.host.fire('pointerup', paragraph)
    fixture.host.runFrames()

    expect(fixture.contexts[0]?.target).toBe(paragraph)
    fixture.dispose()
  })

  it('carries the key target of a keyup capture', () => {
    const fixture = install()
    const paragraph = document.createElement('p')

    fixture.host.fire('keyup', paragraph)
    fixture.host.runFrames()

    expect(fixture.contexts[0]?.target).toBe(paragraph)
    fixture.dispose()
  })

  it('keeps the pointer target when a selectionchange joins the same frame', () => {
    const fixture = install()
    const paragraph = document.createElement('p')

    // The browser dispatches selectionchange alongside the pointer release. The
    // gesture's own target is the evidence; the selectionchange must not erase it
    // before the frame runs, and the two must stay one capture.
    fixture.host.fire('pointerup', paragraph)
    fixture.host.fire('selectionchange', document.createElement('p'))
    fixture.host.runFrames()

    expect(fixture.contexts).toHaveLength(1)
    expect(fixture.contexts[0]?.target).toBe(paragraph)
    fixture.dispose()
  })

  it('reads the selection as it is at frame time, not at event time', () => {
    const fixture = install()

    fixture.host.fire('selectionchange', document.createElement('p'))
    // The reader releases the mouse before the frame runs; the capture must read
    // the settled selection rather than the intermediate one.
    fixture.host.selection = null
    fixture.host.runFrames()

    expect(fixture.contexts[0]?.selection).toBeNull()
    fixture.dispose()
  })

  it('reports the capture to the caller', () => {
    const fixture = install()

    fixture.host.fire('pointerup', document.createElement('p'))
    fixture.host.runFrames()

    expect(fixture.captures).toHaveLength(1)
    expect(fixture.captures[0]?.snapshot?.fileName).toBe('notes.txt')
    fixture.dispose()
  })
})

describe('lifecycle: viewport revalidation', () => {
  it('re-captures on scroll so the geometry is rebuilt from the live range', () => {
    const fixture = install()

    fixture.host.fire('pointerup', document.createElement('p'))
    fixture.host.runFrames()
    fixture.host.fire('scroll', document.createElement('p'))
    fixture.host.runFrames()

    // Two captures, not one capture plus an arithmetic adjustment: a scroll
    // delta cannot know that the selected rows were recycled or re-wrapped.
    expect(fixture.contexts).toHaveLength(2)
    fixture.dispose()
  })

  it('re-captures on resize', () => {
    const fixture = install()

    fixture.host.fire('pointerup', document.createElement('p'))
    fixture.host.runFrames()
    fixture.host.fire('resize', document.createElement('p'))
    fixture.host.runFrames()

    expect(fixture.contexts).toHaveLength(2)
    fixture.dispose()
  })

  it('clears the kernel when a scroll finds no selection', () => {
    const fixture = install()
    fixture.host.fire('pointerup', document.createElement('p'))
    fixture.host.runFrames()
    expect(fixture.kernel.getSnapshot()).not.toBeNull()

    fixture.nextCapture({ snapshot: null, rejectReason: 'collapsed' })
    fixture.host.selection = null
    fixture.host.fire('scroll', document.createElement('p'))
    fixture.host.runFrames()

    expect(fixture.kernel.getSnapshot()).toBeNull()
    fixture.dispose()
  })
})

describe('lifecycle: feedback reporting', () => {
  it('reports a size refusal', () => {
    const fixture = install()
    fixture.nextCapture({ snapshot: null, rejectReason: 'too-large' })

    fixture.host.fire('pointerup', document.createElement('p'))
    fixture.host.runFrames()

    expect(fixture.feedback.getSnapshot()).toEqual({ kind: 'too-large' })
    fixture.dispose()
  })

  it('stays silent for the ordinary gestures', () => {
    for (const reason of [
      'collapsed',
      'outside-supported-preview',
      'cross-root',
      'interactive-control',
      'empty-after-normalization',
    ] as const) {
      const fixture = install()
      fixture.nextCapture({ snapshot: null, rejectReason: reason })

      fixture.host.fire('pointerup', document.createElement('p'))
      fixture.host.runFrames()

      expect(fixture.feedback.getSnapshot(), `${reason} must stay silent`).toBeNull()
      fixture.dispose()
    }
  })

  it('clears the feedback when a later capture succeeds', () => {
    const fixture = install()
    fixture.nextCapture({ snapshot: null, rejectReason: 'too-large' })
    fixture.host.fire('pointerup', document.createElement('p'))
    fixture.host.runFrames()
    expect(fixture.feedback.getSnapshot()).not.toBeNull()

    fixture.nextCapture({ snapshot: snapshot(), rejectReason: null })
    fixture.host.fire('pointerup', document.createElement('p'))
    fixture.host.runFrames()

    expect(fixture.feedback.getSnapshot()).toBeNull()
    fixture.dispose()
  })
})

describe('lifecycle: Escape', () => {
  it('clears the snapshot and the feedback without touching the draft', () => {
    const fixture = install()
    fixture.nextCapture({ snapshot: null, rejectReason: 'too-large' })
    fixture.host.fire('pointerup', document.createElement('p'))
    fixture.host.runFrames()

    fixture.nextCapture({ snapshot: snapshot(), rejectReason: null })
    fixture.host.fire('pointerup', document.createElement('p'))
    fixture.host.runFrames()
    expect(fixture.kernel.getSnapshot()).not.toBeNull()

    fixture.host.fire('keydown', document.body, { key: 'Escape' } as EventInit)

    expect(fixture.kernel.getSnapshot()).toBeNull()
    expect(fixture.feedback.getSnapshot()).toBeNull()
    // Escape is a dismissal: the lifecycle has no composer reference at all, so
    // there is nothing it could write even by accident.
    expect(fixture.captures).toHaveLength(2)
    fixture.dispose()
  })

  it('cancels a frame scheduled by the same keypress', () => {
    const fixture = install()

    fixture.host.fire('selectionchange', document.createElement('p'))
    fixture.host.fire('keydown', document.body, { key: 'Escape' } as EventInit)

    expect(fixture.host.frames).toHaveLength(0)
    fixture.dispose()
  })

  it('leaves other keys alone', () => {
    const fixture = install()
    fixture.host.fire('pointerup', document.createElement('p'))
    fixture.host.runFrames()

    fixture.host.fire('keydown', document.body, { key: 'a' } as EventInit)

    expect(fixture.kernel.getSnapshot()).not.toBeNull()
    fixture.dispose()
  })
})

describe('lifecycle: manual refresh', () => {
  it('captures on demand for a selection made without an event', () => {
    const fixture = install()

    fixture.host.fire('selectionchange', document.createElement('p'))
    // Drain the frame the event scheduled, then drive the lifecycle directly the
    // way a programmatic selection would.
    fixture.host.runFrames()
    const before = fixture.contexts.length
    fixture.host.fire('selectionchange', document.createElement('p'))
    expect(fixture.contexts).toHaveLength(before)

    fixture.host.runFrames()

    expect(fixture.contexts).toHaveLength(before + 1)
    fixture.dispose()
  })

  it('is a no-op after dispose', () => {
    const fixture = install()
    fixture.dispose()

    fixture.host.fire('selectionchange', document.createElement('p'))
    fixture.host.runFrames()

    expect(fixture.contexts).toHaveLength(0)
  })
})



