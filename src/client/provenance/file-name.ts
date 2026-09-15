/**
 * DSH resource-address parsing.
 *
 * A preview root publishes the file it shows through `data-textpreview-url`,
 * whose value is a `dsh-resource://file/…` address rather than a path. Two
 * consumers read that address — the provenance line, which needs the display
 * file name, and the Ask flow, which needs the session the file belongs to —
 * and both read it through the single parser below rather than each carrying
 * its own copy of the syntax. A second parser is not a stylistic problem: the
 * two copies drift, and the drift shows up as a selection attributed to the
 * wrong session rather than as a parse error.
 *
 * Two properties of the parser are load-bearing.
 *
 * Names must be **decoded**. Addresses carry percent-encoded segments, so a
 * file called `my file.txt` arrives as `my%20file.txt` and a Chinese name arrives
 * as a run of `%E4%B8%AD…` escapes. Reading the last segment literally would put
 * the encoded form into the citation the user reads and into the prompt the model
 * receives. Decoding is per segment and happens after the split, so an encoded
 * separator inside a name stays part of that name rather than becoming a path
 * boundary.
 *
 * Identity must be **scoped, not inferred**. Only a `session` address names a
 * session, and it names it in its own first segment. An `absolute` address
 * proves nothing about which session is viewing the file, so it carries no
 * session identity — attributing it to whichever session happens to be current
 * would let one session's selection be written into another's composer. The
 * answer for an address that does not resolve, whose scope this plugin does not
 * know, or whose escape sequences are truncated is `null` rather than a
 * best-effort value, and the parser never throws: it is reached from a DOM event
 * path, where a malformed attribute in the page must not surface as an exception
 * in the DSH UI.
 *
 * The parser is written here rather than imported because the DSH package
 * publishes it only through its private `./src/*` export, which this plugin does
 * not use. It mirrors the published semantics of the installed runtime: the
 * `/file/` scope, a `session` scope whose first segment is an opaque session id,
 * an `absolute` scope whose leading `//` marks a UNC path, dropped `?`/`#`
 * suffixes, and per-segment decoding.
 */

/** Scheme and authority every DSH file address opens with. */
const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/** Length of {@link FILE_ADDRESS_PREFIX}, used to slice the scope off an address. */
const FILE_ADDRESS_PREFIX_LENGTH = FILE_ADDRESS_PREFIX.length

/** Query or fragment marker; everything from the first one onward is ignored. */
const ADDRESS_SUFFIX = /[?#]/

/**
 * The parts of a DSH file address this plugin can read.
 *
 * `sessionId` is present exactly for a session-scoped address; `segments` are the
 * decoded path segments of the file itself and never include the scope or the
 * session id.
 */
export interface ResourceAddress {
  /** The owning session, or `null` when the address is not session-scoped. */
  readonly sessionId: string | null
  /** Decoded path segments of the addressed file, in address order. */
  readonly segments: readonly string[]
}

/**
 * Read the display file name from a DSH resource address.
 *
 * @param address - the value of a preview root's `data-textpreview-url`.
 * @returns the decoded base name, or `null` when the address is not a
 * well-formed DSH file address with a named file.
 */
export function fileNameFromResourceAddress(address: string): string | null {
  const parsed = parseResourceAddress(address)
  if (parsed === null) {
    return null
  }

  return parsed.segments[parsed.segments.length - 1] ?? null
}

/**
 * Read the session a DSH resource address belongs to.
 *
 * @param address - the value of a preview root's `data-textpreview-url`.
 * @returns the decoded session id, or `null` when the address is not
 * session-scoped or does not parse. An `absolute` address always answers `null`:
 * it names a file, not the session viewing it.
 */
export function sessionIdFromResourceAddress(address: string): string | null {
  return parseResourceAddress(address)?.sessionId ?? null
}

/**
 * Parse a DSH file address into its scope identity and decoded path segments.
 *
 * Decoding happens per segment and only after the address has been split, which
 * is what makes an encoded separator inside a name survive: `a%2Fb.txt` decodes
 * to the single name `a/b.txt`, while decoding the whole path first would turn
 * that escape into a separator and reduce the file to `b.txt`. An empty final
 * segment — an address ending in `/` — is dropped so that a directory address
 * yields no file name rather than an empty one.
 *
 * @param address - a candidate address.
 * @returns the parsed address, or `null` when it does not parse.
 */
export function parseResourceAddress(address: string): ResourceAddress | null {
  if (!address.startsWith(FILE_ADDRESS_PREFIX)) {
    return null
  }

  try {
    const suffix = ADDRESS_SUFFIX.exec(address)
    const body = address.slice(FILE_ADDRESS_PREFIX_LENGTH, suffix === null ? undefined : suffix.index)
    const [scope, ...rest] = body.split('/')

    if (scope === 'session') {
      const [sessionId, ...segments] = rest
      if (sessionId === undefined || sessionId === '' || segments.length === 0) {
        return null
      }
      // Decoded first: a truncated escape in the session id must fail the parse
      // rather than yield an identity that merely looks plausible.
      const decodedSessionId = decodeURIComponent(sessionId)
      return {
        sessionId: decodedSessionId,
        segments: namedSegments(segments.map((segment) => decodeURIComponent(segment))),
      }
    }

    if (scope === 'absolute') {
      const unc = rest[0] === '' && rest.length > 1
      const segments = (unc ? rest.slice(1) : rest).map((segment) => decodeURIComponent(segment))
      if (segments.length === 0 || segments[0] === '') {
        return null
      }
      return { sessionId: null, segments: namedSegments(segments) }
    }

    return null
  } catch {
    // `decodeURIComponent` throws on a truncated escape such as `%E4%B8`, which
    // is exactly the malformed input this parser must survive.
    return null
  }
}

/**
 * Drop the trailing empty segment of an address that ends in a separator.
 * @param segments - the decoded path segments.
 * @returns the segments with a trailing empty one removed.
 */
function namedSegments(segments: readonly string[]): string[] {
  const last = segments[segments.length - 1]
  return last === '' ? segments.slice(0, -1) : [...segments]
}
