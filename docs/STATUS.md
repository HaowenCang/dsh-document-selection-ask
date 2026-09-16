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

- Task 5C
  - commit: recorded by the commit that follows this file
  - status: `PRODUCTION DEFECT FIXED / REAL DSH TEXTPREVIEW SMOKE PASS`
  - the fix is architectural rather than numerical. The visible Ask surface moved
    out of `conversation.input.overlay` — which renders inside
    `wSkVaW_composerStack`, whose `z-index: 1` traps any `z-index` the plugin
    could set — into `shell.overlay`, the frame's own root-scoped floating layer,
    a sibling of all three columns at `z-index: 20` with `pointer-events: none`
    on the layer and `auto` on its entries. No `z-index` of this plugin's own was
    raised, and no DSH file was touched
  - the rc.1 contract was verified against the installed
    `@deepseek-ai/dsh-client-ui-layout@0.1.5-rc.1` bundle rather than against the
    design documents: `shell.overlay` is declared `kind: 'list'`, `scope: 'root'`
    by that package's `client` entry, the frame renders it as
    `<div class="…overlayLayer" data-shell-overlay>` with
    `z-index: 20; pointer-events: none; position: absolute; inset: 0`, and the
    slot wrapper carries `display: contents` so an entry's own box is a direct
    child of the layer. All of it was then re-observed in the live browser
  - the session-scoped half is retained, but it no longer draws the button.
    `ComposerTargetRegistrar` occupies `conversation.input.overlay` and publishes
    one `ComposerTarget` per mounted session — `readDraft`, `setDraft`, `focus`
    and the registrar's own inert anchor — into a `ComposerTargetRegistry` that
    `applyClient` creates per call
  - the registry is React-free, keyed by session id, and its disposer is
    identity-checked rather than key-deleting, so the old generation's cleanup
    cannot evict the new generation's target during a React transition. A stale
    disposer and a current one are separate cases in the unit suite
  - **no document-wide composer lookup exists anywhere.** `focus` still starts at
    an element inside the composer card — now the registrar's zero-sized
    `data-dsa-composer-target-anchor` span instead of the overlay's own root — and
    the only `document.querySelector('[data-composer-card]')` strings in the tree
    are in comments explaining why it is not used. A registrar that rendered the
    button would have defeated the whole round; the client fixture mounts the two
    halves in **separate React roots**, the surface deliberately outside the card
  - the surface's visibility is a three-way gate: the session parsed from the
    snapshot's own `resourceAddress`, the session the shell has selected read
    through the public `useSessions` global standard prop, and a session with a
    live registered target. An `absolute` address still proves no session and
    still hides the button, and a resident composer for another session is not
    permission to write to it
  - the draft is read at click time from the target, which dereferences a ref the
    registrar keeps current from the composer's own published state, because the
    surface can no longer call `useInput` — that hook is `useSyncExternalStore`
    based and legal only during a render. The registration itself depends only on
    the session id and the registry, so typing does not rebuild it
  - `@deepseek-ai/dsh-client-ui-layout@0.1.5-rc.1` is pinned as an exact
    `devDependency` (MIT, development/contract-only) and probed at compile time by
    `tests/compatibility/contracts.compile.ts`, which asserts the slot's `kind`
    and `scope` as literal members and that the slot's global standard props can
    satisfy the surface's own `useSessions` contract. The package edge was added
    to `dsh.client.inject`; no Cordis service was added, because the plugin never
    reads `ctx.layout`
  - the Task 5B occlusion assertion is **inverted, not deleted**:
    `keeps the Ask button reachable while the right column is expanded` now
    asserts `elementFromPoint` reaches the button, that the button is outside the
    composer and inside `[data-shell-overlay]`, and that an ordinary Playwright
    `locator.click()` passes its actionability check — with a comment recording
    that the old behaviour failed there. The same two facts are asserted at
    1600×1000 and 2560×1300 in their own cases
  - the programmatic-click workaround is gone from the real-TextPreview smoke:
    `pressAsk` now calls `locator.click()`, and `force`, `dispatchEvent` and
    in-page `.click()` appear nowhere in it

