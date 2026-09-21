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
declared in `dependencies`, and it is inside the built `lib/client.js` today: the
PDF renderer imports it, and the DSH client loader cannot resolve a bare npm
specifier at run time, so `tsdown.config.ts` names it in `deps.alwaysBundle`. The
artifact is 16,331,628 bytes raw and 6,248,980 bytes gzipped as a result. The
packages the bundler's own `//#region` comments attribute inside it occupy
15,756,695 of those characters, and `pdfjs-dist` is the largest single share at
6,731,173 characters — PDF.js itself, its worker and its three asset families.

`@zip.js/zip.js` is the second runtime dependency, and it is **also** inside the
built `lib/client.js`. The browser entry reaches it: `applyClient` registers the
four renderers, each registration path reaches `src/client/ooxml/` for the shared
OOXML preflight, and that module imports the package's public entry. The build
inlines it under `alwaysBundle`, and the artifact carries 34 `//#region
node_modules/.pnpm/@zip.js+zip.js@2.15.0/…` comments naming it, occupying 272,951
characters. It is recorded here both as a declared runtime dependency and as a
bundled one.

The table is the **complete** shipped set, and `scripts/verify.mjs` R8 derives that
set automatically rather than restating it: the declared production dependencies,
the packages the project-owned build pipeline explicitly resolves installed bytes
out of, and the packages the project's own bundler records as inlined into
`lib/client.js`. A library added to the build without a row here fails `pnpm
verify`, and so does a row whose version or license no longer matches the
installed package. The derivation and the one boundary it does not cross are
described under "How the shipped set is discovered" below.

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| `pdfjs-dist` | 6.3.289 | Apache-2.0 | PDF parsing, rasterization and text-layer layout for the selectable PDF preview. The whole library, its module worker, the Adobe CMap family, the standard-font family and the wasm decoders are embedded in `lib/client.js`; nothing is fetched at run time. |
| `@zip.js/zip.js` | 2.15.0 | BSD-3-Clause | OOXML ZIP central-directory metadata validation and later OOXML archive reading. It reads the central directory of a DOCX, PPTX or XLSX package so the preflight can bound the entry count, the declared sizes, the compression ratio and the entry names before any renderer touches the archive. |
| `docx-preview` | 0.4.0 | Apache-2.0 | High-fidelity DOCX rendering into standard HTML/CSS DOM for the selectable DOCX preview. Used solely through its public `renderAsync` entrypoint. |
| `jszip` | 3.10.2 | MIT | Transitive runtime dependency brought in by `docx-preview` and `@aiden0z/pptx-renderer` for ZIP decompression. Inlined into `lib/client.js` from the package's own prebuilt browser bundle, `dist/jszip.min.js`, which is the file `tsdown.config.ts` aliases the `jszip` specifier to; that bundle is a single self-contained artifact carrying vendored copies of the libraries jszip itself depends on, and those copies are part of jszip's distribution and are attributed here to jszip rather than listed as separate packages. |
| `@aiden0z/pptx-renderer` | 1.2.4 | Apache-2.0 | High-fidelity PPTX rendering into HTML/SVG DOM for the selectable PPTX preview. Used through public package exports `PptxViewer`, `parseZipLazyMedia`, `buildPresentation`, and `RECOMMENDED_ZIP_LIMITS`. Bundled into `lib/client.js`. |
| `echarts` | 6.1.0 | Apache-2.0 | Transitive runtime dependency brought in by `@aiden0z/pptx-renderer` for rendering presentation charts. Bundled into `lib/client.js`. |
| `zrender` | 6.1.0 | BSD-3-Clause | Transitive runtime dependency brought in by `echarts` for 2D canvas/SVG rendering. Bundled into `lib/client.js`. |
| `@extend-ai/react-xlsx` | 0.16.4 | MIT | React components and hooks for viewing XLSX workbooks in read-only mode for the selectable XLSX preview. Bundled into `lib/client.js` from the package's published `dist/index.js`; like `jszip`, that file is a self-contained artifact that already carries the copies of its own dependencies it was built with. |
| `@dukelib/sheets-wasm` | 0.1.23 | MIT | WebAssembly bindings for the Duke sheets Excel engine used by `@extend-ai/react-xlsx`. Its glue, the engine binary and the compressed-inline delivery path are described below. |
| `fflate` | 0.8.3 | MIT | Transitive runtime dependency used by `@extend-ai/react-xlsx`; its browser ESM implementation is inlined by the project-owned XLSX runtime-asset builder (`scripts/xlsx-runtime-assets.ts`) into the self-contained XLSX Worker source shipped inside `lib/client.js`. The worker has its own global scope, so the copy the main thread bundles is not reachable from it and a second copy is embedded there. |
| `@tanstack/react-virtual` | 3.14.13 | MIT | Virtualization primitive used by `@extend-ai/react-xlsx`'s workbook viewport so only the visible row window is mounted. Declared as a direct runtime dependency of that package and bundled into `lib/client.js`; the build replaces its `flushSync` import from `react-dom` with a direct `rerender()` call, because the DSH boot supplies React through the loader envelope rather than as a resolvable module. |
| `@tanstack/virtual-core` | 3.17.11 | MIT | Platform-independent measurement, range and scroll arithmetic beneath `@tanstack/react-virtual`. Bundled into `lib/client.js` through that package rather than declared by this repository. |
| `d3-array` | 3.2.4 | ISC | Array statistics, bisection and tick generation, reached through `d3-geo` and `d3-scale` from `@extend-ai/react-xlsx`'s chart renderer. Bundled into `lib/client.js`. It is the package that brings `internmap`. |
| `d3-color` | 3.1.0 | ISC | Colour parsing and conversion, reached through `d3-interpolate`. Bundled into `lib/client.js`. |
| `d3-format` | 3.1.2 | ISC | Number and SI-prefix formatting, reached through `d3-scale`. Bundled into `lib/client.js`. |
| `d3-geo` | 3.1.1 | ISC | Geographic projections and path generation; declared as a direct runtime dependency of `@extend-ai/react-xlsx` and used with `topojson-client` for map-style charts. Bundled into `lib/client.js`. |
| `d3-hierarchy` | 3.1.2 | ISC | Hierarchy, partition and treemap layouts; declared as a direct runtime dependency of `@extend-ai/react-xlsx`. Bundled into `lib/client.js`. |
| `d3-interpolate` | 3.0.1 | ISC | Value and colour interpolation, reached through `d3-scale`. Bundled into `lib/client.js`. |
| `d3-path` | 3.1.0 | ISC | Canvas and SVG path serialization, reached through `d3-shape`. Bundled into `lib/client.js`. |
| `d3-scale` | 4.0.2 | ISC | Band, linear and point scales; declared as a direct runtime dependency of `@extend-ai/react-xlsx`. Bundled into `lib/client.js`. |
| `d3-shape` | 3.2.0 | ISC | Line, area, arc, pie and symbol generators; declared as a direct runtime dependency of `@extend-ai/react-xlsx`. Bundled into `lib/client.js`. |
| `internmap` | 2.0.3 | ISC | `Map` subclass keyed by a value's primitive form, reached through `d3-array` so that scales and extents can key on dates and objects. Bundled into `lib/client.js`. |
| `regl` | 2.1.1 | MIT | Functional WebGL layer; declared as a direct runtime dependency of `@extend-ai/react-xlsx` and imported by its surface renderer. Bundled into `lib/client.js`. |
| `topojson-client` | 3.1.0 | ISC | TopoJSON-to-GeoJSON conversion; declared as a direct runtime dependency of `@extend-ai/react-xlsx` and used with `d3-geo` for map-style charts. Bundled into `lib/client.js`. |
| `tslib` | 2.3.0 | 0BSD | TypeScript's own runtime helpers, imported by `echarts` and `zrender`; their emitted modules inline `tslib.es6.js`, so the bundle carries tslib's implementations. Bundled into `lib/client.js`. |

