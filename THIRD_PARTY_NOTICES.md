# Third-party notices

This file records the third-party software this repository depends on, with the
license each is used under. It is maintained from Task 3 onward: the dependency
rule in `AGENTS.md` requires the license and the shipped status of every added
dependency to be recorded here rather than discovered at release time.

The project's own license is MIT (see `LICENSE`). That license covers this
repository's code only; every dependency below stays under its own license, and
a permissive project license is not a claim about anything it depends on.

## Shipped in the plugin package

None yet. The plugin's own runtime code is first-party, and no third-party
library is bundled into `lib/` at this point. The parsers the design names for
the format renderers (PDF.js, docx-preview, the PPTX renderer, the XLSX viewer,
`@zip.js/zip.js`) are added, with their notices, by the tasks that introduce
them.

## Development and test only

These are `devDependencies`. They are used to build, type-check and test the
plugin and are **not** shipped in the published package, which is why the
`files` list in `package.json` excludes `node_modules` and the test tree.

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| `jsdom` | 30.0.1 | MIT | Test-only DOM implementation. The client specs run under the Vitest `jsdom` environment so that selection ownership, `Range` behaviour and the overlay's render lifecycle are exercised against a real `Selection`/`Range` pair and a real DOM rather than against hand-written stand-ins. No `jsdom` type or value is referenced by `src/`. |
| `@types/react-dom` | 18.3.7 | MIT | Type declarations for React DOM, required because the client specs mount components with `createRoot` (Task 5). Types only; nothing from this package reaches the bundle. |
| `@deepseek-ai/dsh-client-ui-sidebar-right` | 0.1.5-rc.1 | MIT | Contract-only pin for the real-DSH smoke added in Task 5B. The compile probe `tests/compatibility/smoke-driver.contracts.compile.ts` reads the `Context.sidebarRight` augmentation and `openResource` from this package's public `./client` declaration, so the one navigation call the test-only driver makes is checked against the published contract. No value or type from it reaches the plugin's bundle, and it is not a dependency of the shipped package. |

Tasks 5B introduced exactly one dependency, recorded with the required fields:

```text
package:  @deepseek-ai/dsh-client-ui-sidebar-right
version:  0.1.5-rc.1
license:  MIT
runtime/test-only: development/test-only
```

The pin matches the primary runtime release family (`0.1.5-rc.1`), which is the
same release every other DSH contract package in `devDependencies` carries; the
license was verified against the published registry metadata (`npm view
@deepseek-ai/dsh-client-ui-sidebar-right@0.1.5-rc.1 license` reports `MIT`) and
against the installed package's own `package.json`.

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
- the XLSX, PDF, DOCX and PPTX renderer dependencies remain unimplemented in the
  current task sequence, and their licenses are recorded when they are added.
- no dependency is currently used under a copyleft, source-available or
  custom license; a dependency whose license cannot be established is not added,
  and a `GPL`/`AGPL`/`SSPL`/`BUSL`/Commons Clause dependency would be a stop
  condition rather than an accepted entry in this file.

