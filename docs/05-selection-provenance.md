# Selection、Provenance 与 Prompt Contract

## 1. Capture 时机

监听：

- `selectionchange`
- `pointerup`
- `keyup`（Shift + Arrow 等键盘选择）

不在每次 `mousemove` 执行昂贵解析。

capture 流程：

```text
browser/library selection
  → determine root
  → choose adapter
  → normalize
  → resolve provenance
  → enforce limits
  → store snapshot
  → show overlay
```

## 2. DOM Selection 安全范围

DOM adapter 必须证明：

```ts
root.contains(anchorNode) &&
root.contains(focusNode)
```

并且 anchor/focus 位于同一个 root。

排除：

```text
input
textarea
select
button 的内部 label 文本（除非 renderer 明确允许）
[contenteditable]
DSH composer
chat transcript
menus/dialogs
```

## 3. Text normalization

目标是保留用户“看到并选中”的语义，而不是 DOM 噪声。

规则：

- CRLF → LF
- 不删除中间换行
- 行尾 trailing spaces 可去除
- 连续 > 3 个空行压到 2 个空行
- 不把所有 whitespace collapse 成一个空格
- PDF TextLayer 允许对“每 glyph/span 造成的伪换行”做 renderer-specific normalize

## 4. Provenance

统一格式：

### Text/code

```text
[来源：src/main.ts，第 42–51 行]
```

### Markdown 无可靠 source line

```text
[来源：README.md]
```

### PDF

```text
[来源：paper.pdf，第 3–4 页]
```

### DOCX

```text
[来源：report.docx，第 3–4 渲染页]
```

“渲染页”是有意措辞。

### PPTX

```text
[来源：slides.pptx，第 12–14 张幻灯片]
```

### XLSX

```text
[来源：budget.xlsx，Sheet1!B4:D9]
```

## 5. Quote formatter

```ts
function formatSelectionForDraft(snapshot: SelectionSnapshot): string
```

输出：

```md
> [来源：paper.pdf，第 3–4 页]
> 第一行
> 第二行

请针对以上选中内容回答：
```

对已有 draft：

```ts
next = existing.trimEnd()
  ? `${existing.trimEnd()}\n\n${quote}`
  : quote
```

禁止覆盖。

## 6. XLSX 表格 formatter

例如 B2:D4：

```md
> [来源：budget.xlsx，Sheet1!B2:D4]
>
> | B | C | D |
> |---|---|---|
> | Revenue | 120 | 135 |
> | Cost | 80 | 92 |
> | Margin | 40 | 43 |

请针对以上选中内容回答：
```

若列数/内容不适合 Markdown：

```text
```tsv
Revenue    120    135
Cost       80     92
Margin     40     43
```
```

## 7. Snapshot stability

用户点击浮层按钮时浏览器 selection 可能已经 collapse。

因此：

- `SelectionSnapshot` 必须在 selection 有效时复制
- Ask 点击使用 snapshot，不重新读取 `window.getSelection()`
- 文件 tab/renderer 改变即 invalidate snapshot

## 8. 浮层位置

普通 DOM：

```ts
range.getBoundingClientRect()
```

若 rect width/height 为 0：

```ts
range.getClientRects()
```

取最后一个可见 rect。

PDF 跨页：

- Ask 放在 selection 末端 visible rect 附近

XLSX：

- 使用 viewer selection geometry（若公开）
- 否则固定 workbook viewport corner

## 9. Selection rejection reasons

```ts
type SelectionRejectReason =
  | 'collapsed'
  | 'outside-supported-preview'
  | 'cross-root'
  | 'interactive-control'
  | 'empty-after-normalization'
  | 'too-large'
  | 'too-many-cells'
  | 'renderer-not-ready'
```

普通无效 selection 静默隐藏浮层。

只有用户已明确产生支持格式选区但超过限额时显示错误提示。