- Task 6
  - commit: `9cdf62ef0606c495bf6674b6078c463671277762` — PASS
  - status: `PASS`
  - the shared OOXML archive preflight exists: `src/client/ooxml/preflight.ts`
    publishes `preflightOoxml(bytes, limits?, signal?)`, which resolves with
    nothing or rejects with `OoxmlPreflightError` carrying a stable `code`. It
    returns no `ZipReader`, no entry array and no central-directory object —
    Task 6 is a security gate, not an archive session, and the lifecycle of an
    archive whose parts are actually read belongs to the tasks that read them
  - **the rule the whole module exists for is enforced from metadata alone.**
    No entry is extracted: `Entry.getData`, `TextWriter`, `BlobWriter`,
    `Uint8ArrayWriter`, `node:fs`, `node:path`, `fetch(`, `XMLParser` and
    `DOMParser` appear nowhere in `src/client/ooxml/`, and the greps that
    establish it are recorded in the round's report rather than left as a claim
  - `@zip.js/zip.js` 2.15.0 is pinned exactly as a `dependencies` entry — a
    runtime dependency, because the renderers will call the preflight in the
    browser. BSD-3-Clause, zero dependencies, verified against both
    `npm view @zip.js/zip.js@2.15.0 version license dependencies` and the
    installed package's own manifest. Only the public package export is
    imported; no `lib/` private path
  - the four limits are the documented four (`10_000`, 512 MiB, 128 MiB, `200`)
    and are validated **before the bytes are touched**, so a caller-supplied
    bound that is zero, negative, `NaN`, `Infinity`, fractional or beyond the
    safe-integer range is refused as `invalid-limits` instead of silently
    disabling the comparison it was supposed to make
  - `ZipReader` is constructed with `filenameValidation: 'tolerant'` and
    `useWebWorkers: false`, both stated rather than defaulted. The first makes
    this project's own path rule the only one that decides which names an
    archive may carry — zip.js's own `balanced` mode rejects malicious paths
    during `getEntries`, and leaving it on would have made the module's path
    rule dead code that still reads as enforced. The second keeps a
    metadata-only gate from depending on a worker asset the host's CSP may
    refuse to load
  - the parse boundary is one call wide. `getEntries` is the only statement
    inside the `try`, so a `TypeError` from this module's own loop cannot be
    relabelled `invalid-archive`; the entry array is validated outside that
    boundary and a non-array result is a `TypeError` rather than a verdict about
    the caller's file
  - the reader is closed on every path — acceptance, every refusal, abort — and
    a cleanup failure never replaces a refusal. When the archive was accepted
    there is no verdict to protect, so a `close` failure propagates rather than
    being swallowed into an unobservable leak. Asserted against zip.js's own
    `ZipReader.prototype.close`, because the seam that receives a reader does
    not own it and the real entry point is the only place cleanup happens
  - abort is checked before the reader is constructed, after enumeration and
    between entries, and it rejects with an `AbortError` rather than an
    `OoxmlPreflightError`. `signal.throwIfAborted()` is deliberately not used:
    it rethrows `signal.reason` verbatim, so a signal aborted with a string
    would surface a `string` from a function whose contract says cancellation is
    an `AbortError`
  - **zip.js 2.15.0 exposes no `signal` option on `ZipReader` or `getEntries`.**
    Its `AbortSignal` support is on the write side and on `Entry.getData` — the
    two surfaces this task does not use. Abort is therefore cooperative at the
    boundaries this module controls, which for a bounded metadata walk is the
    whole traversal. Recorded as an API observation for the tasks that do read
    entry data
  - **zip.js reports declared sizes and does not verify them against the data.**
    A crafted archive whose central directory understates its compressed size
    reaches this gate as that understatement. The declared numbers are what the
    ZIP format lets a preflight bound, and this is recorded as a hard
    requirement for Task 9/10/11 rather than a defect here: the reader that
    extracts an entry must enforce the size limit on the *actual* byte count,
    because `Entry.getData` is not bounded by anything this module measured
  - a measured, not assumed, bundle finding: `lib/client.js` is unchanged at
    105,747 bytes, because no shipping entry point reaches `src/client/ooxml/`
    yet. An isolated build of the module measures its contribution at about
    26.6 kB raw and 9.3 kB gzipped when a renderer does import it. **The client
    bundle leaves `@zip.js/zip.js` as an external `require`**, which the DSH
    loader cannot resolve — so the task that first imports this module into the
    client graph must inline the dependency in `tsdown.config.ts` (a
    `noExternal`/`deps` statement on the client entry) in the same commit, and
    verify the emitted bundle contains no `require("@zip.js/zip.js")`
  - `THIRD_PARTY_NOTICES.md` now records the dependency with its real
    BSD-3-Clause license, its upstream copyright notice and its no-endorsement
    clause, and it is now in the published `files` list: a package that ships a
    BSD-3-Clause library must ship the notice, and the manifest previously
    omitted it. Verified through `npm pack --dry-run`
  - no renderer, no selection adapter, no Office XML validation, no filesystem
    extraction, no worker, no CDN and no UI were added

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
- Task 5C composer target registry suite: PASS (13 unit cases) — lookup, two-session
  isolation, replacement, stale-disposer identity, idempotent disposer,
  subscribe/unsubscribe, and anchor-scoped focus
