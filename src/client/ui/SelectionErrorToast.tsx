/**
 * The rejection notice.
 *
 * One job: render the feedback the selection source published, and render
 * nothing when it published nothing. It holds no state, no timer and no
 * dismissal logic — the lifecycle clears the feedback when the reader's next
 * gesture replaces it, and a second source of truth for "is this still relevant"
 * is how a notice ends up outliving the gesture that produced it.
 *
 * The copy is passed in rather than resolved here so the component stays free of
 * a document lookup, and so the integrity spec can assert the exact code points
 * of what is rendered.
 *
 * **Why the live region is always mounted.** A `role="status"` region that is
 * inserted already populated is not reliably announced: assistive technology
 * observes mutations *inside* a region it already knows about, so a node that
 * appears with its message in the same commit can be silent — and this notice is
 * the only channel a refused capture has. The region is therefore rendered on
 * every mount and only its child is conditional, so the message always arrives as
 * a mutation of a region that already existed. The region carries no size, no
 * pointer target and no accessible name of its own, so an empty one is inert.
 */

import type { JSX } from 'react'

import type { SelectionFeedback } from '../selection/feedback.js'
import type { SelectionStrings } from './locales.js'

/** The message each reported feedback kind renders. */
const MESSAGE: Readonly<
  Record<'too-large' | 'too-many-cells', (strings: SelectionStrings) => string>
> = {
  'too-large': (strings) => strings.selectionTooLarge,
  'too-many-cells': (strings) => strings.tooManyCells,
}

/** Props of the rejection notice. */
export interface SelectionErrorToastProps {
  /** The feedback to render, or `null` for nothing. */
  readonly feedback: SelectionFeedback
  /** Resolved copy for the running locale. */
  readonly strings: SelectionStrings
}

/**
 * Render the rejection notice.
 *
 * @param props - the feedback and the resolved copy.
 * @returns the always-present live region, with the notice inside it when there
 * is something to report.
 */
export function SelectionErrorToast(props: SelectionErrorToastProps): JSX.Element {
  const feedback = props.feedback

  return (
    <div role="status" aria-live="polite" data-dsa-selection-error-region="">
      {feedback === null ? null : (
        <div data-dsa-selection-error={feedback.kind}>{MESSAGE[feedback.kind](props.strings)}</div>
      )}
    </div>
  )
}
