/**
 * The Ask overlay: one floating button, plus the notice for a refused capture.
 *
 * It occupies `conversation.input.overlay`, a session-scoped list slot the
 * composer bar renders inside `[data-composer-card]`. That position is what
 * makes the rest of the module possible — the button lives in the same subtree
 * as the editable surface it returns focus to — and it is why the overlay is
 * not portalled anywhere: a portal would leave the React tree DSH manages and
 * take the composer search with it.
 *
 * The component owns the bridge, because it is the only place both halves of the
 * composer contract are in scope at once. The **runtime props** carry
 * `sessionId`, `useInput` and `inputActions`; the **injected face** carries the
 * selection and feedback stores. The draft therefore comes from the composer's
 * own published state and goes back through its own published action, and the
 * bridge stays a pure function of what it is handed.
 *
 * Four behaviours are the reason this file exists rather than a bare button.
 *
 * **The button must not destroy the selection it describes.** Pressing a button
 * moves focus, and moving focus collapses the browser selection. The snapshot is
 * already frozen in the kernel by then, so the click would still work — but the
 * highlight would disappear under the reader's hand before they committed to
 * anything, and in a browser that is a visible regression. `preventDefault` on
 * `pointerdown` stops the press from taking focus, which leaves both the
 * selection and the snapshot intact until the click handler runs. jsdom cannot
 * prove this: it implements no focus-driven selection collapse, so the assertion
 * that matters is the browser one.
 *
 * **The notice outlives the button.** A refusal is precisely the case where
 * there is no selection, so the notice is rendered by its own branch and not
 * behind the button's visibility. Hanging it off the button would show the
 * size-limit message only in the one state where it can never be needed.
 *
 * **The draft is read when the button is pressed.** The composer's state hook is
 * read inside the handler, never at render time and never at capture time,
 * because the reader may have typed since selecting and the write replaces the
 * whole draft.
 *
 * **The snapshot is cleared only after a write that succeeded.** The ordering is
 * enforced by `composer-bridge.ts`; this component only decides what to do with
 * its outcome.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import { createComposerBridge } from '../dsh/composer-bridge.js'
import { createComposerFocus } from '../dsh/focus-composer.js'
import type { SelectionFeedback } from '../selection/feedback.js'
import type { SelectionSnapshot } from '../selection/types.js'
import { SelectionErrorToast } from './SelectionErrorToast.js'
import { documentSelectionStrings } from './locales.js'
import { isSameSession, overlayPosition } from './position.js'

/** A projection read from a snapshot source through a framework-bound selector hook. */
type MappedSelector<T, S> = (selector: (value: T) => S) => S

/** The snapshot-source currency the plugin's own stores publish. */
interface SnapshotSource<T> {
  /**
   * Read the current value.
   * @returns the live value.
   */
  getSnapshot(): T
  /**
   * Observe value changes.
   * @param listener - called after each change.
   * @returns a disposer that stops further calls to `listener`.
   */
  subscribe(listener: () => void): () => void
}

/**
 * Subscribe a component to one of this plugin's snapshot sources.
 *
 * The plugin's own sources — the selection kernel and the feedback slot — are
 * read through this hook rather than through `useSyncExternalStore`, and the
 * reason is measured rather than stylistic. A store bound into the slot
 * machinery's `hooks` compartment reaches the component as a **prop**, so it is
 * invoked from a closure the framework's renderer created. `useSyncExternalStore`
 * resolves its subscription through the dispatcher of the component that is
 * rendering, and the client specs observed it silently skipping the subscription
 * when it was reached that way: the store kept its value, the component never
 * re-rendered, and the overlay would have frozen on whatever it first saw. A
 * `useState`/`useEffect` pair has no such dependency — it re-reads the source on
 * every notification — and because the source is passed in explicitly, the
 * production path and the specs run identical code.
 *
 * `useInput` is deliberately *not* read this way. It is the composer's own
 * published state, its identity belongs to the conversation package, and the
 * overlay consumes it exactly as every other session-scoped entry does.
 *
 * @param source - the store to observe.
 * @returns the current value, re-rendered on change.
 */
export function useSnapshotSource<T>(source: SnapshotSource<T>): T {
  const [value, setValue] = useState<T>(() => source.getSnapshot())

  useEffect(() => {
    // Read once on install as well: the source may have changed between the
    // render that seeded the state and the commit that installed the
    // subscription, and a missed change would leave the overlay stale until the
    // next one.
    setValue(source.getSnapshot())
    return source.subscribe(() => {
      setValue(source.getSnapshot())
    })
  }, [source])

  return value
}

/** The composer state fields this overlay reads. */
interface ComposerState {
  /** Clipboard-text projection of the composer's document. */
  readonly draft: string
}

