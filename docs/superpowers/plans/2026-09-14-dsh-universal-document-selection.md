# DSH Universal Document Selection & Ask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a DSH client plugin that lets users select content in TXT/Markdown/code/CSV/PDF/DOCX/PPTX/XLSX previews and append a provenance-aware quote to the current DeepSeek conversation draft.

**Architecture:** Reuse DSH builtin DOM renderers for text/Markdown/code/CSV, add extension renderers for PDF/DOCX/PPTX/XLSX, and normalize all selection sources through a format-independent `SelectionAdapter` registry and `SelectionSnapshot`. The plugin writes only through DSH's public `inputActions.setDraft`, keeps all document parsing local to the browser, and never auto-submits.

**Tech Stack:** TypeScript, React, DSH client plugin APIs, Vitest, Testing Library, Playwright, `pdfjs-dist`, `docx-preview`, `@aiden0z/pptx-renderer`, `@extend-ai/react-xlsx`, `@zip.js/zip.js`, `tsdown`, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-14-dsh-universal-document-selection-design.md`

## Global Constraints

- Primary verified runtime baseline: DSH `0.1.5-rc.1`.
- Forward compile-contract target: DSH `0.1.5-rc.2`.
- Do not claim rc.2 runtime compatibility until a real-app smoke passes.
- DSH Node engine floor: `^22.19.0 || >=24.0.0`.
- v1 supported classes: plain text/TXT, Markdown, code/config, CSV, PDF, DOCX, PPTX, XLSX.
- v1 deferred classes: DOC, PPT, XLS, OCR, editing, annotations, independent side chat, cloud conversion.
- The plugin is client-only in v1; do not add host HTTP routes, shell commands, temp-file converters, LibreOffice, MS Office COM, Poppler, or cloud viewers.
- Reuse DSH builtin text/Markdown/code renderers; do not replace them.
- Register PDF/DOCX/PPTX/XLSX renderers with `priority: 'extension'` and `loading: 'bytes-complete'`.
- Use `conversation.input.overlay` for the Ask UI.
- Use only public `inputActions.setDraft(...)` for composer writes; never modify Lexical internals or DOM values.
- Never call `submit()` as part of the Ask action.
- Never capture arbitrary global page selections; a selection must resolve to one supported Document Preview root.
- Maximum quoted selection: `16_384` UTF-16 code units.
- XLSX maximum selected cells: `200`.
- Do not silently truncate.
- DOCX page provenance must say `渲染页` and must be omitted when pagination cannot be proven.
- Markdown source line numbers must be omitted unless exact source mapping is proven.
- All Office Open XML bytes pass shared ZIP preflight before format parsing.
- OOXML preflight limits: `10_000` entries, `512 MiB` total declared uncompressed bytes, `128 MiB` single entry, `200x` maximum compression ratio; reject encrypted entries, absolute paths, `..` traversal segments, and NUL-containing names.
- PDF workers, XLSX workers/WASM, PPTX workers/assets, and all other runtime assets must be bundled locally; no CDN fallback.
- Every async renderer operation must honor the owning tab `AbortSignal`.
- Disabling the plugin must restore DSH builtin preview behavior.
- No task may suppress an absent DSH API with `any`, private deep-import hacks, React fiber traversal, or direct DOM composer writes.
- Every task follows RED → GREEN → REVIEW → COMMIT and stops after its own commit/report.

---

## File Structure Lock

The implementation must converge on this structure. A task may add a narrowly-scoped helper next to the owning unit, but must not collapse format-specific code into a shared giant component.

```text
dsh-document-selection-ask/
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.json
├─ tsconfig.client.json
├─ tsdown.config.ts
├─ vitest.config.ts
├─ playwright.config.ts
├─ cordis.patch.yml
├─ LICENSE
├─ THIRD_PARTY_NOTICES.md
├─ README.md
├─ README.zh.md
├─ AGENTS.md
├─ DEEPSEEK_START_PROMPT.md
├─ scripts/
│  ├─ verify.mjs
│  ├─ generate-pdf-fixtures.mjs
│  ├─ generate-docx-fixtures.mjs
│  ├─ generate-pptx-fixtures.mjs
│  └─ generate-xlsx-fixtures.mjs
├─ src/
│  ├─ index.ts
│  └─ client/
│     ├─ index.tsx
│     ├─ dsh/
│     │  ├─ register.ts
│     │  ├─ contracts.ts
│     │  ├─ composer-bridge.ts
│     │  └─ focus-composer.ts
│     ├─ selection/
│     │  ├─ types.ts
│     │  ├─ registry.ts
│     │  ├─ kernel.ts
│     │  ├─ dom-range.ts
│     │  ├─ scope.ts
│     │  ├─ normalize.ts
│     │  ├─ limits.ts
│     │  └─ lifecycle.ts
│     ├─ provenance/
│     │  ├─ index.ts
│     │  ├─ text-lines.ts
│     │  ├─ page-range.ts
│     │  ├─ slide-range.ts
│     │  ├─ cell-range.ts
│     │  └─ format.ts
│     ├─ quote/
│     │  ├─ format-selection.ts
│     │  ├─ format-xlsx.ts
│     │  └─ escape-markdown.ts
│     ├─ adapters/
│     │  ├─ dsh-text/
│     │  │  ├─ adapter.ts
│     │  │  └─ lines.ts
│     │  ├─ pdf/
│     │  │  └─ adapter.ts
│     │  ├─ docx/
│     │  │  └─ adapter.ts
│     │  ├─ pptx/
│     │  │  └─ adapter.ts
│     │  └─ xlsx/
│     │     ├─ adapter.ts
│     │     └─ serialize-range.ts
│     ├─ renderers/
│     │  ├─ pdf/
│     │  │  ├─ register.ts
│     │  │  ├─ SelectablePdfBody.tsx
│     │  │  ├─ SelectablePdfBody.module.css
│     │  │  ├─ runtime.ts
│     │  │  ├─ render-page.ts
│     │  │  ├─ text-layer.ts
│     │  │  ├─ worker-asset.ts
│     │  │  └─ errors.ts
│     │  ├─ docx/
│     │  │  ├─ register.ts
│     │  │  ├─ DocxBody.tsx
│     │  │  ├─ DocxBody.module.css
│     │  │  ├─ engine.ts
│     │  │  └─ page-markers.ts
│     │  ├─ pptx/
│     │  │  ├─ register.ts
│     │  │  ├─ PptxBody.tsx
│     │  │  ├─ PptxBody.module.css
│     │  │  ├─ engine.ts
│     │  │  └─ slide-markers.ts
│     │  └─ xlsx/
│     │     ├─ register.ts
│     │     ├─ XlsxBody.tsx
│     │     ├─ XlsxBody.module.css
│     │     ├─ engine.ts
│     │     ├─ viewer-context.tsx
│     │     └─ selection-bridge.ts
│     ├─ ooxml/
│     │  ├─ preflight.ts
│     │  ├─ limits.ts
│     │  └─ errors.ts
│     ├─ ui/
│     │  ├─ SelectionAskOverlay.tsx
│     │  ├─ SelectionAskOverlay.module.css
│     │  ├─ SelectionErrorToast.tsx
│     │  └─ locales.ts
│     └─ assets/
│        └─ asset-imports.d.ts
├─ tests/
│  ├─ unit/
│  ├─ client/
│  ├─ browser/
│  ├─ compatibility/
│  └─ fixtures/
└─ docs/
```

---

### Task 1: Bootstrap the package and prove the DSH public contracts

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `tsconfig.client.json`
- Create: `tsdown.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `cordis.patch.yml`
- Create: `src/index.ts`
- Create: `src/client/index.tsx`
- Create: `src/client/dsh/contracts.ts`
- Create: `src/client/dsh/register.ts`
- Create: `tests/compatibility/contracts.compile.ts`
- Create: `tests/unit/smoke.spec.ts`

