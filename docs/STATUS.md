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

## Current gate

- Task 1 public contracts: PASS
- Task 1A reproducibility: PASS
- Task 2 selection/quote unit suites: PASS
- Task 3 selection core suites: PASS
- Task 3A disposer aggregation suite: PASS
- Full `pnpm test`: PASS (196 tests)
- `pnpm typecheck`: PASS
- `pnpm build`: PASS
- `git diff --check`: PASS
- rc.1 runtime bootstrap smoke: PASS
- rc.2 compile-contract probe: PASS
- rc.2 runtime smoke: NOT TESTED

## Open source

- Task 3A — PASS
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

Task 4 — DSH builtin text/Markdown/code/CSV selection adapter.

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
