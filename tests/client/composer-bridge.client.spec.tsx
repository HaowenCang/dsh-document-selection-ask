/**
 * The composer bridge.
 *
 * This spec pins the four statements that make the Ask action safe, and each one
 * is a refusal rather than a feature.
 *
 * The draft is read when the button is pressed, from the composer's live state,
 * so a paragraph typed after the selection is not overwritten by the write. The
 * append is additive, so a draft that already carries a quoted block keeps it.
 * The public `submit` action is never named, so the reader's message is always
 * theirs to send. And a refused write changes nothing at all — no clear, no
 * focus move — so a failure leaves the reader holding the selection and able to
 * try again.
 *
 * The bridge is exercised through its public factory only. Nothing here reaches
 * into a composer DOM: the whole point of the injected interface is that a test
 * can substitute it, and a spec that queried an element instead would be
 * asserting on a mechanism the production code does not use.
 */

import { describe, expect, it } from 'vitest'

import { createComposerBridge, type AskFailureReason, type ComposerTarget } from '../../src/client/dsh/composer-bridge.js'
import { SELECTION_QUESTION_SUFFIX, appendSelectionToDraft, formatSelectionForDraft } from '../../src/client/quote/format-selection.js'
import type { SelectionSnapshot } from '../../src/client/selection/types.js'
import { snapshot } from '../unit/selection/snapshot.js'

/** Capture time used by every snapshot in this spec. */
const NOW = 1_700_000_000_000

/** A selection text longer than the documented limit, in UTF-16 code units. */
const OVERSIZED_TEXT = 'x'.repeat(16_385)

/** A draft as the reader leaves it before pressing Ask. */
const EXISTING_DRAFT = '\u6211\u7684\u95ee\u9898'

/**
 * One scripted composer.
 *
 * `draft` is mutable so a case can simulate the reader typing between the
 * selection and the click, and `setDraft` records every write so a case can
 * assert a refusal left the composer untouched. `submitted` exists even though
 * the bridge has no way to reach it: the assertion that it stays false is the
 * point of carrying the field at all.
 */
interface FakeComposer extends ComposerTarget {
  draft: string
  readonly writes: string[]
  readonly reads: number
  readonly focuses: number
  readonly submitted: boolean
}

/**
 * Build a scripted composer.
 * @param initialDraft - the draft the composer starts with.
 * @param options - failure injection for the write path.
 * @returns the composer and its call record.
 */
function fakeComposer(
  initialDraft: string,
  options: { readonly failWrite?: boolean } = {},
): FakeComposer {
  const writes: string[] = []
  let reads = 0
  let focuses = 0

  return {
    draft: initialDraft,
    writes,
    get reads(): number {
      return reads
    },
    get focuses(): number {
      return focuses
    },
    submitted: false,
    readDraft(): string {
      reads += 1
      return this.draft
    },
    setDraft(text: string): void {
      if (options.failWrite === true) {
        throw new Error('composer refused the draft')
      }
      writes.push(text)
      this.draft = text
    },
    focus(): void {
      focuses += 1
    },
  }
}

/**
 * Build a text selection snapshot.
 * @param overrides - fields this case is about.
 * @returns the snapshot.
 */
function selection(overrides: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return snapshot({
    resourceAddress: 'dsh-resource://file/session/s1/notes.txt',
    fileName: 'notes.txt',
    documentKind: 'text',
    text: 'alpha',
    location: { kind: 'lines', start: 1, end: 1 },
    rects: [],
    capturedAt: NOW,
    ...overrides,
  })
}