**Interfaces:**
- Produces: `applyClient(ctx: Context): void` in `src/client/dsh/register.ts`.
- Produces compile-time proof that `Context['documentPreviews']`, `DocumentPreviewProps`, `PropsRuntime<'conversation.input.overlay'>`, and the public input actions containing `setDraft(text: string): void` are available.
- No renderer or UI is registered yet.

- [ ] **Step 1: Create the package metadata and exact dependency baseline**

Use a package file with these dependency classes:

```json
{
  "name": "dsh-document-selection-ask",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": "^22.19.0 || >=24.0.0"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.client.json --noEmit",
    "test": "vitest run",
    "test:browser": "playwright test",
    "build": "tsdown",
    "verify": "node scripts/verify.mjs"
  }
}
```

Add exact install ranges only after `pnpm view` confirms the current published versions. Pin `pdfjs-dist` to the same exact version used by installed DSH for the primary verified runtime `0.1.5-rc.1`; do not assume the version from memory. Re-verify the pinned version against the forward contract target `0.1.5-rc.2` before any rc.2 runtime claim. The worker and library version must match exactly.

- [ ] **Step 2: Write the failing DSH contract compile probe**

`tests/compatibility/contracts.compile.ts` must contain compile-only assignments equivalent to:

```ts
import type { Context } from '@deepseek-ai/dsh'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'

declare const ctx: Context
declare const documentProps: DocumentPreviewProps
declare const overlayProps: PropsRuntime<'conversation.input.overlay'>
declare const inputActions: InputActions

void ctx.documentPreviews
void documentProps.resourceAddress
void overlayProps
inputActions.setDraft('contract-probe')
```

If the actual public export path differs, inspect the installed DSH declarations and use the documented public export path. Do not deep-import `src/` to force this probe to compile.

- [ ] **Step 3: Run the compile probe and record the observed contract**

Run:

```bash
pnpm install
pnpm typecheck
```

Expected before the package wiring is correct: compile failure from unresolved/mismatched DSH imports.

If the DSH API itself is absent, stop the entire project and report exactly:

```text
Expected API:
Observed API:
Installed DSH version:
Compiler error:
Candidate migration path:
```

Do not continue to Task 2.

- [ ] **Step 4: Add the minimal client entry and plugin patch**

`src/client/dsh/register.ts`:

```ts
import type { Context } from '@deepseek-ai/dsh'

export function applyClient(_ctx: Context): void {
  // Registration is introduced by later tasks.
}
```

`src/client/index.tsx` calls `applyClient(ctx)` from the DSH client plugin entry using the repository's current client-plugin convention.

`src/index.ts` remains host-safe and must not import browser-only dependencies.

- [ ] **Step 5: Add a smoke test**

`tests/unit/smoke.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyClient } from '../../src/client/dsh/register.ts'

describe('package smoke', () => {
  it('exports the client registrar', () => {
    expect(typeof applyClient).toBe('function')
  })
})
```

- [ ] **Step 6: Run the Task 1 gates**

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: all pass.

- [ ] **Step 7: Review the diff**

Reject the task if it:
- imports private DSH `src/*` modules;
- includes renderer code;
- includes `any` to silence missing contracts;
- puts browser code in the host entry.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig*.json tsdown.config.ts vitest.config.ts playwright.config.ts cordis.patch.yml src tests/compatibility tests/unit/smoke.spec.ts
git commit -m "chore: establish dsh document selection plugin contracts"
```

---

### Task 2: Implement the format-independent selection types, normalization, limits, and quote formatting

**Files:**
- Create: `src/client/selection/types.ts`
- Create: `src/client/selection/normalize.ts`
- Create: `src/client/selection/limits.ts`
- Create: `src/client/provenance/format.ts`
- Create: `src/client/quote/escape-markdown.ts`
- Create: `src/client/quote/format-selection.ts`
- Create: `src/client/quote/format-xlsx.ts`
- Create: `tests/unit/selection/normalize.spec.ts`
- Create: `tests/unit/selection/limits.spec.ts`
- Create: `tests/unit/provenance/format.spec.ts`
- Create: `tests/unit/quote/format-selection.spec.ts`

**Interfaces:**
- Produces `DocumentKind`, `SelectionLocation`, `SelectionSnapshot`, `SelectionRejectReason`.
- Produces `normalizeSelectedText(text: string): string`.
- Produces `validateSelectionSize(snapshot: SelectionSnapshot): SelectionRejectReason | null`.
- Produces `formatProvenance(snapshot: SelectionSnapshot): string`.
- Produces `formatSelectionForDraft(snapshot: SelectionSnapshot): string`.
- Produces `appendSelectionToDraft(existingDraft: string, snapshot: SelectionSnapshot): string`.

- [ ] **Step 1: Write the failing type/normalization tests**

Use these exact behavior cases:

```ts
expect(normalizeSelectedText('a\r\nb   \n\n\n\nc  \n')).toBe('a\nb\n\n\nc')
expect(normalizeSelectedText('   \n\t')).toBe('')
```

The normalizer may trim line-end spaces and collapse more than three consecutive blank-line separators down to two blank lines, but must not collapse all internal spaces.

- [ ] **Step 2: Run the normalization test and verify RED**

Run:

```bash
pnpm vitest run tests/unit/selection/normalize.spec.ts
```

Expected: FAIL because `normalizeSelectedText` does not exist.

- [ ] **Step 3: Implement the shared selection model**

`src/client/selection/types.ts`:

```ts
export type DocumentKind =
  | 'text'
  | 'markdown'
  | 'code'
  | 'csv'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'

export type SelectionLocation =
  | { readonly kind: 'lines'; readonly start: number; readonly end: number }
  | { readonly kind: 'pages'; readonly start: number; readonly end: number; readonly fidelity: 'source' | 'rendered' }
  | { readonly kind: 'slides'; readonly start: number; readonly end: number }
  | { readonly kind: 'cells'; readonly sheet: string; readonly range: string }
  | { readonly kind: 'document' }

export interface SelectionSnapshot {
  readonly adapterId: string
  readonly resourceAddress: string
  readonly fileName: string
  readonly documentKind: DocumentKind
  readonly text: string
  readonly location: SelectionLocation
  readonly rects: readonly DOMRectReadOnly[]
  readonly capturedAt: number
}

export type SelectionRejectReason =
  | 'collapsed'
  | 'outside-supported-preview'
  | 'cross-root'
  | 'interactive-control'
  | 'empty-after-normalization'
  | 'too-large'
  | 'too-many-cells'
  | 'renderer-not-ready'
```

- [ ] **Step 4: Implement normalization and make the first tests pass**

Run:

```bash
pnpm vitest run tests/unit/selection/normalize.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing size-limit tests**

Cover:
- 16,384 chars accepted;
- 16,385 chars rejected with `too-large`;
- XLSX `cellCount: 200` accepted by the XLSX serializer contract introduced below;
- 201 cells rejected with `too-many-cells`;
- no silent truncation.

Represent XLSX cell count in `SelectionSnapshot` through an optional adapter-owned metadata structure only if the type remains format-independent; otherwise validate cell count before snapshot construction and cover that behavior in Task 10. Do not add XLSX-only fields to the universal snapshot.

- [ ] **Step 6: Implement the character limit**

```ts
export const MAX_SELECTION_CODE_UNITS = 16_384

export function validateSelectionSize(snapshot: SelectionSnapshot): SelectionRejectReason | null {
  return snapshot.text.length > MAX_SELECTION_CODE_UNITS ? 'too-large' : null
}
```

Run the limit tests.

- [ ] **Step 7: Write failing provenance tests**

Required expected strings:

