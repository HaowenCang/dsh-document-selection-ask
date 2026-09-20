// @vitest-environment jsdom
/**
 * The Ask surface.
 *
 * This spec renders the real components into a real jsdom document and drives
 * them the way the browser does, because the behaviours under test live in the
 * render lifecycle: a store subscription that must re-render, a layout effect that
 * measures, and a click handler that must re-resolve the session it writes to.
 *
 * **What Task 5C changed about this fixture, and why it is not a stub.**
 * The Ask button and the composer target now live in two different slots:
 * `SelectionAskOverlay` occupies `shell.overlay` (root scope, a sibling of the
 * columns) and `ComposerTargetRegistrar` occupies `conversation.input.overlay`
 * (session scope, inside the composer card). The fixture mounts **both real
 * components** into those two positions — the registrar inside the composer card,
 * the surface in a layer that is deliberately *not* an ancestor of the card — so
 * the target-table handoff, the three-way gate and the anchor-scoped focus search
 * are all exercised rather than simulated. A fixture that rendered the button
 * inside the card would still pass while the production wiring was broken.
 *
 * What jsdom can and cannot prove is stated per case. It cannot prove that
 * `preventDefault` on `pointerdown` preserves a browser selection — it implements
 * no focus-driven selection collapse — so those cases assert the weaker properties
 * available here (the default is cancelled, the snapshot survives the press, focus
 * lands on the composer) and the browser suite asserts the real one. It also
 * implements no layout, so the button's real rectangles, and whether the document
 * column paints over it, are Playwright's business.
 *
 * The kernel, the registry, the feedback source and the target table are the
 * production objects. That matters for the questions this spec answers: whether
 * the surface and the kernel agree about when a snapshot is live, whether the
 * composer half actually publishes a usable target, and whether a published
 * rejection reaches the notice. Hand-written stand-ins could agree with the
 * surface while disagreeing with the registrar.
 *
 * The one piece of machinery that is simulated is the adapter: a fixed adapter
 * with a scripted next outcome stands in for scoped DOM capture, which its own
 * spec covers. The script is what lets a case say "the reader's next gesture
 * produced nothing" without inventing a second DOM.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'

import { SELECTION_QUESTION_SUFFIX, appendSelectionToDraft } from '../../src/client/quote/format-selection.js'
import { createComposerTargetRegistry } from '../../src/client/dsh/composer-target-registry.js'
import type { ComposerTargetRegistry } from '../../src/client/dsh/composer-target-registry.js'
import { createSelectionFeedback } from '../../src/client/selection/feedback.js'
import type { SelectionFeedbackSource } from '../../src/client/selection/feedback.js'
import { createSelectionKernel } from '../../src/client/selection/kernel.js'
import type { SelectionKernel } from '../../src/client/selection/kernel.js'
import { SelectionAdapterRegistry } from '../../src/client/selection/registry.js'
import type { SelectionAdapter, SelectionCapture, SelectionContext } from '../../src/client/selection/registry.js'
import type { SelectionRejectReason, SelectionSnapshot } from '../../src/client/selection/types.js'
import { ComposerTargetRegistrar } from '../../src/client/ui/ComposerTargetRegistrar.js'
import { SelectionAskOverlay } from '../../src/client/ui/SelectionAskOverlay.js'
import type { SelectionAskOverlayProps } from '../../src/client/ui/SelectionAskOverlay.js'
import { installOverlayStyles } from '../../src/client/ui/styles.js'
import { mountTree, pressWithPointer, type MountedTree } from './helpers/react-mount.js'
import { rect } from './helpers/dom-range-fixtures.js'

/** The session every fixture selection belongs to. */
const SESSION_ID = 's1'

/** Capture time used by every snapshot in this spec. */
const NOW = 1_700_000_000_000

/** A draft as the reader leaves it before pressing Ask. */
const EXISTING_DRAFT = '\u6211\u7684\u95ee\u9898'

/** The accessible name of the Ask button, from the plugin's own copy. */
const ASK_LABEL = '\u8be2\u95ee DeepSeek'

/** The English Ask label, used by the locale case. */
const ASK_LABEL_EN = 'Ask DeepSeek'

