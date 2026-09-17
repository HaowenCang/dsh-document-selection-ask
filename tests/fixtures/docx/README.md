# DOCX fixtures

These files are committed and used by both client/unit specifications and real DSH
browser smoke tests. They are generated deterministically by
`scripts/generate-docx-fixtures.mjs`, never downloaded from external networks, and
contain no proprietary source materials or private data.

| File | Content | Purpose |
| --- | --- | --- |
| `paragraphs.docx` | Headings and paragraphs (`DOCX Alpha`, `DOCX Beta`, `DOCX Gamma`) with bold, italic, and Unicode text (`DOCX 中文选段`) | Native DOM Selection, styling fidelity, and Ask flow verification |
| `manual-page-break.docx` | Two pages separated by a real `w:br w:type="page"`: `DOCX page one Alpha` on page 1, `DOCX page two Beta` on page 2 | Verifies rendered page section generation, `data-dsa-docx-page` markers, and cross-page rendered provenance |
| `table-image.docx` | A 2×2 table with cell text and an embedded programmatically generated 16×16 PNG image | Verifies table rendering and embedded image decoding without remote network fetches |
| `headers-footers.docx` | Document with default header (`header marker`), body (`body marker`), and footer (`footer marker`) | Verifies `renderHeaders: true` and `renderFooters: true` functionality in docx-preview |
| `altchunk.docx` | Document with an embedded HTML `w:altChunk` part containing script and HTML markers | Verifies `renderAltChunks: false` security barrier prevents arbitrary HTML injection |
| `external-links.docx` | Document with various external and internal hyperlinks (Safe HTTPS, Safe Mail, Danger JS, Danger Data, Danger File, Danger Custom, Internal Bookmark) | Verifies scheme allowlist enforcement, stripping of unsafe link attributes, HTTP(S) noopener/noreferrer hardening, and bookmark preservation |

## Provenance and Generation

Generated with `docx@9.7.1` (MIT license) and `@zip.js/zip.js@2.15.0` (BSD-3-Clause license) via:

```bash
node scripts/generate-docx-fixtures.mjs
```

All binary assets (such as the test PNG) are generated purely in-memory.
