# Project Status

## Baseline

- Primary verified runtime: DSH `0.1.5-rc.1`
- Forward compile-contract target: DSH `0.1.5-rc.2`

## Completed

- Task 1
  - commit: `663a134cdfab7b15760fd0e6e8b9981656f851a9`
- Task 1A
  - commit: `a2a3f63fbc2b99a073517271728180e4d385f225`
- Task 2
  - commit: `227ed6f`
- Task 3
  - commit: `c7744f61cd65566b3deabf00795ca241778b696e`
  - scoped DOM selection capture and the adapter registry
- Task 3A
  - commit: `d288661`
  - fault-tolerant disposer aggregation; the close-out of the one remediation
    required by Task 3
- Task 3B
  - commit: `62c691c`
  - documentation and execution-protocol change only; no production code, no tests
  - human-facing progress notes, Task reports, deviation notes and blocker reports
    are pinned to Simplified Chinese (`AGENTS.md`, this workflow doc, and
    `DEEPSEEK_TASK_PROMPT.md`); identifiers, command output, error text, filenames,
    API names, commit subjects and quoted upstream text stay untranslated
- Task 4
  - commit: `6258d86df30cc3c4810cdb58258a3cb82c01fda8`
  - `createDshTextAdapter()` reads selections from the builtin DSH text,
    Markdown, code and CSV previews and produces a `SelectionSnapshot`
  - the builtin renderers are reused: no `ctx.documentPreviews.register` call is
    made for text, Markdown, code or CSV
  - ownership is resolved from the selection's own anchor and focus nodes, so a
    keyboard selection with no pointer target is handled, and it stops at
    `[data-textpreview-body]`, so preview chrome is never quoted as content
  - exact line provenance only where the renderer proves it: the plain
    renderer's `data-textpreview-line` rows and the code renderer's Shiki rows
    inside their own `[data-code-block-content]`; rendered Markdown stays
    file-only, including its highlighted code fences
  - registered into a `SelectionAdapterRegistry` owned by `applyClient` through
    `ctx.effect`; no module-global registry

## Current gate

- Task 1 public contracts: PASS
- Task 1A reproducibility: PASS
- Task 2 selection/quote unit suites: PASS
- Task 3 selection core suites: PASS
- Task 3A disposer aggregation suite: PASS
- Task 3B documentation gates: PASS (no `src/` or `tests/` change in the round)
- Task 4 DSH builtin text adapter suite: PASS (51 client cases)
- Task 4 provenance helper suite: PASS (32 unit cases)
- Full `pnpm test`: PASS (279 tests)
- `pnpm typecheck`: PASS
- `pnpm build`: PASS
- `git diff --check`: PASS
- rc.1 runtime bootstrap smoke: PASS
- rc.2 compile-contract probe: PASS
- rc.2 runtime smoke: NOT TESTED

## Open source

- Task 3A — PASS
- Task 3B — PASS
- Task 4 — PASS
- GitHub publication — ACTIVE
- Repository visibility — public
- License — MIT
- Repository: `dsh-document-selection-ask`

`LICENSE` is the standard MIT text with the copyright holder taken from the
authenticated GitHub account. `package.json` declares `"license": "MIT"`.
`THIRD_PARTY_NOTICES.md` records each dependency's own license separately: the
shipped package still bundles no third-party code, and `jsdom` (30.0.1) is
recorded as MIT, development/test-only, verified against the installed package
metadata.

## Next

Task 5 — composer bridge and selection Ask overlay.

Task 4 notes carried forward:

- the adapter is registered but nothing dispatches to it yet: browser event
  wiring (`selectionchange`, `pointerup`, `keyup`, overlay positioning) is
  Task 5, and the transient snapshot store is `createSelectionKernel`;
- the rc.1 DOM contract was verified against the installed
  `@deepseek-ai/dsh-client-ui-sidebar-documentpreview@0.1.5-rc.1` bundle rather
  than against the design documents. The three renderer identities live in
  `src/client/adapters/dsh-text/preview-dom.ts` with that verification recorded,
  because the package publishes its compiled sources only behind `./src/*`;
- `data-document-preview` carries the renderer identity, not the file format.
  Markdown files in the plain viewer keep `documentKind: 'markdown'` and may use
  exact lines, while rendered Markdown never does — a code fence inside it is a
  Shiki block with the same shape as a real code document;
- real selection geometry is still a Playwright concern; the client specs assert
  the copying contract only.

Task 3A notes carried forward:

- `Disposer.disposeAll()` and the functional `disposeAll()` now run every
  disposer even when an earlier one throws, then rethrow: the original error for
  a single failure, an `AggregateError` whose `errors` follow execution order for
  several. The aggregation is released before the first call, so a retry neither
  re-runs a child nor repeats a failure.
- Teardown remains synchronous (`Dispose = () => void`). No async disposer was
  introduced; a renderer that needs one will state that requirement first.

Task 3 notes carried forward:

- the selection core does not read `window.getSelection()`; the caller supplies
  the `SelectionContext`, so browser event wiring (`selectionchange`, `pointerup`,
  `resize`, `Escape`) is still outstanding and belongs to Task 5;
- real range geometry has not been exercised, because jsdom implements no layout
  on `Range`; the client specs cover the copying contract only, and real
  positioning moves to the Playwright suites.

## Synchronization

Every completed Task is committed locally and pushed to `origin`, and the round
is reported as PASS only after `origin/<branch>` is verified to point at local
HEAD. A Task whose local commit succeeds and whose push fails is
LOCAL PASS / GITHUB SYNC BLOCKED and does not proceed to the next Task.
