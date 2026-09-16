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
  - commit: `bb6c9f311bb6ba8d97f97a76c9c680267a38f7be` — `fix: release pdf render abort listeners`
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
- Full `pnpm test`: PASS (624 tests)
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
- GitHub publication — ACTIVE
- Repository visibility — public
- License — MIT
- Repository: `dsh-document-selection-ask`

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
