/**
 * File name resolution for a DSH resource address.
 *
 * A preview root publishes the file it shows through `data-textpreview-url`,
 * whose value is a `dsh-resource://file/…` address rather than a path. Two
 * consequences shape this module.
 *
 * The name must be **decoded**. Addresses carry percent-encoded segments, so a
 * file called `my file.txt` arrives as `my%20file.txt` and a Chinese name arrives
 * as a run of `%E4%B8%AD…` escapes. Reading the last segment literally would put
 * the encoded form into the citation the user reads and into the prompt the model
 * receives. Decoding is per segment and happens after the split, so an encoded
 * separator inside a name stays part of that name rather than becoming a path
 * boundary.
 *
 * The name must be **validated**, not merely extracted. An address that does not
 * resolve, whose scope this plugin does not know, or whose escape sequences are
 * truncated is not a document this plugin can attribute a selection to, and the
 * answer for those cases is `null` rather than a best-effort string. The parser
 * still does not throw: it is reached from a DOM event path, and a malformed
 * attribute in the page must not surface as an exception in the DSH UI.
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
 * Read the display file name from a DSH resource address.
 *
 * @param address - the value of a preview root's `data-textpreview-url`.
 * @returns the decoded base name, or `null` when the address is not a
 * well-formed DSH file address with a named file.
 */
export function fileNameFromResourceAddress(address: string): string | null {
  const segments = segmentsFromResourceAddress(address)
  if (segments === null) {
    return null
  }

  return segments[segments.length - 1] ?? null
}

/**
 * Decode the path segments of a DSH file address.
 *
 * Decoding happens per segment and only after the address has been split, which
 * is what makes an encoded separator inside a name survive: `a%2Fb.txt` decodes
 * to the single name `a/b.txt`, while decoding the whole path first would turn
 * that escape into a separator and reduce the file to `b.txt`. An empty final
 * segment — an address ending in `/` — is dropped so that a directory address
 * yields no file name rather than an empty one.
 *
 * @param address - a candidate address.
 * @returns the decoded segments, or `null` when the address does not parse.
 */
function segmentsFromResourceAddress(address: string): string[] | null {
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
      // The session id is decoded only to reject a malformed one; it is not part
      // of the document's identity and never reaches a citation.
      decodeURIComponent(sessionId)
      return lastNamedSegment(segments.map((segment) => decodeURIComponent(segment)))
    }

    if (scope === 'absolute') {
      const unc = rest[0] === '' && rest.length > 1
      const segments = (unc ? rest.slice(1) : rest).map((segment) => decodeURIComponent(segment))
      if (segments.length === 0 || segments[0] === '') {
        return null
      }
      return lastNamedSegment(segments)
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
function lastNamedSegment(segments: readonly string[]): string[] {
  const last = segments[segments.length - 1]
  return last === '' ? segments.slice(0, -1) : [...segments]
}