### How the shipped set is discovered

The table above is not maintained by hand, and the reason is a measured one. Until Task 13S
`scripts/verify.mjs` compared this file against a list of nine package names written inside the
gate script, and that list had to be kept in step with `tsdown.config.ts` and
`scripts/xlsx-runtime-assets.ts` by memory. `fflate` fell through exactly there: its browser ESM
build is read out of the installed `@extend-ai/react-xlsx` dependency and inlined by the
runtime-asset builder into the synthesized XLSX worker, which travels to the browser as a string
inside `lib/client.js`, so it appears in no bundler region comment and in no lockfile edge from
this repository's own `package.json`. The gate reported 12/12 with the library shipping and
unrecorded.

R8 now derives the shipped set from three project-owned authorities and requires a notice for
every member of it:

- the declared production dependencies in `package.json`, recorded whether or not a renderer
  currently reaches them, which is how `@zip.js/zip.js` is treated;
- the packages the project-owned build pipeline explicitly resolves installed bytes out of —
  `req.resolve("jszip/dist/jszip.min.js", …)`,
  `reactXlsxRequire.resolve("fflate/package.json")`,
  `reactXlsxRequire.resolve("@dukelib/sheets-wasm")`,
  `join(import.meta.dirname, "node_modules", "pdfjs-dist")` — which is the channel that makes
  `fflate` impossible to ship unnoticed;
