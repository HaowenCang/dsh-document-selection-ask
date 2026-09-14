# DSH Universal Document Selection & Ask — Design Specification

Date: 2026-09-14\
Status: **Approved** — see `docs/DESIGN_APPROVAL.md`\
Primary verified runtime: DeepSeek Harness `0.1.5-rc.1`\
Forward contract target: DeepSeek Harness `0.1.5-rc.2`\
rc.2 status: compile-contract compatible only — do not claim full rc.2 runtime compatibility

## 1. Problem

DSH 的右侧 Sidebar 已经可以浏览文件，但“浏览文件”和“围绕文件局部内容提问”仍然断裂：

- 纯文本/Markdown/代码虽然有 DOM 文本，但没有 selection → composer bridge
- PDF 内置 renderer 只画 Canvas，没有 TextLayer
- DOCX/PPTX/XLSX 需要浏览器本地高保真预览
- 不同格式具有不同来源定位语义

目标不是做一个新的 Office suite，而是给 DSH Document Preview 增加一个统一的、可扩展的 Selection → Ask 子系统。

## 2. Scope

v1:

- txt/plain text
- markdown
- code/config
- csv
- pdf
- docx
- pptx
- xlsx

Deferred:

- doc/ppt/xls
- OCR
- editing
- annotations
- independent document chat
- cloud conversion

## 3. User Experience

用户在 DSH Sidebar 内选中内容后看到一个轻量浮动按钮：

```text
询问 DeepSeek
```

点击后：

- source provenance 自动生成
- selection 作为 Markdown quote 追加到当前 draft
- composer 获得 focus
- 用户补充问题
- 用户自己发送

No automatic submit.

## 4. Architecture Decision

采用：

**Universal Selection Kernel + format-specific browser-native renderer adapters**

不采用：

1. 全格式转纯 HTML 文本\
   因为损失 PDF/PPTX/Office layout 与 provenance。

2. 全格式 host-side 转 PDF\
   因为引入外部运行时、临时文件和跨平台问题，并破坏 XLSX range semantics。

3. 每种 renderer 自己实现 Ask\
   因为会复制 selection validation、prompt formatting 与 composer integration。

## 5. DSH Integration

使用当前公开/产品内部稳定 contract：

- `ctx.documentPreviews.register`
- `sidebar.right.tab.document`
- `DocumentPreviewProps`
- `conversation.input.overlay`
- public conversation input actions / `setDraft`

Text/Markdown/code 不注册替代 renderer。

PDF/DOCX/PPTX/XLSX 注册 `priority: 'extension'` renderer，builtin alternatives 仍然保留。

## 6. Data Model

```ts
type DocumentKind =
  | 'text' | 'markdown' | 'code' | 'csv'
  | 'pdf' | 'docx' | 'pptx' | 'xlsx'

type SelectionLocation =
  | { kind: 'lines'; start: number; end: number }
  | { kind: 'pages'; start: number; end: number; fidelity: 'source' | 'rendered' }
  | { kind: 'slides'; start: number; end: number }
  | { kind: 'cells'; sheet: string; range: string }
  | { kind: 'document' }

interface SelectionSnapshot {
  readonly adapterId: string
  readonly resourceAddress: string
  readonly fileName: string
  readonly documentKind: DocumentKind
  readonly text: string
  readonly location: SelectionLocation
  readonly rects: readonly DOMRectReadOnly[]
  readonly capturedAt: number
}
```

## 7. Format Decisions

### Text / Markdown / Code / CSV

Reuse DSH renderer.

Selection root is only accepted inside official Document Preview root. Do not install a generic “select anything on the DSH page” listener.

Line numbers are emitted only if the adapter can prove the mapping. Rendered Markdown may omit source lines.

### PDF

Use `pdfjs-dist`.

Every page renders:

- canvas visual layer
- aligned TextLayer
- `data-dsa-pdf-page`

Provenance is page range.

Image-only PDF still renders but cannot ask via text selection. OCR is out of scope.

### DOCX

Use `docx-preview`.

Render real HTML DOM.

Use explicit/last-rendered page breaks where available. Do not claim Word-compatible dynamic pagination.

Provenance:

- renderer page range when reliable
- otherwise file only

### PPTX

Use `@aiden0z/pptx-renderer`.

Use list/windowed mode, browser-native HTML/SVG, AbortSignal and its zip limits.

Selection provenance is slide range.

### XLSX

Use `@extend-ai/react-xlsx`.

Use semantic cell-range selection, not ordinary browser text selection.

Selection text serializes displayed cell values. Provenance is:

```text
SheetName!A1:C8
```

Viewer is read-only.

## 8. Security

All file bytes remain local.

No CDN, remote viewer, cloud conversion, external OCR.

DOCX/PPTX/XLSX run shared OOXML ZIP preflight through `@zip.js/zip.js`.

Limits:

- max entries 10,000
- total declared uncompressed 512 MiB
- single entry 128 MiB
- expansion ratio 200x
- encrypted entries rejected
- path traversal rejected

Renderer-specific safety limits still apply.

## 9. Performance

PDF pages lazy render.

PPTX uses windowed list rendering.

XLSX uses worker-backed parsing.

All renderer resources are tied to tab `AbortSignal`.

Close/unmount must dispose workers, observers, object URLs and viewer instances.

## 10. Prompt Contract

Example:

```md
> [来源：paper.pdf，第 3–4 页]
> selected line 1
> selected line 2

请针对以上选中内容回答：
```

Existing draft is preserved and separated by blank lines.

Limits:

- 16,384 UTF-16 code units
- XLSX <= 200 cells
- no silent truncation

## 11. Failure and Degradation

A plugin renderer failure must not corrupt Sidebar.

Because extension and builtin renderer definitions remain registered, the user can switch to another candidate.

Failures are renderer-local.

Unsupported complex Office objects should degrade locally rather than fail the whole document where possible.

## 12. Testing

Required:

- pure unit tests
- React/client integration tests
- Playwright browser tests with real fixtures
- DSH contract compile probe
- real DSH Windows smoke tests

Coverage includes text, PDF, DOCX, PPTX and XLSX selection/provenance.

## 13. Architecture Boundaries for DeepSeek v4.1 Flash

The codebase deliberately separates:

- DSH API boundary
- selection kernel
- provenance
- quote formatting
- renderer adapters
- OOXML security
- UI

No implementation file should become a cross-format “god component”.

DeepSeek execution must later be broken into one independently verifiable TDD task per boundary/format.

## 14. Non-negotiable Constraints

- no `any` to suppress missing DSH contracts
- no patching DSH `node_modules`
- no private React fiber
- no Lexical internals
- no direct composer DOM value writes
- no auto-submit
- no global unrestricted Selection capture
- no CDN worker/WASM
- no silent selection truncation
- no OCR in v1

## 15. Open-source dependencies

Preferred:

- pdfjs-dist — Apache-2.0
- docx-preview — Apache-2.0
- @aiden0z/pptx-renderer — Apache-2.0
- @extend-ai/react-xlsx — MIT
- @zip.js/zip.js — BSD-3-Clause

All notices must be represented in `THIRD_PARTY_NOTICES.md` when implementation begins.

## 16. Acceptance

v1 is accepted only when the same top-level UX works across all supported file classes:

```text
open → select → Ask → provenance + quoted content appears in current draft
```

with format-appropriate semantics and without sending the message automatically.
