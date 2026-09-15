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
- Task 5A
  - commit: recorded by the commit that follows this file
  - status: `LOCAL CODE PASS / REAL DSH TEXTPREVIEW SMOKE BLOCKED`
  - closes the `resize` listener ownership defect: the browser dispatches
    `resize` at the `Window` a document belongs to, so the listener is installed
    on `doc.defaultView` and released from the same target, while `scroll` stays a
    document capture listener because that is the only way a preview body's own
    scrolling reaches the lifecycle. A viewport resize therefore reports no
    `SelectionContext.target` at all — a `Window` is not a `Node`, and the
    selection's own endpoints are the evidence a re-anchor has
  - restores `SelectionRejectReason` to the eight capture-domain reasons of
    Task 2. `draft-write-failed` was a write failure filed in the capture
    vocabulary; it now belongs to `AskFailureReason`, declared by
    `dsh/composer-bridge.ts`, which is the module that owns the write.
    `validateSelectionSize` returns `'too-large' | null` rather than the whole
    capture union, so the bridge's narrowing is exhaustive by construction and no
    cast is needed to reach its own failure type
  - the real-TextPreview browser smoke remains unachieved; the reason is recorded
    under `Next` rather than worked around

- Task 5B
  - commit: `f0b0669`
  - status: `REAL DSH TEXTPREVIEW SMOKE PASS / PRODUCTION DEFECT RECORDED`
  - the real preview is now produced by DSH itself. A test-only companion
    plugin (`tests/browser/smoke-driver/`) occupies the session-scoped
    `conversation.input.overlay` slot to obtain the current `sessionId`, and its
    one navigation call is the public
    `ctx.sidebarRight.openResource(address, { kind: 'text' })`. It imports
    nothing from the plugin under test, creates no `data-textpreview-*` node, and
    queries no DOM — asserted over its sources by
    `tests/unit/smoke-profile.spec.ts`
  - `kind` is named because the ranking does not reach the product preview on
    this machine's profiles: `dsh-better-sidebar` registers a file viewer at
    `priority: 'extension'` with `patterns: ['dsh-resource://file/**']`, which
    outranks the preview's own `fallback` band, so a bare `openResource` lands in
    that plugin's editor and no `data-textpreview-*` node exists at all
  - the driver is a separate private package, built by
    `tsdown.smoke-driver.config.ts`; it is not in the shipping `files` list, is
    not a dependency of the shipping package, and `dsa-smoke-driver`,
    `data-dsa-smoke` and `task5b-smoke` appear in neither `lib/client.js` nor
    `lib/index.mjs`
  - `scripts/dsh-smoke-profile.mjs` makes the `dsa-smoke` profile reproducible:
    `inspect` / `prepare` / `validate` / `cleanup`, idempotent, and it refuses
    any profile but `dsa-smoke`. It also carries the duplicate-loader-entry guard
    — each of this repository's bundles must insert exactly one distinct entry id
    that the profile's own patch layer does not re-insert. `prepare` twice
    reports `rows=unchanged` and `validation = clean`, and the profile boots
    twice
  - the official route was tried first and does not work for this profile:
    `dsh plugin --profile dsa-smoke add <dir>` forwards to pnpm, which refuses
    with `ERR_PNPM_UNEXPECTED_VIRTUAL_STORE` because the profile's `node_modules`
    is a junction onto the `web` profile's installed tree
  - `@deepseek-ai/dsh-client-ui-sidebar-right@0.1.5-rc.1` is pinned as an exact
    `devDependency` (MIT, development/test-only) and probed at compile time by
    `tests/compatibility/smoke-driver.contracts.compile.ts`
  - **production defect recorded, not fixed.** With the right column expanded,
    the Ask button is present and on screen but cannot be clicked: the right
    column's stacking context paints over the composer's floating overlay, whose
    `z-index: 20` is trapped inside `wSkVaW_composerStack` (`z-index: 1`). At both
    1600×1000 and 2560×1300 the preview column's left edge reaches past the
    button's centre, `document.elementFromPoint` there returns
    `div.dhJKeW_textDocument`, and a real pointer click is refused. Collapsing
    the column makes the button clickable but unmounts the preview and clears the
    selection, so no plugin-local route reaches both. The smoke asserts the
    occlusion directly and triggers the button programmatically for the rest of
    the flow. Fixing it is a production change and belongs to its own round

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
- Task 5A composer bridge suite: PASS (11 client cases)
- Task 5A browser selection lifecycle suite: PASS (28 client cases)
- Task 5A capture-rejection domain guard: PASS (3 unit cases; the same split is
  asserted at compile time by an exhaustive `switch` whose `default` branch
  assigns to `never`, so a ninth `SelectionRejectReason` fails `pnpm typecheck`)