```ts
'[来源：src/main.ts，第 42–51 行]'
'[来源：paper.pdf，第 3–4 页]'
'[来源：report.docx，第 3–4 渲染页]'
'[来源：slides.pptx，第 12–14 张幻灯片]'
'[来源：budget.xlsx，Sheet1!B4:D9]'
'[来源：README.md]'
```

- [ ] **Step 8: Implement `formatProvenance`**

Rules:
- singular ranges render one number, not `3–3`;
- `pages + fidelity: rendered` uses `渲染页`;
- `document` prints file only.

- [ ] **Step 9: Write failing draft-format tests**

Cover empty and existing draft:

```ts
expect(formatSelectionForDraft(snapshot)).toBe(
  '> [来源：paper.pdf，第 3–4 页]\n> alpha\n> beta\n\n请针对以上选中内容回答：'
)

expect(appendSelectionToDraft('我的问题', snapshot)).toBe(
  '我的问题\n\n> [来源：paper.pdf，第 3–4 页]\n> alpha\n> beta\n\n请针对以上选中内容回答：'
)
```

- [ ] **Step 10: Implement quote formatting**

Every selected line is prefixed with `> `; blank selected lines become `>`.

The formatter must not add a second question suffix if one already exists inside the user's existing draft; it only appends a new selection block.

- [ ] **Step 11: Run Task 2 gates**

```bash
pnpm vitest run tests/unit/selection tests/unit/provenance tests/unit/quote
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/client/selection src/client/provenance src/client/quote tests/unit/selection tests/unit/provenance tests/unit/quote
git commit -m "feat: add universal selection and quote model"
```

---

### Task 3: Implement scoped DOM selection capture and the adapter registry

**Files:**
- Create: `src/client/selection/registry.ts`
- Create: `src/client/selection/dom-range.ts`
- Create: `src/client/selection/scope.ts`
- Create: `src/client/selection/kernel.ts`
- Create: `src/client/selection/lifecycle.ts`
- Create: `tests/unit/selection/registry.spec.ts`
- Create: `tests/client/dom-selection.client.spec.tsx`

**Interfaces:**
- Consumes `SelectionSnapshot`, `SelectionRejectReason`, `normalizeSelectedText`.
- Produces:

```ts
export interface SelectionContext {
  readonly selection: Selection | null
  readonly target: Node | null
  readonly now: number
}

export interface SelectionCapture {
  readonly snapshot: SelectionSnapshot | null
  readonly rejectReason: SelectionRejectReason | null
}

export interface SelectionAdapter {
  readonly id: string
  canHandle(context: SelectionContext): boolean
  capture(context: SelectionContext): SelectionCapture
}
```

- Produces `SelectionAdapterRegistry.register(adapter): () => void`.
- Produces `captureSelection(context): SelectionCapture`.

- [ ] **Step 1: Write failing scope tests**

Construct two DOM roots and assert:
- collapsed selection → `collapsed`;
- anchor in root A, focus in root B → `cross-root`;
- selection inside `textarea` → `interactive-control`;
- selection outside any registered preview → `outside-supported-preview`;
- valid same-root selection returns its range rects and normalized text.

- [ ] **Step 2: Run the failing client test**

```bash
pnpm vitest run tests/client/dom-selection.client.spec.tsx
```

Expected: RED.

- [ ] **Step 3: Implement pure root and interactive-element checks**

Create helpers:

```ts
export function closestElement(node: Node | null): Element | null
export function isInteractiveSelectionNode(node: Node | null): boolean
export function selectionLivesInSameRoot(selection: Selection, root: Element): boolean
```

Interactive exclusion includes:

```css
input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]
```

Do not classify arbitrary buttons as invalid at this generic layer; adapters may need button-like SVG/DOM descendants. The DSH text adapter will additionally reject menu/header chrome by requiring the preview body root.

- [ ] **Step 4: Implement the registry**

Registration must reject duplicate live adapter IDs and return an idempotent disposer.

Capture order is registration order. An adapter whose `canHandle` returns true owns the capture decision; do not fall through after it returns an explicit rejection for its own root.

- [ ] **Step 5: Implement browser Range extraction**

`dom-range.ts`:

```ts
export interface DomRangeCapture {
  readonly text: string
  readonly rects: readonly DOMRectReadOnly[]
  readonly range: Range
}

export function captureDomRange(selection: Selection): DomRangeCapture | null
```

Clone the `Range`; copy the rectangles into plain `DOMRectReadOnly` values so later selection collapse cannot mutate the snapshot geometry.

- [ ] **Step 6: Implement the kernel and transient lifecycle**

`kernel.ts` contains no React.

It exposes:

```ts
export interface SelectionKernel {
  capture(context: SelectionContext): SelectionCapture
  clear(): void
  getSnapshot(): SelectionSnapshot | null
  subscribe(listener: () => void): () => void
}
```

A successful capture stores the immutable snapshot. `clear()` removes it.

- [ ] **Step 7: Run Task 3 gates**

```bash
pnpm vitest run tests/unit/selection/registry.spec.ts tests/client/dom-selection.client.spec.tsx
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/client/selection tests/unit/selection/registry.spec.ts tests/client/dom-selection.client.spec.tsx
git commit -m "feat: add scoped selection kernel"
```

---

### Task 4: Add DSH text/Markdown/code/CSV selection without replacing the builtin renderers

**Files:**
- Create: `src/client/adapters/dsh-text/adapter.ts`
- Create: `src/client/adapters/dsh-text/lines.ts`
- Create: `src/client/provenance/text-lines.ts`
- Modify: `src/client/dsh/register.ts`
- Test: `tests/client/dsh-text-adapter.client.spec.tsx`

**Interfaces:**
- Produces `createDshTextAdapter(): SelectionAdapter`.
- Consumes the official root attributes:
  - `[data-textpreview-url]`
  - `[data-document-preview]`
- Produces line provenance only when exact mapping is demonstrated.

- [ ] **Step 1: Write the failing root-scoping tests**

Fixture DOM:

```html
<div data-textpreview-url="dsh-resource://file/session/s1/src/main.ts"
     data-document-preview="code">
  <div data-textpreview-body>
    <code>
      <span class="line">alpha</span>
      <span class="line">beta</span>
    </code>
  </div>
</div>
```

Assert selecting `beta`:
- adapter handles;
- `fileName === 'main.ts'`;
- `documentKind === 'code'`;
- location is line 2.

Also assert text in a sibling chat-like element is not handled.

- [ ] **Step 2: Run RED**

```bash
pnpm vitest run tests/client/dsh-text-adapter.client.spec.tsx
```

- [ ] **Step 3: Implement filename and kind resolution**

Map official renderer IDs/extensions conservatively:

```ts
function inferBuiltinKind(fileName: string, previewId: string): DocumentKind
```

Rules:
- `.md/.markdown` → `markdown`;
- `.csv` → `csv`;
- code renderer → `code`;
- otherwise `text`.

Do not maintain a giant extension registry duplicating DSH; preview identity wins when available.

- [ ] **Step 4: Implement code line mapping**

Count `.line` elements in document order. If Range endpoints resolve to known `.line` nodes, return exact lines.

If the DOM does not expose stable per-line nodes, fall back to `{ kind: 'document' }`.

- [ ] **Step 5: Implement Markdown provenance fallback**

Rendered Markdown selections must default to:

```ts
{ kind: 'document' }
```

unless a later DSH public contract provides exact source positions. Do not infer source lines from rendered text matching.

- [ ] **Step 6: Register only the adapter**

Modify `applyClient` so this task adds the DSH text adapter to the local `SelectionAdapterRegistry`; it must not call `ctx.documentPreviews.register` for text, Markdown, code, or CSV.

- [ ] **Step 7: Run Task 4 gates**

```bash
pnpm vitest run tests/client/dsh-text-adapter.client.spec.tsx
pnpm typecheck
```

