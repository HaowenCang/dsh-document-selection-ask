/**
 * Returning focus to the composer after an Ask.
 *
 * The approved behaviour ends with the reader's caret back in the composer, so
 * they can type their question without reaching for the mouse. What makes that
 * non-trivial is that DSH rc.1 publishes no focus action on the input facade —
 * `InputActions` carries `setDraft`, the attachment verbs and `submit`, and
 * nothing that names the editable element. The element is reachable only through
 * the DOM, so this module owns the one DOM contract the plugin is allowed to
 * depend on. It is deliberately the smallest module in the Ask flow.
 *
 * **The contract, as rc.1 renders it.** The composer card is
 * `[data-composer-card]`, and inside it the editable surface is
 * `[data-composer-input]` — a `contenteditable` `div` that the shell binds its
 * Lexical editor to. `dsh-client-ui-conversation` observes exactly this rule
 * itself: its own focus path is
 * `editor.getRootElement()?.focus({ preventScroll: true })`, and the element it
 * hands the editor is the one carrying `data-composer-input`.
 *
 * **Why the search starts at a session-scoped DOM anchor.** The origin is the
 * `ComposerTargetRegistrar`'s own invisible anchor, which lives inside
 * `[data-composer-card]` by construction because that is the slot the registrar
 * occupies. The card is therefore found by walking up from an element that
 * belongs to the session being written to, rather than by querying the document.
 * A document-wide lookup would grab whichever composer happens to be first in the
 * DOM — which, with two sessions open, is how one session's quote gets typed into
 * another session's draft. This is also why the Ask button could move out of the
 * composer in Task 5C without changing the focus contract: the button is no
 * longer a descendant of the card, but the registrar still is, and the registrar
 * is what supplies the origin. When no card encloses the origin, there is nothing
 * safe to focus and the call is a no-op; the quote is already in the draft at
 * that point, so a missed focus degrades to "the reader clicks the composer",
 * never to a wrong composer.
 *
 * **What this module must not do.** It calls `focus` and nothing else. It does
 * not assign `value`, does not set `textContent`, does not dispatch an input
 * event, does not touch the selection or caret, does not read a React fiber, and
 * does not reach for the Lexical editor. Every one of those would be a second
 * writer of composer state racing the editor that owns it, and the draft is
 * written exactly once, through `inputActions.setDraft`.
 */

/** The composer card DSH renders around the editable surface. */
export const COMPOSER_CARD_SELECTOR = '[data-composer-card]'

/** The editable surface inside that card, verified against rc.1. */
export const COMPOSER_INPUT_SELECTOR = '[data-composer-input]'

/**
 * Find the editable surface of the composer that contains an element.
 *
 * @param origin - a node inside the composer card, normally the session
 * registrar's anchor.
 * @returns the editable element, or `null` when the node is not inside a
 * composer card or the card has no editable surface.
 */
export function composerEditableWithin(origin: Element | null): HTMLElement | null {
  if (origin === null) {
    return null
  }

  const card = origin.closest(COMPOSER_CARD_SELECTOR)
  if (card === null) {
    return null
  }

  const input = card.querySelector(COMPOSER_INPUT_SELECTOR)
  return input instanceof HTMLElement ? input : null
}

/**
 * Build a focus callback bound to one DOM origin.
 *
 * The element is resolved at call time rather than at construction, because the
 * anchor does not exist when the client registration runs and the composer card
 * is mounted and unmounted as the session changes.
 *
 * @param readOrigin - returns the element the search starts from.
 * @returns a callback that focuses this composer's editable surface.
 */
export function createComposerFocus(readOrigin: () => Element | null): () => void {
  return () => {
    const editable = composerEditableWithin(readOrigin())
    if (editable === null) {
      return
    }

    // The same call the shell's own focus path uses: move focus without
    // scrolling the composer into view, which would jump the conversation when
    // the reader had scrolled away from it.
    editable.focus({ preventScroll: true })
  }
}
