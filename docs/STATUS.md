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
- Task 5
  - commit: recorded by the commit that follows this file
  - `applyClient` now composes the runtime the Ask flow needs: the adapter
    registry, a `SelectionKernel` over it, a `SelectionFeedbackSource`, and one
    browser selection lifecycle that owns every listener for
    `selectionchange`, `pointerup`, `keyup`, `scroll`, `resize` and `Escape`
  - `selectionchange` is coalesced into one `requestAnimationFrame`; pointer and
    mouse movement are not observed; scroll and resize recapture from the live
    range rather than applying a delta to the frozen rectangles
  - the overlay occupies `conversation.input.overlay` through
    `ctx.slots.inject`, and the client half declares `slots` in its runtime
    `export const inject` — the package/module edge in `package.json` was already
    present and is not a substitute for it
  - the Ask button reads the composer's current draft at click time through the
    slot's `useInput`, appends with the Task 2 `appendSelectionToDraft`, and calls
    `inputActions.setDraft` exactly once; `submit` is never named in `src/`
  - `preventDefault` on `pointerdown` is what keeps the press from collapsing the
    selection, verified in a real browser because jsdom cannot observe it
  - focus returns to `[data-composer-card] > [data-composer-input]`, the DOM
    contract rc.1's own focus path uses; the search starts at the overlay's own
    element, never from the document
  - a session mismatch hides the button and writes nothing, and an `absolute`
    resource address is treated as proving no session rather than assumed
  - the overlay's style sheet is a runtime-injected `style[data-plugin-css]`
    element rather than a `*.module.css` import, because tsdown drops that import
    silently and the components would then read class names from `undefined`

## Current gate

- Task 1 public contracts: PASS
- Task 1A reproducibility: PASS
- Task 2 selection/quote unit suites: PASS
- Task 3 selection core suites: PASS
- Task 3A disposer aggregation suite: PASS
- Task 3B documentation gates: PASS (no `src/` or `tests/` change in the round)
- Task 4 DSH builtin text adapter suite: PASS (51 client cases)
- Task 4 provenance helper suite: PASS (32 unit cases)
- Task 5 composer bridge suite: PASS (10 client cases)
- Task 5 selection overlay suite: PASS (26 client cases)
- Task 5 browser selection lifecycle suite: PASS (24 client cases)
- Task 5 overlay placement suite: PASS (18 client cases)
- Task 5 Ask copy integrity: PASS (code-point assertions for both strings)
- Task 5 resource-address suite: PASS (15 unit cases)
- Full `pnpm test`: PASS (378 tests)
- `pnpm typecheck`: PASS
- `pnpm build`: PASS
- `git diff --check`: PASS
- rc.1 runtime bootstrap smoke: PASS
- rc.1 Ask flow smoke (Playwright, live instance): PASS (6 cases)
- rc.2 compile-contract probe: PASS
- rc.2 runtime smoke: NOT TESTED

## Open source

- Task 3A — PASS
- Task 3B — PASS
- Task 4 — PASS
- Task 5 — PASS
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

Task 6 — shared OOXML ZIP preflight.

Task 5 notes carried forward:

- the Ask flow is complete for the builtin text, Markdown, code and CSV
  previews. PDF, DOCX, PPTX and XLSX still have no renderer and no adapter, so
  Tasks 7–11 add them behind the same kernel and the same overlay;
- the rc.1 DOM contract for the composer focus path was verified against the
  installed `@deepseek-ai/dsh-client-ui-conversation@0.1.5-rc.1` bundle:
  `[data-composer-card]` wraps the composer and `[data-composer-input]` is the
  contenteditable the shell binds its Lexical editor to. The shell's own focus
  path is `editor.getRootElement()?.focus({ preventScroll: true })`, which is the
  same call this plugin makes and the only DOM interaction it performs;
- `ctx.slots` is the runtime service name the renderer provides `SlotRegistry`
  under, and `conversation.input.overlay` is a `list` slot the composer bar
  declares with `scope: 'session'`. Registrations use `ctx.slots.inject` because
  a `register` call made before that declaration exists throws;
- the overlay subscribes to the kernel and the feedback source through its own
  `useSnapshotSource` rather than through the slot `hooks` compartment. The
  compartment's bound `use<Name>` hooks reach the component as props, and this
  project's client specs observed React's `useSyncExternalStore` skipping its
  subscription when it was reached that way, which left the overlay frozen on its
  first render. The stores are injected explicitly instead, so production and the
  specs run the same code path;
- the real-DSH smoke drives a live instance and injects only the preview body:
  the shell's file-browser panel could not be reached in the headless instance,
  and an injected preview root reproduces the `data-` contract the adapter reads.
  Selection, gesture, geometry, focus, the composer write and the
  session-isolation comparison are all the real ones. Driving the preview from
  the shell's own file panel remains unverified;
- the smoke requests `zh-CN`. DSH resolves its own locale from the browser's
  language list and writes it to `<html lang>`, and this plugin reads that
  attribute; Playwright's default `en-US` would put the whole application in
  English and the Chinese copy assertions would then test the wrong table;
- the smoke needs a running instance: `DSH_SMOKE_URL` names it, and the spec is
  skipped without it, so `pnpm test:browser` stays usable on a machine with no
  DSH installed.

Task 4 notes carried forward:

- the adapter is registered and is now dispatched to by the browser lifecycle;
  overlay positioning and geometry are Playwright concerns, and the smoke suite
  covers them against a live instance;
- the rc.1 DOM contract was verified against the installed
  `@deepseek-ai/dsh-client-ui-sidebar-documentpreview@0.1.5-rc.1` bundle rather
  than against the design documents. The three renderer identities live in
  `src/client/adapters/dsh-text/preview-dom.ts` with that verification recorded,
  because the package publishes its compiled sources only behind `./src/*`;
- `data-document-preview` carries the renderer identity, not the file format.
  Markdown files in the plain viewer keep `documentKind: 'markdown'` and may use
  exact lines, while rendered Markdown never does — a code fence inside it is a
  Shiki block with the same shape as a real code document.

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
  the `SelectionContext`. Task 5 supplied that caller:
  `src/client/selection/browser-lifecycle.ts` is the one place in the plugin that
  reads the browser selection, and it owns every listener for it;
- range geometry is exercised in a real browser, but jsdom still implements no
  layout on `Range`, so the client specs cover the copying contract and the
  placement arithmetic only; the Playwright smoke covers a real selection's real
  rectangles.

## Synchronization

Every completed Task is committed locally and pushed to `origin`, and the round
is reported as PASS only after `origin/<branch>` is verified to point at local
HEAD. A Task whose local commit succeeds and whose push fails is
LOCAL PASS / GITHUB SYNC BLOCKED and does not proceed to the next Task.