- the packages the project's own bundler records as inlined into `lib/client.js`, read from the
  `//#region node_modules/<path>` comment it emits per module, which is what makes `d3-*`,
  `regl`, `topojson-client`, `internmap`, `tslib` and the two `@tanstack` packages above
  discoverable at all.

**The boundary this rule does not cross.** A package that a third party has already vendored
inside its own prebuilt distribution is attributed to that third party here, not enumerated as a
separate dependency of this repository. Two of the packages above are in that position: `jszip`
is inlined from its own browserify bundle, which carries its internal `pako`, `lie`,
`readable-stream` and `setimmediate` copies, and `@extend-ai/react-xlsx`'s published
`dist/index.js` already carries the `us-atlas` and `world-atlas` TopoJSON data it was built with
rather than importing them. Both are permissively licensed, both are recorded as what they are —
vendored contents of a distribution this project consumes — and neither is a package this build
resolves or inlines on its own. The gate states the same limit in its own header: it searches
text, and it does not claim to prove the absence of unknown vendored code.

### `docx-preview` 0.4.0 and `jszip` 3.10.2

Task 9 introduced `docx-preview` 0.4.0 as the renderer for DOCX documents:

```text
package:  docx-preview
version:  0.4.0
license:  Apache-2.0
runtime/test-only: runtime dependency (bundled into lib/client.js)
```

The license was verified against `node_modules/docx-preview/package.json` and
`node_modules/docx-preview/LICENSE`. The package brings in `jszip` as its runtime
dependency for reading DOCX ZIP archives:

```text
package:  jszip
version:  3.10.2
license:  MIT (MIT OR GPL-3.0-or-later, used under MIT)
runtime/test-only: transitive runtime dependency (bundled into lib/client.js)
```

The license was verified against `node_modules/.pnpm/jszip@3.10.2/node_modules/jszip/package.json`
and `node_modules/.pnpm/jszip@3.10.2/node_modules/jszip/LICENSE.markdown`. Both packages are
bundled into `lib/client.js` via `alwaysBundle` in `tsdown.config.ts`.

### `docx` 9.7.1 (Development / Fixture Generator Only)

```text
package:  docx
version:  9.7.1
license:  MIT
runtime/test-only: test-only fixture generator (devDependencies; NOT bundled into lib/client.js)
```

