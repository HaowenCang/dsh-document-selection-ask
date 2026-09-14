# DeepSeek v4.1 Flash — First Round Prompt

你现在位于 `dsh-document-selection-ask` 仓库根目录。

这是一个 DSH 客户端插件项目。目标是在 DSH 右侧 Document Preview 中，为 TXT/Markdown/代码/CSV/PDF/DOCX/PPTX/XLSX 提供统一的“选中内容 → 询问 DeepSeek”能力。

本轮只执行 **Task 1**，不要执行 Task 2 或任何后续任务。

## 先阅读

严格按以下顺序：

1. `AGENTS.md`
2. `docs/superpowers/specs/2026-09-14-dsh-universal-document-selection-design.md`
3. `docs/superpowers/plans/2026-09-14-dsh-universal-document-selection.md`
4. 计划中的 `Task 1: Bootstrap the package and prove the DSH public contracts`

## 执行前先报告环境

只报告这些项目：

```text
DSH version:
Node version:
pnpm version:
@deepseek-ai/dsh-client-ui-sidebar-documentpreview version:
pdfjs-dist version used by installed DSH:
working tree clean: YES/NO
```

然后执行 Task 1。

## 规则

- 必须 test/compile first。
- 不允许使用 `any` 绕开 DSH 类型错误。
- 不允许 deep import DSH 的 `src/`。
- 不允许修改 DSH `node_modules`。
- 如果 `ctx.documentPreviews`、`sidebar.right.tab.document`、`DocumentPreviewProps`、`conversation.input.overlay` 或公开 `inputActions.setDraft` 的契约无法从当前安装版获得，立即停止。
- 契约不匹配时不要自行设计兼容层，按 `AGENTS.md` 格式报告。
- 本轮不要写任何 PDF/DOCX/PPTX/XLSX renderer。
- 本轮不要提前安装不属于 Task 1 验证所必需的格式 renderer 依赖实现代码。
- 完成测试、typecheck、build、diff review、commit 后停止。

## 本轮结束报告

严格使用 `AGENTS.md` 中的 Task 报告格式。

不要继续 Task 2。
