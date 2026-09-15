/**
 * The session half of the Ask surface.
 *
 * This component draws nothing. It exists so that the half of the Ask contract
 * that can only be obtained inside the composer — the session's published draft,
 * its public `setDraft`, and a DOM anchor from which the caret can be returned —
 * is still obtained from inside the composer, while the visible button is free
 * to live in a slot that can actually be painted above the document column.
 *
 * **Why the split exists.** Task 5B recorded the production defect: with the
 * right column expanded, the Ask button was on screen and unpressable.
 * `conversation.input.overlay` renders inside `wSkVaW_composerStack`, whose
 * `z-index: 1` traps the overlay's own `z-index: 20` in a lower stacking context
 * than the right column, so the column painted over the button and
 * `document.elementFromPoint` at the button's own centre returned the preview.
 * No `z-index` the plugin can set escapes a stacking context it does not own. The
 * fix is to move the surface to `shell.overlay`, which the frame renders as a
 * sibling of both columns at `z-index: 20`; this component is the other half of
 * that move, and the target it publishes is how the moved surface still reaches
 * the right composer.
 *
 * **Why the draft is a subscription rather than a render-time read.** The root
 * overlay cannot call the composer's `useInput`: that is a selector hook built on
 * `useSyncExternalStore`, so it is only legal during a React render, and the
 * consuming component lives in another slot. The composer's published state is
 * therefore read here, where the hook is legal, and the target reports it through
 * a ref so the value the overlay writes through is the draft as of the click
 * rather than the draft as of the registration. A reader may select text, keep
 * typing, and only then press Ask; the write replaces the whole draft, so a
 * frozen value would silently discard everything typed in between.
 *
 * **Why the anchor is invisible and inert.** The focus contract in rc.1 is a DOM
 * walk: the shell publishes no focus action, and the only route back to the
 * editable surface is `[data-composer-card] > [data-composer-input]`. This
 * component renders a zero-sized, `aria-hidden`, `pointer-events: none` span
 * inside the composer card purely to be the origin of that walk. It occupies no
 * layout, receives no events, and is not part of the Ask UI; the class-free
 * `data-dsa-composer-target-anchor` attribute is its only visible trace, and the
 * client specs assert against it.
 *
 * **Why the registration is stable across keystrokes.** Everything the target
 * closes over is either a ref or a value that does not change per keystroke:
 * `readDraft` dereferences the draft ref, `setDraft` calls the action face
 * through a ref, and `focus` walks from the anchor element. The registration
 * effect therefore depends only on the session id and the registry — never on a
 * value the composer republishes — so typing cannot destroy and rebuild the
 * registration the root overlay is rendering against. A target rebuilt per
 * keystroke would still work, but it would churn the registry's subscription and
 * the surface's render, and the churn would be proportional to how fast the
 * reader types.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { JSX } from 'react'

import type { ComposerTarget, ComposerTargetRegistry } from '../dsh/composer-target-registry.js'
import { createTargetFocus } from '../dsh/composer-target-registry.js'

/** A projection read from a snapshot source through a framework-bound selector hook. */
type MappedSelector<T, S> = (selector: (value: T) => S) => S

/** The composer state fields this registrar reads. */
interface ComposerState {
  /** Clipboard-text projection of the composer's document. */
  readonly draft: string
}

/** The composer action fields this registrar writes through. */
interface ComposerActions {
  /**
   * Replace the whole draft through the public action face.
   * @param text - the complete next draft.
   */
  setDraft(text: string): void
}

/**
 * Everything the registrar reads.
 *
 * The first three members are supplied by the framework through
 * `PropsRuntime<'conversation.input.overlay'>` — the session-scoped standard
 * props. The last is the registrant's injected face, which `registerComposerTarget`
 * builds. The registrar draws nothing and takes no locale seat, because nothing
 * it produces has copy.
 */
export interface ComposerTargetRegistrarProps {
  /** Session identity of the composer this registrar is rendered inside. */
  readonly sessionId: string
  /** Selector hook over this session's composer state. */
  readonly useInput: MappedSelector<ComposerState, string>
  /** This session's public composer actions. */
  readonly inputActions: ComposerActions
  /** The target table the root-scoped Ask surface reads. */
  readonly composerTargets: ComposerTargetRegistry
}

/**
 * Publish this session's composer target and render nothing visible.
 *
 * @param props - the framework's session props plus the injected target table.
 * @returns an inert anchor, which is the only markup this component produces.
 */
export function ComposerTargetRegistrar(props: ComposerTargetRegistrarProps): JSX.Element {
  const { composerTargets, inputActions, sessionId } = props

  // The composer's published draft, read through the hook that is only legal
  // here. The ref is what the target reads, so the click-time value is the
  // latest committed draft rather than the value the registration captured.
  const draft = props.useInput((value) => value.draft)
  const draftRef = useRef(draft)
  draftRef.current = draft

  // The action face is read through a ref for the same reason, and for one more:
  // it is a prop identity the framework does not promise to keep stable across
  // renders, and depending on it would rebuild the registration — and churn the
  // surface's subscription — on every render the composer performs.
  const actionsRef = useRef(inputActions)
  actionsRef.current = inputActions

  const anchorRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const target: ComposerTarget = {
      readDraft: () => draftRef.current,
      setDraft: (text) => {
        actionsRef.current.setDraft(text)
      },
      focus: () => {
        // Resolved per call rather than captured at registration: the walk has
        // to start from the anchor mounted right now, and the registration
        // outlives any particular render.
        createTargetFocus(target)()
      },
      get anchor(): Element | null {
        return anchorRef.current
      },
    }

    return composerTargets.register(sessionId, target)
  }, [composerTargets, sessionId])

  const attachAnchor = useCallback((node: HTMLSpanElement | null) => {
    anchorRef.current = node
  }, [])

  return <span ref={attachAnchor} data-dsa-composer-target-anchor="" aria-hidden="true" />
}