- Full `pnpm test`: PASS (393 tests)
- `pnpm typecheck`: PASS
- `pnpm build`: PASS
- `git diff --check`: PASS
- rc.1 runtime bootstrap smoke: PASS
- rc.1 Ask flow smoke (Playwright, live instance): PASS (7 cases)
- rc.1 viewport-resize regression (Playwright, live instance): PASS, and verified
  to discriminate — the case fails against the pre-fix listener with the button
  left at its old `y`
- rc.1 real DSH TextPreview smoke (Playwright, live instance): PASS (6 cases) —
  TXT line 2 with exact provenance, code rows 2–3 with exact provenance, Markdown
  body with file-only provenance, Markdown code fence file-only through a real
  Shiki block, and the occlusion defect recorded as a live assertion
- rc.1 real DSH TextPreview smoke against a second profile boot: PASS (6 cases)
- smoke-profile duplicate-loader-entry regression: PASS (`prepare` twice reports
  `rows=unchanged`; `validate` clean; two consecutive boots succeed)
- production-bundle isolation: PASS (no smoke marker in `lib/client.js`,
  `lib/index.mjs`, or the published `files` list)
- rc.2 compile-contract probe: PASS
- rc.2 runtime smoke: NOT TESTED
- production defect: Ask overlay occluded by the expanded right column — OPEN

## Open source

- Task 3A — PASS
- Task 3B — PASS
- Task 4 — PASS
- Task 5 — PASS
- Task 5A — LOCAL CODE PASS / REAL DSH TEXTPREVIEW SMOKE BLOCKED
- Task 5B — REAL DSH TEXTPREVIEW SMOKE PASS / PRODUCTION DEFECT RECORDED
  (the Ask overlay is occluded by the expanded right column; no `src/` change was
  made in this round)
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

Fixing the recorded production defect — the Ask overlay cannot be clicked while a
document preview is open — before Task 6. Task 6 is not authorized in this round.

The candidate fixes, in order of how much of the plugin they disturb:

1. raise the composer's floating overlay above the right column. That requires a
   stacking context the plugin does not own: the overlay's own `z-index: 20` is
   trapped inside `wSkVaW_composerStack` (`z-index: 1`), so the change would be a
   DSH-side one;
2. move the Ask surface out of `conversation.input.overlay` into a slot that is a
   sibling of both columns (`shell.overlay` is one, at `z-index: 20` on
   `[data-shell-overlay]`). This is a plugin-local change, but it costs the
   composer-descendant relationship the focus path currently relies on:
   `focus-composer.ts` searches for `[data-composer-card]` from the overlay's own
   anchor, so the search would have to start from the document instead;
3. clamp the button to the centre column rather than the viewport. This is
   cosmetic — the button would stop being occluded without the column moving —
   and it would leave the same defect for any other floating surface.

Option 2 is the one that keeps the fix inside this repository, and it needs its own
round with its own failing browser case.

Task 5B notes carried forward:

- the real preview is reachable now, and the route is worth recording because it
  took three attempts to find. `ctx.sidebarRight.openResource` needs the right
  column to be mounted, and it is reachable only from inside a client plugin. A
  test-only companion plugin is therefore the mechanism, not a convenience:
  `tests/browser/smoke-driver/` takes the session id from the session-scoped
  `conversation.input.overlay` slot and calls the service once per fixture;