- Task 5C shell Ask surface suite: PASS (15 client cases) — surface outside the
  composer card, the three-way session gate, session isolation, press-time target
  re-resolution, latest-draft read, registration stability, matching-session focus
- Task 5C selection overlay suite: PASS (26 client cases, rewritten for the split)
- Task 6 OOXML preflight suite: PASS (133 unit cases) — the four documented
  limits and their exact boundaries, thirteen rejected limit shapes, entry count,
  single-entry and aggregate byte bounds, ratio at and one byte over the bound,
  the zero-compressed-size rule on both sides, fifteen accepted and fourteen
  refused path spellings, NUL in both raw and normalized form, an empty name,
  a non-string name, encrypted entries from both a real writer and a crafted
  central directory, ten unusable values for each declared size, the abort
  contract at four positions, and the reader-close policy on all four outcomes
- Task 6 bundle isolation: PASS (`lib/client.js` unchanged at 105,747 bytes; the
  module is not reachable from any shipping entry point yet)
- Task 6 dependency review: PASS (`@zip.js/zip.js` 2.15.0 pinned exactly,
  BSD-3-Clause, zero dependencies, public export only, notice shipped in the
  published tarball)
- Full `pnpm test`: PASS (554 tests)
- `pnpm typecheck`: PASS
- `pnpm build`: PASS
- `git diff --check`: PASS
- rc.1 runtime bootstrap smoke: PASS
- rc.1 Ask flow smoke (Playwright, live instance): PASS (7 cases)
- rc.1 viewport-resize regression (Playwright, live instance): PASS, and verified
  to discriminate — the case fails against the pre-fix listener with the button
  left at its old `y`
- rc.1 real DSH TextPreview smoke (Playwright, live instance): PASS (8 cases) —
  TXT line 2 with exact provenance, code rows 2–3 with exact provenance, Markdown
  body with file-only provenance, Markdown code fence file-only through a real
  Shiki block, and three occlusion-regression cases that assert the expanded right
  column no longer reaches the button's pixel. **Every one of them presses the
  button with an ordinary `locator.click()`**
- rc.1 stacking regression at 1600×1000 and 2560×1300: PASS with the right column
  expanded and the real TextPreview mounted
- smoke-profile duplicate-loader-entry regression: PASS (`prepare` twice reports
  `rows=unchanged`; `validate` clean; two consecutive boots succeed)
- production-bundle isolation: PASS (no smoke marker in `lib/client.js`,
  `lib/index.mjs`, or the published `files` list)
- rc.2 compile-contract probe: PASS
- rc.2 runtime smoke: NOT TESTED
- production defect: Ask overlay occluded by the expanded right column — FIXED in
  Task 5C, with the inverted assertion kept as the regression guard

## Open source

- Task 3A — PASS
- Task 3B — PASS
- Task 4 — PASS
- Task 5 — PASS
- Task 5A — LOCAL CODE PASS / REAL DSH TEXTPREVIEW SMOKE BLOCKED
- Task 5B — REAL DSH TEXTPREVIEW SMOKE PASS / PRODUCTION DEFECT RECORDED
- Task 5C — PASS (the defect is fixed; the Ask surface renders in `shell.overlay`
  and is reachable by a real click while the right column is expanded)
- Task 6 — PASS (the shared OOXML archive preflight exists and is metadata-only;
  `@zip.js/zip.js` 2.15.0 is a pinned runtime dependency)
