# 推荐项目结构

```text
dsh-document-selection-ask/
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.json
├─ tsconfig.client.json
├─ tsdown.config.ts
├─ cordis.patch.yml
├─ LICENSE
├─ THIRD_PARTY_NOTICES.md
├─ README.md
├─ README.zh.md
├─ AGENTS.md                         # 在实施计划阶段生成
├─ DEEPSEEK_START_PROMPT.md          # 在实施计划阶段生成
│
├─ scripts/
│  ├─ verify.mjs
│  ├─ generate-pdf-fixtures.mjs
│  ├─ generate-docx-fixtures.mjs
│  ├─ generate-pptx-fixtures.mjs
│  └─ generate-xlsx-fixtures.mjs
│
├─ src/
│  ├─ index.ts
│  └─ client/
│     ├─ index.tsx
│     │
│     ├─ dsh/
│     │  ├─ register.ts
│     │  ├─ contracts.ts
│     │  ├─ composer-bridge.ts
│     │  └─ focus-composer.ts
│     │
│     ├─ selection/
│     │  ├─ types.ts
│     │  ├─ registry.ts
│     │  ├─ kernel.ts
│     │  ├─ dom-range.ts
│     │  ├─ scope.ts
│     │  ├─ normalize.ts
│     │  ├─ limits.ts
│     │  └─ lifecycle.ts
│     │
│     ├─ provenance/
│     │  ├─ index.ts
│     │  ├─ text-lines.ts
│     │  ├─ page-range.ts
│     │  ├─ slide-range.ts
│     │  ├─ cell-range.ts
│     │  └─ format.ts
│     │
│     ├─ quote/
│     │  ├─ format-selection.ts
│     │  ├─ format-xlsx.ts
│     │  └─ escape-markdown.ts
│     │
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
│     │
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
│     │  │
│     │  ├─ docx/
│     │  │  ├─ register.ts
│     │  │  ├─ DocxBody.tsx
│     │  │  ├─ DocxBody.module.css
│     │  │  ├─ engine.ts
│     │  │  └─ page-markers.ts
│     │  │
│     │  ├─ pptx/
│     │  │  ├─ register.ts
│     │  │  ├─ PptxBody.tsx
│     │  │  ├─ PptxBody.module.css
│     │  │  ├─ engine.ts
│     │  │  └─ slide-markers.ts
│     │  │
│     │  └─ xlsx/
│     │     ├─ register.ts
│     │     ├─ XlsxBody.tsx
│     │     ├─ XlsxBody.module.css
│     │     ├─ engine.ts
│     │     ├─ viewer-context.tsx
│     │     └─ selection-bridge.ts
│     │
│     ├─ ooxml/
│     │  ├─ preflight.ts
│     │  ├─ limits.ts
│     │  └─ errors.ts
│     │
│     ├─ ui/
│     │  ├─ SelectionAskOverlay.tsx
│     │  ├─ SelectionAskOverlay.module.css
│     │  ├─ SelectionErrorToast.tsx
│     │  └─ locales.ts
│     │
│     └─ assets/
│        └─ asset-imports.d.ts
│
├─ tests/
│  ├─ unit/
│  │  ├─ selection/
│  │  ├─ provenance/
│  │  ├─ quote/
│  │  ├─ ooxml/
│  │  └─ adapters/
│  │
│  ├─ client/
│  │  ├─ overlay.client.spec.tsx
│  │  ├─ composer-bridge.client.spec.tsx
│  │  └─ renderer-registration.client.spec.tsx
│  │
│  ├─ browser/
│  │  ├─ pdf-selection.spec.ts
│  │  ├─ docx-selection.spec.ts
│  │  ├─ pptx-selection.spec.ts
│  │  └─ xlsx-selection.spec.ts
│  │
│  ├─ compatibility/
│  │  └─ contracts.compile.ts
│  │
│  └─ fixtures/
│     ├─ pdf/
│     ├─ docx/
│     ├─ pptx/
│     └─ xlsx/
│
└─ docs/
   ├─ architecture.md
   ├─ compatibility.md
   ├─ security.md
   ├─ testing.md
   ├─ renderer-support.md
   ├─ references/
   │  └─ SOURCE_LEDGER.md
   └─ superpowers/
      ├─ specs/
      │  └─ 2026-09-14-dsh-universal-document-selection-design.md
      └─ plans/
         └─ 2026-09-14-dsh-universal-document-selection.md  # 设计批准后生成
```

## 文件边界原则

### `selection/`

完全不知道 PDF.js、docx-preview、pptx-renderer、react-xlsx 的内部 API。

### `adapters/`

只负责把具体 selection 模型转换成 `SelectionSnapshot`。

### `renderers/`

只负责将 bytes 渲染成高保真可视内容，并提供 adapter 需要的公开 DOM/selection bridge。

### `ooxml/`

DOCX/PPTX/XLSX 共用安全检查，禁止在三个 renderer 中复制限额逻辑。

### `dsh/`

DSH API 边界集中放置。DSH 升级时优先修改这一层，而不是全仓搜索 private API。

### `quote/`

纯函数；不依赖 DOM/React/DSH。

这样做是为了让 DeepSeek v4.1 Flash 每次只需掌握一个小边界，避免大型单文件和跨层修改。
