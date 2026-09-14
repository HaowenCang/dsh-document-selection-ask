# 总体架构

## 1. 逻辑分层

```text
┌─────────────────────────────────────────────────────────┐
│ DeepSeek Harness                                        │
│  Document Preview owner + current conversation composer │
└──────────────────┬───────────────────────────┬──────────┘
                   │                           │
          preview content                     │ public input actions
                   │                           │
                   ▼                           ▼
┌──────────────────────────────┐       ┌───────────────────┐
│ Renderer / Existing Preview │       │ Composer Bridge   │
│                              │       │ setDraft + focus  │
│ DSH text/markdown/code       │       └─────────▲─────────┘
│ PDF adapter                  │                 │
│ DOCX adapter                 │                 │
│ PPTX adapter                 │                 │
│ XLSX adapter                 │                 │
└──────────────┬───────────────┘                 │
               │ SelectionCandidate             │
               ▼                                │
┌─────────────────────────────────────────────────────────┐
│ Universal Selection Kernel                              │
│ scope → capture → normalize → provenance → limits       │
└──────────────────┬──────────────────────────────────────┘
                   │ SelectionSnapshot
                   ▼
┌──────────────────────────────┐
│ Selection Ask Overlay        │
│ position + validation + UI   │
└──────────────────┬───────────┘
                   │
                   ▼
          Quote / Prompt Formatter
```

## 2. 为什么 Selection Kernel 必须独立

如果每个 renderer 自己实现 Ask：

- 引用格式会漂移
- composer 写入逻辑会重复
- 长度限制会不一致
- UI 行为会不一致
- DeepSeek 修复一个 bug 时要改多个格式

因此 renderer 只需要实现：

```ts
interface SelectionAdapter {
  readonly id: string
  canHandle(ctx: SelectionContext): boolean
  capture(ctx: SelectionContext): SelectionSnapshot | null
}
```

核心对所有 snapshot 使用同一套：

- validation
- max-size policy
- quote formatter
- composer bridge
- telemetry（首版默认无远程 telemetry）
- error presentation

## 3. 核心数据结构

```ts
type DocumentKind =
  | 'text'
  | 'markdown'
  | 'code'
  | 'csv'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'

type SelectionLocation =
  | {
      kind: 'lines'
      start: number
      end: number
    }
  | {
      kind: 'pages'
      start: number
      end: number
      fidelity: 'source' | 'rendered'
    }
  | {
      kind: 'slides'
      start: number
      end: number
    }
  | {
      kind: 'cells'
      sheet: string
      range: string
    }
  | {
      kind: 'document'
    }

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

`fidelity: 'rendered'` 用于 DOCX 页码，明确其页码可能来自浏览器分页而非 Word 排版引擎。

## 4. DSH 集成

### 4.1 Renderer registry

PDF/DOCX/PPTX/XLSX 各自注册独立 renderer：

```ts
ctx.documentPreviews.register({
  id: '@scope/dsh-document-selection-ask/pdf',
  extensions: ['pdf'],
  priority: 'extension',
  title: () => 'Selectable PDF',
  loading: 'bytes-complete',
  wrap: false,
})
```

Office 同理。

`priority: 'extension'` 让插件 renderer 自动优先于 DSH builtin，同时 builtin 仍保留在候选菜单中作为降级路径。

### 4.2 Renderer body

每个 renderer body 注册到：

```text
sidebar.right.tab.document
```

key 必须与 registry `id` 相同。

### 4.3 Existing preview capture

TXT/Markdown/code/CSV 不注册 renderer。

Selection Kernel 只接受来自：

```css
[data-textpreview-url][data-document-preview]
```

的 selection，并进一步排除 composer/chat transcript/interactive controls。

### 4.4 Ask overlay

浮层作为：

```text
conversation.input.overlay
```

的一个 contribution。

这样不依赖全局 React root，也不向 `document.body` 注入未知生命周期组件。

## 5. Composer Bridge

唯一写入 API：

```ts
inputActions.setDraft(nextDraft)
```

禁止：

- `textarea.value = ...`
- `dispatchEvent(new InputEvent(...))`
- Lexical private nodes
- React fiber lookup
- 连续 `setDraft(); submit();`

首版只设置 draft。

## 6. Renderer 生命周期

每个 byte renderer 都必须：

- 遵循 `tab.signal`
- 自己创建的 AbortController 与 `tab.signal` 合并
- unmount 时释放：
  - worker
  - Blob URL
  - object URL
  - viewer instance
  - IntersectionObserver
  - ResizeObserver
  - event listeners

## 7. Adapter 注册

建议纯数据 registry：

```ts
class SelectionAdapterRegistry {
  register(adapter: SelectionAdapter): () => void
  capture(context: SelectionContext): SelectionSnapshot | null
}
```

顺序：

1. XLSX semantic range adapter
2. plugin DOM-root adapters
3. DSH text/code/markdown adapter
4. generic DOM fallback —— 首版禁用

禁止“网页任何 Selection 都能 Ask”，否则会意外捕获聊天正文、菜单、设置页等。

## 8. 状态模型

Selection state 只需要：

```ts
type SelectionUiState =
  | { kind: 'idle' }
  | { kind: 'ready'; snapshot: SelectionSnapshot }
  | { kind: 'invalid'; reason: SelectionRejectReason }
```

它不进入 session 持久化。

Selection 改变、文件 tab 切换、renderer unmount、Esc、点击 Ask 后，都应清理 transient snapshot。
