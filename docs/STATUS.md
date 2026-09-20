# Project Status

## Baseline

- Current official runtime, primary blocking real-app runtime and primary
  compile-contract baseline: DSH `0.1.5-rc.2`
- Historical / optional backward-compatibility evidence: DSH `0.1.5-rc.1`
  (non-blocking; Task 13's real-app matrix, and no longer the contract pin)
- Forward target: none declared. A newer DSH release stays unsupported until both
  the contract gate and a real-app acceptance pass on it
- Support matrix: `docs/compatibility.md`. Executable acceptance procedure:
  `docs/manual-acceptance.md`

Task 14 closed the divergence this section used to describe. The runtime policy
changed during Task 13, on the human's explicit revision: this machine's installed
DSH is `0.1.5-rc.2`, so rc.2 became the current official local runtime and the
primary blocking acceptance runtime, while rc.1 was demoted to optional
backward-compatibility evidence. `package.json` still pinned the client packages
at the rc.1 release family through the end of Task 13, because a
compile-contract migration is not a test-coverage task. Task 14 owns that
migration and performed it: the contract packages are now pinned at `0.1.5-rc.2`,
`pnpm check:dsh-contracts` compiles the probes against those declarations and
compares them with the discovered installation, and the earlier "required
baseline rc.1 / forward target rc.2" pairing is recorded as a stale roadmap
assumption that no longer describes the acceptance policy.

## Completed

- Task 14
  - baseline: `0ed146e8ba8a4831c77eb06ef2b97cb35253849f` (`main`); branch
    `eval/deepseek-v4.1-flash-task14-20260919`; worktree
    `dsh-document-selection-ask-deepseek-task14-20260919`. No commit in this
    round amends Tasks 1–13, and `origin/main` still points at the baseline
  - the contract divergence is closed: the nine release-numbered `@deepseek-ai/*`
    contract `devDependencies` moved from `0.1.5-rc.1` to `0.1.5-rc.2`,
    `@deepseek-ai/cordis` stayed at `4.0.2` (independent versioning), the
    `pnpm-lock.yaml` diff is exactly the nine packages' `resolution`/`version`
    entries with no unrelated churn, and no production dependency changed
  - `scripts/check-dsh-contracts.mjs` (new) is the round's gate, wired as
    `pnpm check:dsh-contracts`; `scripts/dsh-doctor.mjs` was reduced to a
    reporter over the same implementation, so the two commands cannot disagree
  - the checker audits **every** `package.json` in the repository that declares a
    `@deepseek-ai/*` pin, not only the root one. It found a genuine latent
    defect the previous doctor could not see: `tests/browser/smoke-driver/package.json`
    still pinned `@deepseek-ai/dsh-client-ui-sidebar-right@0.1.5-rc.1` while the
    repository pinned rc.2 — a mixed release family inside one repository. That
    pin was migrated to `0.1.5-rc.2`
  - `docs/compatibility.md` (new) is the support matrix; `docs/manual-acceptance.md`
    (new) is the executable acceptance procedure. `README.md` and `AGENTS.md` lost
    their stale rc.1-primary / rc.2-forward-only statements, and `README.md`'s
    withdrawn "XLSX runtime blocked" section now describes the shipped inline
    runtime instead
  - the same correction reached the two other places that stated the pin as
    current: the compatibility section of `docs/07-testing-strategy.md` and the
    development-dependency table in `THIRD_PARTY_NOTICES.md`. Both records of
    *what was introduced when* were kept verbatim, with a Task 14 note naming the
    new pin; the two licenses were re-verified at `0.1.5-rc.2` against the
    published registry metadata. The published `files` list is unchanged, so
    nothing was added to or removed from the package surface
  - the manual procedure was executed in a real rc.2 web UI this round, not only
    written: all eight formats quoted with the required provenance form while
    preserving a `MANUAL-DRAFT` sentinel and submitting nothing; the
    `打开方式` renderer selector was driven plugin → builtin → plugin; the plugin
    was disabled through the documented `--patch` launch overlay and the builtin
    preview was proved to keep working, then restored; large PPTX and XLSX
    documents were cut mid-load with no stale DOM, no stale Ask and no uncaught
    error; the console and network surfaces were inspected and attributed
  - production delta is zero: `git diff 0ed146e8 -- src` is empty, and
    `lib/client.js` (`735F8B77…`) and `lib/index.mjs` (`FAC72B86…`) are
    byte-identical before and after the pin migration, which is what lets the
    Task 13 rc.1 evidence keep describing the same shipped artifact
  - full detail under "Current gate"

- Task 14R — exclusive runtime override closure (a correction to the Task 14 gate,
  opened by the external audit of the Task 14 PASS report)
  - recorded history: Task 14 reported PASS with `DSH_INSTALL_NODE_MODULES`
    documented as an **exclusive** override → the external audit found that the
    documented property did not hold → this round corrected the discovery
    semantics → Task 14 is closed on the corrected gate
  - the defect was an ordering defect, not a missing rule.
    `discoverRuntime(env)` called `probePathCli(env)` unconditionally *before*
    `runtimeCandidates(env)`, and both `PATH`-derived verdict rules ran whenever
    `cli !== null`. An override therefore still executed the ambient
    `dsh --version` and still let its result decide the gate: a valid rc.2
    override with a broken launcher first on `PATH` failed with "a `dsh` launcher
    is on PATH but `dsh --version` exited 7", and the same override with an rc.1
    launcher on `PATH` failed with "the `dsh` on PATH reports 0.1.5-rc.1 while …
    holds 0.1.5-rc.2". Both were reproduced against the pre-fix script before the
    correction was written
  - the correction reorders discovery so the authority is decided first:
    `runtimeCandidates(env)` runs, and `probePathCli(env)` is invoked only when
    `exclusive` is false. Under an override the `dsh` on `PATH` is not executed,
    not read and not reported, so exclusivity now holds at three levels at once —
    which locations are read, which runtime is selected, and what reaches the
    verdict. Neither a broken launcher nor a different release on `PATH` can
    change the result
  - a bad override still fails loudly on its own evidence: absent directory, a
    directory that is not a `node_modules`, no `@deepseek-ai/dsh` inside it, or a
    version that disagrees with the contract pin. No fallback to `PATH`, to
    `DSH_HOME` or to the home `node_modules` was introduced, and the override
    error path is unchanged from Task 14
  - the override is now visible in the report, not only in the code: both
    commands print `runtime discovery = DSH_INSTALL_NODE_MODULES override` and
    `PATH CLI report = NOT PROBED (explicit override)`. `scripts/dsh-doctor.mjs`
    still imports `inspectContractEnvironment()` rather than restating the
    decision, so it inherits the corrected semantics instead of duplicating them,
    and it reports the same two lines
  - the default no-override route is untouched, P6 included: a `dsh` launcher on
    `PATH` that cannot report a version remains a failure rather than a note,
    because that launcher's directory also supplies the compared installation
  - `docs/compatibility.md` stated the exclusivity more strongly than the code
    implemented it; it now states exactly what the code does, for both commands
  - no production, pin, lockfile or browser-test file was touched. The round
    changed the checker and the doctor, the two command reports, and the
    documentation that describes them
  - one arithmetic correction to the round's own reporting, with no code
    consequence: the Task 14 report described the `pnpm-lock.yaml` delta as
    `54+/54-`, while the actual change against the baseline is **45 additions /
    45 deletions** (`git diff --numstat 0ed146e8 HEAD -- pnpm-lock.yaml`). No
    file was edited to make a count agree; the lockfile itself is unchanged by
    Task 14R
  - full detail under "Current gate"

- Task 13
  - commits: `9064bfdfc5c14c7e7e48df393e1cee7255830e92` (the round's work),
    `08d93f910b71c8db01f0bd8839c1e480d5779cc5` (the round's record),
    `9f8b5c7adc7dba3e7a4a31345b75d6b71bf737e9` and
    `f916ed8f5278071265bc728b9d69dbf7dd7d2831` (two successive corrections to
    `scripts/verify.mjs`, described under "Current gate"), plus a closing docs
    correction. The corrections are separate commits rather than amendments because
    the branch was already published and this round does not force-push
  - `tests/browser/universal-selection.spec.ts` (new, 10 cases): one case per
    supported class — TXT, Markdown, code, CSV, PDF, DOCX, PPTX, XLSX — plus a real
    cross-root refusal and a recovery after it. Each class keeps its own real
    mechanism: builtin plain/Shiki DOM rows for TXT/CSV/code, a rendered-paragraph
    drag for Markdown, the PDF text layer, the rendered DOCX DOM, PPTX HTML/SVG
    text, and the XLSX semantic cell-range gesture. No case merges two classes and
    no format is covered by a "text" case
  - `tests/browser/resource-cleanup.spec.ts` (new, 6 cases): a rapid
    switch-while-rendering case for each byte renderer (PDF, DOCX, PPTX, XLSX), the
    cross-format "a late old resource's cleanup cannot clear the live selection that
    replaced it" case, and a cross-format network/local-asset audit
  - `scripts/verify.mjs` (new, 12 heuristic rules) wired as `pnpm verify`; the one
    new `package.json` row, with no new dependency
  - one new smoke fixture — `smoke-fixtures/task13-smoke.csv` — because CSV is one
    of the eight supported classes and Tasks 5–11 shipped no CSV fixture at all;
    the writer table and the driver table were both extended and every pre-existing
    fixture's bytes were verified unchanged
  - production diff from the baseline is empty: `git diff 56c74b3 -- src` produces
    no output
  - full detail in the Task 13 record under "Current gate"

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
  - commit: `ffec81eac5b29f7ae31019ab91d73396d766adef` — PASS
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

- Task 7
  - commit: `48940016fd216164ca905bf7ea64ae9f127db32e` — PASS
  - status: `PASS`
  - the plugin now renders a real PDF: DSH reads the fixture's bytes, ranks this
    plugin's renderer, mounts it under the keyed document slot, and the body draws
    a canvas plus a **selectable** text layer per page. The end-to-end path is
    asserted against a live instance — seven Playwright cases open `.pdf` files
    through the public `ctx.sidebarRight.openResource` call made by the test-only
    driver, and every `data-dsa-pdf-*` node they read is produced by DSH and the
    registered renderer
  - **rc.1 has no selectable PDF.** The installed
    `@deepseek-ai/dsh-client-ui-sidebar-documentpreview@0.1.5-rc.1` builtin PDF
    renderer draws one `<canvas>` per page and nothing else: `PdfBody` renders a
    canvas with `role="img"`, and the bundle's `TextLayer` class is PDF.js's own
    library code, never constructed by that renderer. Browser text selection over
    a DSH PDF preview was therefore impossible before this task, which is what
    makes a second renderer worth registering rather than a duplicate of one that
    already worked
  - **`priority: 'extension'` is a real ranking rule, not a preference.** The
    installed registry's `matchingDocumentPreviews` computes
    `rank = definition.priority === 'builtin' ? 0 : 1` and sorts descending, so an
    external implementation outranks the builtin whatever order they registered
    in. The plugin registers `dsh-document-selection-ask/pdf` at that band and
    **leaves the builtin registered**:
    `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/pdf` is still a live
    candidate, so disabling the plugin restores the product preview exactly
  - `pdfjs-dist` is pinned to **6.3.289**, the exact version the installed rc.1
    package declares and was compiled against — the installed bundle contains
    `pdfjsVersion = 6.3.289`, `pdfjsBuild = 1c8020a7d` and a source comment naming
    `pdfjs-dist@6.3.289`. Apache-2.0. It is a `dependencies` entry and it is
    **inside** `lib/client.js`: `tsdown.config.ts` names it in `deps.alwaysBundle`,
    because the DSH loader's `require` resolves the shared runtime only and a
    surviving `require("pdfjs-dist")` would be a runtime failure with no compiler
    error in front of it
  - **the worker is created explicitly, and there is no silent fallback.** PDF.js's
    own worker path contains `#setupFakeWorker()`, which parses on the main thread
    when the script cannot be fetched or the handshake fails. The renderer starts a
    native module worker itself from a `Blob` over the build-embedded
    `pdf.worker.min.mjs` and hands it to PDF.js as a port —
    `PDFWorker.create({ port })` takes `#initializeFromPort`, which has no fallback
    branch. A worker that cannot start raises the typed `PdfWorkerFailure`, and the
    browser case asserts the failure is visible **and** that `getDocument` was
    never called
  - the worker source and the CMap, standard-font and wasm families are embedded
    by `tsdown.config.ts` reading the installed package, not copied into the
    repository: a `?raw` virtual module for the worker and a `virtual:pdfjs-assets`
    table of base64 for the assets. The asset table is decoded **on demand**, one
    file per PDF.js request, through a plugin-owned `BinaryDataFactory`; a name the
    table does not hold throws `PdfAssetFailure`. `useWorkerFetch: false` and the
    absent `cMapUrl`/`standardFontDataUrl`/`wasmUrl` leave the document no address
    it could reach the network through
  - **the CSS survived, and that was checked rather than assumed.** Task 5
    recorded that a `*.module.css` import through this bundler is dropped
    silently, so the TextLayer rules are a runtime-injected
    `style[data-plugin-css]` element under a second tag id, and
    `tests/unit/pdf-bundle.spec.ts` asserts the rules are present in the built
    artifact as well as in the document
  - one number keeps the canvas and its text aligned. PDF.js lays a span out at
    `transform × viewport.scale × devicePixelRatio` and divides the result back
    down through `--total-scale-factor`; a canvas rendered at `factor` device
    pixels per CSS pixel therefore has to be paired with
    `--total-scale-factor = factor / devicePixelRatio`, and the same value is
    written from JavaScript. This is the one DSH does not have to solve, because
    its renderer has no text layer; the browser suite asserts a span's rectangle
    lies inside its canvas box, before and after a real viewport resize
  - the frozen raster limits are `MAX_CANVAS_DIMENSION = 16_384` and
    `MAX_CANVAS_PIXELS = 64 * 1024 * 1024`, applied as
    `factor = min(requested, MAX_DIMENSION / max(w, h), sqrt(MAX_PIXELS / (w × h)))`
    with the **CSS geometry untouched**: a page that exceeds a cap is rendered at
    a smaller backing scale rather than displayed smaller. Both bounds, the tier
    rule and the degenerate inputs are covered by pure arithmetic cases, because
    exercising the pixel cap through a real canvas would need a 64-megapixel
    allocation per case
  - a page is one render operation that owns both of its renders.
    `PDFPageProxy.cleanup()` releases the caches the text layer reads, so cleaning
    up when only the canvas had finished would leave the text spans empty and make
    a text page look like a scan. The operation starts both, waits for both, and
    cleans up once — and it tracks that it never cleaned while a render was
    pending
  - pages render lazily, and the margin is a **distance rather than a
    percentage**. `100% 0px` would be measured against the scroll container, whose
    height is a consequence of how many pages have rendered: page 1 alone leaves
    it about one viewport tall and six pages grow it to several, so the observer
    would be measuring a box its own output changes and the whole document would
    render on open while still looking lazy in the code. The probe measured
    exactly that. The margin is now a fixed 1200 CSS pixels against the viewport,
    which is stable under its own effect; page 1 is still immediate
  - the renderer publishes the DOM contract Task 8 will read:
    `[data-dsa-document-kind="pdf"]` with the exact `resourceAddress` from the
    public props, and a stable **1-based** `[data-dsa-pdf-page="<n>"]` wrapper per
    page. Nothing in this task reads those attributes; the address is copied
    verbatim rather than recovered from the shell's DOM, and the scrollport is
    reported through the framework's own `scrollportRef`
  - an image-only PDF produces a canvas and an **empty** text layer: no OCR, no
    filename-as-text, no synthesised placeholder. The fixture is built with drawn
    shapes and no text operator at all, so the assertion cannot pass by accident
  - `scripts/generate-pdf-fixtures.mjs` writes four deterministic fixtures into
    the committed `tests/fixtures/pdf/`, using `pdf-lib` (MIT) and
    `@pdf-lib/fontkit` (MIT) as development-only dependencies. The document
    metadata is pinned and no timestamp is written, so two runs are byte-identical
    — verified by comparing hashes across two runs. The generator refuses to write
    a file containing `/URI`, `http://` or `https://`
  - **the CJK font is not committed; the subset is.** The generator resolves a
    font from a documented local list, verifies **from the font's own `name` and
    `OS/2` tables** that it is freely licensed and permits embedding and
    subsetting, and embeds a subset. The committed `cjk.pdf` was generated from
    Noto Sans SC (SIL OFL 1.1, `fsType` permitting embedding), and the provenance
    is recorded in `tests/fixtures/pdf/README.md` and in
    `THIRD_PARTY_NOTICES.md`. A font that forbids embedding, or whose license
    string is not recognised, is refused rather than embedded
  - **one real boot defect was found and fixed.** The first run after the
    renderer was registered failed with
    `cannot get property "documentPreviews" without inject`: `ctx.documentPreviews`
    is a Cordis getter that refuses to be read before its provider has loaded, and
    the module's runtime `inject` named only `slots`. `src/client/index.tsx` now
    declares `['slots', 'documentPreviews']`, and the second entry is asserted at
    compile time by `tests/unit/client-bundle.spec.ts`
  - measured bundle growth: `lib/client.js` goes from 105,747 bytes to 6,842,908
    bytes raw (2,971,762 gzipped), which is PDF.js, its worker and its three asset
    families. The artifact contains no `require("pdfjs-dist")`, no
    `require("@zip.js/zip.js")`, no CDN host and no remote worker default; its only
    bare requires are the loader's own `react` and `react/jsx-runtime` plus one
    `require("url")` inside PDF.js's `if (isNodeJS)` branch
  - `THIRD_PARTY_NOTICES.md` now records `pdfjs-dist` per embedded family — the
    API bundle, the Adobe CMaps, the Foxit and Liberation standard fonts, and the
    JBIG2, OpenJPEG, QCMS and QuickJS wasm modules each with their own license file
    in the package — plus the TextLayer CSS attribution
    (`pdfjs-dist 6.3.289`, `web/pdf_viewer.css`, Apache-2.0) and the CJK fixture
    font's provenance. `npm pack --dry-run` confirms the file is in the tarball
  - a shared browser helper, `tests/browser/helpers/shell.ts`, points the smoke
    instance at this repository before either real-DSH suite runs. The fixtures are
    addressed by a session-scoped `dsh-resource://file/session/<id>/<path>` URL,
    which resolves against the Session's workspace root, and the instance keeps
    whichever workspace its last user chose — a run against the wrong root fails
    with `workspace-file/not-found` for every fixture, which reads like a renderer
    defect. No plugin code chooses or reads a workspace

- Task 7A — PASS
  - commit: `bb6c9f325caa5489c847048b1102270a641ed5de` — `fix: release pdf render abort listeners`
  - status: `PASS`
  - Closes:
    - per-render AbortSignal listener retention
    - stale lazy-loading source comment
  - **the retention defect.** `renderPdfPage` registered one `abort` listener on
    the signal it was handed and never released it. That signal is the **tab's**,
    which outlives every page, every resize re-render and every page that scrolls
    back out of the lazy range, so `{ once: true }` bought nothing: it releases the
    listener only when the tab finally aborts, and until then every finished render
    operation — its `PDFPageProxy`, its `RenderTask`, its `PdfTextRender` — stayed
    reachable from the tab signal. Twenty drags of the right column's edge left
    twenty finished closures attached. `cancel()` now detaches **first**, so an
    explicit cancel unlinks the operation at the moment it is asked to stop rather
    than when `done` settles, and the operation's settlement `finally` detaches on
    every other path — completion, raster failure, text failure and abort alike.
    `detachAbort` is idempotent and never throws; an already-aborted signal still
    registers nothing at all
  - **the cancellation contract is unchanged.** Releasing a listener releases no
    page earlier: `page.cleanup()` still runs only after both render paths have
    settled, `cleanedUpWhileRendering` is still `false` on every case, the canvas
    task and the text layer are still cancelled by the same `cancel()`, and
    `cancel()` is still idempotent. The listener is released before the two
    renders, which is the one ordering change and is about the signal, not the page
  - **the two listeners are counted separately.** `renderPdfPage` and the text
    layer each attach an `onAbort` to the same event on the same signal, so the new
    client suite separates them by identity rather than by name: the outer one is
    the listener present the moment `renderPdfPage` returns, because it attaches
    before the function's first `await`. `text-layer.ts` is not touched; its own
    release was already correct and remains out of scope
  - the stand-in `TextLayer` now pulls its stream, as PDF.js's own pump does, so a
    stream that errors rejects the layer's promise. Without that, the text path's
    failure mode was unreachable from the suite and the "text failure detaches"
    case would have been nominal; `PageControl.textError` is the script for it
  - `SelectablePdfBody`'s header comment described a `100% 0px` margin rooted at
    the body's own scroll container, which the implementation had already stopped
    doing in Task 7. It now states the fixed `1200px 0px` margin against the
    viewport. `LAZY_ROOT_MARGIN` and the observer's own `root` are unchanged
  - no `SelectionAdapter`, no page provenance resolver, no PDF Ask integration, no
    `SelectionSnapshot` or quote change, no bundler, manifest, lockfile, notices or
    PDF.js asset change. Selecting PDF text still raises no Ask button, which is
    the correct state until Task 8
  - Task 7A listener lifecycle suite: PASS (7 client cases) — completion, raster
    failure, text failure, explicit cancel asserted **while `done` is still
    pending**, tab abort, an already-aborted signal registering nothing, and 20
    sequential renders on one live signal with one registration and one release per
    render. No case calls `abort()` to prove a release
  - Task 7A targeted runtime suite: PASS (25 client cases, unchanged)
  - Task 7A: full `pnpm test`: PASS (624 tests), `pnpm typecheck`: PASS,
    `pnpm build`: PASS, `git diff --check`: PASS
  - Task 7A real DSH PDF renderer smoke (Playwright, live instance): PASS (7 cases,
    re-run after the change) — including the resize re-render and the lazy page
  - Task 7A real DSH TextPreview smoke (Playwright, live instance): PASS (8 cases,
    re-run after the change)

- Task 7B — PASS
  - commit: `2c0d349cfb2acf211401b48a06145f5de9f4fd10` — `fix: reset pdf text layer between renders`
  - status: `PASS`
  - Closes:
    - PDF TextLayer DOM accumulation across resize/re-render
    - stale TextLayer generation after rerender
  - **the accumulation defect.** A page's text-layer element belongs to React and
    is the same element on every re-render of that page, while PDF.js's
    `TextLayer` appends into whatever container it is given and its `cancel()`
    removes none of it — in 6.3.289 `cancel()` cancels the reader and rejects the
    layer's own capability and touches no DOM. Two renders into one container
    therefore left the page's text in the DOM twice, and twenty drags of the
    column's edge left it twenty times. The duplicates are invisible, because the
    spans are transparent and coincide, but they are what the browser reads:
    `getSelection().toString()` returned the text once per generation, so copy
    took it twice and Task 8's adapter would have quoted it twice. Measured
    against the pre-fix build, the client suite reported
    `AlphaBetaGammaAlphaBetaGamma` where one generation is
    `AlphaBetaGamma`
  - **the fix is one `replaceChildren()` at the generation boundary.**
    `text-layer.ts` publishes `clearTextLayer(container)`, `renderPdfPage` calls
    it as its **first statement** — synchronously, before its first `await` and
    before its own abort check — and `renderTextLayer` calls it again immediately
    before it constructs the layer. Both calls are load-bearing and each has a
    distinct job: the operation-level one is what makes the element belong to the
    new generation even when that generation never obtains a page at all (a
    rejected `getPage`) or is cancelled before its first `await`, and the
    module-level one is what makes the rule the module's rather than its
    caller's. `replaceChildren()` rather than `innerHTML = ''` or
    `textContent = ''`: it parses nothing, takes no string and cannot be made to
    run script
  - the ordering the task required is the ordering that ships: `paint()` cancels
    the operation it replaces, `renderPdfPage` empties the container, the new
    layer is constructed. There is no path on which the container is cleared
    while an earlier layer is still the one being written to
  - **no generation token was added, and the reason is recorded rather than
    assumed.** A cancelled layer can in principle append a chunk whose read
    resolved before the cancellation and whose continuation runs after it, and
    such a chunk would land in a container already given to the next generation.
    That window cannot be reached from this application, and the argument is
    about the platform rather than about timing: a text chunk reaches PDF.js's
    pump from a worker `message` event (`MessageHandler.#processStreamMessage` →
    `controller.enqueue`), the pump's continuation for it is a microtask, and a
    microtask always drains before the event loop returns to its task queue —
    while every `cancel()` this renderer performs (an animation frame, an abort
    listener, an effect cleanup) runs in a **later** task. A `WeakMap` token
    would therefore guard against a state the application cannot produce, and
    §十一 of the round's instructions says to keep the simple path when the real
    cancellation is synchronous enough. The reasoning is in the module note, so a
    later change to the cancel path has it in front of it
  - **the module that owns PDF.js's own events layer had to be corrected, not the
    component.** `renderPdfPage` is the only writer of that element and the
    operation is the only thing that knows when a generation ends; the React
    component was already doing the right thing by cancelling first
  - the mock was extended twice and both extensions are faithful rather than
    convenient. `FakeTextLayer.render()` now **pumps**: it pulls a chunk, appends
    its items, pulls the next, so a page's text arrives in installments and the
    gap between two of them is a state a case can hold. Its append makes no
    ownership test and none after the await, exactly as the real layer makes
    none — a stand-in that filtered its own appends would have hidden the defect
    it exists to show. `addScriptedPage()` adds a page whose chunks are released
    by the case (`deliver()` one, `release()` the rest), and `streamTextContent()`
    returns a **fresh** stream per call, as a real page object does, so a
    re-render reads the page's text from the beginning
  - the client suite is a new file, `tests/client/pdf-text-layer.client.spec.tsx`
    (5 cases), because the reused-container contract is not the listener
    lifecycle's subject; Task 7A's `pdf-render-page.client.spec.tsx` is
    untouched and its 7 cases still pass. Every case renders into **one**
    `{ canvas, textLayer }` pair — a case built on two fresh hosts would prove
    nothing, since the defect *is* the reuse. Two renders on one host, then four
    consecutive renders including a cancel after completion, then a render whose
    signal had already aborted (the container is emptied and the generation hands
    out no stream at all), then a failed new generation (a rejected `getPage`,
    so nothing can replace the old text — asserted empty rather than merely
    different), then a generation cancelled between two chunks with the next one
    reading the same three chunks (`PartialAlphaBeta`, never
    `PartialPartialAlphaBeta`)
  - the suite was verified to discriminate: with `clearTextLayer` reduced to a
    no-op, all 5 cases fail with exactly the accumulation the task describes —
    `AlphaBetaGammaAlphaBetaGamma`, `AlphaBeta` four times over, stale text
    surviving an aborted render and a failed one, `PartialPartialAlphaBeta`
  - Task 7A listener lifecycle re-verified after the change: PASS (7 client
    cases, unchanged). The reset touches neither the listener's registration nor
    its release, and `page.cleanup()` still waits for both renders to settle —
    `cleanedUpWhileRendering` is asserted `false` in the new cases as well, and
    the reset is not a cleanup: it never calls `page.cleanup()` and never brings
    one forward
  - Task 7B targeted suites: PASS (`pdf-text-layer` 5, `pdf-render-page` 7,
    `pdf-runtime` 25, `pdf-styles` 4 — 41 cases). Full `pnpm test`: PASS (629
    tests, up from 624), `pnpm typecheck`: PASS, `pnpm build`: PASS,
    `git diff --check`: PASS
  - Task 7B real DSH PDF renderer smoke (Playwright, live instance): PASS (8
    cases). The new case opens `single-page.pdf` at 1600×1000 and then resizes
    through 1200×900, 1900×1200, 1000×800 and 1700×1100; after **each** one the
    layer's `textContent` equals the first render's, the node count is unchanged
    rather than N/2N/3N/4N, a real browser selection equals the first render's
    selection and contains `Gamma` exactly once, the text is still aligned inside
    its canvas, and the Ask button count is still 0. Each resize is proven to
    have re-rendered: the canvas's box **and** backing width both moved — the
    renderer writes them, configures the layer and starts it in one synchronous
    block — and every span in the layer was built after the case stamped the
    previous generation's, so a run where the resize never reached the renderer
    fails instead of passing on stale evidence
  - the same case was verified to discriminate in the browser: with
    `clearTextLayer` a no-op in a rebuilt bundle, it fails with *the layer still
    holds spans from the generation this resize replaced*, which is the defect
    stated in the DOM
  - `cjk.pdf` re-rendered twice (1600×1000 → 1200×900 → 1900×1200): the CJK text
    is identical after each one and the browser selection is identical too, with
    `中文选段测试` and `第二行` each matched exactly once — a doubled generation
    would show every character twice, which a `toContain` assertion would not
    notice. The case now opens at 1600×1000 because the preview column does not
    change width between 1280 and 1300, and a resize that reaches no renderer
    would have tested nothing
  - `image-only.pdf` re-rendered twice: `textContent` is `''` and the layer holds
    zero children after each one, `selectPageText` is `''`, and no span exists —
    the reset introduces no placeholder, and OCR is still `NO`
  - Task 7B real DSH TextPreview smoke (Playwright, live instance): PASS (8
    cases, re-run after the change)
  - no `SelectionAdapter`, no page-provenance resolver, no PDF Ask integration,
    no bundler, manifest, lockfile, notices or PDF.js asset change (`data-dsa-pdf-text`
    已由 Task 7 renderer 存在，Task 7B 没有新增或改变该 DOM contract). `pdfjs-dist` stays at 6.3.289 and its DOM contract is
    untouched: the text layer is still the React element with
    `class="textLayer"`, so every selector `.textLayer span` and the
    `> :not(.markedContent)` rule PDF.js's own stylesheet relies on still resolve
    exactly as before. PDF selection still raises no Ask button, which remains
    the correct state until Task 8

- Task 8 — `d1ad92e35c24e5264353cb0fb2f6ef53bf7481ec` — PASS

PDF:
- native TextLayer selection captured
- source page provenance
- same/cross-page Ask
- real DSH verified

- Task 8A — PASS

Root cause:
- renderer replaced selectable DOM after resize-time lifecycle capture
- Chromium collapsed native Selection without selectionchange
- kernel therefore retained stale snapshot

Fix:
- renderer publishes selectable-DOM invalidation
- BrowserSelectionLifecycle.refresh performs authoritative recapture
- collapsed selection clears stale snapshot
- unaffected valid selection is recaptured rather than blindly cleared

- Task 9 — `b4c86b4685ff86ffec0a99dd71fc71cecfd3ba1d` — PASS

DOCX:
- preflight before render
- high-fidelity docx-preview DOM
- native selection
- rendered-page provenance when reliable
- file-only fallback otherwise
- real DSH Ask verified

- Task 9R — PASS

Security review:
- docx-preview 0.4.0 copies external relationship targets into anchor href
- renderer now sanitizes all published hyperlink schemes
- unsafe rendered DOM never reaches live preview before hardening
- javascript/data/file/custom schemes blocked
- HTTP/HTTPS hardened with noopener/noreferrer
- altChunk gate remains independent

- Task 9S — PASS

OOXML security pipeline:
- central-directory metadata preflight (`preflightOoxml`)
- bounded streaming extraction verification (`verifyOoxmlExtraction`)
- actual output must equal declared size into a discarding counting sink
- third-party Office renderer runs only after both gates
- zero retention of decompressed bytes
- forged declared size mismatch rejected early during extraction
- third-party renderer never called on forged archive

- Task 10 — `6aaf0ddc93d97b33da361eab8afd58b069bfe31e` — PASS

PPTX:
- high-fidelity HTML/SVG renderer
- native selectable text
- slide provenance
- shared OOXML metadata + actual extraction gates
- external media blocked before rendering
- windowed/lazy large-deck rendering
- real DSH Ask verified

- Task 10R — PASS

Review remediation:
- external hyperlink relationship type uses exact Transitional/Strict allowlist
- custom /hyperlink suffix rejected
- active initial PPTX render is destroyed immediately on AbortSignal
- rapid close verified in real DSH
- resize stale-selection evidence validates current-generation endpoints and current text

- Task 10S — PASS

Lifecycle:
- one clearly-owned AbortSignal cancellation path
- temporary initial-render abort race leaves no listener behind
- session.dispose removes active abort ownership
- later signal abort after dispose has no renderer side effect

- Task 11 — `dc266a6620ccc8889dd69377dd4424761a989358` — PASS

XLSX:
- read-only local workbook renderer
- semantic cell-range selection
- displayed/calculated values
- 200-cell limit
- sheet + A1 provenance
- local Duke WASM
- worker-backed parsing
- OOXML metadata + actual extraction gates
- real DSH Ask verified

- Task 11R — BLOCKED — CLIENT-ASSET CONTRACT BLOCKED

Remediation of the Task 11 merge review. The review's three confirmed production
defects and its host-architecture deviation are fixed; the XLSX browser evidence is
**not** green, and the round is reported as BLOCKED rather than PASS.

Fixed, with the failing case observed before the fix:

- **metadata preflight was not awaited.** `XlsxBody` called
  `preflightOoxml(copy, DEFAULT_OOXML_LIMITS)` fire-and-forget, so extraction
  verification, the relationship scan and the third-party viewer could all begin while
  the metadata gate was still reading the central directory. It is now awaited, and the
  three gates are strictly serial: preflight, then `verifyOoxmlExtraction`, then
  `assertSafeXlsxRelationships`, then the engine check, then the viewer.
- **the preflight received no AbortSignal.** Every gate now receives the component's own
  lifecycle signal, so releasing the tab interrupts metadata preflight, extraction
  verification and the relationship scan alike. A preflight rejection no longer escapes
  as an unhandled rejection.
- **validated bytes and rendered bytes were different objects.** The pipeline validated a
  defensive copy and the ready render re-sliced `content.data`, so a host that reused or
  mutated its buffer between the two points changed what the viewer parsed. `ready` now
  carries the exact `ArrayBuffer` the gates validated (`{ kind: 'ready'; file: ArrayBuffer }`),
  one defensive copy per resource generation, and nothing re-reads the host array.
- **`checkSignature: true` in the relationship scanner.** Replaced by
  `checkCrc32: true` plus `checkOverlappingEntry: true`, stated once as
  `XLSX_RELATIONSHIP_READER_OPTIONS` and pinned by a spec against the shared verifier's
  policy.
- **a cancelled relationship scan resolved successfully.** `if (signal?.aborted) return`
  reported a security check that never finished as one that passed. Abort now rejects
  with an `AbortError`, checked before enumeration, between entries and after each
  entry's content is read, and the reader is still released on that path.
- **a cleanup failure could replace the verdict.** The scanner now applies the shared
  verifier's asymmetry: a primary refusal or abort survives a failing `close`, while a
  cleanup failure after acceptance propagates.
- **the relationship scan spawned a zip.js codec Web Worker.** Found by running the
  suite against a live instance and capturing the worker's creation stack:
  `getData` was called with no options, so zip.js's `useWebWorkers` default built a
  `Blob` worker *before* the gate had decided the archive was safe. The scan now states
  `useWebWorkers: false`, matching `verifyOoxmlExtraction`; the browser case asserts a
  live instance creates no worker at all during the blocked-state path.
- **the host half was no longer client-only.** `src/index.ts` had grown a `webServer`
  lookup, two `/dsa-assets` routes and `node:fs` reads. It is restored to the inert
  client-only baseline; `tests/unit/host-entry.spec.ts` now asserts that applying it
  touches no context member, registers no route, and that neither the source module nor
  the built bundle mentions `webServer`, `dsa-assets`, `readFileSync`, `node:fs`,
  `xlsx-worker` or `duke_sheets_wasm`.
- **the build no longer rewrites upstream code without checking it.** The two
  `@extend-ai/react-xlsx` rewrites (the worker construction and the Duke dynamic import)
  go through `replaceExactlyOnce`, which refuses a build unless each literal occurs
  exactly once. The host-route worker rewrite and the `lib/assets` copy are deleted, so
  the package ships no separate worker or WASM asset.

Not fixed, and the reason the round is BLOCKED:

- **the XLSX engine binary has no delivery path.** `@extend-ai/react-xlsx` publishes
  `duke_sheets_wasm_bg.wasm` at a public subpath, and `setWasmSource` accepts an
  `ArrayBuffer` that its worker receives verbatim — but nothing can carry those 4.4 MB to
  the browser client-only. `@deepseek-ai/dsh-client-modules` serves an external plugin's
  browser half as exactly one generated script (`exports["./client"]` plus its optional
  source map) through a closed, pre-computed response table; a request for any other path
  answers 404 and there is no file-system fallback. `ClientModuleRegistry` exposes
  `graph`, `clientPath`, `fetchBundle`, `artifactBaseline`, `rebuilt`, `onRebuilt` and
  `onGraphChanged` — no asset or file registration. `DshClientManifest` declares only
  `platform`, `inject`, `immediately` and `external`, and unknown fields are discarded.
  The one URL a bundle can learn at run time is that combo endpoint, `import.meta.url` is
  unavailable in a classic script, and `document.currentScript` is `null` by the time a
  lazily materialised module body runs. Inlining the binary into `lib/client.js` is
  technically possible and is what DSH's own PDF preview does, but it is exactly the
  "base64 the entire WASM into main JS" that this round's constraints forbid, so it was
  not adopted and the host route was not restored. The renderer therefore fails closed
  with a typed `XlsxWasmSourceUnavailableError` and a visible message before any
  third-party viewer is mounted.
- Consequences: `tests/browser/xlsx-selection.spec.ts` is 1 passed / 9 failed / 0
  skipped. Case 0 records the blocked state from a live instance (renderer reports the
  blocked engine, no selectable surface, no worker, no `/dsa-assets` request, no remote
  request, `/dsa-assets/duke_sheets_wasm_bg.wasm` answers 404). Cases 1–9 encode the
  tightened evidence the unblock must satisfy — exact published range read before Ask,
  exact provenance, the sheet-switch intermediate state, painted drawing surfaces for the
  chart/image workbook, a real client-owned `blob:` Worker, Delete/Backspace/paste
  read-only attempts — and every one of them fails at the readiness gate because no
  workbook reaches a viewer. Their assertions beyond that gate are unverified.
- `tests/client/xlsx-renderer.client.spec.tsx` gained `data-dsa-xlsx-selection` as the
  renderer's published semantic selection (`"<sheet>!<range>"`), so the browser suite can
  confirm a gesture's range rather than infer it from a visible button.

Verification (all on `eval/gemini-3.8-flash-task11-20260918`):

- `pnpm test`: PASS (910 tests)
- `pnpm typecheck`: PASS
- `pnpm build`: PASS
- `npm pack --dry-run`: PASS, with `lib/assets/**` removed from the published file list
- `git diff --check`: PASS
- real DSH 0.1.5-rc.1, profile `dsa-smoke`:
  - PDF 10 passed / 0 failed / 0 skipped
  - DOCX 6 / 0 / 0
  - PPTX 10 / 0 / 0
  - TextPreview 8 / 0 / 0
  - XLSX 1 passed / 9 failed / 0 skipped — BLOCKED (see above)

Next:

Architecture decision on client-only binary asset delivery for external DSH client
plugins. Until it is made, Task 11 cannot be merged and Task 12 must not start.

- Task 11A — PRODUCTION DEFECT FOUND

Delivered the authorised architecture decision. The Duke engine binary and the
library's worker now travel **inside the single client bundle**; the XLSX browser
suite reaches 11 passed / 1 failed / 0 skipped, and the one failure is a defect in
the pinned viewer that this round did not paper over.

Architecture (`docs/06-security-performance.md` §11 records it):

- the exact installed `@extend-ai/react-xlsx@0.16.4` binary is read at build time
  by `scripts/xlsx-runtime-assets.ts`, which refuses the build unless its byte
  length is 4,412,299 and its SHA-256 is
  `24687a3e…5e6ef3d` (`XLSX WASM IDENTITY CHANGED`), compresses it
  deterministically with `node:zlib` (`mtime = 0`, level 9) and publishes
  `Base64(gzip)` through the virtual module `virtual:dsa-xlsx-wasm-gzip`
- the compressed payload is 1,674,037 bytes / 2,232,052 Base64 characters, inside
  the 1,800,000 / 2,400,000 bounds (`XLSX WASM COMPRESSION REGRESSION` otherwise).
  The forbidden raw representation is 5,883,066 characters and appears nowhere in
  the artifact
- the runtime decodes, inflates with `DecompressionStream('gzip')`, checks the
  length and the SHA-256 and only then calls `setWasmSource(BufferSource)`. No
  decompressor dependency was added. Every failure — missing
  `DecompressionStream`, bad base64, corrupt gzip, wrong length, wrong digest —
  raises `XlsxWasmIntegrityError` and fails closed
- initialization is lazy and a session singleton: a session that never opens a
  workbook runs no `atob`, no inflate and no digest, and parallel or repeated opens
  share one promise. A failed attempt clears the cache rather than poisoning the
  session. A caller's `AbortSignal` bounds **its wait only**: a released tab never
  mounts a viewer, and the shared work still completes
- the worker is a self-contained module the build synthesizes: the library's
  `xlsx-worker.js` with its three `fflate` imports rebound to an inlined copy of
  `fflate/esm/browser.js` and its `import("@dukelib/sheets-wasm")` rebound to an
  inlined Duke glue factory. Zero static imports, zero dynamic imports, zero
  `require`, zero `importScripts`, 389,629 characters, no WASM bytes inside it
- the bundle constructs that worker from a `Blob` and revokes the object URL in the
  same statement. The rewrite of the library's own
  `new Worker(new URL("./xlsx-worker.js", import.meta.url), …)` now replaces the
  **whole** construction: the first live run of this architecture produced
  `new Worker(__dsa_xlsx_create_worker__(), { type: "module" })`, which stringified
  the returned `Worker` and made the browser fetch `[object Worker]` relative to the
  document. The bundle spec now asserts the exact rewritten call site
- every rewrite of upstream code (two in the library, four in the worker) is
  asserted to match exactly once, and no `node_modules` file is patched

Measured bundle:

- `lib/client.js` before 13,666,692 bytes (4,482,591 gzipped), after 16,312,972
  bytes (6,245,766 gzipped); delta 2,646,280 bytes, inside the 3.0 MB gate
- the compressed payload is the minimal viable DSH-native client-only transport
  under the current public module contract

**Production defect found — the pinned viewer does not paint an embedded picture.**

`tests/browser/xlsx-selection.spec.ts` case 6 now asserts the two drawing objects
**separately**, and the picture half fails:

- the chart is drawn. The viewer publishes an inline
  `<svg role="img" aria-label="Chart 1">` with a 300×189 box, 4 fills and 8
  gridlines, and the case asserts exactly that
- the embedded picture is not. The fixture's PNG is a solid red 64×64 image; the
  case polls the sheet canvas for its own colour and finds 0 pixels. The control
  case (`6a`) proves the signature is discriminating: the workbook without a
  drawing part paints none of that colour and publishes no drawing overlay at all
- the image is present in the model. Probed through the library's own public
  engine API: `Workbook.fromBytes(fixture).getSheet(0).images` reports one entry,
  `hidden: false`, `mediaPath: "xl/media/image1.png"`, with a valid anchor rect
- ruled out by measurement, each with the exact-payload experiment: the malformed
  drawing part (fixed, see below), the anchor form (`oneCellAnchor` rewritten to
  `twoCellAnchor` — identical rendering), the picture's own `spPr/xfrm/ext` being
  `0,0` while the anchor carries 609600×609600 (rewritten to match — identical
  rendering), and worker-versus-main-thread (`useWorker={false}` — identical
  rendering)
- this is the frozen Task 11 chart/image browser-fidelity requirement, so it is
  reported rather than relaxed

**Fixture defect found and fixed.** `scripts/generate-xlsx-fixtures.mjs` wrote the
chart's `twoCellAnchor` with a stray `</xdr:rowOff>`, so
`xl/drawings/drawing1.xml` was not well-formed XML and the viewer parsed no drawing
at all — neither the chart nor the picture. With the tag removed the chart renders;
`tests/fixtures/xlsx/chart-image.xlsx` is regenerated from the fixed generator. The
other five fixtures were regenerated for comparison and **reverted**: their only
logical difference is the `docProps/core.xml` timestamp, so regenerating them would
have been unrelated binary churn.

Gesture calibration. The suite's grid offsets were measured against the live
runtime rather than assumed; the first honest run put a 45 px start on row 2. The
grid box includes the 40 px row header and the 24 px column header, column A spans
x ≈ 45–95 and row 1 spans y ≈ 24–44 at 1280×720. Every assertion stays exact — the
range a gesture produced is read back from `data-dsa-xlsx-selection` and compared
— and each case records the measurement that fixed its offsets.

Verification (all on `eval/gemini-3.8-flash-task11-20260918`, HEAD before the
round's commit):

- `pnpm test`: PASS (939 tests, up from 910)
- `pnpm typecheck`: PASS
- `pnpm build`: PASS
- `npm pack --dry-run`: PASS — the tarball carries `lib/client.js`, `lib/index.mjs`
  and type declarations only; no `*.wasm` side asset, no worker side asset, no
  smoke fixtures, no Playwright report
- `git diff --check`: PASS
- targeted suites: `xlsx-wasm` 14, `xlsx-security` 30, `xlsx-renderer` 19,
  `xlsx-selection-bridge` 5, `xlsx-adapter` 9, `cell-range` 6, `format-xlsx` 16,
  `xlsx-bundle` 18, `host-entry` 9 — 126 passed
- real DSH 0.1.5-rc.1, profile `dsa-smoke`, `DSH_SMOKE_URL` non-empty:
  - XLSX 11 passed / 1 failed / 0 skipped — the failure is the picture defect above
  - PPTX 10 / 0 / 0
  - DOCX 6 / 0 / 0
  - PDF 10 / 0 / 0
  - TextPreview 8 / 0 / 0
- network and host gates inside the XLSX suite: renderer-triggered WASM requests 0,
  worker requests 0, `/dsa-assets` requests 0, remote requests 0, document uploads
  0; the one `/dsa-assets/duke_sheets_wasm_bg.wasm` request is the suite's own
  intentional probe and answers 404
- one real `blob:` Worker is observed before the workbook is ready, and the object
  URL the plugin created was revoked — read from instrumented
  `URL.createObjectURL`/`revokeObjectURL`, not from the code that calls them
- `src/index.ts` remains inert: `webServer`, `dsa-assets`, `node:fs` serving and
  any XLSX host service are all absent from the host bundle

Next:

The embedded-picture defect is in the pinned `@extend-ai/react-xlsx@0.16.4` viewer,
not in this plugin's code: the plugin passes the documented props, the engine's
public model carries the image, and the chart from the same drawing part renders.
Task 11A is therefore **not** PASS and Task 11 is still not mergeable. Resolving it
needs either an upstream fix, a pin to a version that paints pictures, or a
separate authorised decision — none of which this round may take. Task 12 must not
start.

Next:
Task 12 — Unified registration, locale, cleanup and renderer fallback

- Task 11B — FIXTURE DEFECT REMAINS — NOT PASS

Authorised remediation of the embedded-picture rendering path, through the pinned
viewer's **public** boundary only. The remediation is implemented, verified and
committed; the frozen chart/image browser gate is still not green, and the
blocking condition is now identified in the test fixture rather than in the
plugin or the viewer.

What was done (all of it inside the authorised public boundary):

- `XlsxBody` now configures the viewer explicitly: `showImages={true}` and
  `renderImage={renderXlsxImage}`. No other viewer or provider prop changed, and
  the canvas renderer, read-only mode, worker mode and form-control suppression
  are as they were;
- `src/client/renderers/xlsx/render-image.tsx` renders one `<img>` per worksheet
  picture from the `XlsxImageRenderProps` the hook is handed — the model entry's
  own `src` and its `description`/`name` alt text — and sizes it from the
  **style the viewer published** (`style.width` / `style.height`). The viewer
  wraps this node in a positioned element carrying the same style, so the node
  fills that box; re-applying the style's `left`/`top` would place it a second
  time inside a box already at those coordinates and clip it away. No anchor, row
  height, column width or EMU value is read anywhere in the module, and the
  callback is a module-level constant so the viewer's drawing-layout memoization
  is not invalidated per render;
- the node is read-only presentation: `draggable={false}`, `pointer-events: none`,
  no selection hook, no resize handle, no controller mutation. `renderImageSelection`
  is deliberately **not** supplied;
- no dependency, lockfile, bundler, security-pipeline or selection change. The
  built `lib/client.js` moved from 16,312,972 to 16,314,168 bytes (delta +1,196).

Public contract verified against the installed `@extend-ai/react-xlsx@0.16.4`
package-root typings: `XlsxViewerProps.renderImage`,
`XlsxImageRenderProps { defaultNode, image, rect, style }`, `XlsxImage.src`,
`XlsxImage.mimeType`, `XlsxImage.mediaPath`, `XlsxViewerProps.showImages` (default
`true`). No private API is required or used, and no `node_modules` file is
patched.

Measured against the real fixture, real security gates, real engine and real
viewer (`tests/client/xlsx-image-render.client.spec.tsx`, 3 cases):

- the public controller image model publishes the fixture's one picture with a
  client-owned source, `mimeType: image/png`, `mediaPath` under `xl/media`,
  a one-cell anchor at column D / row 2, and sheet indices 0;
- the documented `renderImage` callback **is** invoked, with a finite positive
  rectangle (`width`/`height` both 64 in the real browser), an absolute
  positioned style carrying the same box and a numeric z-order, and a non-null
  `defaultNode`. This is what rules out `UPSTREAM PUBLIC IMAGE HOOK DEFECT`;
- the production body publishes the picture as a node whose `src` is the viewer's
  own object URL: the platform's allocator is instrumented in the case, the source
  appears in `created` exactly once, the plugin revokes nothing it does not own,
  and a synthetic pointer drag on the node leaves the published box byte-identical.

Measured in a real DSH instance (0.1.5-rc.1, profile `dsa-smoke`, 1280x720):

- XLSX: **12 passed / 1 failed / 0 skipped** (13 cases; 6a and 6b are new);
- case 6, the frozen chart/image case, now reads the picture from direct semantic
  evidence rather than from canvas colour. Eleven of its twelve picture
  properties pass: the node is published (`count` 1), its source is `blob:`, it is
  `complete`, it reports 64x64 natural size, it is laid out in a **64x64 box at
  924,121** — positive, inside the viewport, `display`/`visibility`/`opacity` all
  visible — and it carries `alt="Picture 1"` and `draggable="false"`. The chart
  half still passes unchanged: `<svg role="img" aria-label="Chart 1">` with
  positive dimensions, ≥2 fills and ≥4 gridlines, asserted as a separate object;
- the twelfth property — that the picture's bytes decode into the fixture's solid
  red — fails, and it fails for a cause that no renderer can change:
  **the fixture's embedded PNG is not a decodable image.**

**Fixture defect — new independent evidence. `tests/fixtures/xlsx/chart-image.xlsx`
was NOT modified.**

The picture stored at `xl/media/image1.png` is 227 bytes and byte-identical to the
generator's `SAMPLE_PNG_BASE64` constant (SHA-256
`8f66e8cd3d8558e86bc0870a8e21adf9f33126d91fc6dee7071b10ec53ff8ca8`). Its IHDR
parses — 64x64, 8-bit RGBA — which is why an `<img>` element reports
`complete: true` and `naturalWidth: 64`. Its image data does not:

- `node:zlib.inflateSync` over the IDAT stream: `invalid code lengths set`
- `fflate.unzlibSync` (the decoder bundled inside `@extend-ai/react-xlsx` itself):
  `invalid length/literal`; `fflate.inflateSync`: `unexpected EOF`
- Chromium's own decoder, reached through `createImageBitmap` in the live page:
  `InvalidStateError: The source image could not be decoded`
- drawing the node into a canvas yields no colour at all, which is what the
  round-11A canvas sampling observed

The IDAT payload is 89 bytes behind a valid `78da` zlib header and claims to
expand to the 16,448 bytes a 64x64 RGBA image needs; every decoder that reaches
the Huffman tables rejects it. Three independent decoders, two of them not
browsers, agree, and the bytes in the fixture are the bytes the generator writes.

**Correction to the Task 11A conclusion.** Task 11A recorded "the pinned viewer
does not paint an embedded picture" as a production defect, on the evidence that
the sheet canvas carried none of the picture's colour. That evidence has a
sufficient alternative explanation now: a picture whose pixel data cannot be
decoded paints no colour under *any* renderer, so the canvas-bake observation did
not establish a viewer defect. The remediation above remains authorised and
correct on its own terms — it is plugin-side compatibility hardening through the
documented replacement boundary, it moves pictures onto the same positioned DOM
overlay the chart already uses, and it removes no assertion — but it is **not**
claimed to have fixed a proven upstream defect.

Verification on `eval/gemini-3.8-flash-task11-20260918`:

- `pnpm test`: PASS (945 tests over 54 files, up from 939)
- `pnpm typecheck`: PASS
- `pnpm build`: PASS
- `npm pack --dry-run`: PASS
- `git diff --check`: PASS
- targeted suites: `xlsx-wasm` 14, `xlsx-security` 30, `xlsx-renderer` 22 (up
  from 19: the three new presentation-configuration cases), `xlsx-image-render` 3,
  `xlsx-selection-bridge` 5, `xlsx-adapter` 9, `xlsx-bundle` 18, `host-entry` 9 —
  110 passed
- real DSH 0.1.5-rc.1, profile `dsa-smoke`: XLSX 12/1/0; PPTX 10/0/0; DOCX 6/0/0;
  PDF 10/0/0; TextPreview 8/0/0 — no cross-format regression
- XLSX network gates unchanged: parser-asset requests 0, remote requests 0,
  `/dsa-assets` 0, document uploads 0, WASM HTTP 0, worker HTTP 0; the one real
  `blob:` Worker is still observed and its object URL still revoked
- the embedded picture's own object URL is observed in the platform audit:
  created by the controller, alive while the workbook is open, and revoked after
  the resource is switched — read from instrumented
  `URL.createObjectURL`/`revokeObjectURL`

Next:

Task 11B is **not** PASS and Task 11 is still not mergeable. Unblocking it
requires an authorised decision about the fixture: `chart-image.xlsx` must carry
a decodable 64x64 PNG before the frozen colour evidence can pass, and repairing
the fixture is a separate authorised change — this round was instructed not to
modify it, and did not. Task 12 must not start.

- Task 11C — PASS

Repair of the malformed XLSX embedded-image fixture, and re-run of the frozen
Task 11 browser gate. **No production source was modified**: the delta is the
fixture generator, the one regenerated fixture, a new fixture-integrity spec, the
two type declarations that spec needs, and this documentation. Task 11B's public
`renderImage` path, the WASM runtime architecture and the selection architecture
are untouched.

The defect, restated from the bytes: `xl/media/image1.png` in
`chart-image.xlsx` was 227 bytes (SHA-256
`8f66e8cd3d8558e86bc0870a8e21adf9f33126d91fc6dee7071b10ec53ff8ca8`) and
byte-identical to the generator's `SAMPLE_PNG_BASE64` constant. Its `IHDR` parsed
— 64x64, 8-bit RGBA — while its 89-byte `IDAT` stream, behind a valid `78da`
zlib header, did not inflate (`invalid code lengths set` in `node:zlib`). No
renderer could have turned it into pixels, which is why the Task 11A conclusion
that the pinned viewer had a picture defect was withdrawn in 11B and is not
restored here.

**The replacement is generated, not sourced.** `scripts/generate-xlsx-fixtures.mjs`
now exposes `createSolidRgbaPng()` / `createSolidRedPng()` and the picture is
built from exported width, height and pixel constants; the opaque Base64 literal
is gone from the repository, nothing was downloaded, and no dependency was added
for it. The chunk CRC-32 uses a table local to the generator, and the compression
is `node:zlib.deflateSync(raw, { level: 9 })` — a zlib stream, as the PNG
specification requires.

The new picture is a minimal 8-bit RGBA PNG of **155 bytes**, SHA-256
`f41dfec153038c92de8517fde6d06d501233515739f292d70e4e095ad27c6852`, containing
exactly `IHDR`, `IDAT`, `IEND` and no ancillary chunk. Its `IDAT` is 98 bytes and
inflates to exactly **16,448** bytes: 64 rows × 257 bytes (one filter byte of
type 0 plus 64 pixels), every one of the 4,096 pixels `[255, 0, 0, 255]`.

`tests/unit/xlsx-fixtures.spec.ts` (13 cases) reads that media part **out of the
committed workbook** rather than from the generator: signature and exact chunk
path, every chunk CRC-32, the `IHDR` fields, the inflate length, all 4,096
pixels, agreement between `node:zlib` and the `fflate` bundled inside
`@extend-ai/react-xlsx`, byte equality with the generator's output, the drawing
part parsed as XML with both anchors present, the image and chart relationships
still internal, and no external relationship target. The spec was observed **RED
against the unrepaired fixture** — with the generator change temporarily set
aside, so the failure could not come from the new builder — and the three
semantic cases failed with exactly
`the embedded PNG's IDAT stream does not inflate: Error: invalid code lengths set (89 bytes behind a 78da zlib header)`.

Verification on `eval/gemini-3.8-flash-task11-20260918`:

- targeted suites: `xlsx-fixtures` 13, `xlsx-image-render` 3, `xlsx-renderer` 22,
  `xlsx-wasm` 14, `xlsx-security` 30, `xlsx-bundle` 18 — 100 passed
- `pnpm test`: PASS (958 tests over 55 files, up from 945)
- `pnpm typecheck`: PASS, `pnpm build`: PASS, `npm pack --dry-run`: PASS (88
  files; no XLSX fixture and no smoke fixture in the tarball),
  `git diff --check`: PASS
- `lib/client.js` is byte-identical before and after the round
  (`72dde6ffe6709071fd94a567ef7e90f58fd4a9e676adcf3adb1aa46f729e4521`,
  16,314,168 bytes) and so is `lib/index.mjs`
  (`fac72b86168e002cb6dd2939c1775cad0d149afb24c4c2264b1110b079a60f39`, 2,256
  bytes): the repair changes no production or build input
- `git diff --name-only tests/fixtures/xlsx` names **only**
  `tests/fixtures/xlsx/chart-image.xlsx`; the other five fixtures are
  byte-identical to their committed state (SHA-256 compared before and after the
  targeted regeneration, and no full regeneration was run)
- real DSH 0.1.5-rc.1, profile `dsa-smoke`: **XLSX 13 passed / 0 failed / 0
  skipped** — the same case that failed in 11A and 11B is now green, on the same
  assertions: PPTX 10/0/0, DOCX 6/0/0, PDF 10/0/0, TextPreview 8/0/0

Case 6's picture evidence, read from the live page rather than from the fixture:
the node is published (`count` 1) with a `blob:` source the controller allocated
exactly once, `complete: true`, natural 64x64, laid out in a 64x64 box at
924,121, visible, `draggable="false"`, positioned by the viewer's own box. The
platform audit shows the picture blob at **155 bytes** carrying SHA-256
`f41dfec1…`, `createImageBitmap` returns 64x64, and drawing the decoded node into
a canvas yields **4,096 of 4,096** red pixels. The chart is asserted separately
and unchanged: `<svg role="img" aria-label="Chart 1">` with positive dimensions,
≥2 fills and ≥4 gridlines. Case 6a's control still reports zero image nodes and
zero red pixels for `simple.xlsx`, and 6b still shows the controller's own object
URL released when the resource is switched.

One attribution note, recorded because it cost a run: the first execution of this
round's browser gate read the **stale fixture copy** in the original checkout's
gitignored `smoke-fixtures/`, which the smoke session's workspace root resolves
against, and case 6 failed with the same `InvalidStateError` as before — for the
old bytes, not the new ones. After that copy was refreshed with the regenerated
fixture (a gitignored local artifact; the original checkout's HEAD and working
tree are untouched), the case passed. A browser run of this suite is only
evidence about the fixture the session actually serves.

The correct statement of what this round establishes: the fixture's malformed PNG
was replaced by a deterministic, valid 64×64 RGBA PNG. The previously authorised
public `renderImage` compatibility path remains in place and now passes the full
image-decoding and visual-fidelity gate. It is **not** established — and is not
claimed — that the pinned viewer ever had a missing-picture defect.

Next:

Task 11C is PASS and Task 11 is a **PASS candidate**. PR #4 stays a draft and
Task 12 must not start; whether Task 11 merges is an external review decision.

- Task 12 — `1283d928b099306c6ea193d13024f91757429a5b`

Unified registration, locale, cleanup and renderer-fallback behaviour. Task 11
merged as `c799ad8a72ba257c0813b9c140ccd5f118bbba5c`, which is the baseline this
round was cut from and the only baseline it used.

**One top-level registration owner.** `src/client/index.tsx` now makes the
plugin's single `ctx.effect` call, and its body is `applyClient(ctx)`: the call
returns one local runtime and the effect returns that runtime's `dispose`.
`applyClient` itself calls `ctx.effect` nowhere, so the plugin's top-level effect
count is 1 and no longer grows with the number of contributions. A source gate in
`tests/client/renderer-registration.client.spec.tsx` asserts that `src/client`
contains `ctx.effect(` in exactly one file, and the behaviour suite asserts the
label and the count against a DSH-shaped fake context.

**The Ask slot contributions are owned now.** Both were made with the disposer
`slots.inject` returned thrown away, so a plugin unload left
`shell.overlay#dsh-document-selection-ask:surface` and
`conversation.input.overlay#dsh-document-selection-ask:composer-target` live.
Task 12 registers every contribution with the runtime's `Disposer`, and the new
suite observes the leak it closes: cycle 1 leaves 5 preview definitions, 6 slot
entries and 5 style nodes, dispose removes all of them, cycle 2 installs exactly
one set again with no duplicate id, key or style tag.

**Failure is all-or-nothing.** The two services the client half injects through
are validated before anything is registered, and a registration that throws
part-way releases everything registered before it. The original failure stays
primary: a cleanup that also fails is reported as an `AggregateError` whose
`errors[0]` and `cause` are the registration failure, so a renderer that failed
to install cannot be reported as a cleanup problem.

**One selection lifetime.** `installSelectionLifecycle` composes the browser
lifecycle, the XLSX semantic subscription and resource-scoped invalidation into
one coordinator that owns the kernel and the feedback slot.
`invalidateResource(address)` clears a snapshot only when the snapshot's own
`resourceAddress` matches, which is what keeps a renderer for file A — unmounted
after the reader has already selected in file B — from taking B's snapshot with
it. The renderers publish only "this resource's selectable lifetime ended"
through an injected callback; none of them knows the kernel. `refreshBrowser()`
remains the separate answer to invalidated *geometry* (a re-rendered PDF page, a
recycled PPTX slide), where the live browser selection may still be valid and a
clear would be wrong.

**Locale.** `SelectionStrings` carries the six contract keys in both languages,
still written as `\u` escapes: `ask`, `selectionTooLarge`, `tooManyCells`,
`rendererFailed`, `noSelectableText`, `loading`. `too-many-cells` is now a
reported refusal with its own wording rather than a silent one, so a 201-cell
range no longer reads as a dead button — and it does not borrow the character
limit's sentence. Generic renderer loading and failure copy now comes from the
table; worker, WASM-integrity, engine-unavailable, file-too-large and
missing-bytes wording keeps its specific diagnosis, because collapsing any of
them into "could not be displayed" would drop the security meaning. The Ask
notice resolves its copy from the button's document with the ambient document as
the fallback, which fixed a real defect the new locale case found: a refusal in
an English document rendered its notice in Chinese whenever no button was
visible.

**Renderer registration.** `registerPdfRenderer`, `registerDocxRenderer`,
`registerPptxRenderer` and `registerXlsxRenderer` take a resolved
`RendererRegistrationHost` and return one idempotent disposer aggregating the
definition, the keyed body and the style sheet. None of them reads a context or
registers an effect, so a missing service now fails the runtime's own validation
instead of logging `console.error` and returning `false` into a half-installed
plugin. The four definitions are unchanged: ids
`dsh-document-selection-ask/{xlsx,pdf,docx,pptx}`, `priority: 'extension'`,
`loading: 'bytes-complete'`, `wrap: false`, extensions `xlsx`, `pdf`, `docx`,
`pptx`. No replacement renderer exists for a builtin text class, and no automatic
fallback to the builtin renderer was added: a parse failure, an OOXML refusal or
a WASM integrity failure still fails closed.

## Current gate

### Task 15R — final release-tooling and packaged-documentation closure (this round)

Everything below was run in the Task 15 worktree on `2026-09-20`, on Windows 11,
Node `v24.13.0`, pnpm `11.7.0`, against the installed DSH `0.1.5-rc.2`, one round
after Task 15's freeze. Task 15's own commits are not amended: `71398df` and
`bb44b78` are still in history, `git diff f862a05d -- src` is empty, and the runtime
bundles are byte-identical to the Task 14 build.

```text
FINAL_FREEZE_HEAD = fd36651d876ddff85d5253cdf47d2f1fb56966a6
FINAL_FREEZE_STATUS = clean
ACTIVE_SUBAGENTS = 0
```

`fd36651` is the round's release-tooling commit, `fix: harden release package
verification`; it carries the verifier change and the two packaged-document
corrections, and the working tree was clean at that commit. The record commit that
follows it touches only `docs/STATUS.md` and `docs/testing.md`, neither of which is
in the package `files` allowlist, so nothing the tarball carries changes after the
freeze. `71398df` and `bb44b78` are not amended and no commit is force-pushed.

**Why the round exists.** Task 15's evaluation found two defects in its release
surface. Neither is a runtime defect: one is in the packaged prose and one is in the
release verifier, which is why this round touches `README.md`,
`THIRD_PARTY_NOTICES.md`, `scripts/verify-package.mjs`, `docs/STATUS.md` and the
`verify:package` paragraph of `docs/testing.md`, and nothing else.

**1. The packaged README documented an uninstall procedure that is not reliable.**
Task 15's `README.md` said `dsh plugin --profile <name> remove
dsh-document-selection-ask` removes the package and that "依赖移除后该包名会同时从
`dsh.profile.bundles` 中移除". The behaviour was re-measured on six fresh throwaway
profiles before any wording was chosen, and the sentence is not safe as a promise:

```text
dsh plugin --profile p remove dsh-document-selection-ask   (six fresh profiles)
  5 runs   returned in 0.89–0.97 s, exit 0, package removed from dependencies AND
           from dsh.profile.bundles
  1 run    never returned; killed at 180 s. pnpm had already printed
           "Done in 631ms" and had already rewritten dependencies, but BOTH the pnpm
           process and the dsh launcher were still alive more than three minutes
           later, so reconcilePlugins — which the launcher runs only after its
           spawnSync returns — never ran and dsh.profile.bundles kept the entry
```

The failure is not recoverable with the same command. A second `remove` on that
profile exits non-zero with `ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS`, which skips the
reconciliation again, and the profile then fails to boot: `dsh --profile <p>
--dump-config` exits with `dsh: cannot resolve profile bundle
"dsh-document-selection-ask"`. Running `pnpm remove` directly in the profile
directory is not a substitute: it exits 0 in 0.9 s but leaves `dsh.profile.bundles`
untouched, because reconciliation belongs to the launcher rather than to pnpm.
`dsh --help` on `0.1.5-rc.2` lists only `web` and `plugin`, so there is no other
public profile-lifecycle command to try, and this round did not fall back to editing
the profile manifest or removing directories from the profile's `node_modules` to
manufacture a success.

The packaged README therefore no longer presents `remove` as a verified uninstall
procedure. It states what was measured, says that this project does not rely on the
command, recommends a disposable profile for release-candidate testing (whose
directory can simply be deleted afterwards), and says explicitly that the
observation is about this validation environment and is not a claim about other DSH
versions or platforms. No manual edit of `dsh.profile.bundles` or of a profile
`package.json` is documented anywhere, and the DSH behaviour is not described as a
defect of this plugin.

**2. `scripts/verify-package.mjs` extracted before it had decided the archive was
safe.** The old order was: read the tar index, record layout findings, record
unrecognized-type findings, and then call `tar -xzf` regardless of what those
findings said. That is not the file's own stated "bounded and self-cleaning"
contract, and its member-path check was a raw `startsWith("package/")` prefix test,
which `package/../../outside` and `package/foo/../../../outside` both satisfy.

The verifier now has a hard pre-extraction gate. Every member is checked for an
empty name, a NUL inside the name field, an absolute POSIX path, a drive-rooted
path, a backslash, `.` and `..` components, empty components, and a POSIX
normalisation that leaves `package/`; only regular files and directories are
accepted, so symlinks, hard links, device nodes, FIFOs and unknown type flags fail.
`extract()` is called only when all three preflight checks pass, and the safety
decision is made from the tar index inside this process rather than delegated to
`tar` — "the platform tool would probably refuse it" is not an implementation of the
contract. When the gate fails no temporary directory is created at all, and each
check that needs an extraction prints its own
`extraction was not attempted because archive preflight failed` verdict instead of
disappearing from the report. Every run prints `extractor invocations = N`.

**Negative proofs.** Seven throwaway archives, synthesised header by header in a
harness outside the repository so that no platform `tar` was asked to create the
shapes under test; the official tarball was never modified. Extractor invocation is
evidenced three independent ways: the verifier's own `extractor invocations` line, a
preload that patched `child_process.spawnSync` inside the verifier process and
appended to a marker file on any `tar` call, and a stub `tar.exe` first on `PATH`.

```text
P1  official tarball                       exit 0  marker PRESENT  extractor invocations = 1
P2  member evil.txt outside package/       exit 1  marker absent   extractor invocations = 0
P3  package/../../escape.txt               exit 1  marker absent   extractor invocations = 0
P4  package/foo/../../../escape.txt        exit 1  marker absent   extractor invocations = 0
P5  package/link type = symlink            exit 1  marker absent   extractor invocations = 0
P6  package/hardlink type = hardlink       exit 1  marker absent   extractor invocations = 0
P7  not a gzip stream                      exit 1  marker absent   extractor invocations = 0
P7b valid gzip, truncated tar, no end marker exit 1 marker absent extractor invocations = 0
```

P2 fails `archive layout`, P3 and P4 fail `entry path safety` naming the `..`
component, P5 and P6 fail `entry types` naming the link kind, P7 fails
`archive layout` with `could not be read as a gzipped tar`, and P7b fails
`archive layout` with `no end-of-archive marker`. For P2–P7b the report contains no
`tar exited with` and no `bad option`, so the extractor was not reached; no
`dsa-verify-package-*` directory was left behind by any case; no `escape.txt`
appeared in the canary or stage directory; and no stack trace was printed. The
harness exits 0 only when all eight cases hold.

One defect in a packaged document was found by the new gate rather than by a human,
before the fix: `THIRD_PARTY_NOTICES.md:457 carries drive-rooted path "C:/"`.

**3. A machine-local absolute path in the packaged notices.** The CJK fixture-font
provenance row recorded `C:/Windows/Fonts/Noto Sans SC (TrueType).otf`. The font is
a test fixture input rather than a runtime dependency, but the release contract says
packaged documents carry no machine-local absolute path, and how a fixture was
produced is not a fact a redistributor needs an absolute path for. The row now
describes the source without the machine path and keeps every legal and provenance
fact: family, license, license URL, copyright, the `OS/2.fsType` embedding
permission and the committed artifact. `tests/fixtures/pdf/cjk.pdf` was not
regenerated and no license attribution was reduced.

`scripts/verify-package.mjs` gained a narrow `packaged text paths` check for the
same class of defect, scanning `README.md`, `THIRD_PARTY_NOTICES.md` and `docs/*.md`
from bytes read out of the tarball before extraction. Its two patterns are
drive-rooted paths and `/home/<user>/`-style paths, both with a negative lookbehind
so a URL scheme (`https://`) and a URL path segment do not match. A manual grep with
the same patterns over all seven packaged prose and configuration files reports
**0 hits**, and `C:\Users`, `/home/<user>` and the development worktree path are
absent from every packaged file.

**Final tarball.** `README.md` and `THIRD_PARTY_NOTICES.md` are package surface, so
Task 15's `BB2AB1A0…` artifact is no longer the candidate and was regenerated.

| Item | Task 15 | Task 15R |
| --- | --- | --- |
| SHA-256 | `BB2AB1A0048719A6F416BF00AA75A53DF3410ED110D719350DE5437F748E07F8` | `A5CC50124453E5E0F17DB3E20F465C5167D649980CFD087AABD5A03CCCA53A35` |
| Compressed | 6,393,222 bytes | 6,393,879 bytes |
| Unpacked | 16,688,796 bytes | 16,691,021 bytes |
| Entries | 92 (82 `.d.ts`) | 92 (82 `.d.ts`) |

Two consecutive `pnpm pack` runs after the freeze produce the same SHA-256, so the
artifact is still bit-reproducible, and the delta is the prose growth the round
intends. Side PDF worker and XLSX WASM/worker files remain absent, `tests/`,
fixtures and reports remain absent, and `verify:package` reports **12 checks PASS,
`extractor invocations = 1`**.

**Static matrix, frozen commit.**

```text
pnpm install --frozen-lockfile   PASS (lockfile unchanged)
pnpm check:dsh-contracts         PASS — pin 0.1.5-rc.2, probes compile, PATH CLI 0.1.5-rc.2
pnpm dsh:doctor -- --runtime     PASS — contract environment is consistent
pnpm typecheck                   PASS
pnpm test                        PASS — 58 files, 1052 tests, 0 failed
pnpm build                       PASS
pnpm verify                      PASS — 13/13 heuristic rules
npm pack --dry-run               92 entries, no forbidden shape
pnpm verify:package              PASS — 12 checks on the final tarball
git diff --check                 clean
```

**Build identity.** After the full rebuild: `lib/client.js` 16,331,628 bytes SHA-256
`735F8B77EC0B899F9740A8C0591AB7FE0A294C9D5F185A69A9B4A8F7134A183D` and
`lib/index.mjs` SHA-256
`FAC72B86168E002CB6DD2939C1775CAD0D149AFB24C4C2264B1110B079A60F39` — both equal to
the Task 15 values, so this round changed no runtime byte.

**Final-tarball installation.** The new `.tgz` was installed into a disposable
profile created in this round, `dsa-release-t15r`, initialized from the shipped web
template and never used for anything else:

```text
dsh --profile dsa-release-t15r --from-default-profile web --dump-config   initialized, not booted
dsh plugin --profile dsa-release-t15r add <final tgz>                     exit 0 in 2.4 s
installed path   C:\Users\<user>\.dsh\profiles\dsa-release-t15r\node_modules\dsh-document-selection-ask
```

The installed tree is a real directory; its entries are pnpm store hard links and
**no link anywhere inside it points at the repository**. `lib/client.js` and
`lib/index.mjs` hashes match the final worktree exactly, the installed `README.md`
carries the corrected uninstall text, and the installed `THIRD_PARTY_NOTICES.md`
carries neither a drive-rooted nor a home-directory path. The instance booted on
port 50041 with an empty error stream.

**Targeted browser smoke after the final reinstall.** The runtime bundle, the
browser specs and the DSH runtime are all unchanged, so Task 15's 63/0/0 required
matrix, its full 70/0/0 run and its manual eight-format acceptance remain valid
evidence for this artifact. To close the *new final tgz → install → real browser*
loop, three suites were re-run against the instance installed from the final
tarball (`--workers=1`):

| Suite | Required | Measured |
| --- | --- | --- |
| `universal-selection.spec.ts` | 10 / 0 / 0 | 10 / 0 / 0 |
| `xlsx-selection.spec.ts` | 13 / 0 / 0 | 13 / 0 / 0 |
| `pdf-renderer.spec.ts` | 10 / 0 / 0 | 10 / 0 / 0 |
| **total** | **33 / 0 / 0** | **33 / 0 / 0** |

`33 passed (8.1m)`, zero failed and zero skipped.

**Fresh checkout.** A clone of the frozen commit outside the repository, with no
`lib/` and no driver build, reached the documented sequence without manual
preparation.

```text
pnpm install --frozen-lockfile    PASS
pnpm test                         PASS — 58 files, 1052 tests
pnpm typecheck                    PASS
pnpm build                        PASS — lib/client.js 735F8B77…, lib/index.mjs FAC72B86…
pnpm verify                       PASS — 13/13
npm pack --dry-run                92 entries, same as the worktree
```

The fresh checkout had no dependency on the original development worktree. Its only
intentional external compatibility input was the explicitly selected DSH
`0.1.5-rc.2` runtime installation supplied through `DSH_INSTALL_NODE_MODULES`. No
checkout file was modified to fit the machine.

**Commits.**

```text
fd36651  fix: harden release package verification
         scripts/verify-package.mjs, README.md, THIRD_PARTY_NOTICES.md
followed by  docs: close task 15 release audit
         docs/STATUS.md, docs/testing.md
```

The record commit's own hash is not written here because a file cannot contain the
hash of the commit that introduces it.

**What this round did not do.** No `src/**` change, no dependency-graph change, no
lockfile change, no `tests/browser/**` change, no build-configuration change, no tag,
no `npm publish`, no GitHub Release, and no merge of the evaluation PR. `remove`
reliability is recorded as an observed DSH tooling behaviour rather than as a
release blocker, because installation and operation in a disposable profile are
verified independently and the packaged README no longer misleads a reader about it.

### Task 15 — final packaging, tarball installation and release verification

Everything below was run in the Task 15 worktree on `2026-09-20`, on Windows 11,
Node `v24.13.0`, pnpm `11.7.0`, against the installed DSH `0.1.5-rc.2`.

```text
FINAL_FREEZE_HEAD = 71398dfca5c33c772bd64b4d632720f1bef40d8d
FINAL_FREEZE_STATUS = clean
ACTIVE_SUBAGENTS = 0
```

The freeze commit is the round's release-candidate commit
`release: prepare universal document selection plugin`. `docs/STATUS.md` is not in
the package `files` allowlist, so the record commit that follows it changes nothing
the tarball carries; no other file is touched after the freeze.

**Static matrix, frozen commit.**

```text
pnpm install --frozen-lockfile   PASS (lockfile unchanged)
pnpm check:dsh-contracts         PASS — pin 0.1.5-rc.2, probes compile, PATH CLI reported
pnpm dsh:doctor -- --runtime     PASS (same implementation as the checker)
pnpm typecheck                   PASS
pnpm test                        PASS — 58 files, 1052 tests, 0 failed
pnpm build                       PASS
pnpm verify                      PASS — 13/13 heuristic rules (R13 is the round's new packaging rule)
pnpm verify:package              PASS — 9 checks on the real tarball
npm pack --dry-run               92 entries, no forbidden shape
git diff --check                 clean
```

**Production delta.** `git diff f862a05d 71398df -- src` is empty. The built
artifacts equal the Task 14 build: `lib/client.js` 16,331,628 bytes, SHA-256
`735F8B77EC0B899F9740A8C0591AB7FE0A294C9D5F185A69A9B4A8F7134A183D`;
`lib/index.mjs` SHA-256
`FAC72B86168E002CB6DD2939C1775CAD0D149AFB24C4C2264B1110B079A60F39`. Two
consecutive builds in the same environment produced identical hashes.

**Tarball.**

| Item | Value |
| --- | --- |
| Filename | `dsh-document-selection-ask-0.1.0.tgz` |
| SHA-256 | `BB2AB1A0048719A6F416BF00AA75A53DF3410ED110D719350DE5437F748E07F8` |
| Compressed size | 6,393,222 bytes |
| Unpacked size | 16,688,796 bytes (92 entries, 82 of them `.d.ts`) |
| `lib/client.js` inside the tarball | 16,331,628 bytes, SHA-256 `735F8B77…` (identical to the build) |
| Reproducibility | two consecutive `pnpm pack` runs are **bit-identical** (same SHA-256), not merely same file list |
| Side PDF worker file | absent — the worker source is embedded in `lib/client.js` |
| Side XLSX `.wasm` / worker file | absent — the gzip payload and the worker source are embedded in `lib/client.js` |
| `tests/`, fixtures, reports, coverage, `.git/`, `node_modules/` | absent |
| Screenshots, logs, credentials, absolute machine paths | absent |
| Shipped docs | `docs/renderer-support.md`, `docs/security.md`, `docs/compatibility.md` |

**Tarball independence.** The plugin was installed from the packed `.tgz` into the
disposable profile, not from a link:

```text
dsh --profile dsa-release-t15 --from-default-profile web        profile initialized from the shipped template
dsh plugin --profile dsa-release-t15 add <tgz>                  forwards to pnpm in the profile directory, then reconciles dsh.profile.bundles itself
installed path   C:\Users\<user>\.dsh\profiles\dsa-release-t15\node_modules\dsh-document-selection-ask
```

The installed tree is a real directory inside the profile, not a junction, and it
does not point at any worktree. Its 92 files, its `lib/client.js` hash and its
`package.json` identity all match the tarball. The test-only smoke driver is the
only repository-side input, and it is linked into that profile's own
`node_modules` rather than into the shared tree. A `remove` + `add` cycle from the
tarball was also run: removal took the package out of both `dependencies` and
`dsh.profile.bundles`, and the reinstall put it back and loaded it.

**Automated rc.2 browser matrix, required seven suites, `--workers=1`, against the
tarball-installed plugin** (port 50031, profile `dsa-release-t15`):

| Suite | Required | Measured |
| --- | --- | --- |
| `universal-selection.spec.ts` | >= 10 / 0 / 0 | 10 / 0 / 0 |
| `resource-cleanup.spec.ts` | >= 6 / 0 / 0 | 6 / 0 / 0 |
| `xlsx-selection.spec.ts` | >= 13 / 0 / 0 | 13 / 0 / 0 |
| `pptx-selection.spec.ts` | 10 / 0 / 0 | 10 / 0 / 0 |
| `docx-selection.spec.ts` | 6 / 0 / 0 | 6 / 0 / 0 |
| `pdf-renderer.spec.ts` | 10 / 0 / 0 | 10 / 0 / 0 |
| `real-dsh-textpreview.spec.ts` | 8 / 0 / 0 | 8 / 0 / 0 |
| **total required** | **63 / 0 / 0** | **63 / 0 / 0** |

`pnpm test:browser` — the full suite, including the eighth spec `ask-flow.spec.ts` —
reported **70 passed, 0 failed, 0 skipped**. The eight format/provenance cases and
the draft-preservation and zero-auto-submit assertions all passed against the
tarball-installed plugin, including the sentinel-draft cases in
`universal-selection.spec.ts`. After the reinstall from the final tarball, three
representative suites (`pdf-renderer`, `docx-selection`, `pptx-selection`) were
re-run: 26 passed, 0 failed.

**Manual acceptance, executed against the tarball-installed plugin.** Sections 6
and 7 of `docs/manual-acceptance.md` (eight formats, exact provenance, sentinel
draft preserved, one appended quote block, no auto-submit) are the
`universal-selection.spec.ts` cases above, which drive the same real preview with
real gestures; the remaining sections were executed directly and observed:

```text
text                  PASS   (universal-selection: exact line provenance, sentinel preserved, zero submits)
markdown              PASS   (file-only provenance, no fabricated source line)
code                  PASS   (exact line provenance)
csv                   PASS   (plain-renderer line provenance, no spreadsheet semantics)
pdf                   PASS   (page provenance)
docx                  PASS   (rendered-page provenance)
pptx                  PASS   (slide provenance)
xlsx                  PASS   (semantic range provenance)
draft-preserve        PASS   (sentinel at offset 0 in every case, one quote block appended)
auto-submit-zero      PASS   (submit observer counted 0 in every case)
renderer-selector     PASS   menu = ["PDF · Selectable", "PDF", "纯文本"]; switching to the builtin
                             dropped the plugin root (label "PDF", canvas still drawn) and switching
                             back restored "PDF · Selectable"
disable/restore       PASS   --patch overlay: plugin root 0, no plugin Ask, menu = ["PDF", "纯文本"],
                             builtin canvas drawn; after removing the overlay and restarting:
                             plugin root present, "PDF · Selectable" back in the menu
rapid-close           PASS   large PPTX (120 slides) and large XLSX cut mid-load: 0 stale Ask,
                             0 late DOM, sentinel draft intact
console-clean         PASS   0 error-level console entries and 0 page errors in the main run;
                             0 in the disabled run; 0 in the restored run
network-local         PASS   105 requests in the main run and 36 in each of the other two, all to
                             the instance origin; 0 cross-origin; 0 requests matching
                             pdf.worker / *.bcmap / standard_fonts / duke_sheets / dsa-assets / xlsx-worker
```

**Fresh checkout.** A clone of the frozen commit into a directory outside the
repository, with no `lib/` and no driver build, reached the documented sequence
without any manual preparation:

```text
pnpm install --frozen-lockfile    PASS
pnpm test                         PASS — 58 files, 1052 tests (the Vitest global setup builds both bundles)
pnpm typecheck                    PASS
pnpm check:dsh-contracts          PASS with DSH_INSTALL_NODE_MODULES=<rc.2 install>;
                                  PATH CLI report = NOT PROBED (explicit override)
pnpm build                        PASS — lib/client.js 735F8B77…, lib/index.mjs FAC72B86…, identical to the worktree
pnpm verify                       PASS — 13/13
npm pack --dry-run                92 entries, same as the worktree
```

The fresh checkout had no dependency on the original development worktree. Its only
intentional external compatibility input was the explicitly selected DSH
`0.1.5-rc.2` runtime installation supplied through `DSH_INSTALL_NODE_MODULES`. No
checkout file was modified to fit the machine.

**Round findings that changed a file.**

- `tests/setup/build-artifacts.ts`: the Vitest global setup now builds the test-only
  smoke driver as well as the shipping artifacts. The fresh-checkout gate found that
  `pnpm install && pnpm test` failed on a clean clone because
  `tests/unit/smoke-profile.spec.ts:145-148` asserts the driver's two declared entry
  points exist on disk and only `pnpm build` ran. The fix builds both rather than
  weakening the assertion. `src/**` is untouched and both artifacts remain
  byte-identical.
- `scripts/verify-package.mjs`: the three checks that depend on the shipped manifest
  now print a FAIL verdict when that manifest cannot be parsed, instead of printing
  nothing; the file's own contract says a check that cannot run is a failure rather
  than a skip. Its forbidden shapes also name the side worker/asset files
  (`pdf.worker.*`, `xlsx-worker.*`, `*.bcmap`, `*.pfb`, `*.map`), which
  `scripts/verify.mjs` R13 already rejected in the allowlist.
- Documentation line references to `scripts/verify.mjs` and
  `scripts/verify-package.mjs` were re-anchored after those files changed, and four
  citations in `docs/security.md` were corrected against the sources they name
  (the XLSX spec assertion lines, the preview-root selector line, the measured
  artifact-size attribution, and the preflight rejection order, which validates the
  entry count before the per-entry pass rather than after it).

**An independent read-only adversarial audit of the release-candidate commit was
run before this record.** It re-derived the tarball contents, the shipped-library
set, the notices' quantitative claims and the security document's statements from
the sources and the installed packages, and found no blocking defect. Its findings
are the three bullet points above; the two script-level ones and the citation
corrections were closed before the freeze, and the audit's report is summarized
here rather than quoted.


- Task 14 contract migration — baseline pins `0.1.5-rc.1`, runtime `0.1.5-rc.2`,
  `pnpm dsh:doctor -- --runtime` **FAIL** with "installed DSH is 0.1.5-rc.2 while
  the contract packages pin 0.1.5-rc.1" (this is the divergence the round exists to
  close). Every rc.2 package was proved resolvable before any file was touched:
  `pnpm view @deepseek-ai/<package>@0.1.5-rc.2 version` returned `0.1.5-rc.2` for
  all nine. After the migration: pins `0.1.5-rc.2`, runtime `0.1.5-rc.2`,
  `pnpm typecheck` PASS, `pnpm dsh:doctor -- --runtime` PASS,
  `pnpm check:dsh-contracts` PASS
- Task 14 compile contract — `tests/compatibility/contracts.compile.ts` and
  `tests/compatibility/smoke-driver.contracts.compile.ts` both compile against the
  installed `0.1.5-rc.2` declarations under `tsconfig.client.json`, whose
  `include` covers `tests/**/*.ts`. No `any`, no `as`, no `@ts-ignore`, no
  `@ts-expect-error`, no private `@deepseek-ai/.../src/...` import and no copied
  DSH interface was added; the only edits to those two probes are the historical
  rc.1 → rc.2 baseline note in the smoke-driver probe's doc comment
- Task 14 contract checker — `scripts/check-dsh-contracts.mjs`, wired as
  `pnpm check:dsh-contracts`. It reports the contract release pin, every
  `package.json` that declares a pin together with declared and installed
  versions, the current DSH runtime, the runtime's `sidebar-documentpreview`
  version, the installed `pdfjs-dist` version and the Node version, then compiles
  the probes and sets a non-zero exit code for any inconsistency. Runtime
  discovery is `DSH_INSTALL_NODE_MODULES`, exclusive when set: the override is
  the only authority, the `dsh` CLI on `PATH` is not probed at all in that mode,
  and there is no fallback to `PATH`, `DSH_HOME` or the home `node_modules`. With
  no override the routes are the `dsh` CLI on `PATH` — whose own version command
  is executed and whose output shape is validated rather than assumed — then the
  public `DSH_HOME` layout. It performs
  no registry query, no download, no install and no file write; the compile step
  invokes the project's own TypeScript binary directly rather than through the
  package manager, so it cannot make the package manager decide to install
- Task 14 negative proofs — seven, plus the three Task 14R added (P7–P9), on
  throwaway copies and environment overrides, with the positive worktree never
  edited to manufacture a failure:
  - P1 current rc.2: `pnpm check:dsh-contracts` **PASS** (exit 0)
  - P2 a real rc.1 installation (`@deepseek-ai/dsh@0.1.5-rc.1`, installed into a
    throwaway directory outside the repository) named through
    `DSH_INSTALL_NODE_MODULES`, with an rc.2 launcher first on `PATH`: **FAIL**,
    exit 1, "runtime version mismatch: the installed DSH is 0.1.5-rc.1 while the
    contract packages pin 0.1.5-rc.2". The failure is the override against the
    contract pin and nothing else, which is the point of the re-attribution: the
    report contains no `PATH` problem line, because the machine's rc.2 CLI was
    never probed, and the launcher stub on `PATH` left no marker file. Task 14
    credited a second problem line to a `PATH`/override comparison; that
    comparison was itself the defect, and it no longer happens. A throwaway
    override pointing at a directory with no DSH at all still fails loudly
    instead of falling back
  - P3 one declared pin mutated to `0.1.5-rc.1` in a throwaway copy: **FAIL**,
    exit 1 — "do not pin one DSH release: 0.1.5-rc.1, 0.1.5-rc.2" plus the
    declared/installed mismatch for that package
  - P4 one installed contract package removed from a throwaway `node_modules`:
    **FAIL**, exit 1 — "declared at 0.1.5-rc.2 but absent from node_modules"
  - P4b one installed contract package replaced by a manifest at `0.1.5-rc.1`:
    **FAIL**, exit 1 — "installed at 0.1.5-rc.1, declared at 0.1.5-rc.2"
  - P5 a real contract violation introduced into a throwaway copy of
    `tests/compatibility/contracts.compile.ts` (`SlotMap['shell.overlay']['kind']`
    given `'panel'`): **FAIL**, exit 1, with the compiler's own
    `error TS2322: Type '"panel"' is not assignable to type '"list"'`
  - P6 a `dsh` launcher placed on `PATH` that exits 3 instead of reporting a
    version, with no override set: **FAIL**, exit 1 — "a `dsh` launcher is on PATH
    but `dsh --version` exited 3". The launcher's presence is what makes its
    failure load-bearing, so it is not downgraded to a note; the healthy route
    still reports PASS. Task 14R re-ran this proof and added the execution
    evidence: the stub's marker file **was** written, so the default route really
    does probe `PATH` — the contrast with P7 and P8 is what makes their absent
    markers meaningful
  - P7 (Task 14R) a valid rc.2 override — the machine's own installation
    (`…\Roaming\npm\node_modules`, holding `@deepseek-ai/dsh@0.1.5-rc.2`) — with a
    deliberately broken `dsh.cmd` first on `PATH` that writes a marker file and
    exits 7: **PASS**, exit 0, compile step included. The marker file was absent,
    the report printed `PATH CLI report = NOT PROBED (explicit override)` and
    carried no `PATH` problem. The same environment run against the pre-fix
    script extracted from `HEAD`: **FAIL**, exit 1, "a `dsh` launcher is on PATH
    but `dsh --version` exited 7", marker written — the defect and its correction
    shown against one another
  - P8 (Task 14R) an rc.2 override with an rc.1 launcher first on `PATH` (the stub
    prints `0.1.5-rc.1` and exits 0, confirmed by running it directly): **PASS**,
    exit 0, compile step included. The override is an explicit authority, so no
    `PATH` runtime mismatch is reported. The pre-fix script on the same
    environment: **FAIL**, exit 1, "the `dsh` on PATH reports 0.1.5-rc.1 while …
    holds 0.1.5-rc.2; the compared installation is not the one this machine
    runs", with the stub's marker written
  - P9 (Task 14R) an override pointing at an empty directory — not a
    `node_modules`, holding no `@deepseek-ai/dsh` — with a valid rc.2 launcher
    first on `PATH`: **FAIL**, exit 1 — "the DSH_INSTALL_NODE_MODULES override
    points at a directory holding no @deepseek-ai/dsh package.json (tried …); the
    override is exclusive, so no other location is consulted". The rc.2 launcher
    was not executed (no marker), no fallback PASS was produced, and the override
    error is the only problem reported: the reverse proof of exclusivity
  - P7–P9 share one construction, so their results are comparable: one stub
    directory prepended to `PATH`, one `DSH_INSTALL_NODE_MODULES` value, and the
    gate run in the positive worktree. No throwaway copy of the repository was
    needed, because these proofs change the environment rather than the tree. The
    marker file is the observable probe — it is written by the stub launcher
    itself, so its absence is evidence that `dsh --version` was never executed,
    not merely that its result was discarded
  - the checker also fired on a real defect rather than a synthesised one: with
    the smoke driver's manifest still at rc.1 it reported
    "tests/browser/smoke-driver/package.json: @deepseek-ai/dsh-client-ui-sidebar-right
    installed at 0.1.5-rc.2, declared at 0.1.5-rc.1"
- Task 14 dsh-doctor consistency — `pnpm dsh:doctor -- --runtime` and
  `pnpm check:dsh-contracts` now share one implementation, so they cannot report
  contradictory conclusions about the contract pin or the runtime release. The
  doctor keeps its documented semantics (an absent installation is a note, and a
  failure with `--runtime`), and the checker requires the installation to be
  found
  - Task 14R extended this to the override semantics rather than duplicating them
    in the doctor: `DSH_INSTALL_NODE_MODULES=<valid rc.2> pnpm dsh:doctor --
    --runtime` **PASS** (exit 0) both with the broken launcher first on `PATH` and
    with the rc.1 launcher first on `PATH`, printing the same
    `runtime discovery = DSH_INSTALL_NODE_MODULES override` and
    `PATH CLI report = NOT PROBED (explicit override)` lines the checker prints,
    with neither stub's marker written. `scripts/dsh-doctor.mjs` gained only two
    reporting lines reading the shared state; the decision is still imported from
    `inspectContractEnvironment()`, and no second copy of the discovery logic
    exists. In the default no-override mode the doctor and the checker both still
    probe `PATH`
- Task 14 primary rc.2 browser matrix — re-run on the rc.2-pinned checkout against
  real DSH `0.1.5-rc.2`, profile `dsa-smoke`, `DSH_SMOKE_URL` non-empty,
  `--workers=1`: universal selection **10 / 0 / 0**, resource cleanup **6 / 0 / 0**,
  XLSX **13 / 0 / 0**, PPTX **10 / 0 / 0**, DOCX **6 / 0 / 0**, PDF **10 / 0 / 0**,
  TextPreview **8 / 0 / 0** — **63 passed, 0 failed, 0 skipped**, in 15.4 minutes.
  The round changed the DSH compile/test dependency baseline, so this re-run is the
  regression gate; every suite and every case is the one Task 13 added, with no
  assertion removed or weakened
- Task 14 real-app acceptance result table — executed in a real rc.2 web UI this
  round. The runtime, the profile and the executable steps are recorded above;
  this table is a record of one round's run, not a permanent compatibility promise

  | Item | Result |
  |---|---|
  | text | PASS |
  | markdown | PASS |
  | code | PASS |
  | csv | PASS |
  | pdf | PASS |
  | docx | PASS |
  | pptx | PASS |
  | xlsx | PASS |
  | draft-preserve | PASS |
  | auto-submit-zero | PASS |
  | renderer-selector | PASS |
  | disable/restore | PASS |
  | rapid-close | PASS |
  | console-clean | PASS |
  | network-local | PASS |

- Task 14 manual acceptance detail — each format was opened through the test-only
  driver's own control, a `MANUAL-DRAFT` sentinel was typed into the composer with
  real key presses, the selection was made with the real gesture the procedure
  names, and Ask was pressed with a real click. The quoted content and the
  provenance form matched the procedure's expected values exactly: `beta` with
  `[来源：task5b-smoke.txt，第 2 行]` for text; `alpha paragraph` with
  `[来源：task5b-smoke.md]` for Markdown — file-only, no line number, as the rule
  requires where a rendered document has no exact source mapping;
  `const beta = 2` with `[来源：task5b-smoke.ts，第 2 行]` for code;
  `south,57,beta` with `[来源：task13-smoke.csv，第 3 行]` for CSV;
  `Alpha Beta Gamma` with `[来源：task7-single-page.pdf，第 1 页]` for PDF page
  provenance; `DOCX Alpha: Leading paragraph with bold text for native selection.`
  with `[来源：task9-paragraphs.docx，第 1 渲染页]` for rendered-page provenance;
  `PPTX Slide One Alpha` with `[来源：task10-text-two-slides.pptx，第 1 张幻灯片]`
  for slide provenance; and `Sheet1!A1:C3` with
  `[来源：task11-simple.xlsx，Sheet1!A1:C3]` for XLSX, whose quote body was the
  procedure's expected Markdown table of display values — the `0.00`-formatted
  `3.50`, not the stored `3.5`. In all eight the sentinel survived at offset 0,
  exactly one quote block was appended after it in the order provenance line,
  quoted content, question line, the transcript row count stayed at zero and the
  submit observer counted **0**. The `打开方式` control (aria-label from the
  product's own `openWith` locale key) was driven through `PDF · Selectable` →
  `PDF` → `PDF · Selectable`: the plugin's `data-dsa-document-kind="pdf"` root and
  the Ask control disappear under the builtin renderer and return when it is
  chosen again, and the menu offered exactly `PDF · Selectable`, `PDF` and
  `纯文本`. Disabling used the documented `--patch` launch overlay on the plugin's
  own loader entry id, after
  `dsh --profile dsa-smoke --patch <file> --dump-config` was used to confirm the
  overlay actually reaches the entry; with the plugin disabled the builtin PDF
  renderer drew the document, the menu offered only `PDF` and `纯文本`, and no Ask
  control existed; restarting without the overlay restored `PDF · Selectable`,
  the Ask control and the full quote behaviour. The disable file was created
  inside `<repo>` for the duration of the check and removed afterwards. Large
  `task10-large-120-slides.pptx` and `task11-large.xlsx` were opened and switched
  away from 250 ms into loading: no slides, no workbook content, no stale Ask and
  no stale renderer root survived, and the page recorded no uncaught error. The
  console's five error-level entries were all same-origin 404s for
  `/api/pet/pets`, `/api/pet/diagnostics` and `/api/task-board/state`, raised by
  other plugins in the profile and not by the document renderer under test; no
  entry originated in the tested renderer and no unhandled rejection occurred. The
  network surface was origin-exact: zero cross-origin requests, zero `.wasm` HTTP
  requests, and the XLSX parse ran in a `blob:` worker
- Task 14 static gates — `pnpm check:dsh-contracts` PASS,
  `pnpm dsh:doctor -- --runtime` PASS, `pnpm typecheck` PASS, `pnpm test`
  **1,052 passed / 0 failed over 58 files** (identical to the Task 13 count, so no
  test was deleted, skipped or weakened), `pnpm build` PASS, `pnpm verify`
  **12/12**, `git diff --check` clean, and `npm pack --dry-run` **89 files** —
  the same file count as Task 13, so the published surface did not grow. The
  tarball is 6.4 MB against Task 13's 6.3 MB, which is the README and notices text
  this round corrected rather than any new published file
- Task 14 build identity — `lib/client.js`
  `735F8B77EC0B899F9740A8C0591AB7FE0A294C9D5F185A69A9B4A8F7134A183D` and
  `lib/index.mjs`
  `FAC72B86168E002CB6DD2939C1775CAD0D149AFB24C4C2264B1110B079A60F39` are
  identical before and after the rc.1 → rc.2 pin migration. The pin upgrade
  changed type-resolution inputs only, so no production byte moved; this is also
  why Task 13's rc.1 real-app evidence still describes the shipped artifact
- Task 14R correction, verified on the frozen tree — the override is exclusive in
  behaviour, not only in prose. With `DSH_INSTALL_NODE_MODULES` set, the `dsh` on
  `PATH` is never executed (P7 and P8 leave no marker file, while the same
  environments run against the pre-fix script fail and do write one); a different
  release or a broken launcher on `PATH` cannot change the verdict (P7, P8); and
  an override that is honoured but wrong fails on its own evidence without
  falling back (P2, P9). The default no-override route still probes `PATH` and
  still fails on a launcher that cannot report a version (P6, marker written):
  `pnpm check:dsh-contracts` PASS, `pnpm dsh:doctor -- --runtime` PASS,
  `pnpm typecheck` PASS, `pnpm test` **1,052 passed / 0 failed over 58 files** —
  identical to the Task 14 count, so no test was deleted, skipped or weakened —
  `pnpm build` PASS, `pnpm verify` **12/12**, `npm pack --dry-run` **89 files**,
  `git diff --check` clean
- Task 14R production and bundle boundary — `lib/client.js`
  `735F8B77EC0B899F9740A8C0591AB7FE0A294C9D5F185A69A9B4A8F7134A183D` and
  `lib/index.mjs`
  `FAC72B86168E002CB6DD2939C1775CAD0D149AFB24C4C2264B1110B079A60F39` are
  byte-identical to the Task 14 build, `git diff 9e811dad -- src` and
  `git diff 0ed146e8 -- src` are both empty, and no pin, lockfile, browser test or
  smoke-driver file changed. The round's diff is confined to
  `scripts/check-dsh-contracts.mjs`, `scripts/dsh-doctor.mjs`, `README.md`,
  `docs/compatibility.md` and this file, so Task 14's rc.2 browser matrix
  (**63 passed / 0 failed / 0 skipped**) is retained rather than re-run: it
  exercised an artifact and a set of tests that this round did not touch, on the
  same grounds that let Task 13's rc.1 evidence survive the pin migration
- Task 14 adversarial review — Agent D's read-only review of the integrated tree,
  with zero files modified, found no blocking problem and five should-fix items,
  all of which are closed in the tree being reviewed:
  - the checker downgraded a failed `dsh --version` probe on a launcher it had
    found to a note, so a PATH that once held `dsh` could lose the very evidence
    that established the compared installation is the one this machine runs. It is
    now a problem: a broken launcher fails the gate at exit 1. Verified by putting
    a `dsh.cmd` that exits 3 on `PATH` — the gate reports
    "a `dsh` launcher is on PATH but `dsh --version` exited 3" and exits 1, while
    the healthy route still reports PASS. This is negative proof P6
  - `docs/07-testing-strategy.md` still carried an "rc.2 contract probe
    (disposable environment)" section whose result block read
    `rc.2 runtime smoke: NOT CLAIMED`, contradicting the same file's rewritten
    compatibility section and this round's record. The section now states the
    Task 14 classification
  - `docs/01-research-open-source.md` still declared rc.1 the project's primary
    verified runtime, contradicting `AGENTS.md`, `README.md`, this file and
    `docs/compatibility.md`. It now states the Task 14 policy
  - the two documents that described the smoke profile as never touching another
    profile were wrong about the filesystem: `dsa-smoke/node_modules` is a
    directory link onto the `web` profile's installed tree, so the package links
    `prepare` maintains physically live in that shared tree, and `cleanup` removes
    them from there. `README.md`, `docs/manual-acceptance.md` and the safety-rules
    comment in `scripts/dsh-smoke-profile.mjs` now state that, and scope the
    isolation claim to manifests and loaders, which is what it actually covers
  - `docs/manual-acceptance.md` described the workspace picker entry as "the
    checkout directory's name". That holds for the canonical checkout and not for
    a `git worktree`, and the failure is silent rather than loud: the registered
    root exists either way, so a reader working from a worktree would validate a
    second tree's fixtures and see nothing wrong. The document now says the name
    is the DSH workspace-registry entry, requires the two trees' `smoke-fixtures/`
    to be byte-identical before a run, and requires the result record to name the
    tree the fixtures came from
  - the review's remaining notes were handled as documentation rather than code:
    the checker's header comment was stale about how the compile step is invoked
    and about which dependency fields it owns, both now stated; the Chinese
    interface strings in the manual are now qualified as locale values with the
    stable `aria-label` anchor named as the language-independent handle; and
    `docs/compatibility.md` now records that the evaluated content is the merge
    baseline plus this branch's uncommitted changes rather than the baseline alone
- Task 14 known items, recorded rather than fixed — each is out of this round's
  ownership or forbidden by its constraints:
  - two production source comments still name rc.1 as the primary runtime
    (`src/client/renderers/pdf/register.ts` and
    `src/client/adapters/dsh-text/preview-dom.ts`). Fixing them would put a
    production diff in a round whose contract is zero production delta, so the
    conflict is recorded here instead and belongs to whichever round next touches
    those files
  - several browser and client suites are still *titled* "real DSH 0.1.5-rc.1 …"
    although this round ran them against rc.2. The titles are test-file
    identifiers, the assertions are version-independent, and the round's actual
    runtime is recorded here; renaming them was neither required nor in any
    agent's file ownership
  - `THIRD_PARTY_NOTICES.md`'s contract-only dev-pin rows were corrected because
    this round's own migration made them false, but that file is otherwise
    Task 15's; no packaging, shipped-set, or release work was done on it
  - the isolated `dsa-smoke` profile is left prepared and pointing at this
    worktree, as Task 13 left it. `pnpm smoke:profile cleanup` removes the test
    driver; the plugin row and its link stay until another round runs `prepare`
- Task 14 evidence provenance — the browser matrix and the manual acceptance run
  executed the plugin built from this worktree while reading fixtures through the
  registered workspace root, which is the canonical checkout
  `dsh-universal-document-selection`. Both trees' `smoke-fixtures/` were compared
  file by file after `prepare` wrote this worktree's copy and were byte-identical
  (25 files, SHA-256 per file), so the documents under test were the ones this
  round generated. The condition is stated in `docs/manual-acceptance.md` because
  a reader reproducing the procedure from a worktree has to re-establish it
  (`docs/compatibility.md`), Agent C (`docs/manual-acceptance.md`) and Agent D
  (read-only adversarial review, zero files modified), each with a disjoint file
  set. The contract-pin migration, the checker, the negative proofs, the
  `README.md`/`AGENTS.md`/`docs/07-testing-strategy.md` corrections and the entire
  real-app acceptance execution were integrator-run on the critical path. No
  sub-agent committed, pushed, merged or created a branch, and no two agents wrote
  the same file

- Task 14 orchestration freeze — before any final gate ran, every sub-agent was
  stopped and the registry was confirmed empty: **ACTIVE_SUBAGENTS = 0**, with no
  write-capable and no read-only agent live, and no two of them sharing a file.
  `FINAL_FREEZE_HEAD` is the head of the commit that carries this record and
  `FINAL_FREEZE_STATUS = clean`; every gate below was then run at that exact
  revision, with no commit, no file edit and no sub-agent started while it ran.
  The three round commits are the two before it — the contract migration and the
  documentation — plus the record itself
- Task 14 production boundary — `git diff 0ed146e8 -- src` is empty.
  `package.json` gained one script row and nine pin changes; `dependencies`,
  `exports`, `files`, `engines` and `peerDependencies` are byte-identical, so the
  published surface did not move and `scripts/verify.mjs` R10 reads the same
  input it read before. No test was deleted, skipped or weakened: from 1,052
  passing cases over 58 files in Task 13 to 1,052 over 58 here, and the only test
  file the round touched is the smoke-driver compile probe's doc comment. No
  formatter, linter, Playwright, TypeScript, React, bundler or renderer version
  moved. No Task 15 work is present: nothing was packaged, no release or tag was
  created, and nothing was published

- Task 13 browser gate — **CLOSED** on the primary runtime, real DSH `0.1.5-rc.2`,
  profile `dsa-smoke`, `DSH_SMOKE_URL` non-empty: universal selection **10 / 0 / 0**,
  resource cleanup **6 / 0 / 0**, XLSX **13 / 0 / 0**, PPTX **10 / 0 / 0**, DOCX
  **6 / 0 / 0**, PDF **10 / 0 / 0**, TextPreview **8 / 0 / 0** — **63 passed, 0
  failed, 0 skipped**, `--workers=1`, in 15.6 minutes. The same five existing
  suites were re-measured on the same instance with the Task 13 build before the
  new suites were added and were already 47 / 0 / 0, so the round's additions
  regress none of them
- Task 13 static gates — `pnpm test` **1,052 passed / 0 failed over 58 files**
  (identical to the Task 12R count, so no test was deleted or skipped),
  `pnpm typecheck`, `pnpm build`, `pnpm verify` **12/12**, `npm pack --dry-run`
  (89 files, 6.3 MB, no test tree, no fixture, no smoke workspace, no Playwright
  report, no local path), `git diff --check`
- Task 13 production identity — `git diff 56c74b36a45951ac4c27a1363e26189c4b0730fc
  -- src` is empty; `package.json` gained exactly one row
  (`"verify": "node scripts/verify.mjs"`), `pnpm-lock.yaml` is unchanged and no
  dependency was added; `playwright.config.ts` is unchanged, because `testDir:
  'tests/browser'` already collects both new specs and changing its timeouts,
  retries, engine or viewport was neither needed nor permitted
- Task 13 sub-agent topology — one integrator plus four sub-agents with disjoint
  file ownership: Agent A (`tests/browser/universal-selection.spec.ts`), Agent B
  (`tests/browser/resource-cleanup.spec.ts`), Agent C (`scripts/verify.mjs`) and
  Agent D (read-only adversarial review, zero files modified). All live browser
  runs were serial and integrator-only; no sub-agent pushed, merged, committed or
  created a branch. The integrator reviewed every sub-agent diff and rejected three
  rounds of work across Agents A and B and one round for Agent C; those rejections
  and their measured causes are recorded below
- Task 13 acceptance findings, none of which is a production defect — the round
  added coverage and found no product bug, but it did produce four measurements
  worth keeping:
  - the preview column is a fixed 576 px wide at 1280x720, 1600x1000 and
    2560x1300, and a rendered DOCX page is centred on it and overflows 13 px to the
    left, so a paragraph's first glyph run begins outside the column; a press at
    `column.left + 1` lands on the shell's resize handle (`DIV.pI_x6G_handle`) and
    the first point inside `[data-dsa-docx-content]` is `column.left + 5`, which is
    already two characters into a 96 px first run. A forward drag therefore cannot
    select the whole paragraph at any viewport, and the DOCX case selects it with a
    real triple click (`mouse.move` plus three real `down`/`up` pairs carrying
    `clickCount` 1, 2, 3) — a real user-level block gesture, not a synthetic range,
    and still asserted by exact equality. The measurement and the ruling are also
    recorded in the case's own comment and in `SmokeDriverControl.tsx`
  - `two-page.pdf` is a six-page document, and at `scrollTop: 0` only page 1
    rasterises while pages 2–6 keep their placeholder and the browser's default
    300x150 canvas. A document-wide `[data-dsa-pdf-placeholder]` count of zero is a
    state this renderer never produces, so the cleanup suite's PDF readiness gate is
    page-scoped, in the shape `pdf-renderer.spec.ts` already uses
  - `new URL('ws://…').origin` is a `ws:` origin and can never equal the page's
    `http:` origin, so the cleanup suite normalises `ws:`→`http:` and `wss:`→`https:`
    before comparing the DSH API channel against `appOrigin`. A socket on another
    host or port, or a plaintext socket on an `https:` page, still fails
  - the smoke driver's own commentary claimed twenty-four controls. Task 13's CSV
    fixture makes it twenty-five, and twenty-six grid items still ceil to seven
    rows, so the recorded strip box `292, 490.4, 408 x 217.6` is unchanged; the
    commentary now states the count as a measured quantity rather than an
    assumption
- Task 13 gate-script corrections after review — the notices rule needed **two**
  successive corrections, and the first was not sufficient. Both are committed
  (`9f8b5c7`, then `f916ed8`) because the branch was already published and this
  round does not force-push.
  - `9f8b5c7`: the block-record lookup searched `package: <name>` followed by up to
    240 arbitrary characters before `license:`, and on a 400-line notices file that
    gap runs straight through the markdown table into a **later** library's block
    record. A field lookup keyed on a package name must not be able to answer with
    another package's value, so the lookup is anchored to the `package:` line and
    bounded to the four lines that follow it.
  - `f916ed8`: anchoring alone did not close Agent D's finding. A row whose license
    *cell* exists but is blank still fell through to the block record, so blanking
    `pdfjs-dist`'s license cell found a license in that package's own fenced block
    and the rule reported nothing. A row that carries a version cell and an empty
    license cell is a notice claiming the identity and omitting the license, so it
    is now reported on the empty cell itself, and only a row with no license cell
    at all consults the block form.
  - The integrator verified the second correction by A/B, not by reading it: on a
    throwaway copy of the tree with `pdfjs-dist`'s license cell blanked, the
    previously committed script reports `PASS R8` and 12/12 — the false negative —
    while the corrected script reports `FAIL R8` with exactly one finding,
    `notices carry no license for this shipped library … THIRD_PARTY_NOTICES.md:28
    -> pdfjs-dist`. The unmodified copy is 12/12 under both, so the rule still
    passes a correct notices file.
- Task 13 adversarial review — Agent D's read-only review of the integrated tree
  raised three blocking findings and the integrator fixed all three before the
  final matrix: the cleanup case that names "a late old resource cannot clear the
  newer resource's selection" was consuming B's Ask surface *before* the cleanup
  window, so no live snapshot existed during it (reworked to keep an un-clicked Ask
  surface, that is a live snapshot, across the window and to assert it survives and
  still appends B's own exact block); `scripts/verify.mjs`'s composer-write rule
  matched only quoted selector literals and so could not fire on this repository's
  own constant-based style (widened, then corrected again after the widening
  produced six false positives on the clean tree, by resolving a name's *nearest
  preceding* binding); and the notices rule skipped the license comparison whenever
  the recorded license cell was empty (now reported like an empty version). Agent D
  also confirmed the review's own required checks: no test weakening, no fixed sleep
  standing in for evidence, no force click or event dispatch, no kernel/adapter/
  bridge access, no loose selectors, exact provenance matching
  `src/client/provenance/format.ts`, a network gate that is origin-exact rather than
  allow-list-shaped, no Task 14 scope, and version-neutral assertions
- Task 13 optional rc.1 backward-compatibility evidence — **DIFFERENCE: NONE**,
  and non-blocking by policy. On the isolated rc.1 install in an out-of-tree
  scratch home (`E:\Projects\DSHarness\.dsa-rc1`, `@deepseek-ai/dsh@0.1.5-rc.1`
  with a fresh profile driven by `scripts/dsh-smoke-profile.mjs`), the same seven
  suites were re-run serially with the Task 13 build: universal selection
  **10 / 0 / 0**, resource cleanup **6 / 0 / 0**, XLSX **13 / 0 / 0**, PPTX
  **10 / 0 / 0**, DOCX **6 / 0 / 0**, PDF **10 / 0 / 0**, TextPreview **8 / 0 / 0**
  — **63 passed, 0 failed, 0 skipped, 29.8 minutes**, identical to the rc.2
  result on every suite. No production change was made for rc.1's sake, and rc.1
  does not decide this round either way
- Task 12R browser gate — **CLOSED** on real DSH `0.1.5-rc.1` and `0.1.5-rc.2`:
  the smoke driver keeps all twenty-four fixture controls inside the viewport
  (strip `292, 490, 408 x 218` at 1280 x 720), every one of them is opened by an
  ordinary actionability-checked `locator.click()`, and each suite is XLSX
  **13 / 0 / 0**, PPTX **10 / 0 / 0**, DOCX **6 / 0 / 0**, PDF **10 / 0 / 0**,
  TextPreview **8 / 0 / 0**. The earlier rc.1 result of XLSX 7 / 6 is retained
  below as history: it demonstrated non-regression against the pre-Task-12
  baseline and did not meet the frozen acceptance gate
- Task 12 registration ownership: PASS — one top-level `ctx.effect` per apply,
  `applyClient` effect-free, exactly four extension renderer definitions with
  `priority: 'extension'` / `loading: 'bytes-complete'` / `wrap: false`, zero
  replacement renderers for the builtin text classes, the five adapters in the
  frozen order XLSX → PDF → DOCX → PPTX → builtin text, every registration
  disposed exactly once with a second dispose a no-op, every contribution
  released on unload (including the two previously leaked Ask slot entries), a
  builtin PDF definition seeded before the plugin still live and still the same
  object after the plugin is disposed, and a serial apply/dispose/apply cycle
  leaking no definition, slot entry, listener or style node
- Task 12 registration failure: PASS — a definition that throws releases the four
  adapter registrations, the two Ask slot contributions, the overlay style sheet
  and the definitions registered before it, and rethrows the original error; a
  throwing child disposer does not end the sweep; a missing required service
  fails the apply before a single definition is registered
- Task 12 selection lifecycle: PASS (40 cases) — resource-scoped invalidation
  (A's late cleanup leaves B's snapshot object-identical), XLSX semantic capture
  and owner-token isolation, Escape clearing a DOM snapshot and a semantic
  snapshot and the notice and a pending frame while leaving the reader's own
  browser selection untouched, scroll and resize recapturing the same text,
  resource and provenance with updated geometry, a disconnected selection
  clearing, a pending frame cancelled on dispose, a post-dispose bridge publish
  and resource callback inert, and all four renderer bodies notifying the
  coordinator on unmount, on an address change and on tab abort
- Task 12 locale: PASS — six keys in both tables, Chinese default for a missing
  or unknown language, `zh`/`zh-CN`/`zh-TW` → Chinese and `en`/`en-US`/`fr` →
  English, both refusal notices worded per language and per limit, every Chinese
  key pinned to its exact code points in `tests/unit/quote/integrity.spec.ts`,
  and the generic DOCX loading and failure states rendering the resolved
  language while an explicit diagnosis keeps its own message
- Task 12 static gates: PASS — `pnpm test` 1,051 passed / 0 failed over 58 files
  (Task 11 baseline: 958 over 55), `pnpm typecheck`, `pnpm build`,
  `npm pack --dry-run` (89 files, no fixture, no smoke workspace, no report, no
  side WASM or worker asset), `git diff --check`
- Task 12 real DSH, five existing browser suites with the Task 12 build, DSH
  `0.1.5-rc.2` (the only release installed on this machine; see the runtime note
  below for the rc.1 runs): XLSX **13 / 0 / 0**, PPTX **10 / 0 / 0**, DOCX
  **6 / 0 / 0**, PDF **10 / 0 / 0**, TextPreview **8 / 0 / 0** — 47 passed, 0
  failed, 0 skipped
- Task 12 real DSH, runtime `0.1.5-rc.1`: the machine's DSH installation is rc.2
  and its `dsa-smoke` profile tree is shared with the user's own `web` profile,
  so rc.1 was stood up as an isolated install
  (`@deepseek-ai/dsh@0.1.5-rc.1` plus a fresh profile created with
  `--from-default-profile web`) and driven by the repository's own
  `scripts/dsh-smoke-profile.mjs`. On that instance: PPTX **10 / 0 / 0**, DOCX
  **6 / 0 / 0**, PDF **10 / 0 / 0**, TextPreview **8 / 0 / 0**, and XLSX
  **7 passed / 6 failed / 0 skipped**. The six XLSX failures are environmental
  and are **not** attributable to Task 12: the pre-Task-12 baseline
  (`c799ad8`) run on the same instance fails the identical six cases with the
  identical error (`locator.click` — the smoke driver's last fixture buttons
  resolve outside the clickable viewport in that minimal home). On the rc.2
  instance, which carries the user's full profile, the same Task 12 build passes
  all thirteen
- Task 12 production defect found by the new locale case: the rejection notice
  resolved its copy only from the Ask button's owner document, so a refusal in an
  English document was worded in Chinese whenever no button was on screen. Fixed
  in `SelectionAskOverlay` by falling back to the ambient document — the one
  change Task 12 permits in that file, and it is a copy-resolution change only

### Task 13S — closing the shipped-library discovery hole

Task 13's gate script was green while a shipped library had no notice. The external
final audit of `ada7224` is what observed it: `scripts/xlsx-runtime-assets.ts`
resolves `fflate/package.json` out of the installed `@extend-ai/react-xlsx`, reads
`fflate/esm/browser.js`, and inlines it into the synthesized XLSX worker source, which
is embedded in `lib/client.js` and delivered to the browser. `fflate@0.8.3` was
therefore shipped code with no record in `THIRD_PARTY_NOTICES.md`, and `verify.mjs` R8
could not see it, because the set that rule iterated was nine package names written
inside the gate script and `fflate` was not one of them.

The record above states `pnpm verify` **12/12** as a Task 13 result. That measurement
was correct and its reading was wrong: it was a false PASS, not a passed gate.

**RED, taken before any file was modified.** On a throwaway copy of `ada7224` with a
real `node_modules` junction, `lib/client.js` carries one
`var __dsa_fflate__ = (function ()` declaration and the three rewritten worker
imports — four occurrences of the identifier; `THIRD_PARTY_NOTICES.md` contains no
occurrence of `fflate`; `verify.mjs` contains none either; and the unmodified gate
still reports `PASS R8` and 12/12. The junction is what makes that a statement about
the rule rather than about a missing dependency tree, and it is why every proof copy
below carries one.

**The defect is the discovery, not the missing name.** Repairing only the data would
have left the same false negative for the next explicitly inlined package, because
the maintainer would still have had to remember to edit the build script *and* a
second list inside the gate. R8 now derives the shipped set from three project-owned
authorities:

- the declared production dependencies, read from the lockfile's root importer;
- the packages the project-owned build pipeline explicitly resolves installed bytes
  out of, found by scanning `scripts/xlsx-runtime-assets.ts` and `tsdown.config.ts`
  for module-resolution calls and `node_modules` path joins. This is the channel that
  makes `fflate` impossible to ship unnoticed;
- the packages the project's own bundler records as inlined into `lib/client.js`,
  read from the `//#region node_modules/<path>` comment rolldown emits per module.

There is no hand-maintained shipped-library list left in `verify.mjs`, so the class-B
members the old list named are covered by the derivation rather than by a restatement:
`jszip` and `@dukelib/sheets-wasm` through the build's own resolve calls, `echarts` and
`zrender` through the bundler's region comments. A derivation that reads nothing is a
failure and not a pass — an unreadable pipeline file, a bundle with no region comment,
and an empty union are each reported — and the discovery is deliberately not a scan for
npm-shaped strings, which would have reported `alwaysBundle`'s wildcard patterns, the
bundler's aliases and every dependency of a dependency.

**What the corrected rule found.** Against the tree at `ada7224` it reports 16 findings,
not one. `fflate` is the reported blocker; the other fifteen are packages the bundler
region comments prove were already shipping with no notice — `@tanstack/react-virtual`
3.14.13, `@tanstack/virtual-core` 3.17.11, `d3-array` 3.2.4, `d3-color` 3.1.0,
`d3-format` 3.1.2, `d3-geo` 3.1.1, `d3-hierarchy` 3.1.2, `d3-interpolate` 3.0.1,
`d3-path` 3.1.0, `d3-scale` 4.0.2, `d3-shape` 3.2.0, `internmap` 2.0.3, `regl` 2.1.1,
`topojson-client` 3.1.0 and `tslib` 2.3.0. All fifteen arrive through
`@extend-ai/react-xlsx`'s chart, map and viewport support; each was recorded with the
version the lockfile resolves and the license its own installed manifest declares, and
R8 re-checks both. The shipped set is now 25 packages, all of them in the notices table.

**Notices.** `fflate` is recorded as 0.8.3, MIT — read from
`node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/package.json` and its `LICENSE`,
not from this prompt — with the purpose stated as what it is: a transitive runtime
dependency of `@extend-ai/react-xlsx` whose browser ESM implementation the
project-owned XLSX runtime-asset builder inlines into the self-contained XLSX worker,
with a second copy embedded because a worker has its own global scope. The stale Duke
delivery text is corrected in place rather than deleted: the passage recording *why*
the `/dsa-assets/...` host routes were removed and why the compressed-inline
architecture was adopted is kept, and the "no binary of it is currently delivered to
the browser" blocker statement is replaced by the architecture that shipped — exact
installed WASM, identity gate, deterministic gzip, base64 payload in `lib/client.js`,
local inflate, runtime SHA-256 verification, `setWasmSource(BufferSource)`; worker
self-contained and started from a `Blob`; zero HTTP requests for either.
`tests/browser/xlsx-selection.spec.ts` case 0 is cited by its current title, because it
asserts the delivered engine now and no longer records a blocked state.

**Proof matrix**, all on throwaway copies with `node_modules` junctions:

| Proof | Injected change | Observed |
| --- | --- | --- |
| P1 clean | none | `PASS R8`, 12/12, 0 findings |
| P2 remove fflate | fflate notice row deleted | `FAIL R8`, 1 finding naming `fflate` |
| P3 blank fflate license | license cell emptied, identity intact | `FAIL R8`, `notices carry no license … -> fflate` |
| P4 wrong fflate version | row records 0.8.2 | `FAIL R8`, `record version "0.8.2" but the lockfile resolves 0.8.3` |
| P5 wrong fflate license | row records Apache-2.0 | `FAIL R8`, `record license "Apache-2.0" but the installed manifest declares "MIT"` |
| P6 synthetic inliner | a new explicit inliner for `us-atlas` added to `scripts/xlsx-runtime-assets.ts`, no notice | `FAIL R8`, 1 finding naming `us-atlas` |
| P7 class-B coverage | `echarts`, `zrender`, `jszip` and `@dukelib/sheets-wasm` rows deleted | `FAIL R8`, 4 findings, one per package |
| P8 blank-cell rule | `pdfjs-dist` license cell blanked while its own fenced block still carries Apache-2.0 | `FAIL R8`, `notices carry no license … -> pdfjs-dist` |
| P9 bounded block record | shipped table rebuilt with no license column, plus a `package: fflate` block inside the bound | `fflate` has **0** findings; the block form still answers |
| P10 the bound holds | same, with `license:` five lines below `package:` | `FAIL R8`, `notices carry no license … -> fflate` |

P6 is the acceptance proof that the discovery is not `fflate`-shaped: it names a package
that is installed and lockfile-resolved but appears in no region comment, no dependency
list and no existing table row, and the rule reports it because the build's own pipeline
says it is being embedded. P9 and P10 re-establish the two corrections Task 13 made to
this rule — a blank license cell is authoritative and the block-record lookup stays
anchored to its own package and bounded to four following lines — which the discovery
change deliberately does not touch.

**Orchestration and freeze.** The round ran with no write-capable sub-agent and no
read-only reviewer: `active write-capable sub-agents: 0` and `active read-only
sub-agents: 0` were recorded before the first edit, and `active sub-agents before
freeze = 0` before the final gates. This is also the round that records the earlier
orchestration failure, which the commits make visible: the first completion record
(`08d93f9`) was written while `scripts/verify.mjs`'s owner was still working, so the
integrator's first final report was invalidated and the record was superseded twice
(`477f221`, then `ada7224`) before the external audit reopened the round again. The
Task 13 chain is therefore: initial integration → a gate-file owner working past the
first freeze → the first final report invalidated → two R8 parser corrections → the
external audit's missing `fflate` finding → Task 13S → the final freeze with zero
active sub-agents. The errors are kept because the sequence is the audit trail.

**Static gates on the frozen tree** — `pnpm test` **1,052 passed / 0 failed over 58
files** (unchanged, so no test was deleted or weakened), `pnpm typecheck`, `pnpm build`,
`pnpm verify` **12/12**, `npm pack --dry-run` (89 files, no test tree, no fixture, no
proof copy, no local path), `git diff --check`. Production identity is unchanged:
`git diff ada7224 -- src` is empty, `pnpm-lock.yaml` is unchanged, no dependency was
added — `fflate` stays a transitive dependency and was not promoted to make the gate
easier — and `package.json` was not touched. No browser or production file changed in
this round, so the frozen rc.2 matrix (63 / 0 / 0) and the optional rc.1 matrix
(63 / 0 / 0) are retained rather than re-run.

### Task 12R — closing the rc.1 browser gate

The Task 12 record above reports the rc.1 XLSX suite as 7 passed / 6 failed and
explains those failures as environmental, evidenced by the pre-Task-12 baseline
failing the identical six cases on the same instance. That evidence establishes
non-regression and nothing more: a frozen acceptance gate that requires 13 passed
/ 0 failed / 0 skipped is not met by showing that the baseline failed the same
way. Task 12R therefore treats the rc.1 gate as open and closes it without
weakening what the gate measures.

Root cause, measured rather than inferred. The smoke driver renders one control
per fixture in a single `position: fixed` flex row with `left: 12px`, no `right`,
no wrap and no width bound. At the 1,280 x 720 viewport the smoke runs at, the
twenty-four controls measured 1,568.6 px wide against a 1,280 px window, and the
five XLSX controls — the tail of `SMOKE_FIXTURES` — sat 294 px past the right
edge. Playwright reported `locator.click` with "element is outside of the
viewport", which is a statement about the control's geometry, not about the XLSX
renderer: every failing case failed at the click that opens the fixture, before
the plugin under test was exercised. RED was reproduced on a real DSH
`0.1.5-rc.1` instance before any source was touched, with the failing control's
bounding box and the viewport recorded.

Remediation is test infrastructure only. `SmokeDriverControl.tsx` now renders the
controls as a grid anchored at `left: 292px` with `width: 408px`, four 1fr columns
per row, `white-space: nowrap` on the labels and `overflow: hidden` on the strip.
Each bound answers a measured occluder: the window-wide row reached under the
preview column (which begins at `x = 704` and wins the hit test over the strip,
because the overlay slot's composer column establishes the stacking context), and
a second attempt bounded only by `width: 680px` lost `pptx-external-media` to the
shell's right-sidebar resize handle at `x = 276`. `x = 292` clears the handle and
`x = 700` ends before the preview column, and seven rows of four fit in 218 px,
whose top edge stays below the composer's published `y = 447`. No forced click,
no DOM-dispatched event, no viewport widening, no `scrollIntoViewIfNeeded`, and no
scaling or zoom: every case still opens its fixture with an ordinary
actionability-checked `locator.click()`. `xlsx-selection.spec.ts` adds
`expectControlReachable`, which asserts the four bounds of each control against
the viewport before clicking it, so a layout regression names the control, its
box and the viewport instead of surfacing as a bare retry timeout. No product
assertion was removed or weakened.

- Task 12R real DSH `0.1.5-rc.1`, isolated install at
  `E:\Projects\DSHarness\.dsa-rc1` (`@deepseek-ai/dsh@0.1.5-rc.1` with a fresh
  profile driven by `scripts/dsh-smoke-profile.mjs`): XLSX **13 / 0 / 0**, PPTX
  **10 / 0 / 0**, DOCX **6 / 0 / 0**, PDF **10 / 0 / 0**, TextPreview **8 / 0 / 0**
  — 47 passed, 0 failed, 0 skipped. The previous round's rc.1 XLSX result of
  7 / 6 stands as history and established non-regression only; it did not meet the
  frozen acceptance gate
- Task 12R geometry evidence, rc.1 at 1280 x 720 with a workbook open: strip box
  `292, 490, 408 x 218`; all twenty-four controls inside the viewport and receiving
  a click; the six XLSX controls at `xlsx-simple` 600.5, 617.6, 95.5 x 24.8;
  `xlsx-formula-values` 296.0, 648.4; `xlsx-multi-sheet` 397.5, 648.4;
  `xlsx-merged-frozen` 499.0, 648.4; `xlsx-chart-image` 600.5, 648.4; `xlsx-large`
  296.0, 679.2 — every right edge at or below 696 and every bottom edge at or below
  704
- Task 12R rc.2 regression, real DSH `0.1.5-rc.2`, all five suites re-run because
  the harness layout changed: XLSX **13 / 0 / 0**, PPTX **10 / 0 / 0**, DOCX
  **6 / 0 / 0**, PDF **10 / 0 / 0**, TextPreview **8 / 0 / 0** — the wrapped
  controls interfere with no existing interaction
- Task 12R static gates: `pnpm test` **1,052 passed / 0 failed over 58 files**,
  `pnpm typecheck`, `pnpm build`, `npm pack --dry-run` (89 files, no fixture, no
  smoke driver, no Playwright artefact, no local path), `git diff --check`
- Task 12R production identity: `git diff fc5ea8f -- src/client` is empty;
  `lib/client.js` is byte-identical to the Task 12 build at
  `735F8B77EC0B899F9740A8C0591AB7FE0A294C9D5F185A69A9B4A8F7134A183D` and
  `lib/index.mjs` at
  `FAC72B86168E002CB6DD2939C1775CAD0D149AFB24C4C2264B1110B079A60F39`;
  `package.json`, `pnpm-lock.yaml` and the Task 11 runtime assets are unchanged

- Task 11C fixture integrity unit suite: PASS (13 cases) — the committed
  `xl/media/image1.png` read out of the workbook, its signature and exact chunk
  path, every chunk CRC-32, its `IHDR` fields, the inflate to exactly 16,448
  bytes, all 4,096 pixels at `[255, 0, 0, 255]`, `node:zlib` and the viewer's own
  `fflate` agreeing byte-for-byte, generator determinism and byte equality with
  the committed media part, `xl/drawings/drawing1.xml` parsed as XML with both
  anchors present, and the image and chart relationships still internal. Observed
  RED against the unrepaired fixture on `invalid code lengths set`
- Task 11 real DSH XLSX renderer smoke (Playwright, live instance): **13 passed /
  0 failed / 0 skipped as of Task 11C.** Case 6 — the frozen chart/image fidelity
  case — now passes on the same assertions that failed in 11A and 11B: the
  published picture's own bytes decode through `createImageBitmap` into a 64x64
  bitmap and draw into 4,096 of 4,096 red pixels, with the chart asserted
  separately as a labelled SVG
- Task 11 embedded-image presentation client suites: PASS — `xlsx-image-render` (3
  cases: the public controller image model, the documented `renderImage` callback's
  invocation and payload, and the production node's source ownership, box and
  read-only presentation) and `xlsx-renderer` (22 cases, including the three that pin
  the viewer configuration `XlsxBody` publishes)
- Task 11 real DSH XLSX renderer smoke (Playwright, live instance): **SUPERSEDED by
  Task 11R — BLOCKED.** The Task 11 record above stands as what that round claimed; the
  reproduction performed in Task 11R shows the same suite's assertions could not have
  distinguished the ranges it reported (prefix-only provenance) and that the renderer's
  runtime depended on host routes. See the Task 11R record for what is now measured:
  XLSX 1 passed / 9 failed / 0 skipped against a live instance, blocked at the engine
  binary's delivery path.
- Task 11 XLSX relationship security client suite: PASS (30 client cases) — the exact
  Transitional/Strict hyperlink allowlist and its scheme rule, six disallowed external
  relationship families, malformed XML, CRC-corrupted relationship bytes over a real
  archive, abort as an `AbortError` at three positions, the reader-close policy on all
  four outcomes, and the per-entry read options (`useWebWorkers: false`) that keep the
  scan off a codec worker
- Task 11 XLSX renderer pipeline client suite: PASS (13 client cases) — preflight pending
  blocks the later gates, strict gate ordering, preflight rejection never reaching the
  verifier or the viewer, one lifecycle signal shared by all three gates, one defensive
  copy reaching every gate and the viewer by identity, host-byte mutation after the copy
  not reaching the viewer, the blocked engine-binary state, and the published semantic
  selection attribute
- Task 11 XLSX bundling integrity unit suite: PASS (7 unit cases) — no host asset path,
  no worker file, no CDN, the fail-closed worker seam, no second chunk beside
  `lib/client.js`, no `lib/assets` in the artifact or the published file list, and the
  host bundle free of routes, filesystem access and XLSX runtime
- Task 11 cell range provenance unit suite: PASS (6 unit cases)
- Task 11 XLSX selection bridge client suite: PASS (5 client cases)
- Task 11 XLSX selection adapter client suite: PASS (9 client cases)
- Task 11 XLSX renderer & displayed values client suite: superseded by the Task 11R
  pipeline suite above (13 client cases, of which the public displayed-value cases are
  the original 3)
- Task 11 XLSX bundling integrity unit suite: superseded by the Task 11R suite above
  (7 unit cases)
- Task 10S PPTX rendering engine client suite: PASS (12 client cases)
- Task 10R PPTX relationship security client suite: PASS (18 client cases)
- Task 10S real DSH PPTX renderer smoke (Playwright, live instance): PASS (10 cases) — text two slides Ask, cross-slide Ask, Unicode CJK Ask, table & embedded PNG image without remote requests, chart rendering output, large 120-slide windowed virtualization and stale selection cleanup on scroll, strict viewport resize current-generation revalidation, external media fail-closed security rejection, dangerous javascript hyperlink blocking, rapid switch/close during in-flight render without error or leakage
- Task 10 slide range provenance unit suite: PASS (21 unit cases)
- Task 10 PPTX selection adapter client suite: PASS (23 client cases)
- Task 10 PPTX bundling integrity unit suite: PASS (2 unit cases)
- Task 9S OOXML streaming extraction bounds verification suite: PASS (10 client cases)
- Task 9S DOCX engine & forged-size rejection suite: PASS (13 client cases)
- Task 9R DOCX hyperlink security client suite: PASS (14 client cases)
- Task 9 DOCX page markers client suite: PASS (5 client cases)
- Task 9 DOCX selection adapter client suite: PASS (19 client cases)
- Task 9 DOCX bundling integrity unit suite: PASS (2 unit cases)
- Task 9R real DSH DOCX renderer smoke (Playwright, live instance): PASS (6 cases) — paragraphs Ask, manual page break cross-page rendered provenance, table & embedded image without remote requests, headers & footers, viewport resize selection stability, external hyperlink scheme security hardening & Ask over blocked link text
- Task 8A selection invalidation & lifecycle refresh: PASS
- Task 8 PDF selection adapter client suite: PASS (32 client cases)
- Task 8 page range provenance unit suite: PASS (22 unit cases)
- Task 8 real DSH PDF renderer smoke (Playwright, live instance): PASS (10 cases) — single-page Ask, cross-page Ask, CJK Ask, image-only no Ask, live selection across viewport resize, network asset isolation

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
- Task 7 PDF registration suite: PASS (8 unit cases) — the definition's exact
  metadata, `extension` beating `builtin` in **either** registration order under
  the installed rc.1 ranking rule, the builtin retained as a live candidate, a
  non-PDF path and a compound suffix refused, the keyed body registered under the
  definition's own id, both contributions made inside an effect body, and a
  missing registry reported rather than thrown
- Task 7 PDF page geometry suite: PASS (17 unit cases) — the requested factor at
  1× and as `finest`/`normal` at 2×, the dimension cap, the pixel cap and which
  binds first, both caps held for every degenerate input, a non-finite dimension
  refused as `RangeError`, an unusable device pixel ratio normalised to the
  identity, and the text-layer factor for each tier and for a capped raster
- Task 7 PDF runtime suite: PASS (25 client cases) — one native module worker
  created from a blob URL, the host bytes copied before PDF.js may transfer them,
  the network-free configuration asserted field by field, page sizes read once,
  a worker failure raised as `PdfWorkerFailure` with `getDocument` never called,
  a worker that dies after the load reported, teardown releasing the loading task,
  the bridge, the native worker and the blob URL, `dispose()` idempotent across
  three callers, the ready handshake detached and the failure listeners retained,
  abort during open, abort before open, no unhandled rejection, the asset factory
  answering a bundled name and refusing an unbundled one with a fresh buffer per
  request, the canvas sized from the cap with the CSS box unchanged, real DOM text
  spans, an image-only page with an empty layer, both renders cancelled with the
  page cleaned exactly once and never while a render was pending, and a page
  failure reported rather than resolved
- Task 7 PDF style sheet suite: PASS (4 client cases) — the TextLayer rules the
  spans are laid out against, the page and canvas rules, one tagged `style`
  element installed and removed, and a second install adding nothing
- Task 7 built-artifact suite: PASS (8 unit cases) — PDF.js inside
  `lib/client.js` rather than required, the only bare requires being the loader's
  own `react`/`react/jsx-runtime` and PDF.js's `isNodeJS`-guarded `url`, the
  worker source embedded with no package URL, the TextLayer CSS present under its
  tag id, one asset per family present by exact filename, no CDN host and no
  remote worker default, the DSH runtime and `@zip.js/zip.js` absent, and the
  artifact's size reported
- Task 7 smoke-profile agreement: PASS (1 unit case) — the bootstrap's PDF fixture
  sources and the driver's own table naming the same destinations, each source
  committed, the destination derived rather than restated, and every PDF fixture
  opening through the product's document preview tab
- Task 7A listener lifecycle suite: PASS (7 client cases) — the outer page-render
  abort listener is identified separately from the text layer's own and is proven
  released on completion, raster failure, text failure, explicit cancel (asserted
  before `done` settles), and tab abort, with 20 sequential renders on one live
  signal accumulating nothing
- Task 7B text-layer generation suite: PASS (5 client cases) — two renders, then
  four consecutive renders (one cancelled after completion), into **one** reused
  `{ canvas, textLayer }` pair leave one generation of text; a signal that had
  already aborted empties the layer and hands out no stream; a new generation that
  fails before it reaches the text layer (a rejected `getPage`) leaves the layer
  empty rather than holding the previous render's text; and a generation cancelled
  between two chunks is followed by one whose full text is the only text present.
  Verified to discriminate: all 5 fail against a no-op reset
- Task 7B real-DSH resize regression (Playwright, live instance): PASS — four real
  viewport resizes with `textContent`, node count, real browser selection and
  span-in-canvas alignment asserted after each, each resize proven to have
  re-rendered (canvas box and backing width both moved, every span built after the
  previous generation was stamped), and verified to discriminate against a no-op
  reset
- Task 7B CJK and image-only re-render regressions (Playwright, live instance):
  PASS — the CJK text and its browser selection are identical after two resizes
  with each substring matched exactly once, and the image-only page is empty with
  zero layer children after each of its two resizes
- Full `pnpm test`: PASS (629 tests)
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
- rc.1 real DSH PDF renderer smoke (Playwright, live instance): PASS (7 cases) —
  a real `.pdf` opened through the public resource path with this plugin's
  renderer selected over the builtin, a canvas and a selectable text layer, a real
  browser selection taking the page's text, alignment of a span inside its canvas
  before and after a real viewport resize, lazy rendering of a page that is out of
  range until it is scrolled to, CJK text selected by the browser, an image-only
  page with no invented text, no PDF.js asset request and no request leaving the
  instance, and a refused worker reported visibly with nothing rendered
- rc.1 stacking regression at 1600×1000 and 2560×1300: PASS with the right column
  expanded and the real TextPreview mounted
- smoke-profile duplicate-loader-entry regression: PASS (`prepare` twice reports
  `rows=unchanged`; `validate` clean; two consecutive boots succeed)
- PDF fixture determinism: PASS (two generator runs produce byte-identical files;
  each generated file asserted free of `/URI`, `http://` and `https://`)
- production-bundle isolation: PASS (no smoke marker in `lib/client.js`,
  `lib/index.mjs`, or the published `files` list)
- published-tarball content: PASS (`npm pack --dry-run`: 56 files, 3.0 MB packed,
  `THIRD_PARTY_NOTICES.md` included)
- rc.2 compile-contract probe: PASS
- rc.2 runtime smoke: NOT TESTED
- production defect: Ask overlay occluded by the expanded right column — FIXED in
  Task 5C, with the inverted assertion kept as the regression guard

## Runtime note (Task 12 round)

This machine's DSH installation was `0.1.5-rc.2` when Task 12 ran, so the frozen
rc.1 baseline could not be served from the user's own profile tree: that tree is
a junction onto the installed release, and the smoke tooling deliberately never
reinstalls it. The rc.1 gate recorded above was therefore executed against an
isolated rc.1 install in a scratch directory outside this repository, with the
plugin under test linked from this worktree and the profile built by the
repository's own `scripts/dsh-smoke-profile.mjs`.

`DSH_SMOKE_URL` was non-empty for every browser run, so no case skipped. The
bearer token was passed through the environment only and appears in no commit,
document or test file. The user's own profile tree, credentials and workspace
store were not modified: the scratch home holds its own settings file and a copy
of the workspace store, and the isolated profile points at this worktree.

Task 12R re-ran both runtimes on the same terms. The isolated rc.1 home needed one
environmental repair before the gate could be measured at all: a fresh rc.1 home
has no model provider, and the client's first-run onboarding step is a *blocking*
modal — it sets `inert` on the application root and lays a full-viewport mask over
it, so no control in the shell, including the smoke driver's, receives a click.
The modal's primary action cannot be satisfied without a credential, so the home
was given a declared `llm-pi-ai` provider row plus a placeholder credential
reference: enough for the provider join to report the route usable, which is the
condition that ends the step. This is scratch-home configuration, written outside
this repository, and no credential value in it is real. The rc.2 run used the
user's own `dsa-smoke` profile tree, whose links already point at this worktree.

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
- Task 7 — PASS (a real PDF renders with a canvas and a selectable text layer;
  `pdfjs-dist` 6.3.289 is a pinned runtime dependency and is bundled; the builtin
  renderer is retained as the viewer's other candidate)
- Task 7A — PASS (the per-render abort listener is released at the operation's own
  settlement boundary rather than at the tab's, so repeated renders on one tab
  signal retain nothing; the lazy-loading source comment matches the fixed
  `1200px 0px` viewport-rooted observer it describes)
- Task 7B — PASS (one text-layer container holds one generation of text: the
  container is emptied at the render operation's own boundary and again before a
  layer is constructed, so a resize re-render replaces the page's text instead of
  stacking it, and a generation that fails or is cancelled leaves none of its
  predecessor's text behind. No generation token was needed, and the reason is
  recorded)
- Task 8 — PASS (PDF native TextLayer selection captured with source page provenance, same/cross-page Ask, composer draft integration, and real DSH verification)
- Task 11R — BLOCKED — CLIENT-ASSET CONTRACT BLOCKED (the Task 11 review's
  preflight-ordering, validated-bytes, relationship-scanner and host-architecture defects
  are fixed and covered by new suites; the XLSX engine binary has no client-only delivery
  path, so the XLSX renderer fails closed and its browser suite is 1 passed / 9 failed /
  0 skipped against a live instance. PR #4 stays a draft and Task 12 must not start)
- Task 11C — PASS (the malformed embedded PNG was replaced by a deterministic, valid
  64x64 RGBA PNG generated by `scripts/generate-xlsx-fixtures.mjs` rather than copied
  from any binary; the fixture-integrity spec reads the committed media part and fails on
  `invalid code lengths set` against the unrepaired fixture; the real DSH XLSX suite is
  13 passed / 0 failed / 0 skipped with no assertion removed or weakened, and the
  production delta is zero bytes. Task 11 is a PASS candidate pending external review;
  PR #4 stays a draft and Task 12 must not start)
- GitHub publication — ACTIVE
- Repository visibility — public
- License — MIT
- Repository: `dsh-document-selection-ask`
- Task 12 — PASS (`1283d928b099306c6ea193d13024f91757429a5b`; one top-level
  registration owner with `applyClient` effect-free, the two previously leaked Ask
  slot contributions now owned, resource-scoped selection invalidation with a late
  old renderer unable to clear a newer snapshot, six bilingual locale keys with
  `too-many-cells` reported as its own refusal, builtin definitions surviving
  plugin disposal with no automatic fallback, and the five existing browser suites
  green on the Task 12 build; see the Current gate and the runtime note above)
- Task 12R — PASS (smoke-driver viewport remediation; the rc.1 XLSX gate is
  closed at 13 / 0 / 0 and rc.2 stays green at 47 / 0 / 0, production delta zero,
  `lib/client.js` unchanged at
  `735F8B77EC0B899F9740A8C0591AB7FE0A294C9D5F185A69A9B4A8F7134A183D`; see the
  Task 12R record above)
- Task 13 — PASS (`9064bfdfc5c14c7e7e48df393e1cee7255830e92`, with the gate-script
  corrections at `9f8b5c7adc7dba3e7a4a31345b75d6b71bf737e9` and
  `f916ed8f5278071265bc728b9d69dbf7dd7d2831`, and the status records at
  `08d93f910b71c8db01f0bd8839c1e480d5779cc5`; one universal
  acceptance case per supported class plus a real cross-root refusal and a recovery
  after it, per-format resource cleanup with a late old resource proved unable to
  clear the live selection that replaced it, a cross-format network gate that is
  origin-exact, twelve heuristic static gates wired as `pnpm verify`, zero
  production delta and one new smoke fixture; the primary gate is real DSH
  `0.1.5-rc.2` at 63 passed / 0 failed / 0 skipped, with rc.1 recorded separately
  as optional backward-compatibility evidence; see the Task 13 record above)
- Task 13S — PASS (`03e62cc729952b76c9e04de9e54fb2ee53900675`, with the status
  record in the Task 13S section above). The round's own `pnpm verify` 12/12 from
  `ada7224` was a false PASS: `fflate` was shipping inside the embedded XLSX worker
  with no notice, because R8 iterated a hand-written list of nine names. R8 now
  derives the shipped set from the declared dependencies, the packages the
  project-owned build pipeline explicitly resolves installed bytes out of, and the
  packages the bundler records as inlined into `lib/client.js`; against `ada7224`
  that derivation reports 16 packages with no notice, and all sixteen are now
  recorded. The two earlier R8 corrections are preserved, ten injection proofs
  (P1–P10) on throwaway copies with real `node_modules` junctions confirm the rule
  fires, production delta stays zero, no browser file changed so the frozen rc.2
  and rc.1 matrices are retained, and the final tree was frozen with zero active
  sub-agents
- Task 14R — PASS on the corrected gate (checker exclusive-override remediation,
  recorded in full above). What was defective in the Task 14 PASS report was its
  evidence about the gate, not its conclusions about the pins, the compile
  contracts or the real-app matrix: `DSH_INSTALL_NODE_MODULES` was documented as
  exclusive while `discoverRuntime` called `probePathCli` before consulting the
  override and both `PATH` verdict rules ran regardless, so a valid rc.2 override
  could fail because of the machine's ambient `PATH`. Discovery now resolves the
  override first and never probes `PATH` in that mode; P7–P9 were added and P2 was
  re-attributed, with the pre-fix script run against the same environments as a
  control. Every static gate passes, `lib/client.js` and `lib/index.mjs` are
  byte-identical, the `src` delta from both baselines is zero, no pin, lockfile or
  browser file changed, and the frozen tree carried zero active sub-agents
- Task 16 — PASS. The released renderer's PDF high-DPI defect (canvas backed below
  the display ratio and the text layer scaled with it) is reproduced with measured
  before/after numbers at device pixel ratios 1, 1.25, 1.5 and 2, its root cause is
  established from the installed `pdfjs-dist@6.3.289` source, and it is fixed by
  deleting the inverted `finest` tier and laying the text layer out from the CSS
  viewport. The regression suite fails 9/19 on the released unit implementation and
  8/8 on the released client bundle, and passes on the fix. The non-committed
  real-user document renders sharp with its selection on the glyphs at 1.5× and 2×.
  v0.1.2 release candidate prepared — npm-ready metadata, reproducible `npm pack`,
  `verify:package`, `npm publish --dry-run` and an independent tarball install — and
  nothing published.

`LICENSE` is the standard MIT text with the copyright holder taken from the
authenticated GitHub account. `package.json` declares `"license": "MIT"`.
`THIRD_PARTY_NOTICES.md` records each dependency's own license separately, and it
is now part of the published package. Its shipped table is the complete shipped set —
25 packages, of which the direct runtime dependencies are `pdfjs-dist` (6.3.289,
Apache-2.0), `@zip.js/zip.js` (2.15.0, BSD-3-Clause), `docx-preview` (0.4.0,
Apache-2.0), `@aiden0z/pptx-renderer` (1.2.4, Apache-2.0) and `@extend-ai/react-xlsx`
(0.16.4, MIT) — and `scripts/verify.mjs` R8 derives that set from the build instead of
restating it, as the Task 13S record above describes. `pdfjs-dist` is bundled with its
worker and its three asset families, each of which carries its own license file in the
package and its own row in the notices. `jsdom` (30.0.1) is recorded as MIT,
development/test-only, verified against the installed package metadata, as are
`pdf-lib` (1.17.1) and `@pdf-lib/fontkit` (1.1.1), which are the fixture generator's
own dependencies.

## Next

**Task 15 is the final implementation task of this plan and was authorized for this
round. Release, GitHub Release, git tag and npm publish are NOT authorized**, and
none of them was performed: this round creates no tag, no release and no registry
publication, and nothing in it claims the package is published.

**Task 15 — Final packaging, notices, user documentation, tarball installation and
release verification — COMPLETE.** The plan's last implementation task is delivered
and recorded under "Current gate" above: the packaging metadata, the three user
documents, the packaging gates, the isolated tarball install, the automated rc.2
browser matrix, the manual acceptance procedure executed against the
tarball-installed plugin, and the fresh-checkout build. What remains is an external
merge audit of the evaluation branch; the round itself ends here and takes no
release action.

The handover below is retained as history.

**Task 14 — Compatibility matrix and DSH real-app acceptance procedure — COMPLETE.**
Task 13 closed the cross-format acceptance gate; what it deliberately did not do is
describe the runtime support surface. Task 14 owned that: the compatibility matrix
in `docs/compatibility.md`, the executable acceptance procedure in
`docs/manual-acceptance.md`, the contract-pin migration that closed the divergence
between the pins and the installed runtime, and the gate that decides both. All of
it is delivered and recorded under "Current gate" above.

The round's own constraint held: it was not served by changing production. Task 13
ended with zero production delta and Task 14 ends with zero production delta as
well — `git diff 0ed146e8 -- src` is empty, and both shipped artifacts are
byte-identical to the Task 13 build. What moved is the compile-contract baseline,
the gate that decides it, and the documentation that states the support surface.

That closure stands on the corrected gate. The external audit of the Task 14 PASS
report found the checker's `DSH_INSTALL_NODE_MODULES` exclusivity documented but
not implemented — the `PATH` CLI was probed before the override was consulted, and
its verdict rules ran regardless — and Task 14R corrected the discovery order so
the override excludes the `PATH` route instead of merely outranking it. The chain
is recorded in full: Task 14's initial PASS report, the audit finding, the
Task 14R correction, and this closure.

The handover below is retained as history.

The Task 12 → Task 13 handover is retained as history: Task 12 converged the
registrations, the selection lifetime, the locale and the renderer fallback
semantics into one owner and deliberately did not add cross-format acceptance
coverage, handing Task 13 four properties to evidence. All four are delivered and
recorded above — the one-teardown assertion, resource-scoped invalidation, the
code-point-pinned locale keys, and five unchanged existing suites — so the items
that followed are history rather than open work.

The text below is the Task 7 → Task 8 handover, retained as history. Tasks 8–11
completed the work it describes; it is not an open item.

**Task 8 — PDF selection provenance and Ask integration.**

Task 7 built the renderer and stopped at the DOM contract. Selecting text in the
PDF preview is a real browser selection that the kernel currently rejects —
correctly — as living outside every supported preview, so the Ask button stays
absent. Task 8 adds `createPdfSelectionAdapter()`, `src/client/provenance/page-range.ts`,
and the registration that puts the adapter ahead of the DSH text adapter, then
extends the real browser case to take a selection across pages 1–2 of
`two-page.pdf`, press Ask through an ordinary click, and assert the composer
receives `[来源：two-page.pdf，第 1–2 页]` followed by the selected text.

What Task 7 hands Task 8:

- the renderer root publishes `data-dsa-document-kind="pdf"` and the exact
  `resourceAddress`, and each page wrapper publishes a stable **1-based**
  `data-dsa-pdf-page`; nothing in Task 7 reads them, and they are the whole
  provenance contract;
- the page wrappers are the elements a Range endpoint resolves against, and they
  carry the two layers — `[data-dsa-pdf-canvas]` and `.textLayer` — so
  `closest('[data-dsa-pdf-page]')` from either endpoint is the page rule;
- a page that has not rendered yet keeps its box and an empty text layer, so a
  selection can never name a page whose spans do not exist;
- the adapter must be registered **before** the DSH text adapter in
  `applyClient`, because that adapter's fallback treats an unrecognized preview
  root as plain text and would otherwise quote the PDF's spans as a text document
  with no page provenance.

What Task 7A changes for Task 8: nothing it reads. The page wrappers, their
1-based attribute and the text spans are untouched; what changed is who owns a
render's abort listener and when it is released. Task 8's adapter resolves
provenance from the DOM, not from the renderer's lifetime, so it can be built
against the same contract Task 7 published.

What Task 7B changes for Task 8: one thing, and it is the one Task 8 depends on
most. A selection over a PDF page now reads the page's text **once** however many
times the page has been re-rendered, so the quote an adapter takes from
`getSelection()` is the page's text rather than one copy per generation. The DOM
itself is unchanged — `.textLayer` is still the React element, its spans are still
its direct children, and no new `data-dsa-*` attribute was added (`data-dsa-pdf-text` 已由 Task 7 renderer 存在，Task 7B 没有新增或改变该 DOM contract) — so the selectors,
the page wrappers and the 1-based page attribute Task 8 resolves against are
exactly what Task 7 published. The generation cleanup is expressed as
`clearTextLayer` in `text-layer.ts` and is not part of Task 8's contract: an
adapter must still resolve provenance from the plugin's own `data-dsa-pdf-page`
wrappers, never from `.textLayer`, which a future DOCX or PPTX renderer will also
produce.

Task 7 leaves two things for the renderer tasks that follow it:

- the renderer is deliberately not a source of *text* for any other format. The
  `textLayer` class names it emits are PDF.js's own, and the adapter must resolve
  provenance from the plugin's own `data-dsa-*` attributes rather than from
  `.textLayer`, which a future DOCX or PPTX renderer will also produce;
- the asset table is keyed by exact filename, so a `pdfjs-dist` version bump
  changes it. `pnpm build` re-reads the installed package, so the artifact follows
  the pin; `tests/unit/pdf-bundle.spec.ts` asserts one representative asset per
  family and would fail loudly if a family disappeared.

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

Task 7 notes carried forward:

- **a container React owns and a library writes into needs an owner for its
  contents.** PDF.js's `TextLayer` appends into the element it is handed and its
  `cancel()` removes nothing, so a page re-rendered into the same element stacks
  its text invisibly — and it is the *selection* that pays for it, not the
  picture. `renderPdfPage` is the generation boundary for that element and
  `clearTextLayer` is the statement; any later renderer whose body is a DOM
  library plus a React host has the same question to answer;
- **a Cordis service a plugin reads must be named in its runtime `inject`.** The
  first real boot after the PDF renderer was registered failed with
  `cannot get property "documentPreviews" without inject`; the package edge in
  `dsh.client.inject` composes the module into the graph, and the exported
  `inject` array is what orders the *call*. Any later task that reaches a new
  service has the same two statements to make, and a unit suite cannot catch a
  missing one — only a real boot can;
- **PDF.js's own worker path falls back to the main thread** and this project does
  not. `PDFWorker.#initialize` calls `#setupFakeWorker()` when the script cannot be
  fetched or the handshake fails; the renderer therefore creates the native worker
  itself and hands PDF.js a port, which takes a branch with no fallback at all.
  Any later renderer that starts a worker should follow the same shape;
- **`--total-scale-factor` is not optional for a PDF.js text layer.** PDF.js lays a
  span out at `transform × viewport.scale × devicePixelRatio` and divides the
  result back down through that custom property, so a canvas rendered at `factor`
  device pixels per CSS pixel must be paired with `factor / devicePixelRatio`. The
  rule is in `src/client/renderers/pdf/geometry.ts`, the value is written by
  `text-layer.ts`, and the browser suite asserts the alignment;
- **a percentage `rootMargin` is not safe under its own effect.** A `100% 0px`
  margin is measured against the scroll container, whose height is a consequence
  of how many pages have rendered, so the first page's render expands the margin
  until the next page is inside it — the probe measured the whole document
  rendering on open while the code still read as lazy. The margin is now a fixed
  1200 CSS pixels against the viewport;
- **`PDFPageProxy.cleanup()` releases what the text layer reads.** Canvas and text
  must be one operation that cleans up after both have settled; cleaning up when
  only the canvas has finished leaves the spans empty and makes a text page look
  like a scan. `render-page.ts` states this and the client suite asserts it;
- **a listener registered on the tab's signal belongs to the operation, not to the
  tab.** `{ once: true }` is not a release strategy when the signal outlives the
  work: it defers every registration to the tab's own abort, which for a signal
  that lives as long as a preview does means a finished operation stays reachable
  from it for as many times as the page re-rendered. Task 7A is the instance, and
  the rule generalizes to any later renderer that takes the tab signal directly:
  attach in the operation, detach at `cancel()` and at settlement;
- the asset table is keyed by exact filename from the pinned package, so a
  `pdfjs-dist` bump changes it. `pnpm build` re-reads the installed package, so the
  artifact follows the pin automatically, and `tests/unit/pdf-bundle.spec.ts`
  asserts one representative asset per family;
- the real-DSH suites address fixtures by a session-scoped
  `dsh-resource://file/session/<id>/<path>` URL, which resolves against the
  Session's workspace root. `tests/browser/helpers/shell.ts` points the instance
  at this repository before either suite runs, because a fresh browser context has
  no selection of its own and the wrong root fails every fixture with
  `workspace-file/not-found` — which reads like a renderer defect;
- `tests/fixtures/pdf/` is committed, and its `README.md` records each fixture's
  provenance. The CJK fixture's font is **not** committed: the generator resolves
  a locally installed font, verifies from the font's own `name` and `OS/2` tables
  that it may be embedded and subset, and embeds a subset. A machine with none of
  the documented candidates fails the generator rather than producing a fixture
  nobody can explain.

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

### Task 15U — production UI/UX release audit

Audit round over the production UI that Tasks 1–15 built. No feature was added,
no renderer functionality was extended, and the selection kernel, provenance,
quote formatting, composer bridge, OOXML security and worker/WASM architecture
were not touched. The round began read-only and changed production only where a
defect had been measured first.

**Baseline and isolation.**

| Item | Value |
| --- | --- |
| `main` at audit start | `cfabbf7fc991fac46bbabf40f4c01855e4c8d8e5` (`Merge Task 15 release candidate verification`) |
| Evaluation branch | `eval/deepseek-v4.1-flash-task15u-ui-20260920` |
| Worktree | `E:\Projects\DSHarness\dsh-document-selection-ask-deepseek-task15u-ui-20260920` |
| DSH runtime | `0.1.5-rc.2` — contract pin, `PATH` CLI and the browser instance all rc.2 |
| Release candidate before the audit | tarball `A5CC5012…`, `lib/client.js` `735F8B77…`, `lib/index.mjs` `FAC72B86…` |

The audit ran against a live DSH `0.1.5-rc.2` web instance with the plugin
mounted (`dsa-smoke` profile linked at this worktree), and against a second
instance booted from a **disposable release profile** (`dsa-t15u-release`) whose
plugin came from the packed `.tgz` rather than from the repository.

**What was measured, and how.** A new suite, `tests/browser/ui-release.spec.ts`
(17 cases), encodes the objective gates: viewport containment and
`elementFromPoint` hit tests at the button's own centre for the four required
viewports (1024×768, 1280×720, 1440×900, 1920×1080); placement after a real
preview scroll, a viewport resize and a real drag of the shell's column handle;
the unforced actionability check; Tab traversal, focus-ring geometry, Enter and
Space activation, composer focus return and `auto-submit = 0`; a 24 px target
measurement; contrast computed from resolved colours for the Ask button in both
its states, for the renderer status surfaces in both themes and for the workbook
status; the live-notice region's existence before its message; the workbook
no-rectangle fallback; and both locales through DSH's own language resolution.
Screenshots were written only as human evidence, outside the repository, and no
`toHaveScreenshot()` baseline was committed: this machine's rasteriser and GPU
must not become the release gate.

**Read-only findings, and what happened to each.**

| # | Surface | Severity | Measured evidence | Outcome |
| --- | --- | --- | --- | --- |
| 1 | PPTX loading copy on the renderer's own desk | BLOCKING | 13 px `#666` on `#555555` = **1.30:1** | remediated |
| 2 | DOCX loading copy on the renderer's own desk | BLOCKING | 13 px `#666` on `#808080` = **1.45:1** | remediated |
| 3 | DOCX page clipped with no route to it | MAJOR | page left edge at x=595 against a scrollport starting at x=704 with `scrollWidth == clientWidth == 576`: **109 px permanently unreachable** | remediated |
| 4 | Ask fallback over the composer's editable surface | MAJOR | with an XLSX selection the button occupied `[576,345,102×32]` inside the card `[296,333,382×114]`, overlapping the input box `[296,341,378×52]` by 3 136 px² (16 %); a press in the overlap hit the button | remediated |
| 5 | Renderer notices bypassing the locale table | MAJOR | PDF `重试` and `PDF 预览需要完整文件内容。`, the DOCX/PPTX/XLSX no-bytes copy, the two XLSX engine failures and the English `aria-label="Workbook sheets"` all rendered in a language other than the resolved one | remediated |
| 6 | Live region created already populated | MINOR | `[data-dsa-selection-error]` came into existence in the same commit as its text | remediated |
| 7 | XLSX error copy below the text threshold | MINOR | 13 px `#e5484d` on white = **3.91:1** | remediated |
| 8 | XLSX sheet tablist incomplete as an ARIA tab widget | NOTE | `aria-controls` and roving `tabindex` are absent; the four properties this round requires — accessible names, keyboard reachability, exposed active state, focus indicator — all hold | recorded, not changed |
| 9 | PDF page stays white in dark theme | NOTE | `#ffffff` page under `body[data-ds-dark-theme]` | recorded as a deliberate scoping decision: a darkened page would destroy the contrast of the PDF's own rasterised text |
| 10 | Keyboard traversal depends on tab order | MINOR | from the page background the traversal reaches the button on the `dsa-smoke` shell and does not on the minimal release shell, because passing through the composer's editable surface collapses the browser selection and the kernel then clears the snapshot by its documented contract | recorded; closing it would require changing the frozen selection architecture, which this round is not authorised to do |

**Claims checked and rejected.** Three source-derived findings did not survive
measurement and are recorded as rejected rather than fixed. The PPTX
`scrollportRef` claim assumed the plugin's own section scrolls; measured, the
section is 736 px tall inside a 644 px body and is **not** scrollable, so the
shared preview body the plugin reports is the correct scroll owner. The XLSX
sheet-tab claim predicted a clipped viewer bottom; measured,
`scrollHeight == clientHeight == 644` and the viewer viewport ends exactly at the
root's bottom edge. The toast claim predicted an inverted label on a light toast
in dark theme; measured, the pairing resolves to `#f9fafb` on `#43454a` and
holds. One hypothesis of this audit was rejected the same way: the `--dsw-*`
tokens are declared on `body`, not on `:root`, so reading them from
`document.documentElement` returns empty while the overlay resolves them
correctly.

**A defect introduced by this round, and found by it.** The first remediation
gave the DOCX/PPTX status surfaces a themed card with a danger-coloured failure
state. Measuring the real failure surface afterwards showed that
`--dsw-alias-state-danger-primary` resolves to **nothing** in rc.2, so the
literal fallback painted: `#b42318` on the dark card `rgb(35,35,36)` measured
**2.39:1**. The failure state is now distinguished by its `data-dsa-*-status`
attribute and by the copy itself, and its text uses the label token, which
follows both themes. Status contrast in dark theme is now a gate in the suite
rather than a one-off measurement.

**Production changes, and the reason for each.**

| File | Change | Reason |
| --- | --- | --- |
| `src/client/ui/position.ts` | the fallback clears the composer card — above it, below it only when the card is pinned to the top | finding 4 |
| `src/client/ui/SelectionErrorToast.tsx` | the live region is always mounted and the message is its child | finding 6 |
| `src/client/ui/styles.ts` | an inert zero-size rule for the always-mounted region | finding 6 |
| `src/client/ui/locales.ts` | added `RendererStrings` and its two tables **additively**; the six-key `SelectionStrings` contract is unchanged | finding 5 |
| `src/client/renderers/{pdf,docx,pptx,xlsx}/*Body.tsx` | resolve the new renderer copy; the DOCX/PPTX status markup moved from inline colours to a styled attribute | findings 1, 2, 5 |
| `src/client/renderers/{docx,pptx}/styles.ts` | a themed, self-painted status card; DOCX wrapper `min-width: max-content` | findings 1, 2, 3 |
| `src/client/renderers/xlsx/styles.ts` | a darker danger fallback for the failure copy | finding 7 |
| `src/client/renderers/xlsx/XlsxSheetTabs.tsx` | localized accessible name | finding 5 |
| `tests/client/selection-overlay.client.spec.tsx` | three fallback expectations updated to the corrected offsets, each with the measured reason in its comment | finding 4 — the expectations pinned the defective placement; no assertion was weakened |

**Post-remediation evidence.**

- Renderer failure surfaces reached on a cold shell with corrupted fixture bytes:
  PDF `无法显示文档：Invalid PDF structure.` with its retry control at
  **18.90:1** and **18.43:1**; DOCX `invalid-archive` **18.90:1**; PPTX
  `无法显示文档` **18.90:1**; XLSX `无法显示文档` **6.57:1**. Every surface
  carries the parser's own diagnosis rather than a generic replacement, none
  carries a stack trace, and no stale Ask button survives.
- Dark theme selected through the product's own settings dialog
  (`设置 → 通用设置 → 外观 → 深色`), which sets `body[data-ds-dark-theme]` and
  resolves `--dsw-alias-bg-layer-1` to `#232324`,
  `--dsw-alias-label-primary` to `#f9fafb` and
  `--dsw-alias-button-floating-fill` to `#2c2c2e`. The Ask label measured
  **13.34:1** there and hit-tested to itself.
- The XLSX fallback now sits clear of the card, and probes at 25 %, 50 %, 75 %
  and 95 % across the editable surface's own box never land on a button.
- The refusal notice was measured with a real refusal rather than a synthesized
  one: a real drag over `task11-large.xlsx` produced `Sheet1!A2:I29` (252 cells,
  past the 200-cell limit) and the notice rendered
  `选中的单元格过多，请选择不超过 200 个单元格` at `[499,598,282×34]`, inside the
  viewport, in two wrapped lines with no horizontal overflow, at **12.1:1**
  contrast, with **zero** overlap against the composer card. A hit test at the
  composer's editable surface still reaches the editable surface, and a hit test
  at the notice's own centre reaches the notice; the empty live region is 0×0 and
  the Ask button is correctly absent while the capture is refused.

**Suites and gates.**

| Suite | Result |
| --- | --- |
| `ui-release.spec.ts` (new) | **17 / 0 / 0** — on the worktree build and again on the tarball-installed release profile |
| `universal-selection.spec.ts` | 10 / 0 / 0 |
| `resource-cleanup.spec.ts` | 6 / 0 / 0 |
| `xlsx-selection.spec.ts` | 13 / 0 / 0 |
| `pptx-selection.spec.ts` | 10 / 0 / 0 |
| `docx-selection.spec.ts` | 6 / 0 / 0 |
| `pdf-renderer.spec.ts` | 10 / 0 / 0 |
| `real-dsh-textpreview.spec.ts` | 8 / 0 / 0 |
| required matrix total | **63 passed, 0 failed, 0 skipped** (15.4 min, `--workers=1`) |
| `pnpm check:dsh-contracts` | PASS |
| `pnpm dsh:doctor -- --runtime` | PASS — installed DSH `0.1.5-rc.2`, contract environment consistent |
| `pnpm typecheck` | PASS |
| `pnpm test` | **1 052 passed / 0 failed over 58 files** |
| `pnpm build` | PASS |
| `pnpm verify` | **13 / 13** |
| `npm pack --dry-run` | 92 files — the published file list did not grow |
| `pnpm verify:package` | PASS — 12 checks |
| `git diff --check` | clean |

**Artifact identity.** Production changed, so the Task 15 candidate is
superseded and was **not** reused: `lib/client.js`
`735F8B77EC0B899F9740A8C0591AB7FE0A294C9D5F185A69A9B4A8F7134A183D` →
`C866C7945F41A35EC1BE36C48BEAFB1202AA62D8874F1CDADA911186BB34E285`.
`lib/index.mjs` is unchanged at
`FAC72B86168E002CB6DD2939C1775CAD0D149AFB24C4C2264B1110B079A60F39`, which is
what the predicted split requires: every change is client-side and the host entry
was not touched. Two consecutive `pnpm pack` runs are bit-identical at
`1FEAD2827C7BC3AF3ACB39DD56EC9CE065147D889534A002303F5D6D5E7EE159`. The tarball
was copied outside the repository and installed into a **new disposable rc.2
profile** (`dsa-t15u-release`, pnpm, hoisted linker): the installed
`lib/client.js` and `lib/index.mjs` hash-match the worktree exactly, no file in
the installed tree contains this repository's path, and the only links are pnpm
store hard links. `ui-release.spec.ts` and `universal-selection.spec.ts` were
then run against that instance.

**Environment boundaries of this round.** The browser matrix runs at device pixel
ratio 1; the host display is 2560×1600 at 150 % Windows scaling, which was
recorded but not changed, and OS-scaling rendering beyond that setting is **not
tested**. Browser zoom was exercised as viewport-equivalent CSS pixel sizes at
the 100/125/150 ratios; Chromium's native zoom UI was not driven, and
high-contrast is reported only as Chromium `forced-colors` emulation — Windows
High Contrast itself is **not tested**. macOS, Linux and mobile remain
unverified. Screenshots (the four viewports, edge placement, keyboard focus, the
workbook fallback, dark theme, English and the failure surfaces) live under
`E:\Projects\DSHarness\.t15u-audit\shots`, outside the repository; none is
committed and none is inside the package.

**Release state.** Not published: no `npm publish`, no git tag, no GitHub
Release, and `main` is untouched at `cfabbf7`. The round stops at a verified
release candidate pending an external UI merge audit.

### Task 15UR — final UI release evidence closure

An external review of Task 15U returned **production remediation: PASS
candidate**, **final release evidence: INCOMPLETE**. Nothing in the production
surface was disputed. What was disputed is that the round's evidence did not
cover six things it claimed to, and this round closes exactly those six. No UI was
redesigned, no feature was added, and **no production file was touched**: the
whole round is `tests/**`, `scripts/**` and documentation.

**The browser-collection gap, and its arithmetic.** Task 15 recorded
`pnpm test:browser` as *70 passed*. That number was the whole suite as it stood
then; Task 15U then added a 17-case `ui-release.spec.ts` without deleting any old
spec, editing `playwright.config.ts`, or narrowing `test:browser` (which is still
plain `playwright test`). The round therefore expected the complete collection to
be 87 and had only ever executed 63 of it under the name "required matrix". On
the final tarball instance, `pnpm exec playwright test --list` reports **87 tests
in 9 files**, split `ask-flow.spec.ts` 7, `docx-selection.spec.ts` 6,
`pdf-renderer.spec.ts` 10, `pptx-selection.spec.ts` 10,
`real-dsh-textpreview.spec.ts` 8, `resource-cleanup.spec.ts` 6,
`ui-release.spec.ts` 17, `universal-selection.spec.ts` 10,
`xlsx-selection.spec.ts` 13. `63 + 17 + 7 = 87`: no previously collected case was
lost, and no number was adjusted to meet the prediction.

**The false-pass branches, and what replaced them.** Four cases in
`ui-release.spec.ts` measured the Ask button behind a guard —
`if (after.present && after.box !== null)`, and for the scroll case
`if (after.present && rects.length > 0)` with the anchoring check skipped
whenever the anchor had scrolled out of the viewport. The shape is the defect:
a button that silently disappeared while its selection was still live satisfied
every one of them. Each is now an explicit two-outcome state machine over a
single atomic read of the browser selection and the button together. A live
selection must yield a button that is inside the viewport, reachable by an
unforced hit test at its own centre, pressable by a trial click, and placed where
`src/client/selection/viewport.ts` puts it — within a bounded gap of the anchor
when the anchor is visible, pinned to the near edge when it is not. A selection
that is genuinely gone must yield no button. A persistent disagreement between
the two halves is waited out on the selection lifecycle's own frame boundary and
then fails with every pair it observed. The scroll case additionally clears the
selection with a real press on the preview body and asserts the absent half on
the same page. The dark-theme case previously measured the Ask contrast behind
the same kind of guard, so a workbook selection that produced no button passed on
the strength of its status copy; the button is now required before anything about
it is measured.

The hardening is not decorative, and the round's own first run is the evidence:
the reworked scroll case failed with *"the live selection is above the viewport,
so the button must be pinned to the top edge; it is at y=25.8"* — a real
disagreement between a button still carrying the previous scroll's placement and
a selection that had moved. The settle helper now waits for the lifecycle's frame
boundary plus a stability window, and the case passes for the right reason. No
`if (…present…)` branch that can pass without asserting survives in the file.

**Dark-theme XLSX failure contrast, measured on the real surface.** The failure
copy's contrast had only ever been measured in the light theme, and the same
round had shown that `--dsw-alias-state-danger-primary` can resolve to nothing in
rc.2. Reaching the surface needed a fixture nothing had: `xlsx-corrupt`, a
78-byte file whose bytes are a ZIP local-file header followed by
`task11-corrupt.xlsx: deliberately truncated archive, no central directory`. It is
written from the smoke bootstrap's own literal table rather than committed as a
binary, so the refused bytes are reviewable, and it is opened through the driver's
ordinary public control — no look-alike `div.dsa-xlsx-error` was ever inserted. On
the final tarball instance, in the product's own dark theme: `--dsw-alias-bg-canvas`
resolves to **empty**, so the XLSX root's `background-color` falls back to
`#ffffff`; `--dsw-alias-state-danger-primary` resolves to **empty**, so the failure
copy's `color` falls back to `#b42318`; the composited ancestor background measures
`rgb(255, 255, 255)`, the copy measures `rgb(180, 35, 24)`, and the pair measures
**6.57:1** — identical to the light theme, because neither token resolves and both
declared fallbacks are the light-surface values. The requirement is ≥ 4.5:1 and it
holds. **No XLSX dark contrast defect exists and no production fix was needed**;
the architecture claim is now an assertion in the dark case (an unresolved danger
token must leave the declared fallback as the colour that paints) rather than
prose. The twenty-sixth fixture changed the driver strip's row count from
`ceil(26 / 4)` to `ceil(27 / 4)`, which is seven either way; re-measured at
1,280 x 720 the strip box is `292, 490.4, 408 x 217.6` — the same y and height as
the Task 13 measurement — with all twenty-six controls inside the viewport.

**Full browser suite, against the final tarball.** The run used the disposable
rc.2 profile `dsa-t15u-release`, whose plugin is the `file:` install of
`C:\Users\20659\AppData\Local\Temp\dsa-t15u-final\dsh-document-selection-ask-0.1.0.tgz`
— **not** a worktree link: the installed package directory is a real directory,
and its `lib/client.js` and `lib/index.mjs` hash-match the frozen tree. With
`DSH_SMOKE_URL` non-empty and `--workers=1`, `pnpm test:browser` (no spec filter)
collected 87 and reported **87 passed, 0 failed, 0 skipped in 21.7 min**. The
required matrix is the 63 of Task 15, unchanged and included; `ui-release` passed
17; **`ask-flow` passed 7, failed 0, skipped 0** — reported on its own, not folded
into the 63.

**Eight-format core acceptance on the final tarball.** Because Task 15U changed
shared UI production code, all eight classes were operated again on the installed
tarball rather than carried over. Each was performed with a real draft typed by
keyboard, the class's own real gesture, a real press on the Ask button, and then
measured for draft preservation, quote count, focus and submission. The observed
provenance of each:

| Class | Gesture | Observed provenance |
| --- | --- | --- |
| TXT | real press + Shift-click on `beta` | `[来源：task5b-smoke.txt，第 2 行]` |
| Markdown | real horizontal drag across `alpha paragraph` | `[来源：task5b-smoke.md]` |
| code | real press + Shift-click on `const beta = 2` | `[来源：task5b-smoke.ts，第 2 行]` |
| CSV | real press + Shift-click on `south,57,beta` | `[来源：task13-smoke.csv，第 3 行]` |
| PDF | real press + Shift-click across the page-1 text layer | `[来源：task7-single-page.pdf，第 1 页]` |
| DOCX | real press + Shift-click on paragraph 1 | `[来源：task9-paragraphs.docx，第 1 渲染页]` |
| PPTX | real drag across slide 1 | `[来源：task10-text-two-slides.pptx，第 1 张幻灯片]` |
| XLSX | real drag over `Sheet1!A1:C3` | `[来源：task11-simple.xlsx，Sheet1!A1:C3]` |

All eight: Ask published with the contract label `询问 DeepSeek` and reachable by
an unforced hit test at its own centre; the draft still began with the sentinel
and had gained exactly one quote block; the composer held focus afterwards; the
transcript row count was unchanged and the capture-phase `submit` observer counted
**0** submissions. This is agent-performed scripted acceptance on the real
application, not a human hand on the mouse; it is recorded as such.

**Artifact identity, and which packaging command reproduces it.** With
`src/**` and the package surface unchanged from `7cd090b`, the identity holds:
`lib/client.js` `C866C7945F41A35EC1BE36C48BEAFB1202AA62D8874F1CDADA911186BB34E285`,
`lib/index.mjs` `FAC72B86168E002CB6DD2939C1775CAD0D149AFB24C4C2264B1110B079A60F39`,
and the tarball
`1FEAD2827C7BC3AF3ACB39DD56EC9CE065147D889534A002303F5D6D5E7EE159` — reproduced
after a clean `pnpm build` of this tree. One correction to the Task 15U record is
required here, and it is a statement about the tool rather than the artifact:
**`npm pack` is the command that reproduces that byte stream, not `pnpm pack`.**
`pnpm pack` (11.7.0) normalises the shipped manifest, moving `scripts` to the end
of the object and dropping the trailing newline, which yields
`4A6D6114105BF28462EBBA5F6FBB32A078835064E6405F19CC49372ECECC915A`. The two
tarballs are otherwise identical: 92 entries each, 91 of them byte-identical, the
same keys and the same values in the manifest, and both pass
`pnpm verify:package` (92 files, 82 declarations, every check PASS). The Task 15U
entry above says "two consecutive `pnpm pack` runs" — the runs were consecutive
and bit-identical, but the tool was `npm pack`, and this entry is the
authoritative one.

**Fresh checkout.** A clean `git clone` of this branch, outside the repository, at
the candidate commit `fab0a05`: no `lib/`, no `node_modules/`, no `.tgz`, no
`smoke-fixtures/`, no `test-results/` and no `playwright-report/` before anything
ran, and the clone's own worktree list contains only itself. `pnpm install
--frozen-lockfile` 0; `pnpm test` **1052 passed over 58 files**; `pnpm typecheck`
0; `pnpm check:dsh-contracts` PASS; `pnpm build` 0; `pnpm verify` 13/13;
`npm pack --dry-run` **92 files** (6.4 MB packed, 16.7 MB unpacked). The built
`lib/client.js` and `lib/index.mjs` hash-match the frozen candidate exactly. The
only external compatibility input was `DSH_INSTALL_NODE_MODULES` pointing at the
installed `0.1.5-rc.2`; no `lib/`, link or build output was read from the original
worktree.

**Static matrix on the frozen head.** `pnpm check:dsh-contracts` PASS with
`runtime discovery = DSH_INSTALL_NODE_MODULES override` and `PATH CLI report =
NOT PROBED (explicit override)`; `pnpm dsh:doctor -- --runtime` PASS, installed
DSH `0.1.5-rc.2`, contract environment consistent; `pnpm typecheck` 0;
`pnpm test` 1052/1052 over 58 files; `pnpm build` 0 with both bundles
byte-identical afterwards; `pnpm verify` **13/13**; `npm pack --dry-run` 92 files;
`pnpm verify:package` PASS; `git diff --check` clean.

**Boundaries this round did not move,** and deliberately: XLSX full ARIA tabs
pattern stays a NOTE; the XLSX sheet surface and PDF pages stay white in dark
theme because `--dsw-alias-bg-canvas` does not resolve in rc.2 — which is what
makes the 6.57:1 above a statement about the light canvas rather than about a
dark one; Chromium's native zoom UI, Windows High Contrast and OS-scaling
switching are **not tested**; macOS, Linux and mobile remain unverified. None was
addressed, and none is claimed.

**Release state.** Not published: no `npm publish`, no git tag, no GitHub
Release, `main` is untouched at `cfabbf7`, and PR #9 stays a draft. The round
stops at a verified release candidate pending an external merge audit.

### Task 15UR-D — canonical pack command and artifact re-freeze

Documentation and package-surface only: no `src/**`, `tests/**`, `scripts/**`,
`package.json` or lockfile change, and the runtime bundle is byte-identical to
the Task 15UR freeze.

**Canonical pack command = `npm pack`.** It is the command that reproduces every
candidate SHA recorded in this file, and it is now the only packaging step named
by the packaged `README.md` and by the release-validation path in
`docs/testing.md`; both previously said `pnpm pack` and both were corrected in
this round, together with the `private: true` wording. The byte-level difference
is retained as documented evidence rather than written out of the record: on the
same tree pnpm 11.7.0 emits 92 entries of which 91 are byte-identical to the
`npm pack` artifact, the single difference being the shipped `package.json`,
where `scripts` moves to the end of the object and the trailing newline is
dropped — the same key set and the same values, equal under an order-insensitive
deep comparison. The pnpm artifact passes every `pnpm verify:package` check, so
nothing here claims that `pnpm pack` is broken or that its tarball cannot be
installed; it is simply not the command behind the recorded SHA.

**Scripted acceptance is not human manual acceptance.** The eight-format core
acceptance in Task 15U and Task 15UR is agent-performed scripted acceptance on
the real application, not human execution of `docs/manual-acceptance.md`; this
round does not record that checklist as executed — **human manual acceptance =
NOT PERFORMED IN TASK 15UR-D.** Under the current review, scripted real-app
acceptance together with the 87 / 0 / 0 browser matrix, the UI geometry and
accessibility measurements and the tarball installation close this code and UI
change, and a human visual sanity check is a recommended pre-publication step
rather than a merge blocker for PR #9. `docs/testing.md` now states this
distinction explicitly.

**Re-frozen artifact.** The packaged `README.md` is in the `files` allowlist, so
correcting it necessarily moves artifact identity. The Task 15R candidate
`1FEAD2827C7BC3AF3ACB39DD56EC9CE065147D889534A002303F5D6D5E7EE159` is
superseded by `93EE00FBC257A91AD273381839176663A544D75B3C5DA4917751526B61B6B9F9`
(6374493 bytes; 6.4 MB packed, 16.7 MB unpacked, 92 files; two consecutive
`npm pack` runs identical). Extracting both artifacts and comparing all 92
entries isolates the change to exactly one packaged file, `README.md` — the other
91 are byte-identical. `lib/client.js`
`C866C7945F41A35EC1BE36C48BEAFB1202AA62D8874F1CDADA911186BB34E285` and
`lib/index.mjs`
`FAC72B86168E002CB6DD2939C1775CAD0D149AFB24C4C2264B1110B079A60F39` are
unchanged. The same correction moves the pnpm artifact from `4A6D6114…` to
`A630FBBD132B7F0F5AA33FD062752EA7CF3BBD5C9B103ED52F312550E83BE548`, which is the
expected consequence of a changed packaged README rather than a new finding.

**Independent install of the re-frozen artifact.** The final `npm pack` tarball
was installed with `dsh plugin --profile dsa-t15urd add <tarball>` into a profile
newly created from the shipped web template on DSH `0.1.5-rc.2`. The plugin lands
as an unpacked directory rather than a link into this checkout, and the installed
`lib/client.js` and `lib/index.mjs` hash-match the frozen values above. The
instance booted with no host error output, and the targeted `universal-selection`
smoke on it is **10 passed / 0 failed / 0 skipped** — the evidence that the
re-frozen tarball installs, boots and actually executes its client bundle. The
87 / 0 / 0 full matrix recorded in Task 15UR remains the browser evidence for
this same runtime bundle; the eight-format scripted real-app acceptance was not
re-run, because neither the runtime bundle nor the tests changed. A fresh clone
of the frozen commit reproduces the same two bundle hashes and the same
`93EE00FB…` tarball through `pnpm install --frozen-lockfile`, `pnpm build` and
`npm pack`.

### Task 16 — v0.1.2 PDF high-DPI rendering and TextLayer alignment hotfix

**v0.1.0 KNOWN PDF HIGH-DPI DEFECT.** The released selectable PDF renderer drew its
canvas at a *lower* resolution than the display on every display above 1×, and laid
its selectable text out at that same reduced scale. The defect shipped in
`v0.1.0` (tarball `93EE00FB…`) and is present unchanged in `0.1.1`, which was
published to npm from `release/npm-v0.1.1` without touching `src/client/**`, so both
released versions carry it.

```text
symptom           a PDF page is visibly blurry on a scaled display, and the blue
                  selection sits offset and shrunk relative to the glyphs it covers
affected surface  src/client/renderers/pdf/{geometry,render-page,text-layer}.ts
                  (canvas backing factor and --total-scale-factor)
reported on       Windows 2560x1600 at 150 % scaling, i.e. devicePixelRatio 1.5
root cause        two independent errors with one shared premise
                  1. a "detail tier" whose `finest` setting asked for
                     `devicePixelRatio / 2`, selected at devicePixelRatio >= 1.5, so
                     a 150 % display was rendered at 0.75 device pixels per CSS
                     pixel and a 200 % display at 1.0;
                  2. `--total-scale-factor` was written as
                     `backing.factor / devicePixelRatio`, on the theory that
                     PDF.js's own `devicePixelRatio` term had to be cancelled
v0.1.2 fix        the backing factor is the device pixel ratio bounded only by the
                  two frozen caps, and `--total-scale-factor` is `cssViewport.scale`
regression        tests/unit/renderers/pdf-geometry.spec.ts (DPR matrix),
coverage          tests/client/pdf-runtime.client.spec.tsx (raster and text
                  decoupling), tests/client/pdf-text-layer.client.spec.tsx,
                  tests/browser/pdf-hidpi.spec.ts (four real device scale factors,
                  glyph-level ink comparison), plus the alignment-probe fixture
```

**Reproduction, on the released implementation.** The released defect was measured
before any production file was touched, on the real-user document
`正交横波交汇点分析.pdf` (12 pages, 728,611 bytes) opened in a real DSH instance at
a 1700×1000 viewport, and independently on the committed probe fixture. The
per-ratio numbers are identical in shape for both, because the defect is a function
of the ratio and not of the document:

```text
                    released (v0.1.0 / 0.1.1)                fixed (v0.1.2)
DPR   CSS box       backing      backing/CSS  textScale     backing      backing/CSS  textScale
1.0   765x1081.91   765x1081     1.000        1             765x1081     1.000        1.2851095…
1.25  765x1081.91   956x1352     1.250        1             956x1352     1.250        1.2851095…
1.5   765x1081.91   573x811      0.749        0.5           1147x1622    1.499        1.2851095…
2.0   765x1081.91   765x1081     1.000        0.5           1530x2163    2.000        1.2851095…
```

At devicePixelRatio 1.5 the released renderer produced a backing store **smaller
than the CSS box** — an upscaled raster, i.e. the reported blur — and a text layer
297 CSS pixels wide inside a 765-pixel page with spans rendered at 8.61 px where the
fixed build renders 22.13 px. The glyph-level check on the released build found
**zero ink pixels** inside the rectangle the text layer reported for the page's
headline, at 1.5× and at 2×: the selection was not merely offset, it was over empty
paper. That is the reported "blue selection scaled and offset" symptom, measured.

`docs/STATUS.md:3337-3341` (Task 15U) had already recorded that "the browser matrix
runs at device pixel ratio 1 … OS-scaling rendering beyond that setting is **not
tested**", and `docs/STATUS.md:482-485`, `docs/STATUS.md:2968-2970` and
`docs/04-format-adapters.md:62` restated the inverted contract as a design
guarantee. Those statements were measurements of a suite that could not reach the
defect; Task 16 replaces the claim with the four-ratio matrix above.

**The PDF.js 6.3.289 contract, read from the installed source.** No part of the fix
rests on this project's own reasoning about the library. From
`node_modules/pdfjs-dist@6.3.289`:

```text
build/pdf.mjs:15083   TextLayer constructor:  this.#scale = viewport.scale * OutputScale.pixelRatio
build/pdf.mjs:15282   #layout uses #scale only for the canvas measurement font and --scale-x
build/pdf.mjs:15244   span --font-height is written in CSS pixels: `${fontHeight.toFixed(2)}px`
web/pdf_viewer.css    span font-size = --text-scale-factor × --font-height
web/pdf_viewer.css    container width/height = --total-scale-factor × rawDims.pageWidth/Height
web/pdf_viewer.css    .pdfViewer{--scale-factor:1} .pdfViewer .page{--total-scale-factor:calc(--scale-factor × --user-unit)}
web/pdf_viewer.mjs    PDFPageView sets --scale-factor to this.viewport.scale / scale × PDF_TO_CSS_UNITS
build/pdf.mjs:15096   the library never calls setLayerDimensions with a devicePixelRatio term
build/pdf.mjs:10991   CanvasGraphics only *consumes* the caller's transform; it never resizes the canvas
```

`--total-scale-factor` multiplies a CSS-pixel quantity and the reference viewer sets
it from `viewport.scale` alone, so the value that puts a span on its glyph is the CSS
viewport's scale. The library's `devicePixelRatio` term sizes a text-measurement font
and the `--scale-x` correction; it reaches neither the span box nor the span's
position, and it was never the renderer's to cancel. `TextLayer`'s container *width*
is also derived from that variable, which is why the released error shrank the layer
itself (297 px) and not only the glyphs.

**Production fix.** Three files, all inside the PDF renderer:

- `src/client/renderers/pdf/geometry.ts` — `PdfRenderDetail`, `detailFor`,
  `requestedFactor`, `FINEST_DETAIL_RATIO` and `pageBackingGeometry` are deleted
  rather than redefined, because the tier inverted the meaning of its own name. The
  surviving `backingGeometry(cssWidth, cssHeight, devicePixelRatio)` requests exactly
  `devicePixelRatio` and bounds it by the two frozen caps and by nothing else, and
  `PdfBackingGeometry` no longer carries `scale`, `detail` or `textScaleFactor`.
- `src/client/renderers/pdf/render-page.ts` — the canvas box and the text layer take
  the same CSS viewport; `configureTextLayer` is handed `cssViewport.scale`, and the
  raster factor reaches only the backing size and the output transform.
- `src/client/renderers/pdf/text-layer.ts` — the parameter is renamed
  `viewportScale` and documented as the CSS viewport scale.

`MAX_CANVAS_DIMENSION = 16_384` and `MAX_CANVAS_PIXELS = 64 Mi` are unchanged and
still bind: a page large enough to exceed either is rendered at a factor below the
ratio, and the text layer stays on its glyphs because it is no longer a function of
the raster. Selection semantics, provenance, the quote format, the composer bridge,
the same-root rule and the Ask auto-submit policy are untouched, and the change is
confined to the PDF renderer: `git diff 436bb052 -- src` names no DOCX, PPTX, XLSX,
selection-kernel, composer or OOXML file.

**Regression coverage, and the proof that it kills the released build.** The unit
matrix asserts `factor === devicePixelRatio` for 1, 1.25, 1.5, 2, 2.5 and 3 on an
ordinary page, keeps both caps binding under a raised ratio, and asserts that the
removed fields stay removed. Against the released `geometry.ts` the same file is
**9 failed / 10 passed**, with `expected 0.75 to be 1.5`, `expected 1 to be 2` and
`expected 1.25 to be 2.5` among the failures. The client suite asserts that the
canvas backing scales with the ratio while the CSS box and `--total-scale-factor`
do not, at all four ratios. The browser suite
(`tests/browser/pdf-hidpi.spec.ts`) fails **8 of 8** against the released client
bundle, with `the canvas is backed at 0.7500 device pixels per CSS pixel on a 1.5×
display`, `the canvas is backed at 1.0000 … on a 2× display`, `the run's band must
contain ink — received 0`, and `expected 1.5, received 0.7490196078431373` for the
CJK page; those are the recorded `OLD IMPLEMENTATION REGRESSION PROOF` lines. The
suite opens **real browser contexts** at `deviceScaleFactor` 1, 1.25, 1.5 and 2,
asserts each context's own `window.devicePixelRatio` before measuring, and compares
the canvas's own pixels — read with `getImageData()` — against the rectangle the text
layer reports for the same words, so it no longer depends on "the span's box is
inside the canvas's box", which a 0.75× text layer satisfies.

**Real-world acceptance.** The non-committed real-user document was staged into the
session workspace by hand for the run and is not in this repository: it appears in
no commit, in no fixture and in no tarball. After the fix, on the same 1700×1000
viewport, its first page measures `backing/CSS = 1.5` at devicePixelRatio 1.5
(1147×1622 for a 765×1081.91 CSS box) and `= 2.0` at 2.0, with
`--total-scale-factor` identical at every ratio and the headline's raster ink
1.48 px from the box the text layer reports for it, against a relative scale error of
0.973. Before the fix the same run found no ink at all under that box at 1.5× and
2×. Evidence screenshots for both states are written outside the repository, under
`E:\Projects\DSHarness\.task16-pdf-hotfix\{before,after}`, and are not committed.

**Environment boundaries of this round.** `deviceScaleFactor` is the browser's own
emulation of a display and no case patches `window.devicePixelRatio` — the property
is read and asserted. What is *not* verified is a live move of one window between two
displays of different scale: the four ratios are four separate boots, and the
renderer's re-render on a ratio change is covered where the ratio is an input and by
the resize case, not by a real monitor migration. The host display is 2560×1600 at
150 % Windows scaling.

**Known issue observed in the upstream library, not in this renderer.** The
`--scale-x` correction PDF.js applies is computed from a canvas measurement of the
*substituted* font, so on a run the browser's own ink is a few percent narrower than
the box PDF.js derives from the PDF's declared advance widths. Measured on the
alignment probe it stays within ±7 % at all four ratios and is independent of the
device pixel ratio; it is recorded here as an observation about the pinned library
and is not worked around. The pinned version is unchanged at `pdfjs-dist@6.3.289`.

**Release candidate.** `package.json` moves `0.1.0` → `0.1.2`, `private: true` is
removed, and `publishConfig {access: public, registry: https://registry.npmjs.org/}`,
`repository`, `homepage` and `bugs` are declared. The version is **0.1.2 and not
0.1.1** because `dsh-document-selection-ask@0.1.1` is already on the public registry
(published 2026-09-20T11:31:54Z, `dist-tags.latest = 0.1.1`) and npm rejects a
re-publish of an existing version; the human operator selected 0.1.2 for this round.
Nothing is published by Task 16: no `npm publish`, no `v0.1.2` tag, no GitHub
release, and the published `0.1.1` package, the `v0.1.0` tag and the `v0.1.0`
release asset are untouched. `dsh-document-selection-ask` remains an available,
owned name — the published `0.1.1` is this project's own.

## Synchronization

Every completed Task is committed locally and pushed to `origin`, and the round
is reported as PASS only after `origin/<branch>` is verified to point at local
HEAD. A Task whose local commit succeeds and whose push fails is
LOCAL PASS / GITHUB SYNC BLOCKED and does not proceed to the next Task.
