# PDF fixtures

These four files are committed, and the browser suite opens them through the real
DSH document preview. They are generated, never downloaded.

| File | Content | Purpose |
| --- | --- | --- |
| `single-page.pdf` | one A4 page: `Alpha Beta Gamma`, then one Latin sentence | a page with text that is present, visible and selectable |
| `two-page.pdf` | six **A2** pages, each naming itself in its first line (`Alpha page one` … `Zeta page six`) | page 1 renders immediately and the later pages render lazily; the names make a wrong page identifiable |
| `cjk.pdf` | one A4 page: `中文选段测试`, then a second Chinese line | CJK text extraction and CJK browser selection |
| `image-only.pdf` | one A4 page of drawn rectangles and a circle, with **no text operator at all** | a page with nothing to select; asserts that no fake text is invented |

The multi-page fixture is A2 and carries six pages so that a page exists well
beyond the renderer's lookahead. A page is rendered when an `IntersectionObserver`
reports it within a fixed margin of the viewport — see `LAZY_ROOT_MARGIN` in
`src/client/renderers/pdf/SelectablePdfBody.tsx` for why the margin is a distance
rather than a percentage — so a document of two ordinary pages has every page in
range on open and demonstrates nothing about laziness. At A2, page 6 sits about
4100 CSS pixels down, which is past the margin until the reader scrolls.

## How they are produced

```bash
node scripts/generate-pdf-fixtures.mjs
```

The generator writes all four with `pdf-lib`, pins the document metadata to a
fixed date, and writes no timestamp of its own, so two runs on the same inputs
produce byte-identical files: the committed bytes are reproducible, and a diff
of them is a meaningful review.

The generator also refuses to write a file that contains `/URI`, `http://` or
`https://`, so a fixture can never make the smoke depend on the network.

## The CJK font, and why the font itself is not committed

`cjk.pdf` needs a font with CJK coverage embedded in it. Every usable one is
several megabytes, so committing the font would put a binary blob in the
repository to render four glyphs, and committing only the PDF would leave
regeneration dependent on whatever font the regenerating machine happened to
have.

The generator therefore resolves a font from a documented list of local
candidates, verifies **from the font's own `name` and `OS/2` tables** that it is
freely licensed and permits embedding and subsetting, and embeds a subset in the
PDF. The subset — 44 KB, not the font — is what this directory carries.

The committed `cjk.pdf` was generated from:

| Field | Value |
| --- | --- |
| File | `C:/Windows/Fonts/Noto Sans SC (TrueType).otf` |
| Family | Noto Sans SC |
| License | SIL Open Font License, Version 1.1 |
| License URL | `http://scripts.sil.org/OFL` |
| Copyright | `© 2014-2020 Adobe (http://www.adobe.com/).` |
| Embedding permission | `OS/2.fsType` = `{ noEmbedding: false, viewOnly: false, editable: false, noSubsetting: false, bitmapOnly: false }` |

Every field above is read from the font file by the generator and printed when it
runs; none of it is asserted from a filename. A font that forbids embedding, or
whose license string is not a recognised free license, is refused rather than
embedded, so regeneration cannot silently substitute a font that may not be
redistributed.

Noto Sans SC is licensed under the SIL Open Font License 1.1, which permits
embedding and subsetting in a document and permits redistribution of the
resulting document. The copyright notice and the license are preserved inside
`cjk.pdf` itself: `pdf-lib` copies the font's `name` table into the embedded font
program, so the subset carries its own provenance. The full text of the license
is not reproduced in this repository, which is the reason it is recorded by
reference and by the font's own embedded notice rather than by a copy that could
drift from the original.
