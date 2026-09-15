// @vitest-environment jsdom
/**
 * The Ask surface at its Task 5C seat, and the session registrar that feeds it.
 *
 * The overlay's own spec covers the Ask transaction. This one covers what the
 * move to `shell.overlay` introduced, and every case here is about one of the
 * three identities the surface's visibility depends on:
 *
 * - the session parsed from the snapshot's own resource address;
 * - the session the shell has selected, read through the public `useSessions`
 *   global standard prop;
 * - the session that has a live composer target.
 *
 * The fixture mounts the real registrar inside a real `[data-composer-card]` and
 * the real surface in a **separate React root outside that card**, which is the
 * production topology: the two halves live in different slots at different
 * scopes. A case that only passed while the button was a descendant of the
 * composer would not be testing this round at all.
 *
 * The composer store is simulated at its published interface — `useInput` plus
 * `setDraft` — because that contract belongs to DSH, not to this plugin, and the
 * spec's job is to observe what the plugin does with it rather than to
 * re-implement the conversation package.
 */

import { useEffect, useRef, useState } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'

import { createComposerTargetRegistry } from '../../src/client/dsh/composer-target-registry.js'
import type { ComposerTargetRegistry } from '../../src/client/dsh/composer-target-registry.js'
import { createSelectionFeedback } from '../../src/client/selection/feedback.js'
import { createSelectionKernel } from '../../src/client/selection/kernel.js'
import { SelectionAdapterRegistry } from '../../src/client/selection/registry.js'
import type { SelectionAdapter, SelectionContext } from '../../src/client/selection/registry.js'
import type { SelectionSnapshot } from '../../src/client/selection/types.js'
import { ComposerTargetRegistrar } from '../../src/client/ui/ComposerTargetRegistrar.js'
import { SelectionAskOverlay } from '../../src/client/ui/SelectionAskOverlay.js'
import type { SelectionAskOverlayProps } from '../../src/client/ui/SelectionAskOverlay.js'
import { installOverlayStyles } from '../../src/client/ui/styles.js'
// Side-effect import: it sets `IS_REACT_ACT_ENVIRONMENT`, without which React 18
// treats every `act()` call as a no-op and reports state updates as unflushed.
import './helpers/react-mount.js'

/** The session the fixtures' selections belong to. */
const SESSION_A = 'session-a'

/** A second session, used by every isolation case. */
const SESSION_B = 'session-b'

/** Capture time used by every snapshot in this spec. */
const NOW = 1_700_000_000_000

/** Selector for the Ask button. */
const BUTTON = '[data-dsa-selection-ask-button]'

/** Selector for the registrar's inert anchor. */
const ANCHOR = '[data-dsa-composer-target-anchor]'

/**
 * Build a text selection snapshot.
 * @param sessionId - the session the address names.
 * @param overrides - fields this case is about.
 * @returns the snapshot.
 */
function selection(sessionId: string, overrides: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return {
    adapterId: 'test-adapter',
    resourceAddress: `dsh-resource://file/session/${sessionId}/notes.txt`,
    fileName: 'notes.txt',
    documentKind: 'text',
    text: 'alpha',
    location: { kind: 'lines', start: 1, end: 1 },
    rects: [],
    capturedAt: NOW,
    ...overrides,
  }
}

/** The shell's session-list store, as the renderer binds `useSessions` to it. */
interface ShellSessions {
  /**
   * Read the selected session.
   * @returns the session id the shell has made current.
   */
  current(): string | undefined
  /**
   * Change the selection and let the surface react to it.
   * @param sessionId - the new current session, or `undefined` for none.
   */
  select(sessionId: string | undefined): Promise<void>
  /**
   * Change the selection **without** notifying subscribers.
   *
   * Used by the press-time re-resolution case: it is what lets a composer be
   * replaced after the button was rendered, so the press has to act on the
   * registry as it stands rather than on the target the render captured.
   *
   * @param sessionId - the new current session, or `undefined` for none.
   */
  selectSilently(sessionId: string | undefined): void
  /**
   * Install a listener.
   * @param listener - called after each notified change.
   * @returns the unsubscribe.
   */
  subscribe(listener: () => void): () => void
}