- [ ] **Step 8: Commit**

```bash
git add src/client/adapters/dsh-text src/client/provenance/text-lines.ts src/client/dsh/register.ts tests/client/dsh-text-adapter.client.spec.tsx
git commit -m "feat: capture selections from builtin dsh text previews"
```

---

### Task 5: Add the composer bridge and `conversation.input.overlay` Ask UI

**Files:**
- Create: `src/client/dsh/composer-bridge.ts`
- Create: `src/client/dsh/focus-composer.ts`
- Create: `src/client/ui/SelectionAskOverlay.tsx`
- Create: `src/client/ui/SelectionAskOverlay.module.css`
- Create: `src/client/ui/SelectionErrorToast.tsx`
- Create: `src/client/ui/locales.ts`
- Modify: `src/client/dsh/register.ts`
- Test: `tests/client/composer-bridge.client.spec.tsx`
- Test: `tests/client/selection-overlay.client.spec.tsx`

**Interfaces:**
- Consumes `SelectionKernel`, `formatSelectionForDraft`, `appendSelectionToDraft`.
- Produces:

```ts
export interface ComposerBridge {
  appendSelection(snapshot: SelectionSnapshot): void
  focus(): void
}
```

- The overlay receives the current session's public input actions through the slot runtime.

- [ ] **Step 1: Write failing composer tests**

Mock public input state/actions and assert:
- empty draft → exactly one `setDraft(formattedQuote)`;
- non-empty draft → exactly one `setDraft(existing + blank lines + quote)`;
- `submit` is never called;
- too-large selection does not call `setDraft`.

- [ ] **Step 2: Run RED**

```bash
pnpm vitest run tests/client/composer-bridge.client.spec.tsx
```

- [ ] **Step 3: Implement `ComposerBridge` through the public DSH input facade**

Read current draft from the public input runtime/hook available in `conversation.input.overlay`.

If current DSH exposes only `setDraft` and the overlay standard props expose the current draft through `useInput`, use those public fields. If the installed public API does not expose draft reading, stop and report the contract mismatch rather than query Lexical DOM.

- [ ] **Step 4: Write failing overlay behavior tests**

Simulate a valid kernel snapshot and assert:
- one button with accessible name `询问 DeepSeek`;
- button disappears after kernel `clear()`;
- Escape clears the snapshot;
- clicking Ask appends the quote and clears the snapshot;
- oversized rejection renders the localized “选区过大，请缩小范围” feedback and does not write.

- [ ] **Step 5: Implement overlay positioning**

For DOM selections use the last visible rect:

```ts
function anchorRect(rects: readonly DOMRectReadOnly[]): DOMRectReadOnly | null
```

Position with `position: fixed`, clamp to viewport margins, and revalidate on scroll/resize. Do not portal arbitrary UI outside the DSH slot unless the slot convention explicitly does so.

- [ ] **Step 6: Wire browser selection events**

Use one lifecycle owner for:
- `selectionchange`;
- `pointerup`;
- keyboard selection via `keyup`;
- `scroll`;
- `resize`;
- `Escape`.

Throttle/coalesce `selectionchange` into `requestAnimationFrame`; do not parse selection on every pointer move.

- [ ] **Step 7: Register the overlay contribution**

Use the current DSH slot injection convention for `conversation.input.overlay`.

- [ ] **Step 8: Run Task 5 gates**

```bash
pnpm vitest run tests/client/composer-bridge.client.spec.tsx tests/client/selection-overlay.client.spec.tsx
pnpm typecheck
```

- [ ] **Step 9: Manual smoke with builtin text preview**

In real DSH:
1. open `.txt`;
2. select text;
3. click Ask;
4. verify quoted content appears in current draft;
5. verify no message is sent.

Record the result in the task report.

- [ ] **Step 10: Commit**

```bash
git add src/client/dsh src/client/ui tests/client/composer-bridge.client.spec.tsx tests/client/selection-overlay.client.spec.tsx
git commit -m "feat: add selection ask overlay and composer bridge"
```

---

### Task 6: Add shared OOXML ZIP preflight

**Files:**
- Create: `src/client/ooxml/limits.ts`
- Create: `src/client/ooxml/errors.ts`
- Create: `src/client/ooxml/preflight.ts`
- Create: `tests/unit/ooxml/preflight.spec.ts`
- Create: `tests/fixtures/ooxml/README.md`

**Interfaces:**
- Produces:

```ts
export interface OoxmlLimits {
  readonly maxEntries: number
  readonly maxTotalUncompressedBytes: number
  readonly maxSingleUncompressedBytes: number
  readonly maxCompressionRatio: number
}

export const DEFAULT_OOXML_LIMITS: OoxmlLimits

export async function preflightOoxml(
  bytes: Uint8Array<ArrayBuffer>,
  limits?: OoxmlLimits,
  signal?: AbortSignal,
): Promise<void>
```

- [ ] **Step 1: Write failing tests for normal and malicious metadata**

Generate ZIPs in test code with `@zip.js/zip.js` or a deterministic fixture helper.

Cases:
- normal Office-like archive passes;
- `maxEntries + 1` rejects;
- one entry declared/created above single-entry limit rejects;
- aggregate above total limit rejects;
- ratio over `200` rejects;
- `../evil.xml` rejects;
- `/absolute.xml` rejects;
- `C:\evil.xml` rejects;
- NUL-containing name rejects if the ZIP library allows constructing it;
- encrypted entry rejects;
- aborted signal rejects with `AbortError`.

- [ ] **Step 2: Run RED**

```bash
pnpm vitest run tests/unit/ooxml/preflight.spec.ts
```

- [ ] **Step 3: Implement errors and exact limits**

```ts
export const DEFAULT_OOXML_LIMITS = {
  maxEntries: 10_000,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxSingleUncompressedBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 200,
} as const
```

Use entry central-directory metadata before extracting contents.

- [ ] **Step 4: Implement path validation**

Normalize backslash to slash only for validation. Reject any path segment exactly equal to `..`, absolute Unix paths, drive-letter absolute paths, and `\0`.

Do not extract files to disk.

- [ ] **Step 5: Implement compression-ratio validation**

For non-empty compressed entries:

```ts
ratio = uncompressedSize / Math.max(1, compressedSize)
```

Reject above the limit.

For entries whose library metadata does not expose the required sizes, reject rather than bypass the preflight.

- [ ] **Step 6: Run Task 6 gates**

```bash
pnpm vitest run tests/unit/ooxml/preflight.spec.ts
pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/client/ooxml tests/unit/ooxml tests/fixtures/ooxml
git commit -m "feat: add shared ooxml archive preflight"
```

---

### Task 7: Add a selectable PDF renderer with PDF.js Canvas + TextLayer

**Files:**
- Create: `src/client/renderers/pdf/register.ts`
- Create: `src/client/renderers/pdf/SelectablePdfBody.tsx`
- Create: `src/client/renderers/pdf/SelectablePdfBody.module.css`
- Create: `src/client/renderers/pdf/runtime.ts`
- Create: `src/client/renderers/pdf/render-page.ts`
- Create: `src/client/renderers/pdf/text-layer.ts`
- Create: `src/client/renderers/pdf/worker-asset.ts`
- Create: `src/client/renderers/pdf/errors.ts`
- Create: `scripts/generate-pdf-fixtures.mjs`
- Create: `tests/browser/pdf-renderer.spec.ts`
- Create: `tests/fixtures/pdf/.gitkeep`
- Modify: `src/client/dsh/register.ts`
- Modify: `tsdown.config.ts`
- Modify: `src/client/assets/asset-imports.d.ts`

