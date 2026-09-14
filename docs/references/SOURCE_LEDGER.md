# Source Ledger

研究日期：2026-09-14

## DeepSeek Harness

### Repository
https://github.com/deepseek-ai/deepseek-harness

### Baseline
commit family / release: `0.1.5-rc.2`

### Relevant files

- `package.json`
  - confirms DSH version `0.1.5-rc.2`
  - Node engine `^22.19.0 || >=24.0.0`

- `packages/client/ui-sidebar-documentpreview/README.md`
  - Document Preview owner
  - renderer registry contract
  - `text-pages` vs `bytes-complete`
  - external renderer priority
  - keyed `sidebar.right.tab.document`

- `packages/client/ui-sidebar-documentpreview/src/client/document/registry.ts`
  - `DocumentPreviewDefinition`
  - extension priority beats builtin

- `packages/client/ui-sidebar-documentpreview/src/client/document/contract.ts`
  - `DocumentContent`
  - `DocumentPreviewProps`

- `packages/client/ui-sidebar-documentpreview/src/client/pdf/PdfBody.tsx`
  - current PDF pages render only `<canvas>`
  - no TextLayer

- `packages/client/ui-sidebar-documentpreview/src/client/TextPreview.tsx`
  - root carries `data-textpreview-url` and `data-document-preview`

- `packages/client/ui-conversation/src/client/input/facade.ts`
  - public `inputActions.setDraft`

- slot subsystem references
  - `conversation.input.overlay`

## DOCX

### docx-preview / docxjs
https://github.com/VolodymyrBaydalka/docxjs

Key findings:

- Apache-2.0
- browser HTML renderer
- stable `renderAsync`
- `breakPages`
- manual / lastRendered page breaks
- real-time Word-compatible repagination not implemented

## PPTX

### @aiden0z/pptx-renderer
https://github.com/aiden0z/pptx-renderer

Key findings:

- Apache-2.0
- browser-native
- HTML/SVG
- windowed long deck
- AbortSignal
- zip limits
- shapes, text, images, tables, charts, SmartArt fallback
- explicit unsupported Office features documented

## XLSX

### @extend-ai/react-xlsx
https://github.com/extend-hq/react-xlsx

Key findings:

- MIT
- React viewer
- worksheets, charts, images
- selection state
- readOnly
- worker-backed parsing
- local WASM can be configured
- file-size safeguards
- primarily OOXML `.xlsx`

### xlsx-preview
https://github.com/simon5057/xlsx-preview

Used as fallback reference only.

## Multi-format architectural references

### VSCode Office Viewer
https://github.com/cweijan/vscode-office

Shows practical multi-renderer composition:
PDF.js + docxjs + PPTX renderer + spreadsheet renderer.

### omni-doc-viewer
https://github.com/akbhuker/omni-doc-viewer

Shows a unified viewer facade over multiple format engines.

## ZIP / OOXML

### zip.js
https://github.com/gildas-lormeau/zip.js

Key findings:

- BSD-3-Clause
- browser-capable ZipReader
- entry metadata includes declared uncompressed size
- appropriate for metadata-only preflight
