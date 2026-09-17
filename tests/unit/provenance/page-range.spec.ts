import { describe, expect, it } from 'vitest'

import { pageRangeLocation } from '../../../src/client/provenance/page-range.js'

describe('pageRangeLocation', () => {
  it('builds a single-page source location', () => {
    expect(pageRangeLocation('1', '1', 'source')).toEqual({
      kind: 'pages',
      start: 1,
      end: 1,
      fidelity: 'source',
    })
  })

  it('builds a spanning source location', () => {
    expect(pageRangeLocation('3', '4', 'source')).toEqual({
      kind: 'pages',
      start: 3,
      end: 4,
      fidelity: 'source',
    })
  })

  it('builds a rendered page location for future reuse', () => {
    expect(pageRangeLocation('3', '4', 'rendered')).toEqual({
      kind: 'pages',
      start: 3,
      end: 4,
      fidelity: 'rendered',
    })
  })

  it('accepts positive safe integers up to MAX_SAFE_INTEGER', () => {
    const maxSafe = String(Number.MAX_SAFE_INTEGER)
    expect(pageRangeLocation('1', maxSafe, 'source')).toEqual({
      kind: 'pages',
      start: 1,
      end: Number.MAX_SAFE_INTEGER,
      fidelity: 'source',
    })
  })

  it('refuses an inverted page range without auto-sorting', () => {
    expect(pageRangeLocation('4', '3', 'source')).toBeNull()
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
    expect(pageRangeLocation(start, end, 'source')).toBeNull()
  })
})