Used solely in `scripts/generate-docx-fixtures.mjs` to deterministically create test documents.
It is not imported anywhere in `src/` and is strictly verified to have 0 occurrences in the
shipping client artifact `lib/client.js`.

### `@aiden0z/pptx-renderer` 1.2.4, `echarts` 6.1.0, and `zrender` 6.1.0

Task 10 introduced `@aiden0z/pptx-renderer` 1.2.4 as the renderer for PPTX presentations:

```text
package:  @aiden0z/pptx-renderer
version:  1.2.4
license:  Apache-2.0
runtime/test-only: runtime dependency (bundled into lib/client.js)
```

The license was verified against `node_modules/@aiden0z/pptx-renderer/package.json` and registry metadata.
It brings in `echarts` as a direct runtime dependency for rendering presentation charts:

```text
package:  echarts
version:  6.1.0
license:  Apache-2.0
runtime/test-only: transitive runtime dependency (bundled into lib/client.js)
```

`echarts` in turn brings in `zrender` for vector and canvas rendering:

```text
package:  zrender
version:  6.1.0
license:  BSD-3-Clause
runtime/test-only: transitive runtime dependency (bundled into lib/client.js)
```

All three packages are bundled into `lib/client.js` via `alwaysBundle` in `tsdown.config.ts`.
Notice that 1.2.4 avoids `mtx-decompressor` (MPL-2.0), ensuring zero weak-copyleft distribution surface.

### `pptxgenjs` 4.0.1 (Development / Fixture Generator Only)

```text
package:  pptxgenjs
version:  4.0.1
license:  MIT
runtime/test-only: test-only fixture generator (devDependencies; NOT bundled into lib/client.js)
```

Used solely in `scripts/generate-pptx-fixtures.mjs` to deterministically create test presentations.
It is not imported anywhere in `src/` and is verified to have 0 occurrences in `lib/client.js`.

### `@extend-ai/react-xlsx` 0.16.4 and `@dukelib/sheets-wasm` 0.1.23

Task 11 introduced `@extend-ai/react-xlsx` 0.16.4 as the read-only renderer for XLSX spreadsheet workbooks:

```text
package:  @extend-ai/react-xlsx
version:  0.16.4
license:  MIT
runtime/test-only: runtime dependency (bundled into lib/client.js)
```

The license was verified against `node_modules/@extend-ai/react-xlsx/package.json` and
`node_modules/@extend-ai/react-xlsx/LICENSE`. The package brings in `@dukelib/sheets-wasm`
as its WebAssembly spreadsheet parsing and calculation engine:

```text
package:  @dukelib/sheets-wasm
version:  0.1.23
license:  MIT
runtime/test-only: runtime dependency of @extend-ai/react-xlsx (glue, inlined)
```

Both were re-verified against the installed manifests rather than against this file:
`node_modules/@extend-ai/react-xlsx/package.json` declares version `0.16.4` and
`"license": "MIT"`, and the installed `@dukelib/sheets-wasm` — reachable only through the pnpm
store, at `node_modules/.pnpm/@dukelib+sheets-wasm@0.1.23/node_modules/@dukelib/sheets-wasm/` —
declares version `0.1.23` and `"license": "MIT"`.

The engine binary is `@extend-ai/react-xlsx`'s own `duke_sheets_wasm_bg.wasm`
(4,412,299 bytes, SHA-256
`24687a3e6d051689d7ff0fdde5148ff527744100d4fd70efa3d1580a05e6ef3d`), published at the export
subpath `@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm`, which the package's own manifest maps
to `./dist/duke_sheets_wasm_bg.wasm`. `@dukelib/sheets-wasm` supplies the JavaScript glue the
engine is initialised through. The binary is not fetched from any CDN and no remote fallback
exists.

