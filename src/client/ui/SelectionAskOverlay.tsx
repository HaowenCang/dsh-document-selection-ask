/**
 * The Ask surface: one floating button, plus the notice for a refused capture.
 *
 * It occupies `shell.overlay` — the frame-wide floating layer the shell renders
 * as a sibling of all three columns, outside their scroll containers, at
 * `z-index: 20` with `pointer-events: none` on the layer and `auto` on its
 * entries. That position is the whole point of Task 5C. While this component
 * lived in `conversation.input.overlay` it was inside `wSkVaW_composerStack`
 * (`z-index: 1`), so the expanded right column — a later sibling in the same
 * stacking context — painted over it: the button was visible and
 * `document.elementFromPoint` at its own centre returned the document preview,
 * which meant a reader could not press it. No `z-index` of the plugin's own can
 * escape a stacking context it does not own, which is why the fix moved the
 * surface rather than raising a number.
 *
 * **What the move costs, and how it is paid.** The composer's own contract —
 * `useInput` and `inputActions` — is session-scoped and is only available inside
 * the composer, and this component is no longer there. Two things replace it,
 * and neither is a document-wide lookup:
 *
 * - the session that must receive the write comes from the public global
 *   standard prop `useSessions`, projected onto `state.current`;
 * - the composer that receives it comes from `ComposerTargetRegistry`, keyed by
 *   that same session id, where the session-scoped `ComposerTargetRegistrar`
 *   inside the composer card published it.
 *
 * `document.querySelector('[data-composer-card]')` is deliberately not used
 * anywhere: with several sessions mounted, a resident composer, or a
 * `conversation.composer` chain takeover, the first DOM match is not provably the
 * composer the selection belongs to, and the failure it produces is a quote
 * written into another session's draft.
 *
 * **The three-way gate.** The button is shown only when three identities agree:
 * the session parsed from the snapshot's own resource address, the session the
 * shell currently has selected, and a session that has a registered composer
 * target. Any one of them missing hides the button and makes the draft
 * unwritable — including the case where the address proves no session at all,
 * because an `absolute` resource names a file and not the session viewing it.
 *
 * **The press is re-resolved, never reused.** The target is read at click time
 * rather than kept from render, so a session switch between the render and the
 * click cannot write through a closure that belongs to the session the reader
 * just left. The same re-check is repeated for the active session for the same
 * reason.
 *
 * Four behaviours carried over from Task 5 are unchanged and remain the reason
 * this is not a bare button.
 *
 * **The button must not destroy the selection it describes.** Pressing a button
 * moves focus, and moving focus collapses the browser selection. The snapshot is
 * already frozen in the kernel by then, so the click would still work — but the
 * highlight would disappear under the reader's hand before they committed to
 * anything. `preventDefault` on `pointerdown` stops the press from taking focus,
 * which leaves both the selection and the snapshot intact until the click handler
 * runs. jsdom implements no focus-driven selection collapse, so the assertion
 * that matters is the browser one.
 *
 * **The notice outlives the button.** A refusal is precisely the case where
 * there is no selection, so the notice is rendered by its own branch and not
 * behind the button's visibility. Hanging it off the button would show the
 * size-limit message only in the one state where it can never be needed.
 *
 * **The draft is read when the button is pressed.** The write replaces the whole
 * draft, so the target's `readDraft` is called inside the handler, never at
 * render time: the reader may have typed since selecting.
 *
 * **The snapshot is cleared only after a write that succeeded.** The ordering is
 * enforced by `composer-bridge.ts`; this component only decides what to do with
 * its outcome.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import type { ComposerTargetRegistry } from '../dsh/composer-target-registry.js'
import { createTargetFocus } from '../dsh/composer-target-registry.js'
import { createComposerBridge } from '../dsh/composer-bridge.js'
import { sessionIdFromResourceAddress } from '../provenance/file-name.js'
import type { SelectionFeedback } from '../selection/feedback.js'
import type { SelectionSnapshot } from '../selection/types.js'
import { SelectionErrorToast } from './SelectionErrorToast.js'
import { documentSelectionStrings } from './locales.js'
import { overlayPosition } from './position.js'

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
 * The plugin's own sources — the selection kernel, the feedback slot and the
 * composer target registry — are read through this hook rather than through
 * `useSyncExternalStore`, and the reason is measured rather than stylistic. A
 * store bound into the slot machinery's `hooks` compartment reaches the
 * component as a **prop**, so it is invoked from a closure the framework's
 * renderer created. `useSyncExternalStore` resolves its subscription through the
 * dispatcher of the component that is rendering, and the client specs observed it
 * silently skipping the subscription when it was reached that way: the store kept
 * its value, the component never re-rendered, and the overlay would have frozen
 * on whatever it first saw. A `useState`/`useEffect` pair has no such dependency
 * — it re-reads the source on every notification — and because the source is
 * passed in explicitly, the production path and the specs run identical code.
 *
 * The registry needs this for a second reason: a session becoming current and a
 * composer mounting are independent events, so the button's visibility can
 * change without either the snapshot or the active session changing.
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

/** The shell's session-list state, as this component consumes it. */
interface SessionListLike {
  /** The session the shell currently has selected, if any. */
  readonly current: string | undefined
}