**Interfaces:**
- Produces `registerPdfRenderer(ctx: Context): () => void`.
- Page root contract: `[data-dsa-pdf-page="<1-based page>"]`.
- Text layer must contain selectable text nodes aligned with the visible canvas.
- No Ask adapter yet; this task ends when the PDF is visually rendered and text is browser-selectable.

- [ ] **Step 1: Pin PDF.js to the installed DSH PDF.js version**

Inspect installed DSH `package.json`/lock/declarations and set the exact same `pdfjs-dist` version.

Add a verification assertion in `scripts/verify.mjs` that fails if the plugin and installed DSH PDF.js major/minor/patch versions differ for the primary verified runtime baseline.

- [ ] **Step 2: Generate deterministic PDF fixtures**

`scripts/generate-pdf-fixtures.mjs` must create:
- `single-page.pdf` with `Alpha Beta`;
- `two-page.pdf` with distinct page text;
- `cjk.pdf` with embedded test-capable Unicode font licensed for repository fixtures or use a generator that embeds a permitted fixture font;
- `image-only.pdf`.

Do not commit proprietary fonts.

- [ ] **Step 3: Write failing browser tests**

Assertions:
- plugin PDF renderer can be selected/auto-selected;
- `single-page.pdf` has one `[data-dsa-pdf-page="1"]`;
- visible canvas exists;
- text layer includes `Alpha Beta`;
- browser Selection can select `Alpha`;
- image-only PDF renders a canvas and exposes no fake text.

- [ ] **Step 4: Run RED**

```bash
pnpm test:browser -- tests/browser/pdf-renderer.spec.ts
```

- [ ] **Step 5: Implement local PDF worker runtime**

Use PDF.js `getDocument` with a locally bundled module worker. Do not fetch a CDN worker and do not fall back silently to main-thread parsing.

Expose:

```ts
export interface PdfSession {
  readonly document: PDFDocumentProxy
  dispose(): Promise<void>
}

export async function openPdf(
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
): Promise<PdfSession>
```

Abort/dispose destroys the loading task/document/worker resources exactly once.

- [ ] **Step 6: Implement page rendering**

Canvas:
- CSS viewport from desired fit width;
- backing canvas scaled by `devicePixelRatio`;
- cap backing dimension at `16_384`;
- cap backing pixels at `64 * 1024 * 1024`;
- if cap exceeded, reduce backing scale while keeping CSS viewport unchanged.

TextLayer:
- use the same unscaled CSS viewport;
- render into an absolutely positioned layer above canvas;
- preserve text selection;
- do not import the entire global `pdf_viewer.css` if it causes DSH collisions; copy only the Apache-2.0 TextLayer-relevant rules with attribution in `THIRD_PARTY_NOTICES.md`.

- [ ] **Step 7: Implement lazy page lifecycle**

Each page:
- has a stable wrapper;
- uses `IntersectionObserver` with approximately `100% 0px` root margin;
- renders page 1 immediately;
- cancels render on tab abort/unmount.

- [ ] **Step 8: Register the renderer**

```ts
{
  id: '@local/dsh-document-selection-ask/pdf',
  extensions: ['pdf'],
  priority: 'extension',
  loading: 'bytes-complete',
  wrap: false,
}
```

Register the matching keyed body in `sidebar.right.tab.document`.

- [ ] **Step 9: Run Task 7 gates**

```bash
pnpm test:browser -- tests/browser/pdf-renderer.spec.ts
pnpm typecheck
pnpm build
```

- [ ] **Step 10: Commit**

```bash
git add src/client/renderers/pdf src/client/assets scripts/generate-pdf-fixtures.mjs tests/browser/pdf-renderer.spec.ts tests/fixtures/pdf tsdown.config.ts src/client/dsh/register.ts THIRD_PARTY_NOTICES.md scripts/verify.mjs
git commit -m "feat: add selectable pdf text layer renderer"
```

---

### Task 8: Add PDF selection provenance and Ask integration

**Files:**
- Create: `src/client/adapters/pdf/adapter.ts`
- Create: `src/client/provenance/page-range.ts`
- Test: `tests/client/pdf-adapter.client.spec.tsx`
- Modify: `src/client/dsh/register.ts`
- Modify: `tests/browser/pdf-renderer.spec.ts`

**Interfaces:**
- Produces `createPdfSelectionAdapter(): SelectionAdapter`.
- Consumes page roots `[data-dsa-pdf-page]`.
- Produces `{ kind: 'pages', fidelity: 'source' }`.

- [ ] **Step 1: Write failing adapter tests**

DOM fixture:

```html
<section data-dsa-document-kind="pdf"
         data-dsa-resource-address="dsh-resource://file/session/s1/paper.pdf">
  <div data-dsa-pdf-page="3"><span>alpha</span></div>
  <div data-dsa-pdf-page="4"><span>beta</span></div>
</section>
```

Select from `alpha` to `beta`.

Expected:

```ts
{
  fileName: 'paper.pdf',
  documentKind: 'pdf',
  location: { kind: 'pages', start: 3, end: 4, fidelity: 'source' },
  text: 'alpha...beta'
}
```

- [ ] **Step 2: Implement nearest-page resolution**

For Range start/end containers use `.closest('[data-dsa-pdf-page]')`.

Reject if either endpoint is outside the same plugin PDF document root.

- [ ] **Step 3: Register the PDF adapter after the DSH text adapter**

Ordering must ensure the plugin PDF root is never misclassified as generic text.

- [ ] **Step 4: Extend real browser test through the Ask button**

Open `two-page.pdf`, select text across pages 1–2, click Ask, assert composer contains:

```text
[来源：two-page.pdf，第 1–2 页]
```

and selected text.

Assert no network request leaves the DSH origin for PDF parsing assets.

- [ ] **Step 5: Run Task 8 gates**

```bash
pnpm vitest run tests/client/pdf-adapter.client.spec.tsx
pnpm test:browser -- tests/browser/pdf-renderer.spec.ts
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/client/adapters/pdf src/client/provenance/page-range.ts src/client/dsh/register.ts tests/client/pdf-adapter.client.spec.tsx tests/browser/pdf-renderer.spec.ts
git commit -m "feat: ask from selectable pdf pages"
```

---

### Task 9: Add the DOCX high-fidelity renderer and rendered-page provenance

**Files:**
- Create: `src/client/renderers/docx/register.ts`
- Create: `src/client/renderers/docx/DocxBody.tsx`
- Create: `src/client/renderers/docx/DocxBody.module.css`
- Create: `src/client/renderers/docx/engine.ts`
- Create: `src/client/renderers/docx/page-markers.ts`
- Create: `src/client/adapters/docx/adapter.ts`
- Create: `scripts/generate-docx-fixtures.mjs`
- Create: `tests/browser/docx-selection.spec.ts`
- Create: `tests/client/docx-adapter.client.spec.tsx`
- Modify: `src/client/dsh/register.ts`

**Interfaces:**
- Produces `registerDocxRenderer(ctx): () => void`.
- Produces `createDocxSelectionAdapter(): SelectionAdapter`.
- Document root: `[data-dsa-document-kind="docx"]`.
- Reliable page wrapper: `[data-dsa-docx-page="<1-based rendered page>"]`.
- Page provenance uses `fidelity: 'rendered'`.

- [ ] **Step 1: Generate deterministic DOCX fixtures**

Create:
- `paragraphs.docx`;
- `manual-page-break.docx`;
- `table-image.docx`;
- `headers-footers.docx`.

Use an open-source JS DOCX generator in the fixture script. The generated files must be deterministic enough for text/structure assertions; do not assert ZIP timestamps.

- [ ] **Step 2: Write failing renderer browser tests**

Assertions:
- text is visible and selectable;
- manual page break yields two reliable page wrappers if `docx-preview` exposes/creates page sections;
- tables render readable cells;
- selecting text and Ask writes source;
- the source says `渲染页` only when page marker mapping exists.

