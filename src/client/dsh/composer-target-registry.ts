/**
 * The bridge between the two halves of the Ask surface.
 *
 * Task 5C splits the Ask UI in two, and this module is what keeps the split from
 * costing session isolation. The **visible** surface — the button and the
 * rejection notice — now lives in `shell.overlay`, a root-scoped list slot that
 * is a sibling of every column; that is the only place from which a floating
 * surface can be painted above the document column. The **composer contract** it
 * needs — the session's latest draft, its public `setDraft`, and a way back to
 * its caret — can only be obtained inside the composer, from
 * `conversation.input.overlay`, which is session-scoped. The two slots are in
 * different React trees and different scopes, so the handoff has to be an
 * explicit object.
 *
 * Three properties of that object are deliberate, and each one rules out a
 * simpler design that was tried or considered.
 *
 * **It is created per `applyClient` call, never in module scope.** A
 * module-global registry would survive a hot reload and hold the *previous*
 * generation's targets: the new component generation would register into a table
 * whose stale entries still answer, and the overlay would write through a
 * `setDraft` bound to a composer that no longer exists. The registry is
 * therefore an ordinary object the client registration owns and discards.
 *
 * **It is keyed by session, never by position.** A document-wide lookup —
 * `document.querySelector('[data-composer-card]')` — returns whichever composer
 * the DOM happens to put first, and with two sessions mounted, a resident
 * composer, or a `conversation.composer` chain takeover that is not necessarily
 * the one the selection belongs to. The failure it produces is the worst kind
 * this plugin has: a quote appended to another session's draft. Lookup is
 * therefore `get(sessionId)` — the identity parsed from the snapshot's own
 * resource address — and a session with no registered target simply has no Ask
 * surface.
 *
 * **It is React-free.** The registry is an ordinary mutable table with a
 * `subscribe` method, exactly like `SelectionKernel` and
 * `SelectionFeedbackSource`. React is a consumer of it, not a participant, which
 * is what lets the same object be driven from a client spec without a document.
 *
 * **A stale disposer must not remove a live target.** React mounts the new
 * generation of a session's composer before it unmounts the old one, so two
 * registrations for one session id overlap during an ordinary transition. A
 * disposer that unconditionally deleted its key would let the *old* component's
 * cleanup evict the *new* component's target, and the Ask button would vanish
 * from a session that is perfectly alive. Each registration therefore carries an
 * identity token, and its disposer removes the entry only while that token is
 * still the current one.
 */

import { createComposerFocus } from './focus-composer.js'

/**
 * The composer contract one session-scoped registrar publishes.
 *
 * The three members mirror `ComposerTarget` in `composer-bridge.ts`, which is
 * the only consumer that writes through this table; there is deliberately no
 * second writer of composer state anywhere in the plugin.
 */
export interface ComposerTarget {
  /**
   * Read the session's draft as the composer holds it right now.
   * @returns the current draft text.
   */
  readDraft(): string
  /**
   * Replace the whole draft through the public action face.
   * @param text - the complete next draft.
   */
  setDraft(text: string): void
  /**
   * Return keyboard focus to this session's composer.
   *
   * The callback is built from the registrar's own DOM anchor, so focus can only
   * ever land in the composer that published this target.
   */
  focus(): void
  /**
   * The registrar's own DOM anchor inside `[data-composer-card]`.
   *
   * The root overlay reads it for two things: the no-geometry fallback position
   * (which needs a composer box) and the focus search. It is the element that
   * makes the search session-scoped, so it is part of the published contract
   * rather than a private field.
   */
  readonly anchor: Element | null
}

/**
 * The per-application target table the two slot halves share.
 *
 * Obtain one from {@link createComposerTargetRegistry}. The interface is
 * exported so the overlay can depend on the contract without constructing an
 * implementation, and so a spec can substitute one.
 */
export interface ComposerTargetRegistry {
  /**
   * Publish one session's composer target.
   *
   * A second registration for a session id replaces the first: the newest
   * registration is the one a reader's click must reach, because it belongs to
   * the newest mounted composer.
   *
   * @param sessionId - the session whose composer this target drives.
   * @param target - the composer contract, bound to that session's own DOM.
   * @returns an idempotent disposer that removes this registration, and only
   * this one.
   */
  register(sessionId: string, target: ComposerTarget): () => void
  /**
   * Resolve the composer target for a session.
   *
   * @param sessionId - the session to look up.
   * @returns the live target, or `null` when that session has no mounted
   * composer. A `null` answer is the reason the Ask surface stays hidden: there
   * is nothing this plugin could safely write to.
   */
  get(sessionId: string): ComposerTarget | null
  /**
   * Observe registration changes.
   *
   * The overlay subscribes rather than polling, because a session becoming
   * current and a composer mounting are independent events and the button may
   * only appear once both have happened.
   *
   * @param listener - called after each registration, replacement or removal.
   * @returns an idempotent disposer that stops further calls to `listener`.
   */
  subscribe(listener: () => void): () => void
}

/**
 * Build an empty target registry.
 *
 * The instance owns one map and one listener set, and holds no module-level
 * state, so two `applyClient` calls — a hot reload, or an application and its
 * specs — never share targets.
 *
 * @returns a registry with no targets and no listeners.
 */
export function createComposerTargetRegistry(): ComposerTargetRegistry {
  /**
   * The live target per session, with the token that owns the entry. The token
   * is a fresh object per registration and is never compared by value: it exists
   * only so a superseded disposer can recognise that it no longer owns the slot.
   */
  const targets = new Map<string, { readonly token: object; readonly target: ComposerTarget }>()
  const listeners = new Set<() => void>()

  /** Publish a table change to every live listener, in subscription order. */
  function notify(): void {
    for (const listener of [...listeners]) {
      listener()
    }
  }

  return {
    register(sessionId: string, target: ComposerTarget): () => void {
      const token = {}
      targets.set(sessionId, { token, target })
      notify()

      let disposed = false
      return () => {
        // Idempotent for the same reason every other disposer in this plugin is:
        // React may run a cleanup twice, and the second call must not evict a
        // registration that is not this one's.
        if (disposed) {
          return
        }
        disposed = true

        // Identity-checked, not key-deleted. During a React transition the new
        // composer's registration lands before the old one's cleanup runs, so an
        // unconditional delete here would remove the live target and hide the
        // Ask button for a session that is still open.
        if (targets.get(sessionId)?.token !== token) {
          return
        }

        targets.delete(sessionId)
        notify()
      }
    },

    get(sessionId: string): ComposerTarget | null {
      return targets.get(sessionId)?.target ?? null
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      let disposed = false

      return () => {
        if (disposed) {
          return
        }
        disposed = true
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Build the anchor-scoped focus callback for one registration.
 *
 * This is the whole of the focus policy, and it is a two-line composition on
 * purpose: `createComposerFocus` already owns the one DOM contract the plugin
 * depends on — walk up from an origin inside the composer, then focus the
 * editable surface it finds — and the only thing this round changed about that
 * search is which element it starts from.
 *
 * The origin is the registrar's own anchor, which lives inside the composer card
 * by construction. The search therefore cannot reach another session's composer,
 * even when several are mounted, and it never starts from the document.
 *
 * @param target - the registration whose anchor the search starts from.
 * @returns a callback that focuses this registration's composer, or does nothing
 * when its anchor is no longer mounted.
 */
export function createTargetFocus(target: ComposerTarget): () => void {
  return createComposerFocus(() => target.anchor)
}
