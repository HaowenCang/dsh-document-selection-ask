# Third-party notices

This file records the third-party software this repository depends on, with the
license each is used under. It is maintained from Task 3 onward: the dependency
rule in `AGENTS.md` requires the license and the shipped status of every added
dependency to be recorded here rather than discovered at release time.

The project's own license is MIT (see `LICENSE`). That license covers this
repository's code only; every dependency below stays under its own license, and
a permissive project license is not a claim about anything it depends on.

## Shipped in the plugin package

`@zip.js/zip.js` is this repository's first runtime dependency. It is declared in
`dependencies`, not `devDependencies`, because the shared OOXML preflight runs in
the browser and the format renderers will call it from the client bundle. The
built `lib/client.js` does not contain it yet — nothing in the shipping entry
point reaches `src/client/ooxml/` until a renderer does — but it is a runtime
dependency from the moment it is declared, and it is recorded here as one.

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| `@zip.js/zip.js` | 2.15.0 | BSD-3-Clause | OOXML ZIP central-directory metadata validation and later OOXML archive reading. It reads the central directory of a DOCX, PPTX or XLSX package so the preflight can bound the entry count, the declared sizes, the compression ratio and the entry names before any renderer touches the archive. |

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

- no CDN- or network-loaded asset is a dependency of the plugin;
- no parser or renderer library is imported by `src/client/selection/`, which is
  format-independent by construction;
- `src/client/ooxml/` is the one module that depends on `@zip.js/zip.js`, and it
  reads archive metadata only: it calls no entry-extraction API, imports no
  filesystem module, parses no XML and starts no worker;
- the XLSX, PDF, DOCX and PPTX renderer dependencies remain unimplemented in the
  current task sequence, and their licenses are recorded when they are added.
- no dependency is currently used under a copyleft, source-available or
  custom license; a dependency whose license cannot be established is not added,
  and a `GPL`/`AGPL`/`SSPL`/`BUSL`/Commons Clause dependency would be a stop
  condition rather than an accepted entry in this file.

