# AGENTS.md — dsh-document-selection-ask

## Purpose

This repository implements the approved design in:

`docs/superpowers/specs/2026-09-14-dsh-universal-document-selection-design.md`

and the execution plan in:

`docs/superpowers/plans/2026-09-14-dsh-universal-document-selection.md`

The intended primary coding model is DeepSeek v4.1 Flash running under DSH.

## Runtime baseline

Current official runtime, primary blocking real-app runtime and primary compile-contract
baseline: DSH `0.1.5-rc.2`.

The contract packages are pinned to `0.1.5-rc.2` and `pnpm check:dsh-contracts` compiles the
probes against those declarations and compares them with the installed runtime.

`0.1.5-rc.1` is historical backward-compatibility evidence, not a maintained baseline: Task 13
recorded a full real-app matrix on it, and it is no longer the contract pin. No newer release is
declared as a forward target — a later DSH release stays unsupported until both the contract gate
and a real-app acceptance pass on it. Current task status is tracked in `docs/STATUS.md`, and the
support matrix is in `docs/compatibility.md`.

## Mandatory reading order

Before editing any file, read:

1. `AGENTS.md`
2. `docs/superpowers/specs/2026-09-14-dsh-universal-document-selection-design.md`
3. `docs/superpowers/plans/2026-09-14-dsh-universal-document-selection.md`
4. the exact Task being executed
5. only the architecture/support docs referenced by that Task

Do not begin by scanning the entire repository indiscriminately.

## Human-facing language

Unless the human explicitly requests another language:

- all progress updates, Task reports, implementation explanations, blocker reports,
  review notes, and final summaries addressed to the human must use Simplified Chinese;
- fixed technical identifiers, source code, command output, error messages, filenames,
  API names, commit subjects, and quoted upstream text may remain in their original language;
- do not switch the surrounding explanatory prose to Japanese, English, Traditional Chinese,
  or another language merely because source material or a report template uses that language;
- if a required report template contains English field names, keep the field names if useful,
  but write explanatory values and prose in Simplified Chinese.

This rule concerns human-facing communication only. It does not require translating source
code identifiers, upstream API names, existing English repository documentation, or commit
subjects.

## Execution discipline

Execute **one Task only per round** unless the human explicitly requests a larger batch.

For each Task:

1. inspect only the files/contracts required by the Task;
2. write the specified failing test first;
3. run it and confirm the intended failure;
4. implement the minimal production change;
5. run the Task-specific tests;
6. run `pnpm typecheck`;
7. review `git diff --check` and `git diff`;
8. verify all Task stop rules;
9. commit with the exact or semantically equivalent commit subject from the plan;
10. stop and report using the required report template.

Never start Task N+1 in the same round unless explicitly instructed.

## GitHub synchronization

This is a public MIT-licensed GitHub project.

After every completed implementation Task:

1. complete tests/typecheck/build;
2. inspect the diff;
3. commit locally;
4. update status documentation when required;
5. push all Task commits to `origin`;
6. verify that `origin/<current-branch>` points at local HEAD;
7. only then report the Task as PASS.

Never force-push or rewrite published history without explicit human approval.

A Task with a successful local commit but failed GitHub push is
LOCAL PASS / GITHUB SYNC BLOCKED and must not proceed to the next Task.

Documentation commits record the Task and are pushed in the same round as the
code they describe. A round whose code commit reached `origin` while its status
commit stayed local is not synchronized.

## Hard architecture constraints

### DSH boundary

Allowed:
- public package exports;
- `ctx.documentPreviews.register`;
- keyed `sidebar.right.tab.document`;
- `conversation.input.overlay`;
- public input facade/actions including `setDraft`.

Forbidden:
- importing `@deepseek-ai/.../src/...`;
- patching files in `node_modules`;
- reading React fiber;
- accessing Lexical private nodes;
- assigning composer DOM `.value`;
- synthesizing DOM input events to impersonate composer state.

If a required public API is absent, STOP and report:

```text
Expected API:
Observed API:
Installed DSH version:
Compiler error:
Candidate migration path:
```

Do not use `any` to continue.

### Ask semantics

- Preserve existing draft.
- Append one provenance-aware quote block.
- Never call submit automatically.
- Never silently truncate a selection.
- Never capture selection outside a supported Document Preview root.

### Renderer boundary

`selection/` must not import PDF.js, docx-preview, pptx renderer, or react-xlsx.

`quote/` must be pure and must not import React, DOM, DSH, or renderer libraries.

`ooxml/` must not import DOCX/PPTX/XLSX UI components.

Format adapters may depend on the stable DOM/bridge contract of their own renderer only.

### v1 format policy

Supported:
- TXT/plain text
- Markdown
- code/config
- CSV
- PDF
- DOCX
- PPTX
- XLSX

Not supported:
- DOC
- PPT
- XLS
- OCR
- document editing
- persistent annotations

Do not opportunistically add deferred formats.

## Security constraints

Document bytes are untrusted.

- no remote Office/PDF viewer;
- no document upload;
- no CDN PDF worker;
- no CDN XLSX WASM;
- no LibreOffice/MS Office/COM/Poppler;
- OOXML must run shared preflight first;
- respect AbortSignal on every async renderer;
- clean workers, object URLs, observers, and viewer sessions on unmount.

Never log document bytes or selected content at debug/info level.

## Dependency rule

Before adding a dependency:
1. confirm license;
2. confirm current package name/version;
3. confirm it works in browser/client bundle;
4. record it in `THIRD_PARTY_NOTICES.md` if shipped.

PDF.js plugin version must match the exact installed DSH PDF.js version for the primary verified runtime baseline.

Do not mix DSH release-family client packages in the primary development graph. Project-local public dev dependencies must match the primary runtime release family unless a compatibility probe is intentionally isolated.

## Test rule

Do not delete or weaken a failing test to make the Task pass.

Do not replace exact provenance assertions with snapshots that hide semantic regressions.

Browser rendering/geometry behavior belongs in Playwright, not jsdom mocks.

Fixtures must be deterministic and generated from permissively licensed tooling/assets.

## File-size and focus rule

Prefer files under roughly 250–350 lines of implementation code.

If a file exceeds this because it owns two responsibilities, split it before adding a third responsibility.

Do not create:
- `utils.ts` dumping grounds;
- one `DocumentViewer.tsx` containing all formats;
- one adapter with branches for every format.

## Stop rules

Stop immediately when:
- DSH contract mismatch is material;
- renderer requires forbidden private API;
- license is incompatible;
- runtime requires remote document upload;
- selectable text cannot be produced without OCR/rasterization for a format that requires real text;
- CSP/bundler cannot host a required local worker/WASM without architecture change.

Report the blocker; do not redesign silently.

## Required report after every Task

```text
Task:
Status: PASS | BLOCKED

Implemented:
- ...

Tests added:
- ...

Commands run:
- command -> PASS/FAIL

DSH/API observations:
- ...

Diff review:
- no private DSH imports: YES/NO
- no forbidden composer DOM writes: YES/NO
- no auto-submit: YES/NO
- no remote parser assets: YES/NO

Commit:
<sha> <subject>

Blockers:
- none
```
