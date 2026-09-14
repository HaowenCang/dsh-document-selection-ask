# Format Adapter 设计

## 1. DSH Text / Markdown / Code / CSV Adapter

### 策略

不替换 renderer。

范围 root：

```css
[data-textpreview-url][data-document-preview]
```

捕获：

```ts
window.getSelection()
```

要求：

- `rangeCount > 0`
- `!selection.isCollapsed`
- anchor/focus 属于同一 Document Preview root
- 不是 input/textarea/contenteditable
- 文本 normalize 后非空

### 行号

#### code

优先根据 renderer 的 per-line DOM（例如 `code > .line`）解析首尾 line。

#### plain text

利用 DSH `DocumentContent.pages` 的 accumulated text 与 source line counts，建立 visible text → source offset mapping。

#### Markdown

rendered Markdown 与 source Markdown 不是一一字符映射，因此首版：

- 默认 provenance 只写文件名
- 只有 adapter 能证明 source line 映射准确时才输出 lines
- 严禁伪造“精确行号”

## 2. PDF Adapter

### Renderer

`pdfjs-dist`：

```text
Page
├─ canvas            visual pixels
└─ textLayer         selectable text positioned over canvas
```

Canvas：

- viewport 使用 CSS pixel dimensions
- backing store 乘 `devicePixelRatio`

TextLayer：

- 使用与 canvas 完全相同的 CSS viewport
- 绝不能使用 DPR-scaled viewport
- 每页 root：

```html
<div data-dsa-pdf-page="3">
```

### lazy rendering

IntersectionObserver：

- rootMargin 约 100% viewport
- 首屏至少 page 1
- 进入邻近视区后加载

### selection provenance

Range start/end 向上找到最近：

```css
[data-dsa-pdf-page]
```

得到 start/end page。

### scanned PDF

如果 TextLayer 无文本：

- 正常显示 canvas
- 不显示 Ask 按钮
- 可显示非侵入提示：
  “该页面没有可选择文本；OCR 不在当前版本范围内。”

## 3. DOCX Adapter

### Renderer

`docx-preview`

输入：

```ts
Uint8Array<ArrayBuffer>
```

先通过 OOXML preflight。

建议渲染：

```ts
renderAsync(bytes, body, styleHost, {
  breakPages: true,
  ignoreLastRenderedPageBreak: false,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  useBase64URL: false,
})
```

### DOM root

插件外围：

```html
<section data-dsa-document-kind="docx">
  <div data-dsa-docx-host />
</section>
```

渲染结束后：

- 仅在已实际生成分页容器时增加 `data-dsa-docx-page`
- 不通过高度猜测强行伪造 Word 页码

### provenance

若 selection 跨多个可识别 page：

```text
report.docx，第 3–4 渲染页
```

若 renderer 未产生可靠分页：

```text
report.docx
```

这是比错误页码更可靠的降级。

### fidelity

不得声明“与 Word 像素一致”。

验收只要求：

- 主要文字顺序正确
- 常见标题/段落/表格/图片可读
- selection 与可见文本对应
- 常见 Word 文件布局明显优于纯文本抽取

## 4. PPTX Adapter

### Renderer

`@aiden0z/pptx-renderer`

建议：

```ts
PptxViewer.open(buffer, host, {
  renderMode: 'list',
  listOptions: { windowed: true },
  fitMode: 'contain',
  zipLimits: RECOMMENDED_ZIP_LIMITS,
  signal,
})
```

### selection

仅捕获 viewer host 内真实 HTML/SVG text。

slide container 必须获得稳定标记：

```html
<div data-dsa-pptx-slide="12">
```

如果第三方库没有公开 slide DOM contract：

- 不依赖 hashed className
- 在我们的 viewer integration 层，根据公开 render lifecycle / slide model 建立 wrapper
- 禁止抓取私有 React fiber

### provenance

```text
presentation.pptx，第 12 张幻灯片
presentation.pptx，第 12–14 张幻灯片
```

### 不支持对象

动画、transition、OMML、复杂 3D 等：

- 尽力显示静态内容
- 不阻止其它 slide 的 selection
- console 不应因单个 unsupported object 持续刷错

## 5. XLSX Adapter

### renderer

`@extend-ai/react-xlsx`

首版：

```tsx
<XlsxViewer
  file={buffer}
  readOnly
  showDefaultToolbar={false}
  /* plugin controls sheet nav/zoom only if needed */
/>
```

### selection semantics

XLSX 不使用 browser text selection 作为主入口。

使用库公开 selection hook：

```ts
useXlsxViewerSelection()
```

得到：

- `activeCellAddress`
- `selectedRangeAddress`

统一转为：

```ts
SelectionLocation = {
  kind: 'cells',
  sheet: 'Sheet1',
  range: 'B4:D9',
}
```

### text serialization

选区序列化优先保留：

- displayed value
- row/column order
- empty cells
- formulas不作为唯一文本替代 displayed result

格式：

- 小区域：Markdown table
- 大区域：TSV fenced block

限制：

- <= 200 cells
- <= 16,384 chars

### selection overlay

电子表格 selection 后：

- Ask button 固定显示在 selected range bounding box 附近
- 若 library 暂时不暴露 selection rect，则显示在 workbook viewport 右上角，但 snapshot 仍正确
- UI position 不得通过 React fiber 读取

## 6. Adapter Compatibility Contract

每个 adapter 必须通过：

```ts
interface SelectionAdapter {
  readonly id: string
  readonly kinds: readonly DocumentKind[]

  capture(context: SelectionContext): SelectionSnapshot | null
  clear?(): void
}
```

renderer-specific details 不允许泄漏到：

- quote formatter
- composer bridge
- overlay UI

否则未来增加 EPUB/ODT/RTF 会再次产生耦合。