/**
 * Everything the Ask surface reads.
 *
 * The first member is supplied by the framework through `PropsRuntime<'shell.overlay'>`
 * — the root scope carries the **global** standard props, and `useSessions` is
 * one of them, merged into `GlobalStandardProps` by
 * `@deepseek-ai/dsh-client-ui-session`. It is the published route to the active
 * session, and the only one this component uses: `ctx.sessions` is not read, no
 * private store is touched, and no DOM is searched for a "current" composer.
 *
 * The remaining members are the registrant's injected face, which
 * `registerAskSurface` builds. The copy is not a prop: there is no locale seat on
 * a slot registration this plugin can declare, so the strings are resolved from
 * the document on each render, which keeps a language change observable without
 * inventing a second subscription.
 */
export interface SelectionAskOverlayProps {
  /** The shell's session-list selector hook, from the global standard props. */
  readonly useSessions: MappedSelector<SessionListLike, string | undefined>
  /** The transient selection store, injected from the client runtime. */
  readonly selection: SnapshotSource<SelectionSnapshot | null>
  /** The rejection feedback store, injected from the client runtime. */
  readonly feedback: SnapshotSource<SelectionFeedback>
  /** The per-session composer target table, injected from the client runtime. */
  readonly composerTargets: ComposerTargetRegistry
  /** Clear the captured selection after a successful ask. */
  readonly clearSelection: () => void
  /** Drop the rejection feedback after a successful ask. */
  readonly clearFeedback: () => void
}

/**
 * Re-render a component whenever a subscription reports a change.
 *
 * The Ask surface needs this for the composer target table, which publishes only
 * `subscribe`: the table's *value* is a lookup keyed by session, so there is no
 * single snapshot to compare, and what changes is the answer to a question the
 * component asks during render. Subscribing and re-reading on each notification
 * is the whole contract — and the counter is what makes React commit, because a
 * `state` setter given the same value would bail out.
 *
 * `useState`/`useEffect` is used rather than `useSyncExternalStore` for the reason
 * {@link useSnapshotSource} records: a store handed to the component through the
 * slot framework reaches it as a prop, and the client specs observed React
 * skipping the subscription when `useSyncExternalStore` was reached that way.
 *
 * @param subscribe - installs a listener and returns its disposer.
 */
function useSubscription(subscribe: (listener: () => void) => () => void): void {
  const [, setRevision] = useState(0)

  useEffect(() => subscribe(() => {
    setRevision((value) => value + 1)
  }), [subscribe])
}

/**
 * Subscribe the surface to the shell's active session.
 *
 * `useSessions` is the published route to the selected session, and reading it
 * through the global standard props is the whole of the session-identity rule on
 * this side of the bridge. The ref mirrors the answer on every render so the
 * click handler can restate the same comparison without calling a selector hook
 * outside a render, which React does not permit.
 *
 * @param useSessions - the shell's session-list selector hook.
 * @returns the selected session as of this render, and a ref holding the latest.
 */