- the fixture address is session-scoped
  (`dsh-resource://file/session/<id>/<path>`) because the overlay refuses a
  selection whose address names another session; an `absolute` address would
  render and then be silently unquotable. `fixtures.ts` builds the address
  directly rather than importing DSH's own `sessionFileAddress`, because that
  helper lives in `@deepseek-ai/dsh-util-workspace-path`, a host-side package a
  browser bundle cannot require;
- a Shiki row (`.line`) is block-level with a box spanning the whole code block,
  so its leading edge is outside its own glyphs and a drag anchored there snaps to
  the nearest character — on the first attempt, to the following line. The smoke
  anchors inside the row's first token and extends with a real `Shift`+click.
  This is a property of the renderer, not of the test, and any future
  selection-driving code should assume it;
- the composer's published `draft` is the clipboard projection of its Lexical
  document: the appended block's newlines are not part of the string. Assertions
  therefore match the block part by part, with the requirement that nothing
  follows the last part, rather than comparing lines;
- `pnpm build` and `pnpm smoke:driver` are separate: the driver is a second
  package and is never part of the shipping bundle.

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
  the shell's own file panel remains unverified, and Task 5A established why it is
  unreachable in this instance rather than merely unfound — see the Task 5A note
  below;
- the smoke requests `zh-CN`. DSH resolves its own locale from the browser's
  language list and writes it to `<html lang>`, and this plugin reads that
  attribute; Playwright's default `en-US` would put the whole application in
  English and the Chinese copy assertions would then test the wrong table;
- the smoke needs a running instance: `DSH_SMOKE_URL` names it, and the spec is
  skipped without it, so `pnpm test:browser` stays usable on a machine with no
  DSH installed.

Task 5A notes carried forward — the investigation that Task 5B closed:

- the right column is a slot whose **occupant opens itself**. `ctx.layout`
  publishes `openRightbar`/`closeRightbar`, and only the right Sidebar calls
  them, on opening a resource; nothing else writes that state. The document
  preview DOM therefore cannot be made to exist by any external step — it is a
  consequence of a navigation the shell itself has to perform. Task 5B's answer is
  to make that navigation happen from inside a client plugin, which is the only
  place the service is reachable;
- and in a headless instance with a fresh session, every route to that navigation
  was closed, each one verified rather than assumed:
  - the Files tab exists and is registered, but its tab strip
    (`[data-dockkit-add-tab]`, `[data-dockkit-split-button]`,
    `[data-sidebar-right-toggle]`) sits inside the collapsed right column and
    reports `visibility: hidden` at every viewport tried, including 2560 px wide,
    both in this instance and in the GUI on this machine. It is never clickable,
    so the tab cannot be opened;
  - the composer's `@` file reference picker **does** work and **is** real: it
    lists the session workspace, it is rooted there, it navigates into
    directories, and committing an option builds a genuine
    `[data-composer-chip="reference"]` decorator. But that chip is prompt-context
    metadata — clicking it, double-clicking it and right-clicking it perform no
    navigation, and the transcript's own reference crumb never rendered in a
    session that was still reachable afterwards;
  - no reachable session exposed a transcript row offering the `openFile` action
    (`dsh-client-ui-chat` wires `openFile` to `ctx.sidebarRight.openResource`), so
    the shell's own file-link path had nothing to click;
- the fixture directory is `smoke-fixtures/` at the repository root and is
  ignored by git. The name carries no leading dot on purpose: the picker omits
  dot-entries, so a hidden directory is unreachable from the very UI the smoke
  would drive — which is how this was established;
- the shell's client runtime does not publish its `Context` on the page. The
  public service route (`ctx.sidebarRight.openResource`) is reachable only from
  inside a client plugin, so reaching it from a test would mean either
  monkey-patching a client plugin at runtime or a private DOM/React path. Both are
  excluded by this project's DSH boundary, so neither was used.

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
