/**
 * Source-line provenance helpers.
 *
 * Both functions here guard the same promise: a citation this plugin prints must
 * be one a reader could verify against the file. `textLineLocation` refuses
 * bounds that cannot be a source line, and `fileNameFromResourceAddress` refuses
 * addresses that do not name a file, so the adapter's only remaining job is to
 * fall back to `{ kind: 'document' }` when a renderer cannot prove a position.
 *
 * The address cases mirror the published semantics of the installed runtime: the
 * `/file/` scope, a `session` scope whose first segment is an opaque session id,
 * an `absolute` scope, dropped `?` and `#` suffixes, and decoding applied per
 * segment rather than to the whole path.
 */

import { describe, expect, it } from 'vitest'

import { fileNameFromResourceAddress } from '../../../src/client/provenance/file-name.js'
import { textLineLocation } from '../../../src/client/provenance/text-lines.js'

describe('textLineLocation', () => {
  it('builds a single-line location', () => {
    expect(textLineLocation(7, 7)).toEqual({ kind: 'lines', start: 7, end: 7 })
  })

  it('builds a spanning location', () => {
    expect(textLineLocation(42, 51)).toEqual({ kind: 'lines', start: 42, end: 51 })
  })

  it.each([
    ['a zero start', 0, 1],
    ['a zero end', 1, 0],
    ['a negative start', -1, 4],
    ['a negative end', 1, -4],
    ['a fractional start', 1.5, 4],
    ['a fractional end', 1, 4.5],
    ['a NaN start', Number.NaN, 4],
    ['an infinite end', 1, Number.POSITIVE_INFINITY],
  ])('refuses %s', (_label, start, end) => {
    expect(() => textLineLocation(start, end)).toThrowError(RangeError)
  })

  it('refuses an inverted range', () => {
    // The bounds are individually valid, so this is the case a check on each
    // bound alone would let through as `第 9–4 行`.
    expect(() => textLineLocation(9, 4)).toThrowError(RangeError)
  })
})

describe('fileNameFromResourceAddress', () => {
  it.each([
    ['a session-scoped file', 'dsh-resource://file/session/s1/notes.txt', 'notes.txt'],
    ['a nested path', 'dsh-resource://file/session/s1/src/client/main.ts', 'main.ts'],
    ['an encoded space', 'dsh-resource://file/session/s1/my%20file.txt', 'my file.txt'],
    [
      'CJK percent encoding',
      'dsh-resource://file/session/s1/%E4%B8%AD%E6%96%87.md',
      '\u4e2d\u6587.md',
    ],
    ['raw CJK', 'dsh-resource://file/session/s1/\u4e2d\u6587.csv', '\u4e2d\u6587.csv'],
    ['an absolute scope', 'dsh-resource://file/absolute/C%3A/work/report.pdf', 'report.pdf'],
    ['a UNC absolute scope', 'dsh-resource://file/absolute//share/report.pdf', 'report.pdf'],
    ['a query suffix', 'dsh-resource://file/session/s1/notes.txt?v=2', 'notes.txt'],
    ['a fragment suffix', 'dsh-resource://file/session/s1/notes.txt#L4', 'notes.txt'],
    ['an encoded session id', 'dsh-resource://file/session/a%20b/notes.txt', 'notes.txt'],
  ])('resolves %s', (_label, address, expected) => {
    expect(fileNameFromResourceAddress(address)).toBe(expected)
  })

  it('keeps an encoded separator inside the file name', () => {
    // Decoding the whole path before splitting would turn `%2F` into a real
    // separator and silently report `b.txt` as the file name.
    expect(fileNameFromResourceAddress('dsh-resource://file/session/s1/a%2Fb.txt')).toBe('a/b.txt')
  })

  it.each([
    ['a non-DSH scheme', 'https://example.invalid/notes.txt'],
    ['a bare scheme', 'dsh-resource://file/'],
    ['an unknown scope', 'dsh-resource://file/workspace/s1/notes.txt'],
    ['a session without a path', 'dsh-resource://file/session/s1'],
    ['a session without an id', 'dsh-resource://file/session//notes.txt'],
    ['an absolute scope without a path', 'dsh-resource://file/absolute/'],
    ['a trailing separator', 'dsh-resource://file/session/s1/'],
    ['a truncated escape', 'dsh-resource://file/session/s1/%E0%A4%A.txt'],
    ['a truncated session escape', 'dsh-resource://file/session/%E0%A4%A/notes.txt'],
    ['an empty address', ''],
  ])('refuses %s', (_label, address) => {
    expect(fileNameFromResourceAddress(address)).toBeNull()
  })
})
