# Third-party notices

This file records the third-party software this repository depends on, with the
license each is used under. It is maintained from Task 3 onward: the dependency
rule in `AGENTS.md` requires the license and the shipped status of every added
dependency to be recorded here rather than discovered at release time.

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
| `jsdom` | 30.0.1 | MIT | Test-only DOM implementation. The client specs run under the Vitest `jsdom` environment so that selection ownership, `Range` behaviour and scope checks are exercised against a real `Selection`/`Range` pair rather than against hand-written stand-ins. It is not a production dependency, and no `jsdom` type or value is referenced by `src/`. |

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
