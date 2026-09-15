/**
 * DSH resource-address parsing.
 *
 * The Ask flow needs two different facts out of the same address, and they are
 * not interchangeable. The file name is what the provenance line quotes, so an
 * address that does not resolve must produce no citation rather than a
 * best-effort string. The session id is what decides whether a captured
 * selection may be written into a particular composer at all, so an address
 * whose scope this plugin cannot read must produce no identity rather than a
 * guess: guessing would let a selection made in one session be attributed to
 * another, and the draft would then receive a quote the reader never selected
 * there.
 *
 * Both readers therefore share one parser and one scope vocabulary. These cases
 * assert the shared parser's observable behaviour, including the scopes it
 * deliberately refuses.
 */

import { describe, expect, it } from 'vitest'

import {
  fileNameFromResourceAddress,
  sessionIdFromResourceAddress,
} from '../../../src/client/provenance/file-name.js'

describe('file name resolution', () => {
  it('reads and decodes the last segment', () => {
    expect(fileNameFromResourceAddress('dsh-resource://file/session/s1/src/main.ts')).toBe('main.ts')
  })

  it('decodes percent-encoded segments per segment', () => {
    expect(fileNameFromResourceAddress('dsh-resource://file/session/s1/my%20file.txt')).toBe('my file.txt')
    expect(fileNameFromResourceAddress('dsh-resource://file/session/s1/%E4%B8%AD%E6%96%87.md')).toBe(
      '\u4e2d\u6587.md',
    )
  })

  it('keeps an encoded separator inside a name', () => {
    expect(fileNameFromResourceAddress('dsh-resource://file/session/s1/a%2Fb.txt')).toBe('a/b.txt')
  })

  it('drops query and fragment suffixes', () => {
    expect(fileNameFromResourceAddress('dsh-resource://file/session/s1/notes.txt?rev=2#top')).toBe('notes.txt')
  })

  it('reads an absolute-scope address', () => {
    expect(fileNameFromResourceAddress('dsh-resource://file/absolute/C:/work/notes.txt')).toBe('notes.txt')
  })

  it('drops the trailing segment of an address that ends in a separator', () => {
    // The runtime's own parser drops the trailing empty segment when it maps an
    // address onto session URN segments, so `…/src/` names the directory `src`.
    // A second reader of the same address must not disagree with the runtime
    // about what it points at.
    expect(fileNameFromResourceAddress('dsh-resource://file/session/s1/src/')).toBe('src')
  })

  it('returns null for a scope this plugin does not know', () => {
    expect(fileNameFromResourceAddress('dsh-resource://file/chat/s1/notes.txt')).toBeNull()
    expect(fileNameFromResourceAddress('https://example.test/notes.txt')).toBeNull()
    expect(fileNameFromResourceAddress('')).toBeNull()
  })

  it('returns null for a session address with no path', () => {
    expect(fileNameFromResourceAddress('dsh-resource://file/session/s1')).toBeNull()
    expect(fileNameFromResourceAddress('dsh-resource://file/session//notes.txt')).toBeNull()
  })

  it('returns null rather than throwing on a truncated escape', () => {
    expect(fileNameFromResourceAddress('dsh-resource://file/session/s1/%E4%B8.txt')).toBeNull()
  })
})

describe('session identity resolution', () => {
  it('reads the session id of a session-scoped address', () => {
    expect(sessionIdFromResourceAddress('dsh-resource://file/session/s1/src/main.ts')).toBe('s1')
  })

  it('decodes a percent-encoded session id', () => {
    expect(sessionIdFromResourceAddress('dsh-resource://file/session/s%201/notes.txt')).toBe('s 1')
  })

  it('ignores the query and fragment suffixes', () => {
    expect(sessionIdFromResourceAddress('dsh-resource://file/session/s1/notes.txt?rev=2#top')).toBe('s1')
  })

  it('reports no identity for an absolute-scope address', () => {
    // An absolute address names a file outside any session. Nothing in it proves
    // which session is viewing the file, so it must not be attributed to one.
    expect(sessionIdFromResourceAddress('dsh-resource://file/absolute/C:/work/notes.txt')).toBeNull()
  })

  it('reports no identity for an address that does not parse', () => {
    expect(sessionIdFromResourceAddress('dsh-resource://file/session//notes.txt')).toBeNull()
    expect(sessionIdFromResourceAddress('dsh-resource://file/chat/s1/notes.txt')).toBeNull()
    expect(sessionIdFromResourceAddress('https://example.test/notes.txt')).toBeNull()
    expect(sessionIdFromResourceAddress('')).toBeNull()
  })

  it('reports no identity rather than throwing on a truncated escape', () => {
    expect(sessionIdFromResourceAddress('dsh-resource://file/session/%E4%B8/notes.txt')).toBeNull()
  })
})
