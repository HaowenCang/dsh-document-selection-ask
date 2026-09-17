# 安全、性能与资源生命周期

## 1. 信任边界

文件内容是不可信输入。

插件不得因为“这是用户本地文件”而跳过：

- ZIP bomb 防护
- XML/OOXML size limits
- worker termination
- object URL cleanup
- DOM sanitization assumptions
- unsupported embedded object handling

## 2. 无远程上传

首版所有解析均在浏览器内完成。

禁止：

- Google Docs Viewer
- Microsoft Office Online viewer
- 外部 conversion API
- 外部 OCR
- CDN worker
- CDN WASM

依赖的 worker/WASM/字体资源必须随插件包提供或由安装时依赖提供。

## 3. OOXML 安全管线与提取验证 (OOXML Pipeline)

在 DOCX/PPTX/XLSX renderer 调用前，必须经过两道安全门禁：

1. **Central-directory metadata preflight (`preflightOoxml`)**：
   `@zip.js/zip.js` 仅读取 central directory 元数据，不展开任何 entry 正文。
   校验 declared entry count、declared compressed/uncompressed sizes、compression ratio (<= 200)、unsafe paths、encrypted entries 等。
   这是廉价元数据门禁，但 declared uncompressed size 是不可信声明。

2. **Bounded streaming extraction verification (`verifyOoxmlExtraction`)**：
   在第三方 renderer（如 docx-preview / JSZip）解压前，必须证明 actual decompressed size == declared uncompressed size。
   使用 `WritableStream` 计数丢弃槽（discarding sink），不保留解压数据，边流式解压边检查：
   - 一旦 actualEntryBytes > declaredUncompressedSize，立即中断并拒绝；
   - 一旦超过 single-entry 或 aggregate 限制，立即中断；
   - 解压结束时要求 actualEntryBytes === declaredUncompressedSize（防御 actual < declared）；
   - 检验 entry CRC-32 / signature 与重叠 entry。

3. **Format renderer**：
   仅当上述两道门禁全部通过后，第三方 renderer 才能在独立 detached staging 中执行。
   注意：此流程引入了双重解压（double decompression）的安全与性能折衷，但消除了恶意伪造声明尺寸绕过 preflight 的 ZIP bomb 攻击面。

建议硬限制：

```ts
const OOXML_LIMITS = {
  maxEntries: 10_000,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxSingleUncompressedBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 200,
}
```

同时拒绝：

- encrypted ZIP entries
- absolute paths
- `..` path traversal segments
- NUL-containing names

即使不落盘也做 path 检查，避免未来 adapter 复用时留下危险假设。

## 4. DSH byte cap

DSH `bytes-complete` 本身受 Host `maxFileBytes` 限制。

插件首版尊重该限制，不实现绕过 Host 的私有读取路径。

当文件超过 Host cap：

- 显示 DSH/renderer 可理解错误
- 不偷偷通过 `fetch(file://...)`
- 不创建未授权本地 HTTP endpoint

## 5. PDF

- PDF.js worker 本地 bundle
- worker init 失败应显式报错
- 不做 main-thread silent fallback
- unmount/abort 时 cancel render task + destroy document/worker
- Canvas pixel buffer 用 DPR，但限制极大页面 backing store，避免 GPU/内存爆炸

建议：

```text
max canvas dimension: 16,384 px
max backing pixels/page: 64 MP
```

超过则降低 render scale，但 TextLayer 仍按 CSS viewport 对齐。

## 6. PPTX

启用：

- renderer `RECOMMENDED_ZIP_LIMITS`
- windowed list
- lazy media（若 API 当前支持且验证通过）
- AbortSignal

100+ slide deck 不应一次 mount 全部复杂 slide DOM。

## 7. DOCX

`docx-preview` 可生成大量 DOM。

防护：

- byte cap + OOXML preflight
- render 操作在 tab abort 后忽略结果
- URL.createObjectURL 必须由 renderer disposal 清理
- document style node 只能写入插件自己的 scoped style host
- 不将 altChunk 任意 HTML 直接以不受控方式注入 DSH app root

首版建议 `renderAltChunks: false`，除非专门安全评审证明可接受。

## 8. XLSX

`@extend-ai/react-xlsx`：

- `readOnly`
- `useWorker: true`
- WASM 资源本地化
- 设置 `maxFileSizeBytes`
- 对大文件延迟/只读
- sheet change/renderer dispose 时释放 controller/worker

建议 plugin limit 与 DSH byte cap 取更小值。

## 9. CSP 与 asset packaging

必须测试 DSH web profile 下：

- module worker
- Blob URL
- WASM `instantiate`
- CSS asset
- optional source map

不能假定普通 Vite demo 能运行就等于 DSH plugin bundle 可运行。

## 10. 内存验收

手工/自动性能 fixture：

- PDF：200 pages
- DOCX：150+ pages/large tables/images
- PPTX：120 slides
- XLSX：50k cells + charts/images

验收不是要求所有 fixture “瞬间打开”，而是：

- UI 不死锁
- 能取消
- tab close 后 heap 可回落
- 没有 worker 永久残留
- selection 不因 lazy/windowing 完全失效