- [ ] **Step 3: Write failing adapter unit/client tests**

Cover:
- same page;
- cross rendered pages;
- no page wrapper → `{ kind: 'document' }`;
- cross-document root reject.

- [ ] **Step 4: Implement the engine**

`engine.ts` wraps `docx-preview` only:

```ts
export async function renderDocx(
  bytes: Uint8Array<ArrayBuffer>,
  body: HTMLElement,
  styleHost: HTMLElement,
  signal: AbortSignal,
): Promise<void>
```

Before parsing:

```ts
await preflightOoxml(bytes, DEFAULT_OOXML_LIMITS, signal)
```

Render options:
- `breakPages: true`;
- `ignoreLastRenderedPageBreak: false`;
- `renderHeaders: true`;
- `renderFooters: true`;
- `renderFootnotes: true`;
- `renderEndnotes: true`;
- `renderAltChunks: false`;
- no Base64 asset mode unless the library requires it and cleanup is proven.

After each async boundary, check `signal.aborted`.

- [ ] **Step 5: Implement reliable page marking**

Inspect the renderer's public/stable page DOM output.

Only apply `data-dsa-docx-page` to actual page section containers emitted by the engine. Do not infer pages by dividing scroll height.

If a future library version removes stable page sections, page markers become unavailable and the adapter falls back to file-only provenance.

- [ ] **Step 6: Register the DOCX renderer**

```ts
{
  id: '@local/dsh-document-selection-ask/docx',
  extensions: ['docx'],
  priority: 'extension',
  loading: 'bytes-complete',
  wrap: false,
}
```

- [ ] **Step 7: Register the DOCX adapter**

It captures native DOM Selection inside the plugin DOCX root and resolves rendered pages when present.

- [ ] **Step 8: Run Task 9 gates**

```bash
pnpm vitest run tests/client/docx-adapter.client.spec.tsx
pnpm test:browser -- tests/browser/docx-selection.spec.ts
pnpm typecheck
```

- [ ] **Step 9: Commit**

```bash
git add src/client/renderers/docx src/client/adapters/docx scripts/generate-docx-fixtures.mjs tests/client/docx-adapter.client.spec.tsx tests/browser/docx-selection.spec.ts tests/fixtures/docx src/client/dsh/register.ts
git commit -m "feat: add selectable docx preview"
```

---

### Task 10: Add the PPTX HTML/SVG renderer and slide provenance

**Files:**
- Create: `src/client/renderers/pptx/register.ts`
- Create: `src/client/renderers/pptx/PptxBody.tsx`
- Create: `src/client/renderers/pptx/PptxBody.module.css`
- Create: `src/client/renderers/pptx/engine.ts`
- Create: `src/client/renderers/pptx/slide-markers.ts`
- Create: `src/client/adapters/pptx/adapter.ts`
- Create: `src/client/provenance/slide-range.ts`
- Create: `scripts/generate-pptx-fixtures.mjs`
- Create: `tests/browser/pptx-selection.spec.ts`
- Create: `tests/client/pptx-adapter.client.spec.tsx`
- Modify: `src/client/dsh/register.ts`

**Interfaces:**
- Produces `registerPptxRenderer(ctx): () => void`.
- Produces `createPptxSelectionAdapter(): SelectionAdapter`.
- Slide root: `[data-dsa-pptx-slide="<1-based slide>"]`.

- [ ] **Step 1: Generate PPTX fixtures**

Create deterministic decks:
- `text-two-slides.pptx`;
- `table-image.pptx`;
- `chart.pptx`;
- `large-120-slides.pptx`.

Use a permissively licensed PPTX generator such as PptxGenJS in the fixture script.

- [ ] **Step 2: Write failing browser tests**

Assertions:
- text remains real selectable DOM/SVG text;
- slide 1 and 2 can be selected;
- cross-slide selection yields slides 1–2;
- 120-slide deck uses windowing/lazy behavior rather than mounting all heavy slide trees at once;
- aborting/closing the preview does not leave an uncaught promise.

- [ ] **Step 3: Implement engine wrapper**

```ts
export interface PptxEngineSession {
  dispose(): void | Promise<void>
}

export async function renderPptx(
  bytes: Uint8Array<ArrayBuffer>,
  host: HTMLElement,
  signal: AbortSignal,
): Promise<PptxEngineSession>
```

Before renderer open:
- `preflightOoxml(...)`;
- then enable the PPTX library's recommended ZIP limits as a second line of defense.

Use:
- list mode;
- windowed rendering;
- fit mode `contain`;
- `signal`.

Do not reach into private framework state.

- [ ] **Step 4: Add stable slide wrappers**

Prefer a public callback/model from the renderer to wrap each slide.

If the library directly owns the host DOM, `slide-markers.ts` may translate a documented stable slide attribute into `data-dsa-pptx-slide`. It must not select CSS-module hash classes or React internals.

- [ ] **Step 5: Implement the slide adapter**

Use nearest `[data-dsa-pptx-slide]` on Range endpoints.

If a selection snapshot points at a slide that later unmounts due to windowing, the snapshot remains usable until:
- user changes the selection;
- resource tab changes;
- renderer lifecycle clears it.

- [ ] **Step 6: Register renderer and adapter**

Renderer:
- extension `pptx`;
- `priority: extension`;
- `bytes-complete`.

- [ ] **Step 7: Run Task 10 gates**

```bash
pnpm vitest run tests/client/pptx-adapter.client.spec.tsx
pnpm test:browser -- tests/browser/pptx-selection.spec.ts
pnpm typecheck
```

- [ ] **Step 8: Commit**

```bash
git add src/client/renderers/pptx src/client/adapters/pptx src/client/provenance/slide-range.ts scripts/generate-pptx-fixtures.mjs tests/client/pptx-adapter.client.spec.tsx tests/browser/pptx-selection.spec.ts tests/fixtures/pptx src/client/dsh/register.ts
git commit -m "feat: add selectable pptx preview"
```

---

### Task 11: Add the XLSX read-only workbook renderer and semantic cell-range Ask flow

**Files:**
- Create: `src/client/renderers/xlsx/register.ts`
- Create: `src/client/renderers/xlsx/XlsxBody.tsx`
- Create: `src/client/renderers/xlsx/XlsxBody.module.css`
- Create: `src/client/renderers/xlsx/engine.ts`
- Create: `src/client/renderers/xlsx/viewer-context.tsx`
- Create: `src/client/renderers/xlsx/selection-bridge.ts`
- Create: `src/client/adapters/xlsx/adapter.ts`
- Create: `src/client/adapters/xlsx/serialize-range.ts`
- Create: `src/client/provenance/cell-range.ts`
- Create: `scripts/generate-xlsx-fixtures.mjs`
- Create: `tests/browser/xlsx-selection.spec.ts`
- Create: `tests/client/xlsx-adapter.client.spec.tsx`
- Modify: `src/client/dsh/register.ts`
- Modify: `tsdown.config.ts`
- Modify: `src/client/assets/asset-imports.d.ts`

**Interfaces:**
- Produces `registerXlsxRenderer(ctx): () => void`.
- Produces a semantic selection bridge:

```ts
export interface XlsxRangeSelection {
  readonly sheet: string
  readonly range: string
  readonly values: readonly (readonly string[])[]
  readonly cellCount: number
  readonly rect: DOMRectReadOnly | null
}
```

- Produces `createXlsxSelectionAdapter(bridge): SelectionAdapter`.

- [ ] **Step 1: Generate XLSX fixtures**

Create:
- `simple.xlsx`;
- `formula-values.xlsx`;
- `multi-sheet.xlsx`;
- `merged-frozen.xlsx`;
- `chart-image.xlsx`;
- `large.xlsx`.

Use a permissively licensed workbook generator in the fixture script.

- [ ] **Step 2: Write failing range serialization tests**

