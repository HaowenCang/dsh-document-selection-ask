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

## Current gate

- Task 1 public contracts: PASS
- Task 1A reproducibility: PASS
- Task 2 selection/quote unit suites: PASS (92 tests)
- Task 3 selection core suites: PASS (registry 14, kernel + lifecycle 24, DOM selection 26)
- Full `pnpm test`: PASS (176 tests)
- `pnpm typecheck`: PASS
- `pnpm build`: PASS
- `git diff --check`: PASS
- rc.1 runtime bootstrap smoke: PASS
- rc.2 compile-contract probe: PASS
- rc.2 runtime smoke: NOT TESTED

## Next

Task 4 — DSH builtin text/Markdown/code/CSV selection adapter.

Task 3 notes carried forward:

- the selection core does not read `window.getSelection()`; the caller supplies
  the `SelectionContext`, so browser event wiring (`selectionchange`, `pointerup`,
  `resize`, `Escape`) is still outstanding and belongs to Task 5;
- `Disposer.disposeAll()` is ordered and idempotent, but a disposer that throws
  propagates and leaves the remaining disposers uncalled;
- real range geometry has not been exercised, because jsdom implements no layout
  on `Range`; the client specs cover the copying contract only, and real
  positioning moves to the Playwright suites.
