/**
 * Normalization contract for captured selection text.
 *
 * The normalizer is the boundary between renderer-specific DOM text and the
 * prompt contract. It removes transport noise — CRLF, line-trailing padding,
 * whitespace-only selections — while preserving everything a reader would call
 * content: internal spacing, tabs, blank lines up to the documented bound, and
 * the exact Unicode code points of the selection.
 */

import { describe, expect, it } from 'vitest'

import { normalizeSelectedText } from '../../../src/client/selection/normalize.js'

describe('normalizeSelectedText', () => {
  it('normalizes CRLF, trims trailing padding and bounds blank runs', () => {
    expect(normalizeSelectedText('a\r\nb   \n\n\n\nc  \n')).toBe('a\nb\n\n\nc')
  })

  it('reduces a whitespace-only selection to the empty string', () => {
    expect(normalizeSelectedText('   \n\t')).toBe('')
  })

  it('converts CRLF and lone CR line breaks to LF', () => {
    expect(normalizeSelectedText('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('removes spaces and tabs at line ends', () => {
    expect(normalizeSelectedText('a   \nb\t\t\n')).toBe('a\nb')
  })

  it('preserves internal spacing rather than collapsing it', () => {
    expect(normalizeSelectedText('a    b')).toBe('a    b')
    expect(normalizeSelectedText('a \t b')).toBe('a \t b')
  })

  it('preserves internal tabs', () => {
    expect(normalizeSelectedText('a\tb')).toBe('a\tb')
  })

  it('removes leading and trailing blank lines', () => {
    expect(normalizeSelectedText('\n\n  \nalpha\nbeta\n\n\n')).toBe('alpha\nbeta')
  })

  it('collapses more than two blank lines to exactly two', () => {
    expect(normalizeSelectedText('a\n\n\n\n\n\nb')).toBe('a\n\n\nb')
  })

  it('keeps one and two blank lines unchanged', () => {
    expect(normalizeSelectedText('a\n\nb')).toBe('a\n\nb')
    expect(normalizeSelectedText('a\n\n\nb')).toBe('a\n\n\nb')
  })

  it('leaves CJK text unchanged', () => {
    expect(normalizeSelectedText('第一行\n第二行  内容')).toBe('第一行\n第二行  内容')
  })

  it('does not damage surrogate pairs', () => {
    expect(normalizeSelectedText('😀😀\nok')).toBe('😀😀\nok')
  })

  it('keeps non-ASCII spacing that is not line padding', () => {
    expect(normalizeSelectedText('a\u3000b')).toBe('a\u3000b')
  })

  it('returns the empty string unchanged', () => {
    expect(normalizeSelectedText('')).toBe('')
  })
})