/** The composer action fields this overlay writes through. */
interface ComposerActions {
  /**
   * Replace the whole draft through the public action face.
   * @param text - the complete next draft.
   */
  setDraft(text: string): void
}

/**
 * Everything the Ask overlay reads.
 *
 * The first three members are supplied by the framework through
 * `PropsRuntime<'conversation.input.overlay'>` — strict session-scoped standard
 * props plus global ones. The last four are the registrant's injected face,
 * which `registerOverlay` builds.
 *
 * The copy is not a prop. There is no locale seat on a slot registration this
 * plugin can declare, so the strings are resolved from the document on each
 * render instead of being frozen at apply time; that keeps a language change
 * observable without inventing a second subscription.
 */
export interface SelectionAskOverlayProps {
  /** Session identity of the composer this overlay is rendered inside. */
  readonly sessionId: string
  /** Selector hook over this session's composer state. */
  readonly useInput: MappedSelector<ComposerState, string>
  /** This session's public composer actions. */
  readonly inputActions: ComposerActions
  /** The transient selection store, injected from the client runtime. */
  readonly selection: SnapshotSource<SelectionSnapshot | null>
  /** The rejection feedback store, injected from the client runtime. */
  readonly feedback: SnapshotSource<SelectionFeedback>
  /** Clear the captured selection after a successful ask. */
  readonly clearSelection: () => void
  /** Drop the rejection feedback after a successful ask. */
  readonly clearFeedback: () => void
}

/**
 * Render the Ask button and the rejection notice.
 *
 * @param props - the framework's runtime props plus the injected face.
 * @returns the overlay, which may be the button, the notice, both, or nothing.
 */
export function SelectionAskOverlay(props: SelectionAskOverlayProps): JSX.Element {
  const snapshot = useSnapshotSource(props.selection)
  const feedback = useSnapshotSource(props.feedback)
  const draft = props.useInput((value) => value.draft)

  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const [placement, setPlacement] = useState<{ readonly left: number; readonly top: number } | null>(null)
  const visible = snapshot !== null && isSameSession(snapshot, props.sessionId)
  // The running document, captured when the button first attaches. Resolving the
  // copy from the anchor during render would read `null` on the render that
  // mounts the button, and the first paint would then show the wrong language
  // until something else re-rendered — which, with a selection standing still,
  // is never.
  const [doc, setDoc] = useState<Document | null>(null)
  const strings = documentSelectionStrings(doc ?? undefined)

  const attachAnchor = useCallback((node: HTMLButtonElement | null) => {
    anchorRef.current = node
    setDoc(node?.ownerDocument ?? null)
  }, [])

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const view = anchor?.ownerDocument.defaultView ?? null
    if (!visible || snapshot === null || anchor === null || view === null) {
      setPlacement(null)
      return
    }

    const box = anchor.getBoundingClientRect()
    setPlacement(
      overlayPosition(
        anchor,
        snapshot.rects,
        { width: box.width, height: box.height },
        { width: view.innerWidth, height: view.innerHeight },
      ),
    )
  }, [visible, snapshot])

  const onPointerDown = useCallback((event: { preventDefault(): void }) => {
    // Preventing the default of a pointer press is what suppresses the focus
    // change, and the focus change is what collapses the selection.
    event.preventDefault()
  }, [])

  const onClick = useCallback(() => {
    if (snapshot === null) {
      return
    }

    const bridge = createComposerBridge({
      // Bound to the value this render read. The composer publishes a new state
      // object on every edit, so the overlay re-renders per keystroke and this
      // closure is never staler than the last committed render — which is the
      // draft the reader sees when they press the button.
      readDraft: () => draft,
      setDraft: (text) => {
        props.inputActions.setDraft(text)
      },
      focus: createComposerFocus(() => anchorRef.current),
    })

    const outcome = bridge.appendSelection(snapshot)
    if (!outcome.ok) {
      // The snapshot stays: the reader keeps the button and can press it again.
      return
    }

    props.clearSelection()
    props.clearFeedback()
  }, [props, snapshot, draft])

  return (
    <>
      {visible ? (
        <div data-dsa-selection-ask="">
          <button
            data-dsa-selection-ask-button=""
            ref={attachAnchor}
            type="button"
            style={placement === null ? HIDDEN : { left: placement.left, top: placement.top }}
            onPointerDown={onPointerDown}
            onClick={onClick}
          >
            {strings.ask}
          </button>
        </div>
      ) : null}
      <SelectionErrorToast feedback={feedback} strings={strings} />
    </>
  )
}

/**
 * Style used before the button has been measured.
 *
 * The button must be rendered before its position is known — measuring it is
 * what produces the position — so the first paint must not show it at the
 * document origin. `visibility` rather than `display` keeps it measurable, which
 * is what the layout effect depends on.
 */
const HIDDEN = { visibility: 'hidden' } as const