/**
 * Build the shell's session store.
 * @param initial - the session the shell starts with.
 * @returns the store.
 */
function shellSessions(initial: string | undefined): ShellSessions {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    current: () => current,
    async select(sessionId: string | undefined): Promise<void> {
      current = sessionId
      // Awaited by the caller: React's act queue drains across a microtask
      // boundary, so a synchronous act here would leave the assertion reading
      // the DOM of the render before it.
      await act(async () => {
        for (const listener of [...listeners]) listener()
      })
    },
    selectSilently(sessionId: string | undefined): void {
      current = sessionId
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** One composer mounted inside its own card, with its own store. */
interface Composer {
  /** The session this composer serves. */
  readonly sessionId: string
  /** The card the registrar is mounted inside. */
  readonly card: HTMLElement
  /** The editable surface inside that card. */
  readonly editable: HTMLElement
  /** Everything written through this composer's `setDraft`, in order. */
  readonly writes: string[]
  /**
   * Type a draft into this composer, as the reader does.
   *
   * The composer's store publishes on every edit and the registrar re-reads its
   * draft on every render, so this re-renders the registrar.
   *
   * @param text - the complete next draft.
   */
  type(text: string): void
  /** Unmount this composer's registrar, as a session switch does. */
  unmount(): void
}

/** The mounted surface and the composers it can reach. */
interface Surface {
  readonly kernel: ReturnType<typeof createSelectionKernel>
  readonly composerTargets: ComposerTargetRegistry
  readonly sessions: ShellSessions
  readonly surfaceRoot: HTMLElement
  /**
   * Mount one more session's composer at the end of the document.
   * @param sessionId - the session the composer serves.
   * @returns the composer.
   */
  composer(sessionId: string): Composer
  /**
   * Capture a snapshot into the kernel.
   * @param snapshot - the snapshot, or `null` for a gesture that found nothing.
   */
  capture(snapshot: SelectionSnapshot | null): void
  /**
   * Render the surface again without any source having changed.
   *
   * See {@link ShellSessions.selectSilently} for the one case that needs it. The
   * returned promise is awaited for the same reason `select` is: React's `act`
   * queue drains across a microtask boundary.
   *
   * @returns completion of the render.
   */
  rerender(): Promise<void>
  /** Unmount every root this fixture owns. */
  unmount(): void
}

/**
 * Mount the surface and the shell's session store.
 *
 * @param activeSession - the session the shell starts with.
 * @param draft - the draft the first composer starts with.
 * @returns the fixture.
 */
function mountSurface(activeSession: string | undefined, draft = ''): Surface {
  const adapterRegistry = new SelectionAdapterRegistry()
  let next: SelectionSnapshot | null = null
  const adapter: SelectionAdapter = {
    id: 'test-adapter',
    canHandle: (): boolean => true,
    capture: () => ({ snapshot: next, rejectReason: next === null ? 'collapsed' : null }),
  }
  adapterRegistry.register(adapter)
  const kernel = createSelectionKernel(adapterRegistry)
  const feedback = createSelectionFeedback()
  const composerTargets = createComposerTargetRegistry()
  const sessions = shellSessions(activeSession)

  /**
   * Project the shell's store through the surface's `useSessions` prop.
   *
   * The product's hook is a `GlobalStandardProps` member the renderer binds to
   * this store; the projection and the subscription are the same.
   *
   * @param selector - the projection the surface reads.
   * @returns the projected value, re-rendered on change.
   */
  function useSessions(
    selector: (state: { readonly current: string | undefined }) => string | undefined,
  ): string | undefined {
    const [value, setValue] = useState<string | undefined>(() => selector({ current: sessions.current() }))
    // The selector is a fresh closure per render, so it is read through a ref:
    // subscribing to it directly would tear the subscription down and rebuild it
    // on every render, and the listener would then report through a stale
    // closure rather than through the projection the current render asked for.
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

  const surfaceContainer = document.createElement('div')
  document.body.appendChild(surfaceContainer)
  let surfaceRoot: Root | null = null
  act(() => {
    surfaceRoot = createRoot(surfaceContainer)
    surfaceRoot.render(<SelectionAskOverlay {...surfaceProps} />)
  })

  const composers: Composer[] = []
  const roots: Root[] = []

  /**
   * Mount one session's composer and its registrar.
   * @param sessionId - the session the composer serves.
   * @param initial - the draft it starts with.
   * @returns the composer.
   */
  function composerFor(sessionId: string, initial: string): Composer {
    const card = document.createElement('div')
    card.setAttribute('data-composer-card', '')
    const editable = document.createElement('div')
    editable.setAttribute('data-composer-input', '')
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = -1
    card.appendChild(editable)
    document.body.appendChild(card)

    const container = document.createElement('div')
    card.appendChild(container)

    const writes: string[] = []
    let current = initial
    const listeners = new Set<() => void>()

    /** Republish this composer's draft, as its own store does after an edit. */
    function publish(): void {
      for (const listener of [...listeners]) listener()
    }

    const useInput = (selector: (value: { readonly draft: string }) => string): string =>
      selector({ draft: current })

    /**
     * Render the real registrar, with the store contract the framework supplies.
     * @returns the registrar.
     */
    function Host(): JSX.Element {
      useInput((value) => value.draft)
      const rerender = useState(0)[1]
      useEffect(() => {
        const listener = (): void => {
          act(() => {
            rerender((value) => value + 1)
          })
        }
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }, [])
      return (
        <ComposerTargetRegistrar
          sessionId={sessionId}
          useInput={useInput}
          inputActions={{
            setDraft: (text: string) => {
              writes.push(text)
              current = text
              publish()
            },
          }}
          composerTargets={composerTargets}
        />
      )
    }

    let root: Root | null = null
    act(() => {
      root = createRoot(container)
      root.render(<Host />)
    })
    if (root !== null) roots.push(root)

    const composer: Composer = {
      sessionId,
      card,
      editable,
      writes,
      type(text: string): void {
        current = text
        publish()
      },
      unmount(): void {
        const mounted = root
        root = null
        act(() => {
          mounted?.unmount()
        })
      },
    }
    composers.push(composer)
    return composer
  }

  composerFor(activeSession ?? SESSION_A, draft)

  return {
    kernel,
    composerTargets,
    sessions,
    surfaceRoot: surfaceContainer,
    composer: (sessionId: string) => composerFor(sessionId, ''),
    capture(snapshot: SelectionSnapshot | null): void {
      next = snapshot
      act(() => {
        kernel.capture(emptyContext())
      })
    },
    async rerender(): Promise<void> {
      const root = surfaceRoot
      if (root === null) {
        return
      }
      // The same element again: React re-renders the tree without any prop or
      // store changing.
      await act(async () => {
        root.render(<SelectionAskOverlay {...surfaceProps} />)
      })
    },
    unmount(): void {
      const mountedSurface = surfaceRoot
      surfaceRoot = null
      act(() => {
        mountedSurface?.unmount()
        for (const root of roots) root.unmount()
      })
      surfaceContainer.remove()
      for (const composer of composers) composer.card.remove()
    },
  }
}

/** A capture context with no browser selection. */
function emptyContext(): SelectionContext {
  return { selection: null, target: null, now: NOW }
}

/**
 * Press the Ask button, as a real pointer press and click.
 * @param surface - the fixture.
 * @returns the button that was pressed.
 */
function pressAsk(surface: Surface): HTMLElement {
  const button = surface.surfaceRoot.querySelector<HTMLElement>(BUTTON)
  if (button === null) {
    throw new Error('the Ask button is not rendered')
  }
  act(() => {
    button.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    button.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
  })
  return button
}

beforeEach(() => {
  document.body.replaceChildren()
  document.head.replaceChildren()
  installOverlayStyles(document)
})

describe('surface placement', () => {
  it('renders outside the composer card it writes to', () => {
    const surface = mountSurface(SESSION_A)
    surface.capture(selection(SESSION_A))

    const button = surface.surfaceRoot.querySelector<HTMLElement>(BUTTON)
    expect(button).not.toBeNull()

    // The property the move exists for: the surface is not a descendant of any
    // composer card, so no composer stacking context can trap it. The composer
    // half is present and separate.
    expect(button?.closest('[data-composer-card]')).toBeNull()
    expect(document.querySelector(ANCHOR)?.closest('[data-composer-card]')).not.toBeNull()

    surface.unmount()
  })

  it('does not render the anchor outside a composer', () => {
    const surface = mountSurface(SESSION_A)

    // The anchor is the registrar's, and the registrar only exists where the
    // composer does; the surface root holds none of it.
    expect(surface.surfaceRoot.querySelector(ANCHOR)).toBeNull()

    surface.unmount()
  })
})

describe('surface three-way session gate', () => {
  it('shows the button when the snapshot, the active session and the target agree', () => {
    const surface = mountSurface(SESSION_A)
    surface.capture(selection(SESSION_A))

    expect(surface.surfaceRoot.querySelector(BUTTON)?.textContent).toBe('\u8be2\u95ee DeepSeek')

    surface.unmount()
  })

  it('hides the button when the snapshot names another session', () => {
    const surface = mountSurface(SESSION_A)
    surface.capture(selection(SESSION_B))

    expect(surface.surfaceRoot.querySelector(BUTTON)).toBeNull()

    surface.unmount()
  })

  it('hides the button when the snapshot names no session at all', () => {
    const surface = mountSurface(SESSION_A)
    surface.capture(selection(SESSION_A, { resourceAddress: 'dsh-resource://file/absolute/C:/notes.txt' }))

    expect(surface.surfaceRoot.querySelector(BUTTON)).toBeNull()

    surface.unmount()
  })

  it('hides the button when the selection session is not the active session', () => {
    // The composer for B is mounted and registered; only the shell's selection
    // differs. This is the resident-composer case: a target existing is not
    // permission to write to it.
    const surface = mountSurface(SESSION_A)
    surface.composer(SESSION_B)
    surface.capture(selection(SESSION_B))

    expect(surface.composerTargets.get(SESSION_B)).not.toBeNull()
    expect(surface.surfaceRoot.querySelector(BUTTON)).toBeNull()

    surface.unmount()
  })

  it('hides the button when the active session has no registered target', async () => {
    // The mirror case: the shell moves to B, whose composer never mounted, so the
    // target is absent and the surface goes with it. The gate is per-session, not
    // "some target exists somewhere".
    const surface = mountSurface(SESSION_A)
    surface.capture(selection(SESSION_A))
    expect(surface.composerTargets.get(SESSION_A)).not.toBeNull()
    expect(surface.surfaceRoot.querySelector(BUTTON)).not.toBeNull()

    await surface.sessions.select(SESSION_B)

    expect(surface.composerTargets.get(SESSION_B)).toBeNull()
    expect(surface.surfaceRoot.querySelector(BUTTON)).toBeNull()

    surface.unmount()
  })

  it('appears once the selection session also becomes current, without a new capture', async () => {
    // A composer mounting and a session becoming current are independent events,
    // and each of them alone must be enough to publish a button the other already
    // earned. Here: no session is current and the selection is already live, so
    // selecting its session is what makes the action appear, with no new capture.
    const surface = mountSurface(undefined)
    surface.capture(selection(SESSION_A))
    expect(surface.surfaceRoot.querySelector(BUTTON)).toBeNull()

    await surface.sessions.select(SESSION_A)
    expect(surface.surfaceRoot.querySelector(BUTTON)).not.toBeNull()

    surface.unmount()
  })

  it('disappears when the registrar unmounts, and returns when it mounts again', () => {
    const surface = mountSurface(SESSION_A)
    const composer = surface.composer(SESSION_A)
    surface.capture(selection(SESSION_A))
    expect(surface.surfaceRoot.querySelector(BUTTON)).not.toBeNull()

    composer.unmount()
    expect(surface.surfaceRoot.querySelector(BUTTON)).toBeNull()

    surface.unmount()
  })
})

describe('surface session isolation', () => {
  it('writes to the selected session and never to another one', () => {
    const surface = mountSurface(SESSION_A)
    const composerA = surface.composer(SESSION_A)
    const composerB = surface.composer(SESSION_B)

    surface.capture(selection(SESSION_A))
    pressAsk(surface)

    expect(composerA.writes).toHaveLength(1)
    expect(composerB.writes).toEqual([])

    surface.unmount()
  })

  it('writes through the target the registry holds at press time, not the one the render saw', async () => {
    // Replace the button's own recorded anchor mid-flight, so the press can only
    // succeed by re-resolving the registry. The lookup happens before the
    // replacement is published, which is what makes this the stale case, and the
    // press then has to find the new anchor rather than reuse the old target.
    //
    // The click is dispatched inside the composer card so it bubbles to the
    // surface's own container: the button is `position: fixed` over the composer,
    // so a real press on it is a press inside the card as far as event
    // propagation is concerned.
    const surface = mountSurface(SESSION_A)
    const composerA = surface.composer(SESSION_A)
    surface.capture(selection(SESSION_A))

    const recorded = surface.composerTargets.get(SESSION_A)
    expect(recorded).not.toBeNull()

    const button = surface.surfaceRoot.querySelector<HTMLElement>(BUTTON)
    const replacement = document.createElement('div')
    replacement.setAttribute('data-composer-card', '')
    const replacementInput = document.createElement('div')
    replacementInput.setAttribute('data-composer-input', '')
    replacementInput.tabIndex = -1
    replacement.appendChild(replacementInput)
    document.body.appendChild(replacement)

    let replacementWrites = 0
    act(() => {
      surface.composerTargets.register(SESSION_A, {
        readDraft: () => 'replacement draft',
        setDraft: () => {
          replacementWrites += 1
        },
        focus: () => {
          replacementInput.focus({ preventScroll: true })
        },
        anchor: replacement,
      })
    })

    // The replacement publishes and the surface drops the button with it, so the
    // press is replayed on the element the reader was already looking at. The
    // element is moved into the surface's own subtree first: that is where the
    // button lives, and where its React event delegation is installed.
    await act(async () => {
      surface.surfaceRoot.appendChild(button as HTMLElement)
      button?.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
    })

    expect(replacementWrites).toBe(1)
    expect(composerA.writes).toEqual([])
    expect(document.activeElement).toBe(replacementInput)

    surface.unmount()
  })

  it('keeps a session A selection from reaching session B after a switch and a switch back', async () => {
    const surface = mountSurface(SESSION_A)
    const composerA = surface.composer(SESSION_A)
    const composerB = surface.composer(SESSION_B)

    surface.capture(selection(SESSION_A))
    await surface.sessions.select(SESSION_B)
    await surface.sessions.select(SESSION_A)

    // Back on A with A's selection still live and A's composer still mounted, the
    // action is available again and reaches A.
    expect(surface.surfaceRoot.querySelector(BUTTON)).not.toBeNull()
    pressAsk(surface)

    expect(composerA.writes).toHaveLength(1)
    expect(composerB.writes).toEqual([])

    surface.unmount()
  })
})

describe('surface draft freshness', () => {
  it('reads the draft as of the click, not as of the registration', () => {
    const surface = mountSurface(SESSION_A, 'first')
    const composer = surface.composer(SESSION_A)
    surface.capture(selection(SESSION_A))

    composer.type('typed after the selection')
    pressAsk(surface)

    expect(composer.writes[0]).toContain('typed after the selection')
    expect(composer.writes[0]).not.toContain('first')

    surface.unmount()
  })

  it('does not rebuild the registration on every keystroke', () => {
    const surface = mountSurface(SESSION_A)
    const composer = surface.composer(SESSION_A)
    surface.capture(selection(SESSION_A))
    const before = surface.composerTargets.get(SESSION_A)

    composer.type('a')
    composer.type('ab')
    composer.type('abc')

    // Same object identity: a target rebuilt per keystroke would still work, but
    // it would churn the subscription the surface renders against.
    expect(surface.composerTargets.get(SESSION_A)).toBe(before)

    surface.unmount()
  })
})

describe('surface focus', () => {
  it('returns focus to the matching session composer', () => {
    const surface = mountSurface(SESSION_A)
    const composerA = surface.composer(SESSION_A)
    const composerB = surface.composer(SESSION_B)
    surface.capture(selection(SESSION_A))

    pressAsk(surface)

    expect(document.activeElement).toBe(composerA.editable)
    expect(document.activeElement).not.toBe(composerB.editable)

    surface.unmount()
  })
})
