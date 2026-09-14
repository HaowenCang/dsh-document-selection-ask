# 开源项目调研与技术选型

## 1. DSH 官方能力

本节的技术调研基于 DeepSeek Harness `0.1.5-rc.2` 源码进行。

调研对象与项目的运行时基线是两件事：项目主验证运行时为 `0.1.5-rc.1`，`0.1.5-rc.2` 仅为 forward compile-contract target。当前基线见 `docs/STATUS.md`。

DSH 已提供右侧 Document Preview，并公开 renderer registry。第三方 renderer 可注册：

```ts
ctx.documentPreviews.register({
  id,
  extensions,
  priority: 'extension',
  title,
  loading: 'text-pages' | 'bytes-complete',
  wrap,
})
```

并在 keyed slot `sidebar.right.tab.document` 下注册相同 `id` 的 body。

`DocumentPreviewProps` 为 renderer 提供：

- `resourceAddress`
- `content`
- `wrap`
- `scrollportRef`
- 标准 `useTabInfo`
- 标准 `useResource`

这意味着插件无需自行建立文件 HTTP 服务，也不应绕过 DSH 的 Session 文件权限模型。

### 1.1 文本/Markdown/源码

DSH 内置 plain text、Markdown 与 code renderer 已经输出真实 DOM 文本，且 Document Preview 根存在稳定的自动化测试选择器：

```html
[data-textpreview-url][data-document-preview]
```

因此首版不应重写这些 renderer。插件只需在允许的 Document Preview root 中监听浏览器 Selection。

### 1.2 PDF

DSH 当前 PDF body 的每页仅渲染：

```tsx
<canvas ... />
```

没有 PDF.js TextLayer，因此无法在页面可见位置原生选择文本。

结论：PDF 必须提供一个 `priority: 'extension'` 的 renderer，用 PDF.js 同时渲染 Canvas 与 TextLayer。

## 2. DOCX

### 2.1 首选：docx-preview / docxjs

项目目标就是将 DOCX 转为尽量保持语义与版式的 HTML。

优点：

- 浏览器原生
- 输出真实 DOM 文本，可直接使用 Selection API
- 支持页面宽高、字体、页眉页脚、脚注尾注、图片、样式等
- API 稳定入口 `renderAsync`
- Apache-2.0

关键限制：

- 它不是 Microsoft Word 排版引擎
- 不会对任意连续文本实时重新分页
- 页面边界主要来自 manual page break、`lastRenderedPageBreak`、section/page settings
- 浏览器字体差异会改变行折行与最终分页

因此本项目将“DOCX 页码”定义为**浏览器 renderer 的渲染页**，不承诺与 Word 的物理页码完全一致。

建议参数：

```ts
{
  breakPages: true,
  ignoreLastRenderedPageBreak: false,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  useBase64URL: false,
}
```

### 2.2 备选：recon-vcs/docx-renderer

这是 docx-preview 系列的现代高保真分支，拥有更强的 fixture 与 browser regression 测试体系。

暂不作为首选依赖的原因：

- 生态成熟度与长期 API 稳定性低于 docx-preview
- 我们通过 `DocxEngine` adapter 隔离具体库，因此后续可以无侵入替换

## 3. PPTX

### 首选：@aiden0z/pptx-renderer

该项目为 browser-native PPTX renderer：

- OOXML 解析
- HTML/SVG DOM 输出
- shapes / text / images / tables / charts
- SmartArt fallback data
- list / slide 模式
- windowed long-deck rendering
- AbortSignal
- zip safety limits
- visual regression against PowerPoint ground truth
- Apache-2.0

这比“把 PPTX 转 PDF”更适合本项目，因为 DOM/SVG 中的文本可以保留为真实文本节点，从而支持原位置 Selection。

限制必须在 UI/文档中承认：

- 3D effects
- animations/transitions
- equations / OMML
- 完整 EMF/WMF vector
- 部分复杂 Office 特效
- 本地字体缺失导致的版式偏差

## 4. XLSX

电子表格不应采用普通浏览器文字拖选作为主交互。用户真正选择的是 cell/range，而不是一段无结构字符串。

### 首选：@extend-ai/react-xlsx

当前项目提供：

- React viewer
- worksheet rendering
- frozen panes
- tables
- worksheet images
- embedded charts / chartsheets
- selection state
- zoom
- worker-backed parsing
- WASM parser/calculation
- read-only mode
- file size safeguards
- MIT

其公开 hook 可得到：

- active cell
- selected range

因此 XLSX adapter 应监听**工作表 range selection**，将它标准化成统一 `SelectionSnapshot`，并序列化：

```text
Sheet1!B4:D8
```

以及选区显示值的 TSV/Markdown table。

注意：

- `experimentalCanvas` 默认可能启用 Canvas worksheet renderer
- 本项目不依赖浏览器文本 Range 处理 XLSX，因此 Canvas 并非阻塞项
- 首版强制 `readOnly`
- 不显示保存、编辑、export 等会造成“插件可以修改原文件”误解的控件

### 备选：xlsx-preview + exceljs

优点是结构简单、HTML 输出天然可选择。

缺点：

- 交互和大表性能弱
- charts/images/frozen panes 等能力不如 react-xlsx
- range selection 语义需要自己补

因此只作为 fallback/spike 参考。

## 5. 统一文档 viewer 参考

### cweijan/vscode-office

该项目证明了：

- PDF.js
- docxjs
- PPTX browser renderer
- SheetJS + spreadsheet UI

可以共同组成一个本地 Office preview 体系。

我们不直接移植其 VS Code webview 架构，只参考 format-per-renderer 的分层模式。

### omni-doc-viewer / react-file-viewer-v2

这些项目证明“统一 API 包装多个 renderer”是成熟方向。但本项目的核心不是 generic viewer，而是 DSH 的 Selection → Ask 管线，因此仍需自己维护 Selection Kernel 与 provenance contract。

## 6. OOXML 安全

DOCX/PPTX/XLSX 都是 ZIP 容器。

首版增加公共 OOXML preflight：

- 使用 `@zip.js/zip.js` 读取 central-directory metadata
- 不在 preflight 阶段展开 entry data
- 检查 entry count、uncompressed sizes、compression ratio、路径、加密标志
- 通过后再交给具体 renderer

这样可以在 docx-preview 等库实际解压前拦截明显 ZIP bomb。

## 7. 结论

推荐栈：

```text
DSH official text/markdown/code
            │
            ├── PDF: pdfjs-dist + TextLayer
            ├── DOCX: docx-preview
            ├── PPTX: @aiden0z/pptx-renderer
            └── XLSX: @extend-ai/react-xlsx
                         │
                OOXML preflight: @zip.js/zip.js
```

所有格式统一进入：

```text
Selection Adapter
  → SelectionSnapshot
  → Provenance Resolver
  → Selection Overlay
  → Quote Formatter
  → inputActions.setDraft()
```