**Delivery path.** The binary and the worker both reach the browser, and the earlier statement
in this file that they did not is superseded rather than removed, because the reason for the
change is part of the record. DSH serves an external client plugin's browser half as exactly one
generated script — the file `exports["./client"]` names, plus its optional source map — through a
closed, pre-computed response table, and exposes no public client-only API by which a plugin may
contribute a second file. An earlier revision registered `/dsa-assets/...` routes in the host
half to work around that; the routes were removed because a host dependency is not the frozen
client-only architecture, and nothing in the shipped plugin reaches a host service today.

What replaced them is the compressed-inline architecture, built by
`scripts/xlsx-runtime-assets.ts` at bundle time. It is recorded here as the shipping statement:

```text
exact installed duke_sheets_wasm_bg.wasm
  -> identity gate (package version, byte length and SHA-256 asserted before anything is emitted)
  -> deterministic gzip at level 9 (zero MTIME, no file name, so the payload is a function of the dependency bytes)
  -> base64 payload embedded in lib/client.js
  -> inflated locally in the browser on first use
  -> runtime SHA-256 verification against the same digest
  -> setWasmSource(BufferSource) on the engine module
```

The raw uncompressed binary is **not** base64-embedded; that representation stays forbidden, and
a payload that grew toward it fails the build with `XLSX WASM COMPRESSION REGRESSION` rather than
shipping. The worker is embedded the same way and is self-contained: the library's own
`xlsx-worker.js` is rewritten so that it carries no import of any kind, its three `fflate`
imports are replaced by a destructuring of the inlined `fflate` copy described in the table
above, and its dynamic `import("@dukelib/sheets-wasm")` is routed to the glue the bundle banner
already holds. The plugin constructs the worker from a `Blob` over that embedded source, so it is
a Blob worker and the library's own `new URL("./xlsx-worker.js", import.meta.url)` never survives
into the artifact.

The consequence is measured rather than asserted: the built client issues **zero** HTTP requests
for the engine and **zero** for the worker. `tests/browser/xlsx-selection.spec.ts` case 0 used to
record the blocked state; it now opens the workbook through the delivered engine and is titled
"client-inline runtime boot: no asset request, no remote request, a real Blob Worker parses the
workbook".

### `exceljs` 4.4.0 (Development / Fixture Generator Only)

```text
package:  exceljs
version:  4.4.0
license:  MIT
runtime/test-only: test-only fixture generator (devDependencies; NOT bundled into lib/client.js)
```

Used solely in `scripts/generate-xlsx-fixtures.mjs` to deterministically create test spreadsheet fixtures.
It is not imported anywhere in `src/` and is verified to have 0 occurrences in `lib/client.js`.

### `pdfjs-dist` 6.3.289

Task 7 introduced this dependency, recorded with the required fields:

```text
package:  pdfjs-dist
version:  6.3.289
license:  Apache-2.0
runtime/test-only: runtime dependency (bundled into lib/client.js)
```

The version is **not chosen by this project.** It is the exact version the
primary verified runtime carries. The installed
`@deepseek-ai/dsh-client-ui-sidebar-documentpreview@0.1.5-rc.2` — recorded in
`devDependencies` at that release and reachable through the pnpm store — declares
`"pdfjs-dist": "6.3.289"` in its own `devDependencies`. The version that DSH's
own document preview compiles against is therefore 6.3.289 on the current
baseline, and that is the value this project pins. A PDF.js worker speaks a
message protocol that is not stable across releases, so a plugin whose renderer
used a different version from the one DSH ships would be a compatibility claim
nobody could verify.

This file records the pin against the installed package rather than against the
DSH bundle: the installed
`@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js` is 6,888,390
bytes and does not carry the string `pdfjsVersion` at all, so it is not an
authority for which PDF.js build the runtime resolves. What the pin is checked
against is the declaration above and this repository's own artifact: the built
`lib/client.js` carries `pdfjsVersion = 6.3.289` and `pdfjsBuild = 1c8020a7d`,
inside a module the bundler attributes to
`node_modules/.pnpm/pdfjs-dist@6.3.289/node_modules/pdfjs-dist/build/pdf.mjs`. The
specifier is pinned exactly — `"pdfjs-dist": "6.3.289"`, with no `^`, `~` or range
— and `scripts/verify.mjs` R8 compares the version this file records with the one
`pnpm-lock.yaml` resolves.

