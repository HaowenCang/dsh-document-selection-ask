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
 * @returns the notice, or `null` when there is nothing to report.
 */
export function SelectionErrorToast(props: SelectionErrorToastProps): JSX.Element | null {
  const feedback = props.feedback
  if (feedback === null) {
    return null
  }

  return (
    <div role="status" aria-live="polite" data-dsa-selection-error={feedback.kind}>
      {MESSAGE[feedback.kind](props.strings)}
    </div>
  )
}