describe('composer bridge: append', () => {
  it('writes the formatted quote once for an empty draft', () => {
    const composer = fakeComposer('')

    const outcome = createComposerBridge(composer).appendSelection(selection())

    expect(outcome).toEqual({ ok: true, draft: formatSelectionForDraft(selection()) })
    expect(composer.writes).toHaveLength(1)
    expect(composer.writes[0]).toBe(formatSelectionForDraft(selection()))
  })

  it('appends below an existing draft through the shared formatter', () => {
    const composer = fakeComposer(EXISTING_DRAFT)

    const outcome = createComposerBridge(composer).appendSelection(selection())

    const expected = appendSelectionToDraft(EXISTING_DRAFT, selection())
    expect(outcome).toEqual({ ok: true, draft: expected })
    expect(composer.writes).toEqual([expected])
    expect(expected.startsWith(EXISTING_DRAFT)).toBe(true)
  })

  it('keeps a previous quote block and appends a second one', () => {
    const alreadyQuoted = appendSelectionToDraft('', selection())

    const composer = fakeComposer(alreadyQuoted)
    createComposerBridge(composer).appendSelection(selection({ text: 'beta' }))

    const next = composer.writes[0] ?? ''
    expect(next.startsWith(alreadyQuoted)).toBe(true)
    // The earlier block keeps its own question line; nothing is rewritten.
    expect(next.split(SELECTION_QUESTION_SUFFIX)).toHaveLength(3)
  })

  it('reads the draft at click time rather than trusting a frozen value', () => {
    const composer = fakeComposer('')
    const bridge = createComposerBridge(composer)

    // The reader types after selecting and before pressing Ask.
    composer.draft = EXISTING_DRAFT

    const outcome = bridge.appendSelection(selection())

    expect(outcome).toEqual({ ok: true, draft: appendSelectionToDraft(EXISTING_DRAFT, selection()) })
    expect(composer.writes[0]).toContain(EXISTING_DRAFT)
  })

  it('never submits, whatever the outcome', () => {
    const composer = fakeComposer(EXISTING_DRAFT)

    createComposerBridge(composer).appendSelection(selection())
    createComposerBridge(composer).appendSelection(selection({ text: OVERSIZED_TEXT }))

    expect(composer.submitted).toBe(false)
  })

  it('focuses the composer exactly once after a successful write', () => {
    const composer = fakeComposer(EXISTING_DRAFT)

    createComposerBridge(composer).appendSelection(selection())

    expect(composer.focuses).toBe(1)
  })
})

describe('composer bridge: refusals', () => {
  it('writes nothing for a selection over the size limit', () => {
    const composer = fakeComposer(EXISTING_DRAFT)

    const outcome = createComposerBridge(composer).appendSelection(selection({ text: OVERSIZED_TEXT }))

    expect(outcome).toEqual({ ok: false, reason: 'too-large' })
    expect(composer.writes).toEqual([])
    expect(composer.reads).toBe(0)
    expect(composer.focuses).toBe(0)
  })

  it('accepts a selection exactly at the limit', () => {
    const composer = fakeComposer('')

    const outcome = createComposerBridge(composer).appendSelection(selection({ text: 'y'.repeat(16_384) }))

    expect(outcome.ok).toBe(true)
    expect(composer.writes).toHaveLength(1)
  })

  it('leaves the draft, the focus and the caller state untouched when the write throws', () => {
    const composer = fakeComposer(EXISTING_DRAFT, { failWrite: true })

    const outcome = createComposerBridge(composer).appendSelection(selection())

    // A failure must not look like a success: the reason is reported, the draft
    // is unchanged, and focus is not stolen — which is what leaves the caller
    // free to keep the snapshot for a retry.
    expect(outcome).toEqual({ ok: false, reason: 'draft-write-failed' })
    expect(composer.draft).toBe(EXISTING_DRAFT)
    expect(composer.writes).toEqual([])
    expect(composer.focuses).toBe(0)
  })
})

describe('composer bridge: focus', () => {
  it('forwards the focus request to the injected composer', () => {
    const composer = fakeComposer('')

    createComposerBridge(composer).focus()

    expect(composer.focuses).toBe(1)
    expect(composer.writes).toEqual([])
  })
})

describe('composer bridge: failure domain', () => {
  /**
   * Record a reason the bridge reported, and prove it is a member of the
   * bridge's own failure union.
   *
   * The parameter type is the whole assertion. `AskFailureReason` is the
   * bridge's vocabulary; `SelectionRejectReason` is the capture vocabulary and
   * no longer contains a write failure, so a bridge still reporting through the
   * latter would not accept this call and `pnpm typecheck` would fail on it.
   * There is no cast here for the same reason: a cast would make the check
   * vacuous.
   * @param reason - the reason the bridge reported.
   * @returns the same reason, for the comparison below.
   */
  function asAskFailure(reason: AskFailureReason): AskFailureReason {
    return reason
  }

  it('keeps a write failure and a size refusal in the same, writer-owned vocabulary', () => {
    const refused = fakeComposer('', { failWrite: true })
    const oversized = fakeComposer(EXISTING_DRAFT)

    const writeOutcome = createComposerBridge(refused).appendSelection(selection())
    const sizeOutcome = createComposerBridge(oversized).appendSelection(selection({ text: OVERSIZED_TEXT }))

    if (writeOutcome.ok || sizeOutcome.ok) {
      throw new Error('both transactions must fail')
    }

    // Two different failures, one union: the composer bridge is where a write
    // can fail, so it is where both reasons are published.
    expect(asAskFailure(writeOutcome.reason)).toBe('draft-write-failed')
    expect(asAskFailure(sizeOutcome.reason)).toBe('too-large')
    expect(refused.draft).toBe('')
    expect(oversized.draft).toBe(EXISTING_DRAFT)
  })
})