The historical note that this pin was first taken from
`@deepseek-ai/dsh-client-ui-sidebar-documentpreview@0.1.5-rc.1` remains true of
Task 7, where the dependency was introduced, and is retained in this file's
record of that Task. The release the project is verified against today is
`0.1.5-rc.2`, and the paragraph above states the current baseline.

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
JavaScript instead of from a literal, because their correct values are the page's
CSS viewport scale and its rounding granularity — the geometry the canvas's CSS
box is laid out from, not the canvas's backing-store scale.

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
| `@deepseek-ai/dsh-client-ui-sidebar-right` | 0.1.5-rc.2 | MIT | Contract-only pin for the real-DSH smoke added in Task 5B. The compile probe `tests/compatibility/smoke-driver.contracts.compile.ts` reads the `Context.sidebarRight` augmentation and `openResource` from this package's public `./client` declaration, so the one navigation call the test-only driver makes is checked against the published contract. No value or type from it reaches the plugin's bundle, and it is not a dependency of the shipped package. |
| `@deepseek-ai/dsh-client-ui-layout` | 0.1.5-rc.2 | MIT | Contract-only pin added in Task 5C. The `shell.overlay` root-scoped list slot the Ask surface moved into is declared by this package's public `./client` entry, and `tests/compatibility/contracts.compile.ts` reads that declaration to assert the slot's `kind` and `scope` at compile time. Imported with `import type {}` only — nothing from it reaches the plugin's bundle. |
| `pdf-lib` | 1.17.1 | MIT | PDF fixture generator (`scripts/generate-pdf-fixtures.mjs`) added in Task 7. It writes the five committed fixtures in `tests/fixtures/pdf/`. Nothing from it reaches `src/` or the bundle; `pnpm build` does not read it. |
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
| Source file | A Windows-installed Noto Sans SC (TrueType), resolved locally by the fixture generator at generation time. The generator takes the font from the host it runs on, so the absolute path it happened to resolve is a property of that machine and is deliberately not recorded here or in the package: the committed artifact is the 44 KB PDF, and the provenance that matters to a redistributor — family, license, copyright and embedding permission — is in the rows below. |
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

Those two blocks record the versions at introduction and are kept as history.
Task 14 moved both pins, together with every other release-numbered DSH contract
package, to the current runtime release family `0.1.5-rc.2`; the table above
carries the versions actually pinned today. Each license was re-verified against
the published registry metadata at the new release (`npm view
@deepseek-ai/dsh-client-ui-sidebar-right@0.1.5-rc.2 license` and `npm view
@deepseek-ai/dsh-client-ui-layout@0.1.5-rc.2 license` both report `MIT`) and
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
- every renderer in the v1 format policy is implemented, and every package any of
  them ships is in the table above. That table is not a snapshot of the
  dependencies this project declares: it is the set `scripts/verify.mjs` R8
  derives from the build, so a package that starts shipping without a row here
  fails `pnpm verify` rather than being noticed at release time;
- no dependency is currently used under a copyleft, source-available or
  custom license; a dependency whose license cannot be established is not added,
  and a `GPL`/`AGPL`/`SSPL`/`BUSL`/Commons Clause dependency would be a stop
  condition rather than an accepted entry in this file. The licenses recorded
  above are Apache-2.0, BSD-3-Clause, MIT, ISC and 0BSD among the shipped set,
  plus Apache-2.0 and SIL OFL 1.1 for the two font families embedded inside
  `pdfjs-dist`. The SIL OFL's own conditions are satisfied by the subset carrying
  its notice and by the provenance recorded here.

