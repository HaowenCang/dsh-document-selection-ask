# Supersession Notice

本设计包替代之前的“PDF 为核心、文本预览附带支持”的 `dsh-document-selection-ask` 设计。

旧方案中的以下原则仍保留：

- 使用 DSH 官方 Document Preview registry，而非修改 `node_modules`
- 使用 `conversation.input.overlay`
- 使用公开 `inputActions.setDraft`
- 不自动提交
- PDF 使用 PDF.js TextLayer
- 严格处理 AbortSignal、worker cleanup 与 renderer disposal

以下内容被正式替换：

- 插件核心从“PDF selectable renderer”升级为“Universal Selection Kernel”
- Office Open XML（DOCX/PPTX/XLSX）成为首版范围
- Selection provenance 从 `line/page` 二元扩展为 `line/page/slide/cell-range`
- Renderer 目录按格式 adapter 隔离
- 测试范围扩展到 fixture + visual regression + selection semantics