function useActiveSession(
  useSessions: MappedSelector<SessionListLike, string | undefined>,
): { readonly activeSessionId: string | undefined; readonly liveSessionId: { current: string | undefined } } {
  const activeSessionId = useSessions((state) => state.current)
  const liveSessionId = useRef(activeSessionId)
  liveSessionId.current = activeSessionId
  return { activeSessionId, liveSessionId }
}

/**
 * Render the Ask button and the rejection notice.
 *
 * @param props - the framework's global props plus the injected face.
 * @returns the overlay, which may be the button, the notice, both, or nothing.
 */
export function SelectionAskOverlay(props: SelectionAskOverlayProps): JSX.Element {
  const { composerTargets, feedback: feedbackSource, selection: selectionSource } = props
  const snapshot = useSnapshotSource(selectionSource)
  const feedback = useSnapshotSource(feedbackSource)
  const { activeSessionId, liveSessionId } = useActiveSession(props.useSessions)

  // Subscribed before the gate is computed: a session becoming current and a
  // composer registering its target are independent events, so the button may
  // become available without either the snapshot or the active session changing.
  const subscribeTargets = useCallback(
    (listener: () => void) => composerTargets.subscribe(listener),
    [composerTargets],
  )
  useSubscription(subscribeTargets)

  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const [placement, setPlacement] = useState<{ readonly left: number; readonly top: number } | null>(null)

  // The three-way gate, computed from the snapshot's own address rather than from
  // any ambient "current composer". `null` for the selected session — an address
  // that is not session-scoped — hides the surface instead of guessing an owner.
  const selectedSession = snapshot === null ? null : sessionIdFromResourceAddress(snapshot.resourceAddress)
  const target =
    selectedSession !== null && selectedSession === activeSessionId
      ? composerTargets.get(selectedSession)
      : null
  const visible = snapshot !== null && target !== null

  // The running document. The button's own owner document is preferred, because
  // it is the document the surface actually painted into; the ambient document is
  // the fallback for the one state where there is no button to read it from — a
  // refusal, which has no selection and therefore renders the notice alone.
  // Without that fallback an English document showed its refusal in Chinese,
  // which is the same defect as rendering no notice at all for a reader who
  // cannot read it.
  const [doc, setDoc] = useState<Document | null>(null)
  const strings = documentSelectionStrings(doc ?? globalThis.document)

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
        // The fallback position is the composer's own corner, and this surface is
        // no longer inside the composer, so the origin is the registrar's anchor
        // rather than the button's own subtree.
        target?.anchor ?? null,
        snapshot.rects,
        { width: box.width, height: box.height },
        { width: view.innerWidth, height: view.innerHeight },
      ),
    )
  }, [visible, snapshot, target])

  const onPointerDown = useCallback((event: { preventDefault(): void }) => {
    // Preventing the default of a pointer press is what suppresses the focus
    // change, and the focus change is what collapses the selection.
    event.preventDefault()
  }, [])

  const onClick = useCallback(() => {
    if (snapshot === null) {
      return
    }

    // Resolved again here rather than reused from the render, so the press acts on
    // the table as it stands. The registry is the one input to this decision that
    // can move without the surface re-rendering against it — a replacement
    // composer publishing a new target for the same session — and the ref carries
    // the active session so the same comparison can be restated without calling a
    // selector hook outside a render. The write can therefore only ever reach the
    // target that the session the reader is looking at owns right now.
    const selected = sessionIdFromResourceAddress(snapshot.resourceAddress)
    if (selected === null || selected !== liveSessionId.current) {
      return
    }

    const resolved = composerTargets.get(selected)
    if (resolved === null) {
      return
    }

    const bridge = createComposerBridge({
      // Bound to the target rather than to a value this render read: the target
      // reports the draft as of this call, from the composer's own published
      // state, so the write cannot discard text typed after the selection.
      readDraft: () => resolved.readDraft(),
      setDraft: (text) => {
        resolved.setDraft(text)
      },
      focus: createTargetFocus(resolved),
    })

    const outcome = bridge.appendSelection(snapshot)
    if (!outcome.ok) {
      // The snapshot stays: the reader keeps the button and can press it again.
      return
    }

    props.clearSelection()
    props.clearFeedback()
  }, [composerTargets, liveSessionId, props, snapshot])

  return (
    <>
      {visible ? (
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
