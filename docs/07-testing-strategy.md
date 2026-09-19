# 测试策略

## 1. 测试金字塔

```text
Real DSH acceptance / smoke
        ▲
Playwright renderer + selection integration
        ▲
React client tests
        ▲
pure unit tests
```

## 2. Pure unit tests

必须覆盖：

### selection core

- same-root validation
- cross-root reject
- interactive control reject
- normalize text
- empty reject
- max char reject
- selection snapshot immutability

### provenance

- line ranges
- PDF page ranges
- DOCX rendered page ranges
- PPTX slide ranges
- XLSX sheet/range
- unknown/weak provenance graceful fallback

### quote formatter

- empty draft
- existing draft
- multiline quote
- no accidental code fence break
- XLSX markdown/TSV

### OOXML limits

fixture ZIP：

- normal
- too many entries
- huge declared uncompressed size
- excessive ratio
- encrypted
- path traversal

## 3. Client integration tests

jsdom/happy-dom 能做的：

- adapter registry
- DSH root scoping
- overlay state transitions
- `inputActions.setDraft` exactly once
- draft preserved
- auto-submit never called

对 Range geometry 不应过度依赖 jsdom；几何行为转 Playwright。

## 4. PDF browser tests

真实 Chromium + generated PDF fixtures：

- single-page text
- multi-page text
- mixed font sizes
- rotated page
- CJK text
- scanned/image-only PDF
- selection page provenance
- TextLayer 与 Canvas alignment

视觉测试：

- canvas 与 text-layer bounding boxes 偏差阈值

## 5. DOCX browser tests

fixture：

- paragraphs/headings
- tables
- images
- headers/footers
- manual page break
- lastRenderedPageBreak
- section orientation
- CJK
- footnote

assert：

- visible text order
- selection text
- page provenance only when reliable
- no page provenance fabrication

可选 screenshot regression，不要求与 Word 1:1。

## 6. PPTX browser tests

fixture：

- plain text
- multiple text boxes
- table
- image
- chart
- group
- SmartArt fallback
- CJK
- 100+ slides

assert：

- text selection
- slide provenance
- windowed renderer can select currently mounted slide
- scroll → old slide unmount → selection snapshot invalidated

## 7. XLSX tests

fixture：

- simple cells
- merged cells
- formulas + displayed results
- tables
- frozen panes
- multiple sheets
- chart/image workbook
- large workbook

assert：

- selected range
- active sheet
- serialized values
- <=200 cell enforcement
- selection change updates Ask snapshot
- readOnly prevents editing

## 8. DSH contract compile test

单独创建 compile-only file，验证当前安装版存在：

```ts
ctx.documentPreviews
DocumentPreviewProps
PropsRuntime<'conversation.input.overlay'>
inputActions.setDraft
```

如果任何 API 缺失：

**停止实现。**

输出：

```text
Expected API:
Observed API:
Installed DSH version:
Compiler error:
Candidate migration:
```

禁止用 `any`、deep import private internals 或 DOM hack 绕过。

## 9. Compatibility

版本策略（Task 14 修订）：

- Current official runtime / primary blocking real-app runtime / primary compile-contract
  baseline: DSH `0.1.5-rc.2`
- Historical backward-compatibility evidence: DSH `0.1.5-rc.1`（Task 13 的真实应用矩阵，
  不再是 contract pin，也不再作为维护基线）
- No separate forward target is declared。更新的 DSH release 必须同时通过 contract gate 与
  real-app acceptance，之后才可声称支持；矩阵见 `docs/compatibility.md`。

Contract 依赖不从机器上的 DSH 安装解析，而是在本项目 `devDependencies` 中按同一 release 精确固定：

```text
@deepseek-ai/cordis                              4.0.2
@deepseek-ai/dsh-client-store                    0.1.5-rc.2
@deepseek-ai/dsh-client-ui-conversation          0.1.5-rc.2
@deepseek-ai/dsh-client-ui-dockkit               0.1.5-rc.2
@deepseek-ai/dsh-client-ui-layout                0.1.5-rc.2
@deepseek-ai/dsh-client-ui-renderer              0.1.5-rc.2
@deepseek-ai/dsh-client-ui-session               0.1.5-rc.2
@deepseek-ai/dsh-client-ui-sidebar-documentpreview 0.1.5-rc.2
@deepseek-ai/dsh-client-ui-sidebar-right         0.1.5-rc.2
@deepseek-ai/dsh-client-ui-slots                 0.1.5-rc.2
```

因此：

```bash
git clone && pnpm install && pnpm typecheck && pnpm test && pnpm build
```

只需本项目自身 `node_modules` 即可完成，不依赖也不修改用户级 DSH 安装。`pnpm dsh:doctor`
只做检测：比对 pin 与本机 DSH 安装，并在不一致时以非零退出码报告。`pnpm check:dsh-contracts`
是 Task 14 的完整 gate：在版本一致性之外，还编译 contract probes 并据此决定 PASS/FAIL。

### rc.2 编译契约与真实应用（Task 14 修订）

Task 14 之后不再需要「可丢弃环境里的 rc.2 contract probe」这一独立步骤：rc.2 本身就是当前
基线，编译契约与真实应用验收都在同一运行时上进行。

```text
rc.2 contract:       PASS — pnpm check:dsh-contracts（pin 一致性 + 探针编译）
rc.2 runtime smoke:  PASS — 七个真实 DSH 浏览器套件 63 / 0 / 0，外加 docs/manual-acceptance.md
rc.1 contract:       历史证据，不再是 pin，也不再作为维护基线
```

`docs/compatibility.md` 是支持矩阵，`docs/manual-acceptance.md` 是可执行的人工验收程序；
每轮的实际数值记入 `docs/STATUS.md`，不写回本文件。

## 10. Real DSH acceptance checklist

Windows 11 + Chrome/Edge：

- open text → select → Ask → draft
- open Markdown → select → Ask
- open source → select lines → provenance
- open PDF → select across pages
- open DOCX → select
- open PPTX → select across slide text
- open XLSX → select range
- switch preview renderer from plugin to builtin
- disable plugin → builtin PDF restored
- rapidly close tabs while loading
- switch sessions
- reopen same file
- console has no uncaught errors