- GitHub publication — ACTIVE
- Repository visibility — public
- License — MIT
- Repository: `dsh-document-selection-ask`

`LICENSE` is the standard MIT text with the copyright holder taken from the
authenticated GitHub account. `package.json` declares `"license": "MIT"`.
`THIRD_PARTY_NOTICES.md` records each dependency's own license separately, and it
is now part of the published package. `@zip.js/zip.js` (2.15.0) is the first
entry under "shipped": BSD-3-Clause rather than MIT, with the upstream copyright
notice and no-endorsement clause recorded. `jsdom` (30.0.1) is recorded as MIT,
development/test-only, verified against the installed package metadata.

## Next

**Task 7 — selectable PDF renderer with PDF.js Canvas + TextLayer.**

Task 6 and the format renderers (PDF, DOCX, PPTX, XLSX) follow in that order; the
plan's sequence puts the PDF renderer next, not a DOCX renderer. The Ask flow is
complete for the builtin text, Markdown, code and CSV previews and is reachable
while a document preview is open, which was the last blocker in front of the
renderers.

Task 6 carried forward into the renderer tasks:

- the tasks that actually read OOXML parts own the archive lifecycle. The
  preflight deliberately returns nothing, so Task 9/10/11 each decide when an
  archive is opened, which entries are read and when the reader is closed;
- **the preflight bounds declared sizes, not actual bytes.** zip.js reports the
  central directory's own numbers and does not check them against the data, so a
  crafted archive can understate its compressed size and reach this gate as that
  understatement. Every reader that extracts an entry must enforce its own limit
  on the bytes it actually receives;
- the task that first imports `src/client/ooxml/` into the client graph must
  inline `@zip.js/zip.js` in the client bundle. The bundler currently leaves it
  as an external `require`, which the DSH loader cannot resolve; `lib/client.js`
  stays honest only because nothing shipping reaches the module yet. Verify the
  emitted bundle contains no `require("@zip.js/zip.js")`;
- `ZipReader` 2.15.0 accepts no `AbortSignal`. Its abort support is on the write
  side and on `Entry.getData`, so a reader that extracts entries can pass the
  signal to the extraction call and get real cancellation there;
- the four public limits are validated by `validateOoxmlLimits` in
  `src/client/ooxml/limits.ts`, which the public entry point calls before the
  bytes are touched. A caller that supplies its own limits gets the same
  fail-closed check as the defaults.

The production defect Task 5B recorded is closed. The chosen fix was option 2 of
the three candidates Task 5B listed — moving the surface into a slot that is a
sibling of both columns — and the cost that option was said to carry did not
materialize in the form anticipated. The focus path did **not** have to start from
the document: the session-scoped registrar that replaced the overlay inside the
composer supplies its own DOM anchor, so `focus-composer.ts` still finds
`[data-composer-card]` by walking up from an element inside the composer the
selection belongs to. The two rejected options remain rejected for the reasons
recorded there: raising the overlay's `z-index` needs a stacking context the
plugin does not own, and clamping the button to the centre column would have been
cosmetic and left the same defect for every other floating surface.

Carried forward from Task 5C:

- the composer half of the contract is now a published object rather than a
  closure inside the component. Anything that later needs the draft, the action
  face or the caret from outside the composer should go through
  `ComposerTargetRegistry` — keyed by session id — and not through a DOM lookup;
  `document.querySelector('[data-composer-card]')` returns whichever composer the
  DOM puts first, which is not provably the one the selection belongs to;
- a disposer obtained from that registry is identity-checked. A caller that holds
  one past its own unmount may call it freely: it removes nothing once its token
  has been superseded, which is what makes a React transition safe;
- `shell.overlay` is at `z-index: 20` on `[data-shell-overlay]` and the layer is
  click-through. Any future surface added there must restore `pointer-events:
  auto` on its own root element, or it will render and be unpressable — the
  original defect in a new costume;
- the surface reads the active session through the public `useSessions` global
  standard prop. A root-scoped slot has no session scope, so this is the only
  published route; `ctx.sessions` is not read and no private store is touched;
- the real-DSH smoke's row selection retries the same real gesture when the
  browser reports a selection shorter than the row. The document column animates
  in, and a drag anchored while it is still moving lands on a different glyph. The
  retry is a property of the shell's animation, not of the plugin.

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
