import { describe, expect, it } from 'vitest'

import { slideRangeLocation } from '../../../src/client/provenance/slide-range.js'

describe('slideRangeLocation', () => {
  it('builds a single-slide location', () => {
    expect(slideRangeLocation('1', '1')).toEqual({
      kind: 'slides',
      start: 1,
      end: 1,
    })
  })

  it('builds a spanning slide location', () => {
    expect(slideRangeLocation('2', '5')).toEqual({
      kind: 'slides',
      start: 2,
      end: 5,
    })
  })

  it('accepts positive safe integers up to MAX_SAFE_INTEGER', () => {
    const maxSafe = String(Number.MAX_SAFE_INTEGER)
    expect(slideRangeLocation('1', maxSafe)).toEqual({
      kind: 'slides',
      start: 1,
      end: Number.MAX_SAFE_INTEGER,
    })
  })

  it('refuses an inverted slide range without auto-sorting', () => {
    expect(slideRangeLocation('4', '3')).toBeNull()
  })

  it.each([
    ['null start', null, '1'],
    ['null end', '1', null],
    ['empty start', '', '1'],
    ['empty end', '1', ''],
    ['zero start', '0', '1'],
    ['zero end', '1', '0'],
    ['negative start', '-1', '4'],
    ['negative end', '1', '-4'],
    ['decimal start', '1.5', '4'],
    ['decimal end', '1', '4.5'],
    ['leading space', ' 1', '4'],
    ['trailing space', '1 ', '4'],
    ['leading zero', '01', '4'],
    ['scientific notation', '1e2', '200'],
    ['NaN', 'NaN', '4'],
    ['Infinity', 'Infinity', '4'],
    ['greater than MAX_SAFE_INTEGER', '9007199254740992', '9007199254740992'],
  ])('refuses invalid spelling %s', (_label, start, end) => {
    expect(slideRangeLocation(start, end)).toBeNull()
  })
})
