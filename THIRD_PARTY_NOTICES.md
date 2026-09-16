# Third-party notices

This file records the third-party software this repository depends on, with the
license each is used under. It is maintained from Task 3 onward: the dependency
rule in `AGENTS.md` requires the license and the shipped status of every added
dependency to be recorded here rather than discovered at release time.

The project's own license is MIT (see `LICENSE`). That license covers this
repository's code only; every dependency below stays under its own license, and
a permissive project license is not a claim about anything it depends on.

## Shipped in the plugin package

`pdfjs-dist` is this repository's first **bundled** runtime dependency. It is
declared in `dependencies`, and unlike `@zip.js/zip.js` it is inside the built
`lib/client.js` today: the PDF renderer imports it, and the DSH client loader
cannot resolve a bare npm specifier at run time, so `tsdown.config.ts` names it
in `deps.alwaysBundle`. The artifact is roughly 6.8 MB raw and 3.0 MB gzipped as a
result, most of which is PDF.js itself, its worker and its three asset families.

`@zip.js/zip.js` is the second runtime dependency. The built `lib/client.js` does
not contain it — nothing in the shipping entry point reaches `src/client/ooxml/`
until a renderer does — but it is a runtime dependency from the moment it is
declared, and it is recorded here as one.

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| `pdfjs-dist` | 6.3.289 | Apache-2.0 | PDF parsing, rasterization and text-layer layout for the selectable PDF preview. The whole library, its module worker, the Adobe CMap family, the standard-font family and the wasm decoders are embedded in `lib/client.js`; nothing is fetched at run time. |
| `@zip.js/zip.js` | 2.15.0 | BSD-3-Clause | OOXML ZIP central-directory metadata validation and later OOXML archive reading. It reads the central directory of a DOCX, PPTX or XLSX package so the preflight can bound the entry count, the declared sizes, the compression ratio and the entry names before any renderer touches the archive. |

### `pdfjs-dist` 6.3.289

Task 7 introduced this dependency, recorded with the required fields:

```text
package:  pdfjs-dist
version:  6.3.289
license:  Apache-2.0
runtime/test-only: runtime dependency (bundled into lib/client.js)
```

The version is **not chosen by this project.** It is the exact version the
primary verified runtime carries: the installed
`@deepseek-ai/dsh-client-ui-sidebar-documentpreview@0.1.5-rc.1` package declares
`"pdfjs-dist": "6.3.289"` in its own `devDependencies`, and that is the version
whose build the installed `lib/client.js` was compiled from — the compiled bundle
contains `pdfjsVersion = 6.3.289`, `pdfjsBuild = 1c8020a7d` and a source comment
naming `pdfjs-dist@6.3.289`. A PDF.js worker speaks a message protocol that is not
stable across releases, so a plugin whose renderer used a different version from
the one DSH ships would be a compatibility claim nobody could verify. The
specifier is therefore pinned exactly — `"pdfjs-dist": "6.3.289"`, with no `^`,
`~` or range — and `scripts/dsh-doctor.mjs` reports the pin against the
installation on this machine.

