/**
 * Archive path validation.
 *
 * Every filename in a ZIP archive is attacker-controlled text, and this module
 * decides whether one may be carried forward. It is a **pure predicate over a
 * string**: it resolves nothing, touches no filesystem, rewrites nothing, and
 * returns no repaired name. That is the whole design, and it is deliberate —
 * a validator that could return a path would eventually be asked to return a
 * *safe* path, and every caller that used it to build a target would inherit
 * that function's bugs.
 *
 * Why validate paths at all, in a plugin that extracts nothing? The archive is
 * not extracted today. It is enumerated, and later tasks read specific entries
 * out of it by name — `word/document.xml`, `ppt/presentation.xml`,
 * `xl/workbook.xml`. The rule enforced here is what keeps an entry that names
 * itself `/etc/passwd`, `../../secret` or `C:\Windows\System32` from becoming a
 * plausible key in that lookup, and it is stated now, while the enumeration is
 * the only thing that exists, rather than in the task that first resolves a
 * name. A preflight whose guarantees depend on what a later adapter does with
 * the names is not a preflight.
 *
 * Naming, not repair. The name this module refuses is reported back exactly as
 * the archive declared it, so a diagnostic can show the reader what the file
 * actually contains.
 */

/** A path segment that would resolve to the parent directory. */
const PARENT_SEGMENT = '..'

/** A Windows drive-letter prefix, absolute (`C:/x`) or drive-relative (`C:x`). */
const DRIVE_PREFIX = /^[A-Za-z]:/

/** The character a C-style API truncates a path at. */
const NUL = '\u0000'

/**
 * The rejection reasons this module can produce, or `null` when a name is safe.
 *
 * The rejected half of the union is what makes the type a usable discriminator:
 * `name is string` holds only in the `null` branch, which is exactly the
 * guarantee a caller needs before it uses the name for anything else.
 */
type UnsafePathReason =
  | 'not-a-string'
  | 'empty'
  | 'nul'
  | 'parent-segment'
  | 'absolute'
  | 'drive-prefixed'

/**
 * Rewrite backslashes as slashes **for validation only**.
 *
 * A ZIP entry name is not a path: the format stores a byte string, and a
 * backslash is an ordinary filename character on every system the ZIP
 * specification was written for. It is nevertheless a path separator on Windows
 * and in the archive tooling that follows it, so a name like `word\..\evil.xml`
 * is a traversal to one reader and a strange filename to another. Validating
 * both readings is the fail-closed choice.
 *
 * The result of this function is never used as a path and never replaces the
 * entry's filename. It exists for the duration of one predicate call.
 *
 * @param name - the entry name exactly as the archive declares it.
 * @returns the same text with every backslash replaced by a slash.
 */
function toValidationForm(name: string): string {
  return name.replaceAll('\\', '/')
}

/**
 * Decide whether one archive entry name may be carried forward.
 *
 * The name arrives as `unknown` because it comes from a library boundary: the
 * central directory is attacker-controlled bytes, and a name that did not decode
 * to a string is a refusal rather than a value to coerce. Coercing it — with
 * `String(name)` or a default — would invent a name the archive does not
 * contain.
 *
 * The rules, in the order they are applied to the backslash-normalized form:
 *
 * - anything that is not a string is refused;
 * - a name containing NUL is refused, because C-style APIs truncate at it and a
 *   truncated name is a different file from the one the archive describes. The
 *   check runs on the name as it arrived and again on the normalized form, and
 *   normalization only replaces backslashes, so no spelling of the name can
 *   hide the character;
 * - an empty name is refused, because no Office part has an empty name and an
 *   empty key is the kind of value that makes a lookup succeed by accident;
 * - any segment exactly equal to `..` is refused, which covers `../evil.xml`,
 *   `word/../evil.xml` and `word\..\evil.xml` alike. A segment that merely
 *   contains dots — `...`, `foo..bar` — is not a traversal and is allowed;
 * - a name that begins with `/` after normalization is refused. That is an
 *   absolute POSIX path, and it is what a Windows root-relative path (`\foo`) or
 *   a UNC path (`\\server\share\foo`) becomes under the same normalization, so
 *   one rule covers all three readings;
 * - a name that begins with a drive letter and a colon is refused. The forms
 *   `C:\evil.xml` and `C:/evil.xml` are absolute; `C:evil.xml` is drive-relative
 *   and resolves against a per-drive current directory on Windows. All three
 *   name a location outside the archive under some reader's interpretation, and
 *   no legitimate Office part is named like any of them, so the rule is stated
 *   over the whole drive-prefixed family rather than over the two absolute
 *   spellings.
 *
 * @param name - the entry name exactly as the archive declares it.
 * @returns `null` when the name may be carried forward — and only then is it
 *   known to be a string — otherwise the reason it is unsafe.
 */
export function findUnsafePathReason(name: unknown): null | UnsafePathReason {
  if (typeof name !== 'string') {
    return 'not-a-string'
  }
  if (name.includes(NUL)) {
    return 'nul'
  }
  if (name === '') {
    return 'empty'
  }

  const normalized = toValidationForm(name)
  if (normalized.includes(NUL)) {
    return 'nul'
  }
  if (normalized.startsWith('/')) {
    return 'absolute'
  }
  if (DRIVE_PREFIX.test(normalized)) {
    return 'drive-prefixed'
  }
  for (const segment of normalized.split('/')) {
    if (segment === PARENT_SEGMENT) {
      return 'parent-segment'
    }
  }
  return null
}
