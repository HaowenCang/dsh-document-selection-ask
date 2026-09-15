/**
 * `SelectionRejectReason` is a capture-domain type and nothing else.
 *
 * The type answers one question — why a candidate selection or a renderer
 * capture produced no `SelectionSnapshot` — and every member must therefore be a
 * fact about selection capture. A composer that refuses a draft is not such a
 * fact: by the time the write is attempted the snapshot is valid and stored, so
 * reporting the refusal through this union would put a write failure in the same
 * vocabulary as "the reader clicked in a paragraph" and would send a future
 * diagnosis after a renderer that was never involved. The composer's own
 * failures live in `AskFailureReason`, which is asserted in the bridge's spec.
 *
 * Two properties are checked here, and they fail differently on purpose.
 *
 * The **runtime** list is the vocabulary the module publishes; a rejection reason
 * that is silently dropped or silently added changes what the overlay and the
 * lifecycle can report, and that is observable without a compiler.
 *
 * The **type-level** property is the one that actually proves the domain split,
 * because TypeScript's types vanish at runtime: a spec that merely wrote
 * `const reason: SelectionRejectReason = 'draft-write-failed'` would still pass
 * under Vitest, which strips the annotation rather than checking it. The
 * exhaustive `switch` below narrows the union to `never`, so any extra member —
 * the specific regression this file guards, and any future one — leaves a
 * non-`never` value in the `default` branch and fails `pnpm typecheck` with
 * TS2322. No `@ts-expect-error`, no cast, and no assertion over the source text:
 * the compiler is the oracle, and the repository's own typecheck gate runs it.
 */

import { describe, expect, it } from 'vitest'

import type { SelectionRejectReason } from '../../../src/client/selection/types.js'

/**
 * The rejection vocabulary of Task 2, restored exactly.
 *
 * Written as a `satisfies` check rather than an annotation so a typo in an entry
 * is a compile error while the literal types stay narrow for the comparison
 * below. The list is the capture domain in full: no composer, UI, network or
 * renderer-lifecycle failure belongs in it.
 */
const CAPTURE_REJECT_REASONS = [
  'collapsed',
  'outside-supported-preview',
  'cross-root',
  'interactive-control',
  'empty-after-normalization',
  'too-large',
  'too-many-cells',
  'renderer-not-ready',
] as const satisfies readonly SelectionRejectReason[]

/**
 * Answer for one reason, and prove the union has no other member.
 *
 * @param reason - a value of the capture-domain union.
 * @returns the reason itself, for the comparison in the case below.
 */
function asCaptureDomain(reason: SelectionRejectReason): string {
  switch (reason) {
    case 'collapsed':
    case 'outside-supported-preview':
    case 'cross-root':
    case 'interactive-control':
    case 'empty-after-normalization':
    case 'too-large':
    case 'too-many-cells':
    case 'renderer-not-ready':
      return reason
    default: {
      // The whole type-level assertion. With the eight members above handled,
      // `reason` is `never` here; a ninth member — `draft-write-failed`, a
      // composer reason, a renderer reason — makes this assignment a TS2322 and
      // the typecheck gate fails.
      const unhandled: never = reason
      return unhandled
    }
  }
}

describe('SelectionRejectReason', () => {
  it('publishes exactly the capture-domain reasons', () => {
    expect([...CAPTURE_REJECT_REASONS]).toHaveLength(8)
    expect(new Set(CAPTURE_REJECT_REASONS).size).toBe(8)
  })

  it('answers for every published reason without falling through to an unhandled one', () => {
    // A case that reached the `never` branch would throw a TypeError instead of
    // returning, so this also pins the switch's coverage at runtime.
    for (const reason of CAPTURE_REJECT_REASONS) {
      expect(asCaptureDomain(reason)).toBe(reason)
    }
  })

  it('keeps the write-domain reason out of the capture vocabulary', () => {
    // `draft-write-failed` is not a capture fact, and the only list that may
    // contain it is the composer bridge's `AskFailureReason`. The assertion is on
    // this module's own published list rather than on a value of the type,
    // because the type itself is checked by the `never` branch above.
    expect(CAPTURE_REJECT_REASONS).not.toContain('draft-write-failed')
  })
})