The license was verified against published registry metadata rather than against
this project's documentation: `npm view pdfjs-dist@6.3.289 version license
dependencies` reports `6.3.289`, `Apache-2.0` and no dependencies at all, so the
package adds exactly one module to the install graph.

**The whole package is not covered by one license.** The files this project
embeds are the API bundle, the worker, and the CMap, standard-font and wasm
families, and those families carry their own notices inside the package. Each is
recorded below with its upstream path, and each corresponding license file is
retained unmodified in `node_modules/pdfjs-dist/` in any installation of this
project:

| Embedded resource | Upstream path | Version | License | Notice file in the package |
| --- | --- | --- | --- | --- |
| API bundle and module worker | `build/pdf.mjs`, `build/pdf.worker.min.mjs` | 6.3.289 | Apache-2.0 | `LICENSE` |
| Adobe CMap files (169 files) | `cmaps/*.bcmap` | 6.3.289 | Apache-2.0 | `cmaps/LICENSE` |
| Foxit standard fonts | `standard_fonts/Foxit*.pfb` | 6.3.289 | Apache-2.0, as distributed by PDF.js | `standard_fonts/LICENSE_FOXIT` |
| Liberation standard fonts | `standard_fonts/LiberationSans-*.ttf` | 6.3.289 | SIL Open Font License 1.1 | `standard_fonts/LICENSE_LIBERATION` |
| JBIG2 decoder | `wasm/jbig2.wasm` | 6.3.289 | Apache-2.0 (PDF.js JBIG2 decoder) | `wasm/LICENSE_JBIG2`, `wasm/LICENSE_PDFJS_JBIG2` |
| JPEG 2000 decoder | `wasm/openjpeg.wasm` | 6.3.289 | Apache-2.0 (OpenJPEG) | `wasm/LICENSE_OPENJPEG`, `wasm/LICENSE_PDFJS_OPENJPEG` |
| QCMS colour management | `wasm/qcms_bg.wasm` | 6.3.289 | Apache-2.0 / MIT (qcms) | `wasm/LICENSE_QCMS`, `wasm/LICENSE_PDFJS_QCMS` |
| QuickJS evaluation module | `wasm/quickjs-eval.wasm` | 6.3.289 | Apache-2.0 | `wasm/LICENSE_*` |

Licence files are not among the embedded resources: `tsdown.config.ts` skips
every filename beginning with `LICENSE` when it builds the asset table, because
those are records rather than resources PDF.js ever requests. The obligation they
satisfy is met by this file and by the retained copies in the installed package,
not by a base64 literal that no reader would ever open.

`pdfjs-dist` is imported only through its public package entry
(`import { getDocument, PDFWorker, TextLayer } from 'pdfjs-dist'`). No `lib/`
private path is imported, and no PDF.js internal is reached through a deep
import: the renderer uses the three values the package exports and the option
object `getDocument` documents.

**The selectable text layer's CSS is adapted from PDF.js.** The
`src/client/renderers/pdf/styles.ts` style sheet contains rules adapted from
`pdfjs-dist@6.3.289`'s `web/pdf_viewer.css`, which is Apache-2.0:

```text
source:  pdfjs-dist 6.3.289
file:    web/pdf_viewer.css
license: Apache-2.0
```

Three departures from that source are deliberate and are recorded so a reviewer
can check them: the sheet is scoped to the `.textLayer` class names PDF.js itself
emits plus this plugin's own `data-dsa-*` attributes, rather than reproducing the
whole viewer; the rules for the annotation editor, the sidebar and the viewer
shell are omitted, because this renderer creates none of those elements; and the
custom properties that carry values rather than rules
(`--total-scale-factor`, `--scale-round-x`, `--scale-round-y`) are written from
JavaScript instead of from a literal, because their correct value is the one the
canvas beside the text was rendered with.

### `@zip.js/zip.js` 2.15.0

Task 6 introduced this dependency, recorded with the required fields:

```text
package:  @zip.js/zip.js
version:  2.15.0
license:  BSD-3-Clause
runtime/test-only: runtime dependency
```

The version is pinned exactly — `"@zip.js/zip.js": "2.15.0"`, with no `^`, `~` or
range — because this project requires reproducible builds and a security
preflight is not a place where a patch release should arrive unannounced. The
lockfile records the same specifier and a single resolved version.

The license is **BSD-3-Clause, not MIT**. The two are both permissive and are not
interchangeable statements, so the package's own license text is what governs its
use and is retained unmodified in `node_modules/@zip.js/zip.js/LICENSE` in any
installation of this project. That file carries the copyright notice
(`Copyright (c) 2023, Gildas Lormeau`) and the three clauses including the
no-endorsement clause, which the BSD-3-Clause requires be kept with a
redistribution; redistributing this plugin therefore means redistributing that
notice with it. The installed `LICENSE` is the authoritative copy and nothing in
this repository rewrites or renames it.

Both facts were verified against real package metadata rather than against this
project's documentation: `npm view @zip.js/zip.js@2.15.0 version license
dependencies` reports `2.15.0`, `BSD-3-Clause` and no dependencies at all, and
`node_modules/@zip.js/zip.js/package.json` independently declares
`"license": "BSD-3-Clause"` with no `dependencies` and no `peerDependencies`,
which is why the package adds exactly one module to the install graph.

`@zip.js/zip.js` is imported only through its public package export
(`import { Uint8ArrayReader, ZipReader } from '@zip.js/zip.js'`). No private
`lib/` path is imported, so no part of this project depends on a module the
package does not publish as API.

## Development and test only

These are `devDependencies`. They are used to build, type-check and test the
plugin and are **not** shipped in the published package, which is why the
`files` list in `package.json` excludes `node_modules` and the test tree.

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| `jsdom` | 30.0.1 | MIT | Test-only DOM implementation. The client specs run under the Vitest `jsdom` environment so that selection ownership, `Range` behaviour and the overlay's render lifecycle are exercised against a real `Selection`/`Range` pair and a real DOM rather than against hand-written stand-ins. No `jsdom` type or value is referenced by `src/`. |
| `@types/react-dom` | 18.3.7 | MIT | Type declarations for React DOM, required because the client specs mount components with `createRoot` (Task 5). Types only; nothing from this package reaches the bundle. |
| `@deepseek-ai/dsh-client-ui-sidebar-right` | 0.1.5-rc.1 | MIT | Contract-only pin for the real-DSH smoke added in Task 5B. The compile probe `tests/compatibility/smoke-driver.contracts.compile.ts` reads the `Context.sidebarRight` augmentation and `openResource` from this package's public `./client` declaration, so the one navigation call the test-only driver makes is checked against the published contract. No value or type from it reaches the plugin's bundle, and it is not a dependency of the shipped package. |
| `@deepseek-ai/dsh-client-ui-layout` | 0.1.5-rc.1 | MIT | Contract-only pin added in Task 5C. The `shell.overlay` root-scoped list slot the Ask surface moved into is declared by this package's public `./client` entry, and `tests/compatibility/contracts.compile.ts` reads that declaration to assert the slot's `kind` and `scope` at compile time. Imported with `import type {}` only — nothing from it reaches the plugin's bundle. |
| `pdf-lib` | 1.17.1 | MIT | PDF fixture generator (`scripts/generate-pdf-fixtures.mjs`) added in Task 7. It writes the four committed fixtures in `tests/fixtures/pdf/`. Nothing from it reaches `src/` or the bundle; `pnpm build` does not read it. |
| `@pdf-lib/fontkit` | 1.1.1 | MIT | Font parsing and subsetting for the same generator. It reads the CJK font's own `name` and `OS/2` tables so the generator can verify the license and the embedding permission before embedding a subset, and it drives `pdf-lib`'s `registerFontkit`. Development/test-only; nothing from it reaches the bundle. |

Task 7 introduced two development dependencies, recorded with the required fields:

```text
package:  pdf-lib
version:  1.17.1
license:  MIT
runtime/test-only: development/test-only (fixture generation)

package:  @pdf-lib/fontkit
version:  1.1.1
license:  MIT
runtime/test-only: development/test-only (fixture generation)
```

Neither is a runtime dependency, and neither reaches the client bundle: the
generator is a Node script, and no `src/` module imports either package. They were
chosen because a PDF fixture has to be deterministic and offline — a generator
that downloaded a PDF, or that produced different bytes on each run, would make
the browser smoke unreproducible.

### The CJK fixture font

`tests/fixtures/pdf/cjk.pdf` embeds a **subset** of a CJK font so that real CJK
text can be extracted and selected. The font itself is not committed; the
generator resolves it locally, verifies from the font's own `name` and `OS/2`
tables that it is freely licensed and permits embedding and subsetting, and embeds
only the glyphs the fixture uses. What is committed is the 44 KB PDF.

| Field | Value |
| --- | --- |
| Source file | `C:/Windows/Fonts/Noto Sans SC (TrueType).otf` |
| Family | Noto Sans SC |
| License | SIL Open Font License, Version 1.1 |
| License URL | `http://scripts.sil.org/OFL` |
| Copyright | `© 2014-2020 Adobe (http://www.adobe.com/).` |
| Embedding permission | `OS/2.fsType` = `{ noEmbedding: false, viewOnly: false, editable: false, noSubsetting: false, bitmapOnly: false }` |
| Committed artifact | `tests/fixtures/pdf/cjk.pdf` — test fixture, not shipped in the published package |

The font's `name` table travels with the subset inside the PDF, so the embedded
program carries its own copyright and license statement. `tests/fixtures/pdf/README.md`
records the same provenance next to the artifacts.

Task 5B introduced one dependency, recorded with the required fields:

```text
package:  @deepseek-ai/dsh-client-ui-sidebar-right
version:  0.1.5-rc.1
license:  MIT
runtime/test-only: development/test-only
```

Task 5C introduced one dependency, recorded with the same fields:

```text
package:  @deepseek-ai/dsh-client-ui-layout
version:  0.1.5-rc.1
license:  MIT
runtime/test-only: development/contract-only
```

Both pins match the primary runtime release family (`0.1.5-rc.1`), which is the
same release every other DSH contract package in `devDependencies` carries. Each
license was verified against the published registry metadata (`npm view
@deepseek-ai/dsh-client-ui-sidebar-right@0.1.5-rc.1 license` and `npm view
@deepseek-ai/dsh-client-ui-layout@0.1.5-rc.1 license` both report `MIT`) and
against the installed package's own `package.json`.

`layout` is deliberately **not** a Cordis runtime service dependency. The plugin
does not read `ctx.layout` anywhere; it only needs the slot declaration to exist
in the type program, which the `import type {}` above provides. The package edge
in `dsh.client.inject` is a separate statement and is present: the host composes
the layout package's browser half ahead of this one, so the slot the surface
registers into is declared by the time the registration runs.

jsdom — MIT. Development/test-only dependency; not included in the runtime plugin
bundle.

`@types/react-dom` — MIT. Development/test-only type declarations; React DOM
itself is supplied by the DSH boot, not by this package.

The licenses were verified against the installed package metadata rather than
against the project's documentation: `node_modules/jsdom/package.json` declares
`"license": "MIT"` with the MIT text in `node_modules/jsdom/LICENSE.txt`, and
`@types/react-dom` is published by DefinitelyTyped under MIT.

The remaining `devDependencies` listed in `package.json` are the DSH client
contract packages pinned to the verified runtime release, plus TypeScript,
tsdown, Vitest and Playwright. They are the project's toolchain rather than
third-party code incorporated into the plugin.

## Notes on scope

Recorded here so that a release check can verify the claims:

- no CDN- or network-loaded asset is a dependency of the plugin. The PDF renderer
  configures PDF.js with `useWorkerFetch: false`, no `cMapUrl`,
  `standardFontDataUrl` or `wasmUrl`, and its own `BinaryDataFactory` backed by
  build-embedded bytes; a request for an asset this build does not carry throws
  `PdfAssetFailure` instead of reaching for a URL;
- the PDF worker is started from a `Blob` over the build-embedded
  `pdf.worker.min.mjs`, not from a package URL and not from a CDN;
- no parser or renderer library is imported by `src/client/selection/`, which is
  format-independent by construction;
- `src/client/ooxml/` is the one module that depends on `@zip.js/zip.js`, and it
  reads archive metadata only: it calls no entry-extraction API, imports no
  filesystem module, parses no XML and starts no worker;
- `src/client/renderers/pdf/` is the one module that depends on `pdfjs-dist`, and
  it imports the package's public entry only;
- the DOCX, PPTX and XLSX renderer dependencies remain unimplemented in the
  current task sequence, and their licenses are recorded when they are added.
- no dependency is currently used under a copyleft, source-available or
  custom license; a dependency whose license cannot be established is not added,
  and a `GPL`/`AGPL`/`SSPL`/`BUSL`/Commons Clause dependency would be a stop
  condition rather than an accepted entry in this file. The two font licenses
  above are recorded as what they are — Apache-2.0, SIL OFL 1.1, MIT — and the
  SIL OFL's own conditions are satisfied by the subset carrying its notice and by
  the provenance recorded here.