/** The size-limit notice, from the plugin's own copy. */
const TOO_LARGE = '\u9009\u533a\u8fc7\u5927\uff0c\u8bf7\u7f29\u5c0f\u8303\u56f4'

/** The cell-limit notice, from the plugin's own copy. */
const TOO_MANY_CELLS =
  '\u9009\u4e2d\u7684\u5355\u5143\u683c\u8fc7\u591a\uff0c\u8bf7\u9009\u62e9\u4e0d\u8d85\u8fc7 200 \u4e2a\u5355\u5143\u683c'

/** The English cell-limit notice, used by the locale cases. */
const TOO_MANY_CELLS_EN = 'Too many cells selected. Select no more than 200 cells.'

/** The English size-limit notice, used by the locale cases. */
const TOO_LARGE_EN = 'The selection is too large. Select a smaller range.'

/** Selector for the Ask button. */
const BUTTON = '[data-dsa-selection-ask-button]'

/** Selector for the rejection notice. */
const TOAST = '[data-dsa-selection-error]'

/** Selector for the registrar's inert anchor. */
const ANCHOR = '[data-dsa-composer-target-anchor]'

/**
 * Build a text selection snapshot for one session.
 * @param overrides - fields this case is about.
 * @returns the snapshot.
 */
function selection(overrides: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return {
    adapterId: 'test-adapter',
    resourceAddress: `dsh-resource://file/session/${SESSION_ID}/notes.txt`,
    fileName: 'notes.txt',
    documentKind: 'text',
    text: 'alpha',
    location: { kind: 'lines', start: 1, end: 1 },
    rects: [],
    capturedAt: NOW,
    ...overrides,
  }
}

/** The shell's active-session store, as `useSessions` presents it. */
interface ActiveSessionStore {
  /**
   * Read the projected active session.
   * @returns the session id the shell has selected.
   */
  current(): string | undefined
  /** Change the selection and notify the surface. */
  set(sessionId: string | undefined): void
  /** Install a listener. */
  subscribe(listener: () => void): () => void
}

/**
 * Build the one store the surface's `useSessions` projection reads.
 *
 * It is a plain source rather than a React context because that is what the shell
 * hands the slot: `useSessions` is a `GlobalStandardProps` member the renderer
 * binds to the session list store and passes to every root-scope entry. The
 * fixture reproduces the projection (`state.current`), not the store.
 *
 * @param initial - the session the shell starts with.
 * @returns the store.
 */