For:

```ts
{
  sheet: 'Sheet1',
  range: 'B2:D4',
  values: [
    ['Revenue', '120', '135'],
    ['Cost', '80', '92'],
    ['Margin', '40', '43'],
  ]
}
```

Expected provenance:

```text
[来源：budget.xlsx，Sheet1!B2:D4]
```

Expected body is either the exact Markdown table selected by the serializer policy or TSV fenced block.

Specify policy:
- use Markdown table when rows <= 20 and columns <= 12 and no cell contains a newline;
- otherwise TSV fenced block.

- [ ] **Step 3: Write failing 200-cell limit tests**

Exactly 200 cells accepted. 201 cells returns `too-many-cells`. The adapter must reject before building a draft.

- [ ] **Step 4: Write failing browser tests**

Assertions:
- workbook opens locally;
- editing is disabled;
- sheet navigation works;
- select a range;
- Ask button appears;
- composer gets `SheetName!A1:C3`;
- displayed/calculated values are quoted, not formula source alone;
- selecting >200 cells rejects;
- no XLSX data is uploaded.

- [ ] **Step 5: Implement local WASM asset configuration**

Bundle the exact package-provided WASM asset.

Call `setWasmSource(localAsset)` before first workbook parse.

Do not use a CDN.

Verify the built plugin contains/references the local WASM file.

- [ ] **Step 6: Implement `XlsxBody` in read-only mode**

Use:
- `readOnly`;
- `useWorker: true`;
- `showDefaultToolbar={false}`;
- explicit file size cap no larger than the DSH complete-byte cap;
- no export/edit controls.

If the library exposes `experimentalCanvas`, leave its default unless tests demonstrate DOM mode is required. Selection semantics come from the library range model, not text Range.

- [ ] **Step 7: Implement the selection bridge**

Read the active sheet and selected range from the library's public hooks/controller.

Retrieve displayed values for the selected cells through public workbook/viewer APIs.

Expose only normalized `XlsxRangeSelection`; do not expose the third-party controller outside `renderers/xlsx`.

- [ ] **Step 8: Implement the adapter**

`canHandle` becomes true when:
- current active document root is XLSX;
- bridge has a non-empty active range.

The adapter returns:

```ts
location: {
  kind: 'cells',
  sheet,
  range,
}
```

and serialized display values.

- [ ] **Step 9: Add overlay anchoring fallback**

If the public XLSX API provides a selection bounding rectangle, use it.

Otherwise set `rect: null`; the overlay renders at the workbook viewport's top-right corner. Do not inspect React fiber or private canvas objects.

- [ ] **Step 10: Run Task 11 gates**

```bash
pnpm vitest run tests/client/xlsx-adapter.client.spec.tsx tests/unit/quote
pnpm test:browser -- tests/browser/xlsx-selection.spec.ts
pnpm typecheck
pnpm build
```

- [ ] **Step 11: Commit**

```bash
git add src/client/renderers/xlsx src/client/adapters/xlsx src/client/provenance/cell-range.ts scripts/generate-xlsx-fixtures.mjs tests/client/xlsx-adapter.client.spec.tsx tests/browser/xlsx-selection.spec.ts tests/fixtures/xlsx src/client/dsh/register.ts tsdown.config.ts src/client/assets
git commit -m "feat: ask from xlsx cell ranges"
```

---

### Task 12: Unify registration, locale, cleanup, and renderer fallback behavior

**Files:**
- Modify: `src/client/dsh/register.ts`
- Modify: `src/client/index.tsx`
- Modify: `src/client/selection/lifecycle.ts`
- Modify: `src/client/ui/locales.ts`
- Create: `tests/client/renderer-registration.client.spec.tsx`
- Create: `tests/client/lifecycle.client.spec.tsx`

**Interfaces:**
- Produces one top-level registration disposer.
- Adapter order is explicitly:
  1. XLSX semantic adapter
  2. PDF
  3. DOCX
  4. PPTX
  5. DSH builtin text/Markdown/code/CSV

- [ ] **Step 1: Write failing registration tests**

Assert:
- PDF/DOCX/PPTX/XLSX each register one extension renderer;
- builtin text classes register zero replacement renderers;
- all registrations are disposed exactly once;
- removing plugin definitions leaves builtin definitions untouched;
- duplicate plugin apply/dispose cycles do not leak entries.

- [ ] **Step 2: Write failing lifecycle tests**

When:
- active resource address changes;
- tab aborts;
- renderer unmounts;
- Escape is pressed;

the active selection snapshot clears.

A simple scroll does not clear a still-valid snapshot; it only repositions the overlay.

- [ ] **Step 3: Implement one registration owner**

`applyClient(ctx)` must create local registries/bridges and return or register DSH `ctx.effect` disposers using the official plugin lifecycle.

Do not leave module-global mutable registries that survive plugin reload.

- [ ] **Step 4: Complete bilingual copy**

Required keys:

```text
ask
selectionTooLarge
tooManyCells
rendererFailed
noSelectableText
loading
```

Chinese default and English translation.

- [ ] **Step 5: Run Task 12 gates**

```bash
pnpm vitest run tests/client/renderer-registration.client.spec.tsx tests/client/lifecycle.client.spec.tsx
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/client/dsh src/client/index.tsx src/client/selection/lifecycle.ts src/client/ui/locales.ts tests/client/renderer-registration.client.spec.tsx tests/client/lifecycle.client.spec.tsx
git commit -m "refactor: unify document selection plugin lifecycle"
```

---

### Task 13: Add cross-format Playwright acceptance and cancellation/resource tests

**Files:**
- Create: `tests/browser/universal-selection.spec.ts`
- Create: `tests/browser/resource-cleanup.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `scripts/verify.mjs`

**Interfaces:**
- No new production API.
- Establishes end-to-end invariants shared by every format.

- [ ] **Step 1: Write the universal acceptance test**

For each supported class:

```ts
type Case = {
  file: string
  select: (page: Page) => Promise<void>
  expectedSource: RegExp
  expectedText: RegExp
}
```

Cases:
- TXT;
- Markdown;
- code;
- CSV;
- PDF;
- DOCX;
- PPTX;
- XLSX.

For every case:
1. open preview;
2. produce selection;
3. click Ask;
4. assert expected provenance;
5. assert selected text/value;
6. assert composer was not submitted.

- [ ] **Step 2: Add cross-root rejection browser case**

Attempt a DOM Range spanning a supported preview and an outside node.

Expected: no Ask button.

- [ ] **Step 3: Add rapid close/cancel cases**

For PDF/DOCX/PPTX/XLSX:
1. open a large fixture;
2. close/switch tab before render settles;
3. assert no uncaught rejection;
4. assert no Ask snapshot remains.

- [ ] **Step 4: Add local-asset network assertion**

Intercept requests and fail if parser runtime assets target a remote host.

Allow ordinary DSH application requests only.

Specifically verify:
- PDF worker local;
- XLSX WASM local;
- no Office document upload.

- [ ] **Step 5: Extend `scripts/verify.mjs`**

Verify:
- package build files exist;
- no built JS contains known CDN worker/WASM URLs;
- no source imports DSH private `src/` paths;
- no source contains `ReactFiber`, `__reactFiber`, direct `.value =` composer hack signatures;
- `THIRD_PARTY_NOTICES.md` mentions all shipped third-party libraries.

Keep this as a heuristic gate in addition to tests, not as the only correctness check.

- [ ] **Step 6: Run Task 13 gates**

```bash
pnpm test
pnpm test:browser -- tests/browser/universal-selection.spec.ts tests/browser/resource-cleanup.spec.ts
pnpm typecheck
pnpm build
pnpm verify
```

- [ ] **Step 7: Commit**

```bash
git add tests/browser/universal-selection.spec.ts tests/browser/resource-cleanup.spec.ts playwright.config.ts scripts/verify.mjs
git commit -m "test: cover universal document selection workflow"
```

---

### Task 14: Add compatibility matrix and DSH real-app smoke procedure

**Files:**
- Create: `docs/compatibility.md`
- Create: `docs/manual-acceptance.md`
- Create: `scripts/check-dsh-contracts.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `README.zh.md`

