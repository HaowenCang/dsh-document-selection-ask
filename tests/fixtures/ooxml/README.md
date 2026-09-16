# OOXML security fixtures

**No binary archive is committed here, and none is needed.**

Task 6 security fixtures are generated in test code because metadata boundaries
and malicious paths must be explicit and reproducible. A checked-in ZIP whose
purpose is to carry `../evil.xml` or a declared expansion of exactly 200× cannot
be reviewed in a diff, and a reviewer who cannot see the property under test
cannot tell whether the fixture still has it. The archives the suite uses
therefore live in the spec that needs them, in the form of the names and sizes
the case is about.

Two builders produce them, both in `tests/helpers/ooxml-zip.ts`:

- `buildZip` writes entries with zip.js's own `ZipWriter`, so an assertion about
  an ordinary Office-like archive is an assertion about bytes a real writer
  emitted. It is what the acceptance cases and the real-deflate ratio case use.

- `buildMetadataZip` assembles the archive by hand, and exists because a ZIP's
  central directory carries **its own copy** of each entry's sizes and encryption
  flag — and that copy, not the content, is what a metadata preflight reads. A
  writer will not emit a directory that disagrees with what it just wrote, so
  every disagreement the preflight must survive has to be stated directly:

  - declared sizes that reach an exact boundary (`ratio == 200`);
  - a large uncompressed size declared against no compressed bytes at all;
  - a filename containing NUL, which `ZipWriter` refuses to produce;
  - an empty filename;
  - a trivially small archive that carries the encryption bit.

  Its structure is fixed and stated in the helper: local file header
  (`PK\x03\x04`), local data, central directory record (`PK\x01\x02`), end of
  central directory (`PK\x05\x06`) — all little-endian, stored method, no extra
  fields, UTF-8 names with the language-encoding flag set. Every field that
  decides what the preflight sees is written from a named variable, which is why
  the helper is one screen of field writes rather than a byte array.

The values these builders declare are the attack surface Task 6 bounds. The
limits they are checked against are the four documented constants in
`src/client/ooxml/limits.ts`; the rules that apply them are in
`src/client/ooxml/preflight.ts` and `src/client/ooxml/paths.ts`.

Nothing in this directory is production code. No module under `src/` may import
anything from `tests/`, and the preflight never extracts, parses or stores an
entry's content.
