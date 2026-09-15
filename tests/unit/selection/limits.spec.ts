/**
 * Selection size limit contract.
 *
 * The documented limit is 16,384 *UTF-16 code units*, and the unit is the whole
 * point of the spec. `String.prototype.length` counts code units, so a limit
 * expressed with it is exact and cheap; counting code points or UTF-8 bytes
 * would admit selections that cost the model far more context than the contract
 * promises. These tests pin the counting unit, the exact boundaries, and the
 * refusal to truncate.
 */

import { describe, expect, it } from 'vitest'

import { MAX_SELECTION_CODE_UNITS, validateSelectionSize } from '../../../src/client/selection/limits.js'
import { snapshot } from './snapshot.js'

/**
 * Build text of an exact UTF-16 length.
 * @param codeUnits - required length in code units.
 * @returns the text.
 */
function textOfLength(codeUnits: number): string {
  return 'a'.repeat(codeUnits)
}

describe('MAX_SELECTION_CODE_UNITS', () => {
  it('is the documented 16,384 code units', () => {
    expect(MAX_SELECTION_CODE_UNITS).toBe(16_384)
  })
})

describe('validateSelectionSize', () => {
  it('accepts a selection below the limit', () => {
    expect(validateSelectionSize(snapshot({ text: textOfLength(16_383) }))).toBeNull()
  })

  it('accepts a selection exactly at the limit', () => {
    expect(validateSelectionSize(snapshot({ text: textOfLength(16_384) }))).toBeNull()
  })

  it('rejects a selection one code unit over the limit', () => {
    expect(validateSelectionSize(snapshot({ text: textOfLength(16_385) }))).toBe('too-large')
  })

  it('rejects a large selection with too-large', () => {
    expect(validateSelectionSize(snapshot({ text: textOfLength(100_000) }))).toBe('too-large')
  })

  it('accepts empty text, which is a separate rejection reason', () => {
    // Emptiness is `empty-after-normalization`, decided by the normalization
    // step; the size validator answers only the size question.
    expect(validateSelectionSize(snapshot({ text: '' }))).toBeNull()
  })

  it('counts UTF-16 code units, so a surrogate pair costs two', () => {
    expect('😀'.length).toBe(2)
    expect(validateSelectionSize(snapshot({ text: '😀'.repeat(8_192) }))).toBeNull()
    expect(validateSelectionSize(snapshot({ text: '😀'.repeat(8_192) + 'a' }))).toBe('too-large')
  })

  it('reports the reason without touching the snapshot text', () => {
    const text = textOfLength(20_000)
    const subject = snapshot({ text })

    expect(validateSelectionSize(subject)).toBe('too-large')
    // No silent truncation: the rejected text stays whole for the caller to
    // re-inspect, and the snapshot is not mutated.
    expect(subject.text).toBe(text)
    expect(subject.text).toHaveLength(20_000)
  })
})
