# 产品与技术需求

## 1. 用户场景

用户在 DSH 右侧文件预览中阅读文件时，可以直接选中内容并点击“询问 DeepSeek”。

插件必须保持用户当前阅读上下文：

- 不要求先复制
- 不要求另开文件
- 不要求手工输入文件名、页码、slide、sheet
- 不将文件上传到第三方服务

## 2. 首版支持矩阵

| 类型 | 扩展名 | 预览策略 | Selection 语义 | Provenance |
|---|---|---|---|---|
| Plain text | `.txt` + DSH 文本 fallback | 复用 DSH | DOM Range | 文件 + 可得时行号 |
| Markdown | `.md/.markdown` | 复用 DSH | DOM Range | 文件；源行仅可靠时提供 |
| Code/config | DSH 已识别源码/配置 | 复用 DSH | DOM Range | 文件 + 行号 |
| CSV | `.csv` | 首版复用 DSH text/code | DOM Range | 文件 + 行号 |
| PDF | `.pdf` | Canvas + TextLayer | DOM Range | 页码范围 |
| DOCX | `.docx` | HTML DOM | DOM Range | 渲染页范围 |
| PPTX | `.pptx` | HTML/SVG DOM | DOM Range | slide 范围 |
| XLSX | `.xlsx` | worksheet viewer | Cell Range | sheet + A1 range |

## 3. 首版明确不做

- `.doc/.ppt/.xls`
- OCR
- 扫描 PDF 自动识别
- Office 文件编辑
- 持久高亮/批注
- 将 selection 自动发送给模型
- 独立 side chat
- 文件内容自动进入 system prompt
- HTML iframe 内跨文档 selection
- OLE/宏执行
- 外部 Office conversion service
- LibreOffice/MS Office/COM 依赖

## 4. Ask 交互

用户完成合法 selection 后出现浮动按钮：

```text
[ 询问 DeepSeek ]
```

点击后：

1. Snapshot selection，避免 focus 变化导致 Range 丢失
2. 生成 provenance
3. 格式化为 Markdown 引用
4. 追加到当前 draft
5. 聚焦 composer
6. 用户自行补充问题并发送

不自动 `submit()`。

## 5. Draft 保留

如果 composer 已有文本：

```text
已有问题
```

点击后变为：

```text
已有问题

> [来源：paper.pdf，第 3–4 页]
> ...
> ...

请针对以上选中内容回答：
```

不得覆盖用户已有 draft。

## 6. 长度限制

默认：

- 普通文本 selection：16,384 UTF-16 code units
- XLSX：最多 200 个 cells
- 序列化后的 XLSX 内容同样不超过 16,384 code units

超过限制：

- 不静默截断
- 浮层提示“选区过大，请缩小范围”
- 不修改 draft

## 7. 跨区域 selection

仅允许 anchor/focus 位于同一 logical selection root。

禁止：

- 从 Sidebar 文件拖选到 chat transcript
- 跨两个不同文件 tab
- 跨两个 iframe
- selection 包含 composer/input/contenteditable
- PDF 两个不同文档实例之间跨选

单个 PDF/DOCX/PPTX 中允许跨页/跨 slide selection。

## 8. 可访问性

- Ask button 必须可键盘聚焦
- selection 快捷键可后续增加，但首版不强制
- loading/error 有 `role=status` / `role=alert`
- tooltip/按钮均有中英文 locale
- `prefers-reduced-motion` 不依赖动画才能理解状态

## 9. 成功标准

以下全部通过才视为 v1 完成：

- TXT/MD/code/PDF/DOCX/PPTX/XLSX 均能产生合法 Ask payload
- PDF 可直接选择真实文本
- PPTX 文本不是截图或 OCR
- DOCX 文本不是图片
- XLSX range 带 sheet/range
- draft 不被覆盖
- 插件不自动发送
- 禁用插件后 DSH 内置预览恢复
- 无远程文件上传
- DSH 当前 release baseline 下无 console error
