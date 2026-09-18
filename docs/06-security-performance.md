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

### 内嵌 worksheet 图片的呈现（Task 11B）

图片经由 pinned `@extend-ai/react-xlsx@0.16.4` 的**公开**替换边界呈现：
`XlsxViewer` 配置 `showImages={true}` 与 `renderImage`，插件仅从公开的
`XlsxImageRenderProps` 构造一个 `<img>`。

信任与所有权边界：

- **来源是 viewer 的**：`image.src` 是 controller 为 media 字节创建的 object URL。
  插件不创建第二份 URL、不 `fetch`、不重新编码、不复制字节。该 URL 的创建与释放
  均归 controller（资源切换时由它 revoke），插件不调用 `URL.revokeObjectURL`。
- **几何是 viewer 的**：节点的宽高取自 viewer 发布的 `style`；viewer 已将该 style
  应用在包裹节点的定位元素上，因此节点填满该盒子。插件不读取 anchor、行高、列宽
  或 EMU，不做任何坐标换算。
- **只读**：节点 `draggable={false}`、`pointer-events: none`，不提供
  `renderImageSelection`，不接入选区手柄，不调用任何 image mutation。
- **不外联**：`renderImage` 只消费已通过 relationship gate 的 local/embedded 图片；
  external image relationship 仍在 viewer 之前被拒，因此该边界不会让外部图片重新
  可达。
- 图像节点带 `data-dsa-xlsx-image` 标记，仅用于测试观察与所有权区分，不参与
  selection、provenance 或 cell geometry。

该边界属于 plugin-side compatibility hardening（公开 hook），不是对
`node_modules` 的 patch，也不是对上游实现的替换。

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

## 11. XLSX 引擎与 Worker 的客户端内联（Task 11A 有限例外）

DSH 不提供独立的客户端二进制资源契约。因此，Duke WASM 以确定性的 gzip 压缩
Base64 负载的形式，随单一 client bundle 一起交付，并在首次打开 XLSX 时于本地
解压并做 SHA-256 校验。

原始未压缩 WASM 的 Base64 内联仍然禁止。不使用网络，也不使用任何 host route。

### 允许与禁止的表示

| 表示 | 大小 | 状态 |
| --- | --- | --- |
| 原始 WASM | 4,412,299 字节 | 唯一合法来源 |
| 原始 WASM 的 Base64 | 5,883,066 字符 | 禁止 |
| 确定性 gzip | 1,674,037 字节 | 允许 |
| gzip 的 Base64 | 2,232,052 字符 | 允许 |

例外范围严格限定为 `@extend-ai/react-xlsx@0.16.4` 的
`duke_sheets_wasm_bg.wasm` 这一个二进制。它不推广到用户文档、PDF 或 PPTX 资源、
任意插件二进制、后续任务的资源，也不构成重构既有 renderer 的依据。

### 交付链路

```text
exact WASM bytes
→ build-time deterministic gzip (node:zlib, mtime = 0)
→ Base64(gzip bytes)
→ single lib/client.js
→ lazy browser decode (atob over the Base64 literal)
→ DecompressionStream('gzip')
→ exact WASM ArrayBuffer
→ length check + SHA-256 check
→ setWasmSource(BufferSource)
→ worker receives the same BufferSource
```

构建期硬门：原始字节长度与 SHA-256 必须等于已评审值，否则以
`XLSX WASM IDENTITY CHANGED` 使 build 失败；gzip 超过 1,800,000 字节或 Base64
超过 2,400,000 字符，则以 `XLSX WASM COMPRESSION REGRESSION` 失败。运行期再次
校验长度与 SHA-256，任何不一致以 `XlsxWasmIntegrityError` fail closed，不回落
CDN、host route、主线程解析或 `useWorker=false`。

### Worker

library worker 以 build 期合成的**自包含模块源码**交付，经 `Blob` URL 构造为
module worker：源码内联 Duke JS glue 与 fflate 浏览器构建，不含任何静态
`import`、动态 `import()`、`require(`、`importScripts` 或可达远端地址。WASM 本体
不重复内嵌进 worker，它经 `setWasmSource` 的公开消息路径传入。

object URL 在 `new Worker(url)` 之后立即 revoke：worker 的脚本抓取已由构造函数
启动，而 library 自身拥有 Worker 生命周期（`dispose()` 调用 `terminate()`），并
未提供插件可挂接的释放点。

### 内存

- 非 XLSX 工作流不分配引擎内存：解压、校验与安装均发生在首次打开 XLSX 时。
- 初始化是 session 级单例，并发与后续调用共享同一 Promise；失败不写入缓存，
  以免一次失败永久禁用该 session 的表格渲染。
- Base64 字面量本身常驻已加载的 bundle，这是单 bundle 方案的固有成本；运行期
  不再额外缓存解压后的副本。