**Interfaces:**
- No new runtime API.
- Adds reproducible compatibility/acceptance gates.

- [ ] **Step 1: Add a contract-check command**

`package.json`:

```json
{
  "scripts": {
    "check:dsh-contracts": "node scripts/check-dsh-contracts.mjs"
  }
}
```

The script prints:
- installed `@deepseek-ai/dsh` version;
- installed sidebar-documentpreview version;
- installed `pdfjs-dist` version;
- Node version.

Then it invokes/validates the compile contract test through the project's typecheck command.

- [ ] **Step 2: Document the support matrix**

`docs/compatibility.md` must state:

```text
Required/verified runtime baseline: DSH 0.1.5-rc.1
Forward compile-contract target: DSH 0.1.5-rc.2
Future rc.2 runtime support requires real-app smoke
Later DSH releases: unsupported until contract + real-app smoke pass
Node: ^22.19.0 || >=24.0.0
Primary manual platform: Windows 11 + Chromium-based DSH web UI
```

Do not claim support for versions not tested.

- [ ] **Step 3: Write the exact real DSH acceptance procedure**

`docs/manual-acceptance.md` contains exact steps for:
- enable plugin;
- open each fixture;
- produce selection;
- verify source;
- preserve pre-existing draft;
- verify no auto-submit;
- switch renderer dropdown back to builtin PDF;
- disable plugin;
- confirm builtin PDF returns;
- close large documents mid-load;
- inspect console;
- inspect Network panel for external upload/worker/WASM requests.

- [ ] **Step 4: Run the real-app smoke on the installed DSH `0.1.5-rc.1`**

Record a results table in the task report, not hard-coded into docs as eternal truth:

```text
text PASS/FAIL
markdown PASS/FAIL
code PASS/FAIL
csv PASS/FAIL
pdf PASS/FAIL
docx PASS/FAIL
pptx PASS/FAIL
xlsx PASS/FAIL
disable/restore PASS/FAIL
console-clean PASS/FAIL
network-local PASS/FAIL
```

Any FAIL blocks Task 15.

- [ ] **Step 5: Probe the forward contract target `0.1.5-rc.2` in an isolated disposable install**

Use an isolated disposable test install/worktree. Do not downgrade the user's main DSH profile in place.

The rc.2 probe covers the compile contract only. rc.2 runtime support stays unclaimed until a real-app smoke passes on rc.2.

If the package is unavailable, record `NOT TESTED — package unavailable` rather than claiming support.

- [ ] **Step 6: Commit**

```bash
git add docs/compatibility.md docs/manual-acceptance.md scripts/check-dsh-contracts.mjs package.json README.md README.zh.md
git commit -m "docs: define dsh compatibility and acceptance gates"
```

---

### Task 15: Finish packaging, notices, user documentation, and release verification

**Files:**
- Modify: `package.json`
- Modify: `cordis.patch.yml`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `THIRD_PARTY_NOTICES.md`
- Create: `LICENSE`
- Create: `docs/renderer-support.md`
- Create: `docs/security.md`
- Create: `docs/testing.md`
- Modify: `scripts/verify.mjs`

**Interfaces:**
- Produces the installable plugin package.
- No new runtime behavior unless a packaging defect is found.

- [ ] **Step 1: Write final renderer support documentation**

Include exact v1 matrix:

```text
TXT/plain text       selectable; builtin DSH renderer
Markdown             selectable; source lines only when proven
Code/config          selectable; line provenance when exact
CSV                   selectable; builtin text/code path
PDF                   selectable text layer; no OCR
DOCX                  selectable HTML; rendered-page provenance when reliable
PPTX                  selectable HTML/SVG; slide provenance
XLSX                  semantic cell-range selection; sheet + A1 provenance
DOC/PPT/XLS           not supported in v1
```

- [ ] **Step 2: Finish `THIRD_PARTY_NOTICES.md`**

Include at minimum:
- pdfjs-dist / Mozilla PDF.js — Apache-2.0;
- docx-preview/docxjs — Apache-2.0;
- @aiden0z/pptx-renderer — Apache-2.0;
- @extend-ai/react-xlsx — MIT;
- @zip.js/zip.js — BSD-3-Clause;
- any generator used only in dev fixtures if its license requires notice;
- copied PDF TextLayer CSS notice if copied.

Do not copy entire third-party licenses into source files unless required; follow each license's notice obligations.

- [ ] **Step 3: Verify package contents**

Run the package manager's pack dry-run/list command.

Assert the tarball contains:
- runtime JS/CSS;
- PDF worker asset;
- XLSX WASM asset;
- license/notices;
- README.

Assert it does not contain:
- test fixtures;
- Playwright reports;
- raw development docs if package size policy excludes them;
- local DSH profile paths.

- [ ] **Step 4: Run the full verification matrix**

```bash
pnpm check:dsh-contracts
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
pnpm verify
pnpm pack --dry-run
```

All must pass.

- [ ] **Step 5: Run the real DSH acceptance procedure one final time**

Use `docs/manual-acceptance.md`.

The release is blocked by:
- any unsupported external network request caused by document parsing;
- any auto-submit;
- any lost existing draft;
- any selection source mismatch;
- inability to disable and restore builtin behavior;
- uncaught console error during tested fixtures.

- [ ] **Step 6: Review the complete diff and history**

Check:
- no task left uncommitted;
- one format has not bypassed the shared kernel;
- no direct DSH private API was introduced after Task 1;
- no debug logging dumps document contents;
- no oversized fixture is accidentally packaged.

- [ ] **Step 7: Commit**

```bash
git add package.json cordis.patch.yml README.md README.zh.md LICENSE THIRD_PARTY_NOTICES.md docs/renderer-support.md docs/security.md docs/testing.md scripts/verify.mjs
git commit -m "release: prepare universal document selection plugin"
```

---

## Implementation Order and Stop Rules

Execute strictly in numeric order.

A task stops the entire implementation when any of these is true:

1. A required DSH public contract is missing.
2. A selected third-party library cannot run under the DSH client bundler/CSP without a forbidden workaround.
3. A library license is incompatible with distribution.
4. A renderer requires remote document upload.
5. A format can only be made selectable by raster/OCR when the spec requires real text.
6. The only path forward requires editing DSH `node_modules`, React fiber, Lexical internals, or private DSH source imports.

The worker must report the failure and candidate migration instead of improvising around the architecture.

## DeepSeek v4.1 Flash Per-Task Report Format

After every task, stop and report exactly:

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

For a blocked task, replace `none` with the exact blocker and do not begin the next task.

## Final Definition of Done

The project is complete only when:

- Tasks 1–15 are committed.
- `pnpm check:dsh-contracts` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm test:browser` passes.
- `pnpm build` passes.
- `pnpm verify` passes.
- package dry-run contains all required runtime assets.
- real DSH `0.1.5-rc.1` acceptance passes for text, Markdown, code, CSV, PDF, DOCX, PPTX, XLSX.
- rc.2 runtime acceptance remains `NOT TESTED` unless a real-app smoke on rc.2 passes; the rc.2 compile contract alone does not satisfy this item.
- PDF uses real TextLayer selection.
- DOCX/PPTX use real browser text, not screenshots/OCR.
- XLSX Ask uses semantic cell range selection.
- existing composer draft is preserved.
- Ask never auto-submits.
- plugin disable restores builtin preview behavior.
- no parser document data is uploaded to a third-party service.