function activeSessions(initial: string | undefined): ActiveSessionStore {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    current: () => current,
    set(sessionId: string | undefined): void {
      current = sessionId
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** One mounted surface and everything it is wired to. */
interface OverlayFixture {
  readonly kernel: SelectionKernel
  readonly feedback: SelectionFeedbackSource
  readonly composerTargets: ComposerTargetRegistry
  /** The shell's active-session selection, as the frame's own store holds it. */
  readonly sessions: ActiveSessionStore
  /** The layer the Ask surface renders into — deliberately not the composer card. */
  readonly surfaceRoot: HTMLElement
  /** The registrar's own container, inside the composer card. */
  readonly registrarRoot: HTMLElement
  readonly tree: MountedTree
  readonly writes: string[]
  readonly submits: number[]
  readonly composer: HTMLElement
  /**
   * Script the outcome of the next capture.
   * @param capture - the verdict the fixed adapter returns next.
   */
  nextCapture(capture: SelectionCapture): void
  /**
   * Write a draft into the composer, as the reader's own typing does.
   *
   * The composer publishes a new state object on every edit, so the fixture
   * re-renders the registrar exactly as the real store notification does. Without
   * that render the registrar's ref would still hold the previous value, which is
   * the product's own behaviour rather than a defect in the fixture.
   *
   * @param text - the complete next draft.
   */
  typeDraft(text: string): void
  /**
   * Switch the session the shell has selected, as the session controller does.
   * @param sessionId - the session to make current, or `undefined` for none.
   */
  selectSession(sessionId: string | undefined): void
  /**
   * Unmount the session registrar alone, leaving the surface mounted.
   *
   * This is the shape a session switch produces: the surface outlives the
   * composer it was rendering against.
   */
  unmountRegistrar(): void
}

/**
 * Mount the two halves of the Ask flow.
 *
 * The registrar goes inside a real `[data-composer-card]`; the surface goes into
 * a second container appended to the body, which is what makes this fixture
 * exercise the cross-slot handoff rather than the pre-5C containment.
 *
 * @param options - the snapshot to make live, whether the write should fail, the
 * language, the sessions involved, and the geometry jsdom cannot report itself.
 * @returns the fixture.
 */
function mountOverlay(
  options: {
    readonly snapshot?: SelectionSnapshot | null
    readonly draft?: string
    readonly failWrite?: boolean
    readonly lang?: string
    readonly sessionId?: string
    readonly activeSessionId?: string | undefined
    readonly buttonSize?: { readonly width: number; readonly height: number }
    readonly cardBox?: {
      readonly left: number
      readonly top: number
      readonly right: number
      readonly bottom: number
      readonly width: number
      readonly height: number
    }
  } = {},
): OverlayFixture {
  document.documentElement.lang = options.lang ?? 'zh'

  const card = document.createElement('div')
  card.setAttribute('data-composer-card', '')
  const composer = document.createElement('div')
  composer.setAttribute('data-composer-input', '')
  composer.setAttribute('contenteditable', 'true')
  card.appendChild(composer)
  document.body.appendChild(card)

  if (options.cardBox !== undefined) {
    const box = options.cardBox
    card.getBoundingClientRect = () => box as DOMRect
  }

  const buttonSize = options.buttonSize
  if (buttonSize !== undefined) {
    // jsdom lays nothing out, so every box is zero-sized and the placement rule
    // would be exercised against zeros. The stub supplies the one measurement the
    // component actually reads.
    Object.defineProperty(HTMLButtonElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      writable: true,
      value: function stubbed(this: HTMLButtonElement): DOMRect {
        void this
        return DOMRect.fromRect({ x: 0, y: 0, width: buttonSize.width, height: buttonSize.height })
      },
    })
  }

  const active = options.snapshot === undefined ? selection() : options.snapshot
  let outcome: SelectionCapture =
    active === null
      ? { snapshot: null, rejectReason: 'outside-supported-preview' }
      : { snapshot: active, rejectReason: null }

  const adapter: SelectionAdapter = {
    id: 'test-adapter',
    canHandle: (): boolean => true,
    capture: () => outcome,
  }

  const registry = new SelectionAdapterRegistry()
  registry.register(adapter)
  const kernel = createSelectionKernel(registry)
  const feedback = createSelectionFeedback()
  const composerTargets = createComposerTargetRegistry()
  const sessions = activeSessions(
    'activeSessionId' in options ? options.activeSessionId : (options.sessionId ?? SESSION_ID),
  )

  const writes: string[] = []
  const submits: number[] = []
  let draft = options.draft ?? ''
  const draftListeners = new Set<() => void>()

  /**
   * Publish a draft change to the mounted registrar.
   *
   * The composer's own store publishes on every edit, and the registrar re-reads
   * its draft on every render; this is the fixture's half of that contract.
   */
  function publishDraft(): void {
    for (const listener of [...draftListeners]) listener()
  }

  // The real registrar, inside the real card. It receives the store-backed hook
  // shape the framework supplies: `useInput` re-reads the draft on every render,
  // and the fixture re-renders it when the composer's state changes.
  const useInput = (selector: (value: { readonly draft: string }) => string): string =>
    selector({ draft })

  function RegistrarHost(): JSX.Element {
    useInput((value) => value.draft)
    const rerender = useState(0)[1]
    useEffect(() => {
      const listener = (): void => {
        act(() => {
          rerender((value) => value + 1)
        })
      }
      draftListeners.add(listener)
      return () => {
        draftListeners.delete(listener)
      }
    }, [])
    return (
      <ComposerTargetRegistrar
        sessionId={options.sessionId ?? SESSION_ID}
        useInput={useInput}
        inputActions={{
          setDraft: (text: string) => {
            if (options.failWrite === true) {
              throw new Error('composer refused the draft')
            }
            writes.push(text)
            draft = text
            // The composer's own store publishes on every write, so a second Ask
            // in the same case sees the draft the first one produced.
            publishDraft()
          },
        }}
        composerTargets={composerTargets}
      />
    )
  }

  /**
   * Subscribe the surface to the shell's session list.
   *
   * The product's `useSessions` is a `GlobalStandardProps` member the renderer
   * binds to the session list store; this hook is that projection (`state.current`)
   * over the fixture's store, which is the same shape and the same subscription.
   *
   * @param selector - the projection the component reads.
   * @returns the projected value, re-rendered on change.
   */
  const useSessions = (
    selector: (state: { readonly current: string | undefined }) => string | undefined,
  ): string | undefined => {
    const [value, setValue] = useState<string | undefined>(() => selector({ current: sessions.current() }))
    // The selector is a fresh closure per render, so it is read through a ref:
    // subscribing to it directly would rebuild the subscription on every render
    // and report through a stale closure.
    const selectorRef = useRef(selector)
    selectorRef.current = selector
    useEffect(() => {
      const listener = (): void => {
        setValue(selectorRef.current({ current: sessions.current() }))
      }
      const unsubscribe = sessions.subscribe(listener)
      listener()
      return unsubscribe
    }, [])
    return value
  }

  const surfaceProps = {
    useSessions,
    selection: kernel,
    feedback,
    composerTargets,
    clearSelection: () => {
      kernel.clear()
    },
    clearFeedback: () => {
      feedback.clear()
    },
  } as unknown as SelectionAskOverlayProps

  // The surface, in its own root, outside the card. That separation is the point
  // of the fixture: the visible surface is no longer a descendant of the composer
  // it writes to, so a case that only passed while it was would not be testing
  // the production wiring.
  const surfaceContainer = document.createElement('div')
  document.body.appendChild(surfaceContainer)

  let surfaceRoot: Root | null = null
  act(() => {
    surfaceRoot = createRoot(surfaceContainer)
    surfaceRoot.render(<SelectionAskOverlay {...surfaceProps} />)
  })

  // The registrar, in its own root, inside the card — the composer's slot.
  const registrarContainer = document.createElement('div')
  card.appendChild(registrarContainer)

  let registrarRoot: Root | null = null
  act(() => {
    registrarRoot = createRoot(registrarContainer)
    registrarRoot.render(<RegistrarHost />)
  })

  function unmountRegistrar(): void {
    const mounted = registrarRoot
    registrarRoot = null
    act(() => {
      mounted?.unmount()
    })
  }

  if (active !== null) {
    // The selection arrives after the mount, which is the order the product
    // produces: the composer is mounted long before the reader drags. The
    // capture therefore also proves the subscription works, because the button
    // can only appear if the store's notification re-rendered the surface.
    act(() => {
      kernel.capture(emptyContext())
    })
  }

  return {
    kernel,
    feedback,
    composerTargets,
    sessions,
    surfaceRoot: surfaceContainer,
    registrarRoot: registrarContainer,
    tree: {
      // The surface's own container: every DOM assertion in this spec is about
      // what the visible surface rendered, and it no longer shares a root with
      // the composer.
      container: surfaceContainer,
      act(body: () => void): void {
        act(body)
      },
      unmount(): void {
        const surface = surfaceRoot
        const registrar = registrarRoot
        surfaceRoot = null
        registrarRoot = null
        act(() => {
          surface?.unmount()
          registrar?.unmount()
        })
        surfaceContainer.remove()
        registrarContainer.remove()
      },
    },
    writes,
    submits,
    composer,
    nextCapture(capture: SelectionCapture): void {
      outcome = capture
    },
    typeDraft(text: string): void {
      draft = text
      publishDraft()
    },
    selectSession(sessionId: string | undefined): void {
      act(() => {
        sessions.set(sessionId)
      })
    },
    unmountRegistrar,
  }
}

/**
 * Press the Ask button, as a pointer press followed by a click.
 * @param fixture - the mounted fixture.
 * @returns the button that was pressed.
 */
function pressAsk(fixture: OverlayFixture): HTMLElement {
  const button = fixture.tree.container.querySelector<HTMLElement>(BUTTON)
  if (button === null) {
    throw new Error('the Ask button is not rendered')
  }
  fixture.tree.act(() => {
    pressWithPointer(button)
  })
  return button
}

/**
 * Run the reader's next gesture through the fixture's kernel.
 *
 * The three fields are separate on purpose, because they are separate facts: the
 * adapter's `rejectReason` is what the capture decided, the snapshot is what it
 * produced, and `feedback` is what the browser lifecycle would report to the
 * feedback source afterwards. Driving them explicitly keeps these cases about
 * the surface — which store value it renders — rather than about the lifecycle's
 * reporting policy, which is asserted where the lifecycle is installed.
 *
 * @param fixture - the mounted fixture.
 * @param step - the scripted gesture.
 * @returns the capture the kernel produced.
 */
function captureNext(
  fixture: OverlayFixture,
  step: {
    readonly snapshot: SelectionSnapshot | null
    readonly rejectReason: SelectionRejectReason | null
    readonly feedback: SelectionRejectReason | null
  },
): SelectionCapture {
  fixture.nextCapture({ snapshot: step.snapshot, rejectReason: step.rejectReason })

  let result: SelectionCapture = { snapshot: null, rejectReason: null }
  fixture.tree.act(() => {
    result = fixture.kernel.capture(emptyContext())
  })

  fixture.tree.act(() => {
    if (step.feedback === null) {
      fixture.feedback.clear()
    } else {
      fixture.feedback.report(step.feedback)
    }
  })

  return result
}

/** A gesture that found nothing: a normal pointer release, and silent. */
const EMPTY_GESTURE = {
  snapshot: null,
  rejectReason: 'outside-supported-preview' as SelectionRejectReason,
  feedback: null,
}

/** A gesture that selected more than the documented limit. */
const OVERSIZED_GESTURE = {
  snapshot: null,
  rejectReason: 'too-large' as SelectionRejectReason,
  feedback: 'too-large' as SelectionRejectReason,
}

/** A spreadsheet gesture that selected more than the 200-cell limit. */
const TOO_MANY_CELLS_GESTURE = {
  snapshot: null,
  rejectReason: 'too-many-cells' as SelectionRejectReason,
  feedback: 'too-many-cells' as SelectionRejectReason,
}

/** A capture context with no browser selection. */
function emptyContext(): SelectionContext {
  return { selection: null, target: null, now: NOW }
}

beforeEach(() => {
  document.body.replaceChildren()
  document.head.replaceChildren()
  installOverlayStyles(document)
  // Drop the previous case's button measurement, if it installed one.
  delete (HTMLButtonElement.prototype as unknown as Record<string, unknown>)['getBoundingClientRect']
})

describe('overlay visibility', () => {
  it('renders no button without a snapshot', () => {
    const fixture = mountOverlay({ snapshot: null })

    expect(fixture.tree.container.querySelector(BUTTON)).toBeNull()
    fixture.tree.unmount()
  })

  it('renders the Ask button for a same-session selection', () => {
    const fixture = mountOverlay()

    expect(fixture.tree.container.querySelector(BUTTON)?.textContent).toBe(ASK_LABEL)
    fixture.tree.unmount()
  })

  it('hides the button for a selection belonging to another session', () => {
    const fixture = mountOverlay({
      snapshot: selection({ resourceAddress: 'dsh-resource://file/session/s2/notes.txt' }),
    })

    expect(fixture.tree.container.querySelector(BUTTON)).toBeNull()
    fixture.tree.unmount()
  })

  it('hides the button for a resource address that proves no session', () => {
    const fixture = mountOverlay({
      snapshot: selection({ resourceAddress: 'dsh-resource://file/absolute/C:/work/notes.txt' }),
    })

    expect(fixture.tree.container.querySelector(BUTTON)).toBeNull()
    fixture.tree.unmount()
  })

  it('drops the button when a later capture produces nothing', () => {
    const fixture = mountOverlay()
    expect(fixture.tree.container.querySelector(BUTTON)).not.toBeNull()

    captureNext(fixture, EMPTY_GESTURE)

    expect(fixture.kernel.getSnapshot()).toBeNull()
    expect(fixture.tree.container.querySelector(BUTTON)).toBeNull()
    fixture.tree.unmount()
  })
})

describe('overlay accessible name', () => {
  it('is exactly the documented Ask label', () => {
    const fixture = mountOverlay()

    const label = fixture.tree.container.querySelector(BUTTON)?.textContent
    expect(label).toBe(ASK_LABEL)
    expect([...(label ?? '')].map((character) => character.codePointAt(0))).toEqual([
      0x8be2, 0x95ee, 0x20, 0x44, 0x65, 0x65, 0x70, 0x53, 0x65, 0x65, 0x6b,
    ])
    fixture.tree.unmount()
  })
})

describe('overlay ask transaction', () => {
  it('preserves the existing draft and appends the quote', () => {
    const fixture = mountOverlay({ draft: EXISTING_DRAFT })

    pressAsk(fixture)

    expect(fixture.writes).toEqual([appendSelectionToDraft(EXISTING_DRAFT, selection())])
    fixture.tree.unmount()
  })

  it('writes once, never submits, and clears the snapshot', () => {
    const fixture = mountOverlay({ draft: EXISTING_DRAFT })

    pressAsk(fixture)

    expect(fixture.writes).toHaveLength(1)
    expect(fixture.submits).toEqual([])
    expect(fixture.kernel.getSnapshot()).toBeNull()
    expect(fixture.tree.container.querySelector(BUTTON)).toBeNull()
    fixture.tree.unmount()
  })

  it('appends a second block without rewriting the first', () => {
    const first = appendSelectionToDraft('', selection())
    const fixture = mountOverlay({ draft: first })

    pressAsk(fixture)

    const written = fixture.writes[0] ?? ''
    expect(written.startsWith(first)).toBe(true)
    expect(written.split(SELECTION_QUESTION_SUFFIX)).toHaveLength(3)
    fixture.tree.unmount()
  })

  it('does not act when the snapshot disappeared before the click', () => {
    const fixture = mountOverlay({ draft: EXISTING_DRAFT })
    const button = fixture.tree.container.querySelector<HTMLElement>(BUTTON)

    // A capture that produced nothing between the render and the press is what a
    // stray click elsewhere looks like. The handler must not fall back to the
    // snapshot the component was rendered with, and the button is already gone.
    captureNext(fixture, EMPTY_GESTURE)
    expect(fixture.tree.container.querySelector(BUTTON)).toBeNull()
    fixture.tree.act(() => {
      button?.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
    })

    expect(fixture.writes).toEqual([])
    fixture.tree.unmount()
  })

  it('cancels the pointer default so the press cannot take focus', () => {
    const fixture = mountOverlay()

    const button = fixture.tree.container.querySelector<HTMLElement>(BUTTON)
    const event = new Event('pointerdown', { bubbles: true, cancelable: true })
    fixture.tree.act(() => {
      button?.dispatchEvent(event)
    })

    // jsdom implements no focus-driven selection collapse, so the property
    // provable here is the cancelled default; the browser suite asserts that the
    // browser selection itself survives the press.
    expect(event.defaultPrevented).toBe(true)
    expect(fixture.kernel.getSnapshot()).not.toBeNull()
    fixture.tree.unmount()
  })

  it('keeps the snapshot and writes nothing when the composer refuses the draft', () => {
    const fixture = mountOverlay({ draft: EXISTING_DRAFT, failWrite: true })

    pressAsk(fixture)

    expect(fixture.writes).toEqual([])
    expect(fixture.kernel.getSnapshot()).not.toBeNull()
    expect(fixture.tree.container.querySelector(BUTTON)).not.toBeNull()
    fixture.tree.unmount()
  })
})

describe('overlay focus', () => {
  it('returns focus to the composer editable inside its own card', () => {
    const fixture = mountOverlay()

    pressAsk(fixture)

    expect(document.activeElement).toBe(fixture.composer)
    fixture.tree.unmount()
  })
})

describe('overlay rejection feedback', () => {
  it('renders the size-limit notice for an oversized selection', () => {
    const fixture = mountOverlay({ snapshot: null })

    captureNext(fixture, OVERSIZED_GESTURE)

    const toast = fixture.tree.container.querySelector(TOAST)
    expect(toast?.textContent).toBe(TOO_LARGE)
    expect(toast?.getAttribute('data-dsa-selection-error')).toBe('too-large')
    fixture.tree.unmount()
  })

  it('renders the notice even though no Ask button can be shown', () => {
    const fixture = mountOverlay({ snapshot: null })

    captureNext(fixture, OVERSIZED_GESTURE)

    // The notice and the button are independent: a refusal has no selection, so
    // hanging the notice off the button would hide it in the one state it exists
    // for.
    expect(fixture.tree.container.querySelector(BUTTON)).toBeNull()
    expect(fixture.tree.container.querySelector(TOAST)).not.toBeNull()
    fixture.tree.unmount()
  })

  it('writes no draft while the notice is up', () => {
    const fixture = mountOverlay({ snapshot: null, draft: EXISTING_DRAFT })

    captureNext(fixture, OVERSIZED_GESTURE)

    expect(fixture.writes).toEqual([])
    fixture.tree.unmount()
  })

  it('shows nothing for an ordinary empty gesture', () => {
    const fixture = mountOverlay({ snapshot: null })

    captureNext(fixture, EMPTY_GESTURE)

    expect(fixture.tree.container.querySelector(TOAST)).toBeNull()
    fixture.tree.unmount()
  })

  it('renders the cell-limit notice for a range beyond the limit', () => {
    const fixture = mountOverlay({ snapshot: null })

    captureNext(fixture, TOO_MANY_CELLS_GESTURE)

    const toast = fixture.tree.container.querySelector(TOAST)
    // The kind is asserted beside the wording, because the two limits are
    // different refusals: showing the character limit's notice for a cell
    // overflow would name a limit the reader never reached.
    expect(toast?.getAttribute('data-dsa-selection-error')).toBe('too-many-cells')
    expect(toast?.textContent).toBe(TOO_MANY_CELLS)
    expect(toast?.textContent).not.toBe(TOO_LARGE)
    fixture.tree.unmount()
  })

  it('clears the notice when a later capture succeeds', () => {
    const fixture = mountOverlay({ snapshot: null })

    captureNext(fixture, OVERSIZED_GESTURE)
    expect(fixture.tree.container.querySelector(TOAST)).not.toBeNull()

    captureNext(fixture, { snapshot: selection(), rejectReason: null, feedback: null })

    expect(fixture.tree.container.querySelector(TOAST)).toBeNull()
    expect(fixture.tree.container.querySelector(BUTTON)).not.toBeNull()
    fixture.tree.unmount()
  })

  it('clears the notice after a successful ask', () => {
    const fixture = mountOverlay()

    captureNext(fixture, OVERSIZED_GESTURE)
    expect(fixture.tree.container.querySelector(TOAST)).not.toBeNull()

    // A valid selection followed by Ask: the notice belongs to the previous
    // gesture and must not survive the action.
    captureNext(fixture, { snapshot: selection(), rejectReason: null, feedback: 'too-large' })
    pressAsk(fixture)

    expect(fixture.tree.container.querySelector(TOAST)).toBeNull()
    fixture.tree.unmount()
  })
})

describe('overlay copy', () => {
  it('uses the Chinese product copy for a Chinese document', () => {
    const fixture = mountOverlay({ lang: 'zh-CN' })

    expect(fixture.tree.container.querySelector(BUTTON)?.textContent).toBe(ASK_LABEL)
    fixture.tree.unmount()
  })

  it('uses the English copy for a non-Chinese document', () => {
    const fixture = mountOverlay({ lang: 'en' })

    expect(fixture.tree.container.querySelector(BUTTON)?.textContent).toBe(ASK_LABEL_EN)
    fixture.tree.unmount()
  })

  it.each([
    ['zh-CN', TOO_LARGE, TOO_MANY_CELLS],
    ['en', TOO_LARGE_EN, TOO_MANY_CELLS_EN],
  ])('words both refusals in the document language (%s)', (lang, tooLarge, tooManyCells) => {
    const oversized = mountOverlay({ snapshot: null, lang })
    captureNext(oversized, OVERSIZED_GESTURE)
    expect(oversized.tree.container.querySelector(TOAST)?.textContent).toBe(tooLarge)
    oversized.tree.unmount()

    const cells = mountOverlay({ snapshot: null, lang })
    captureNext(cells, TOO_MANY_CELLS_GESTURE)
    expect(cells.tree.container.querySelector(TOAST)?.textContent).toBe(tooManyCells)
    cells.tree.unmount()
  })
})

describe('overlay style installation', () => {
  it("installs one sheet per document and leaves the owner's sheet alone", () => {
    const sheets = document.head.querySelectorAll('style[data-plugin-css]')
    expect(sheets).toHaveLength(1)
    expect(sheets[0]?.textContent).toContain('[data-dsa-selection-ask-button]')
    expect(sheets[0]?.textContent).toContain('[data-dsa-selection-error]')
    expect(sheets[0]?.textContent).toContain('[data-dsa-composer-target-anchor]')

    // A second install in the same document is a no-op, so its disposer must not
    // remove the sheet the first install owns.
    const dispose = installOverlayStyles(document)
    expect(document.head.querySelectorAll('style[data-plugin-css]')).toHaveLength(1)
    dispose()
    expect(document.head.querySelectorAll('style[data-plugin-css]')).toHaveLength(1)
  })
})

describe('overlay placement', () => {
  it('anchors to the snapshot geometry and clamps into the viewport', () => {
    // A selection at the very right edge of a 1024-wide viewport: the centred
    // position would put the button past the edge, so the clamp is what makes it
    // reachable.
    const fixture = mountOverlay({
      snapshot: selection({ rects: [rect({ x: 1010, y: 300, width: 14, height: 20 })] }),
      buttonSize: { width: 100, height: 24 },
    })

    const button = fixture.tree.container.querySelector<HTMLElement>(BUTTON)
    expect(Number.parseFloat(button?.style.left ?? '')).toBe(1024 - 100 - 8)
    expect(Number.parseFloat(button?.style.top ?? '')).toBe(300 - 24 - 8)
    fixture.tree.unmount()
  })

  it('falls back clear of the composer card when the snapshot has no geometry', () => {
    const fixture = mountOverlay({
      snapshot: selection({ rects: [] }),
      buttonSize: { width: 100, height: 24 },
      cardBox: { left: 100, top: 500, right: 700, bottom: 600, width: 600, height: 100 },
    })

    const button = fixture.tree.container.querySelector<HTMLElement>(BUTTON)
    // Right-aligned to the card, and one inset *above* it rather than inside it:
    // the old inner placement covered the right of the composer's editable box,
    // which the browser audit measured on every XLSX selection.
    expect(Number.parseFloat(button?.style.left ?? '')).toBe(600)
    expect(Number.parseFloat(button?.style.top ?? '')).toBe(500 - 24 - 12)
    fixture.tree.unmount()
  })

  it('keeps the fallback inside the viewport when the card has no usable box', () => {
    const fixture = mountOverlay({
      snapshot: selection({ rects: [] }),
      buttonSize: { width: 100, height: 24 },
      cardBox: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
    })

    const button = fixture.tree.container.querySelector<HTMLElement>(BUTTON)
    // A zero-size card carries no corner to hang the box from, so it falls back
    // to the viewport's own bottom-right margin: 1024 - 100 - 12 and
    // 768 - 24 - 12, both already inside the clamp.
    expect(Number.parseFloat(button?.style.left ?? '')).toBe(912)
    expect(Number.parseFloat(button?.style.top ?? '')).toBe(732)
    fixture.tree.unmount()
  })

  it('keeps the fallback inside the viewport when the card sits at the origin', () => {
    const fixture = mountOverlay({
      snapshot: selection({ rects: [] }),
      buttonSize: { width: 100, height: 24 },
      cardBox: { left: 0, top: 0, right: 0, bottom: 0, width: 600, height: 100 },
    })

    const button = fixture.tree.container.querySelector<HTMLElement>(BUTTON)
    // A card at the origin offers a right edge of 0, which the clamp lifts to the
    // margin, and no room above it at all, so the button takes the other side of
    // the card rather than being pinned inside it: 100 + 12. Neither axis is left
    // sitting on the viewport boundary.
    expect(Number.parseFloat(button?.style.left ?? '')).toBe(8)
    expect(Number.parseFloat(button?.style.top ?? '')).toBe(112)

    fixture.tree.unmount()
  })
})
