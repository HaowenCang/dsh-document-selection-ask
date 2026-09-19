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

`LICENSE` is the standard MIT text with the copyright holder taken from the
authenticated GitHub account. `package.json` declares `"license": "MIT"`.
`THIRD_PARTY_NOTICES.md` records each dependency's own license separately, and it
is now part of the published package. `pdfjs-dist` (6.3.289, Apache-2.0) and
`@zip.js/zip.js` (2.15.0, BSD-3-Clause) are the two shipped runtime dependencies;
the first is bundled with its worker and its three asset families, each of which
carries its own license file in the package and its own row in the notices.
`jsdom` (30.0.1) is recorded as MIT, development/test-only, verified against the
installed package metadata, as are `pdf-lib` (1.17.1) and `@pdf-lib/fontkit`
(1.1.1), which are the fixture generator's own dependencies.

## Next

**Task 13 — Cross-format Playwright acceptance and resource cleanup.**

Task 12 converged the registrations, the selection lifetime, the locale and the
renderer fallback semantics into one owner; it deliberately did not add
cross-format acceptance coverage. Task 13 is where
`tests/browser/universal-selection.spec.ts` and
`tests/browser/resource-cleanup.spec.ts` belong, together with the
`playwright.config.ts` and `scripts/verify.mjs` changes that wire them into the
gate. What Task 12 hands Task 13:

- `ClientRuntime.dispose()` is the one teardown, so a browser case can assert
  that switching documents, closing a tab or disabling the plugin leaves no Ask
  surface, no style node and no stale snapshot across formats without reaching
  into a renderer;
- resource-scoped invalidation is already the contract, so a cross-format case
  can capture in one document, move to another and assert that the first
  document's late cleanup is inert — the property is implemented and unit-tested
  and lacks only its browser acceptance evidence;
- the six locale keys are complete and code-point pinned, so a cross-format case
  can assert each refusal's wording without inventing copy;
- the five existing browser suites are unchanged by this round except for the
  copy assertions the locale migration required; Task 13 adds suites rather than
  extending them.

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

## Synchronization

Every completed Task is committed locally and pushed to `origin`, and the round
is reported as PASS only after `origin/<branch>` is verified to point at local
HEAD. A Task whose local commit succeeds and whose push fails is
LOCAL PASS / GITHUB SYNC BLOCKED and does not proceed to the next Task.
