# 渲染器与选择支持矩阵（v1）

本文记录 `dsh-document-selection-ask` v1 对每种文档格式所使用的渲染器、选择机制、出处（provenance）
与限制。每条结论都对应本仓库 `src/client/**` 中的具体实现，以及随包安装的第三方渲染器版本；
运行时基线为 DSH `0.1.5-rc.2`。

## 支持矩阵

| Format | Renderer | Selection mechanism | Provenance | Limits |
| ------ | -------- | ------------------- | ---------- | ------ |
| TXT / plain text | DSH 内置纯文本渲染器 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text`；本插件不注册替换渲染器 | 浏览器真实 DOM selection；所有权经 `[data-textpreview-body]`，根节点需为 `[data-textpreview-state="text"][data-textpreview-url][data-document-preview]` | `[来源：<文件名>，第 N–M 行]`，仅当渲染器给出 `[data-textpreview-line]` 行时；否则 `[来源：<文件名>]` | 16,384 UTF-16 code units |
| Markdown | DSH 内置 Markdown 渲染器 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown`（`.md` / `.markdown`）；本插件不注册替换渲染器 | 渲染后 DOM 上的真实 selection | 仅文件级 `[来源：<文件名>]`；渲染后的 Markdown 不合成源行号 | 同上 |
| code / config | DSH 内置代码渲染器 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code`；本插件不注册替换渲染器 | 真实 selection，行取自 `[data-code-block-content]` 内的 `pre .line` | 仅当行可证明时：`第 N–M 行`；否则文件级 `[来源：<文件名>]` | 同上 |
| CSV | DSH 内置纯文本渲染器（未匹配其它渲染器时追加的内置回退实现；没有任何渲染器以扩展名声明 `.csv`） | 真实 DOM selection，与纯文本一致 | `[来源：<文件名>，第 N–M 行]`，仅当 `[data-textpreview-line]` 行可证明时；否则文件级 | 同上；CSV 不构成电子表格语义单元格区域 |
| PDF | `pdfjs-dist@6.3.289`：Canvas + 同版本 `TextLayer` | TextLayer span 上的真实 selection，所有权经 `[data-dsa-pdf-text]` 与 `[data-dsa-pdf-page]` | `[来源：<文件名>，第 N–M 页]`，1-based，来自 `[data-dsa-pdf-page]` | 同上；无 OCR，纯图像页没有可选文本 |
| DOCX | `docx-preview@0.4.0` | 渲染出的可选 HTML DOM，所有权经 `[data-dsa-docx-content]` | `[来源：<文件名>，第 N–M 渲染页]`，来自 `[data-dsa-docx-page]`；浏览器分页结果，不是源文档分页；分页不可证明时为文件级 | 同上 |
| PPTX | `@aiden0z/pptx-renderer@1.2.4` | 渲染出的 HTML/SVG 文本上的真实 selection，所有权经 `[data-dsa-pptx-content]` | `[来源：<文件名>，第 N–M 张幻灯片]`，来自 `[data-dsa-pptx-slide]` | 同上 |
| XLSX | `@extend-ai/react-xlsx@0.16.4` | 语义单元格区域选择，不是文本选择；只读 | `[来源：<文件名>，<sheet>!<A1 区域>]`，例如 `Sheet1!A1:C3` | 单次选择 ≤ 200 cells；全局 16,384 UTF-16 code units |
| DOC / PPT / XLS | 无 | 不支持 | 无 | v1 不支持 |
| OCR | 无 | 不支持 | 无 | v1 不支持 |

## 各格式说明

### TXT / plain text

纯文本由 DSH 内置纯文本渲染器绘制，本插件不注册替代渲染器：插件向
`ctx.documentPreviews.register` 注册的扩展名只有 `pdf`、`docx`、`pptx`、`xlsx`。内置纯文本实现
以 `extensions: []` 注册，是内置回退实现；预览在按扩展名匹配之后把该实现追加为最后一个候选，
因此未匹配到其它渲染器的文件由它绘制。插件对它的 DOM 只读。

选择是浏览器真实 selection。适配器从 selection 的 anchor/focus（以及指针目标作为回退）解析所属
预览，把所有权边界定在 `[data-textpreview-body]`：文件路径、查看器菜单、换行与重新加载控件都位于
同一根节点内，选中它们不构成本插件的选择。

精确行出处只在渲染器自身发布了逐行行号时才产生。适配器读取 `[data-textpreview-line]` 的属性值
（1-based 源行号，按正整数校验），不通过数行数推断行号；任一端点无法证明时退化为
`[来源：<文件名>]` 文件级出处。

### Markdown

Markdown 由 DSH 内置 Markdown 渲染器绘制，同样不注册替代渲染器。选择取自渲染后的 DOM。

渲染后的 Markdown 不合成源行出处。代码围栏在渲染结果里与代码渲染器使用同一套 Shiki 行结构，
但围栏行不是 Markdown 源文件的行，因此当被预览文件为 Markdown 时，适配器不读取这些行，出处为
文件级 `[来源：<文件名>]`。Markdown 文件若被用户切换到纯文本渲染器查看，则按纯文本路径给出精确
行号：文档类型描述文件本身（仍是 Markdown），出处描述该渲染器证明了什么。

### code / config

源码与配置文件由 DSH 内置代码渲染器绘制，不注册替代渲染器；可识别的后缀来自该渲染器的语言映射
（例如 `js`、`ts`、`py`、`json`、`sh`、`yaml`、`toml`、`ini`、`css`、`sql`、`xml`、`lua` 等）。

选择是该渲染器行上的真实浏览器 selection。精确行出处只在该渲染器真正证明行时才给出：两个端点
必须落在同一个 `[data-code-block-content]` 视口内，行号由 `pre .line` 在该视口内的顺序决定；端点
跨内容根、或任一属性不合法时，退化为文件级出处。全页范围的行查询被显式排除，因为它会同时命中
渲染后 Markdown 的代码围栏与聊天记录中的代码块。

### CSV

`.csv` 不被任何渲染器以扩展名声明，也不在内置代码渲染器的语言映射中，因此 CSV 文件由内置纯文本
回退渲染器绘制，行结构与纯文本相同：逐行 `[data-textpreview-line]`。选择是真实 DOM selection，
当两端的行号可证明时给出 `[来源：<文件名>，第 N–M 行]`，否则给出文件级出处。

CSV 走的是文本路径，不提供电子表格语义：本插件不把 CSV 当作 XLSX，不产生单元格区域出处，也不
提供表头、公式值或工作表语义。需要单元格区域语义时应使用 `.xlsx` 路径。

### PDF

PDF 由 `pdfjs-dist@6.3.289` 渲染：每页绘制 Canvas，并在其上叠加同一版本提供的真实 `TextLayer`。
选择来自 TextLayer 的 span，页面出处为 `[来源：<文件名>，第 N–M 页]`，1-based，来自页面包装元素的
`[data-dsa-pdf-page]`；标记非规范（前导零、小数、负数、零、超出安全整数）或范围倒置时按
`renderer-not-ready` 拒绝，不猜测页号。

插件不做 OCR。没有文本层的页面（扫描件、纯图像导出）产生空的文本层而不是错误，也不使用文件名或
合成占位文本替代文档本身没有的文字。

PDF worker 与 PDF.js 的运行时资源在构建时内嵌进 `lib/client.js`：worker 源码以 Blob URL 启动为
module worker，CMap、标准字体与 wasm 资源由内嵌资源表按文件名提供，`useWorkerFetch: false` 且不配置
`cMapUrl` / `standardFontDataUrl` / `wasmUrl`。因此不存在远程 worker、不存在 CDN 依赖，包内也不存在
独立的 PDF worker 文件。

### DOCX

DOCX 由 `docx-preview@0.4.0` 渲染为可选中的 HTML DOM。出处为
`[来源：<文件名>，第 N–M 渲染页]`，来自 `[data-dsa-docx-page]`。该编号是浏览器分页的结果，不是源文档
自身的分页，措辞上以「渲染页」与源分页区分；渲染结构未产生可靠分页容器时，出处退化为文件级
`[来源：<文件名>]`，选择本身仍然成立。

进入渲染器之前有两道门禁：先做 OOXML 归档预检（只读中央目录，限制条目数、单条与总解压尺寸、
压缩比、路径安全与加密条目），再做有界流式解压校验（证明实际解压字节与声明一致）。渲染时
`renderAltChunks: false`，嵌入的 altChunk 不会被注入预览 DOM；渲染完成后所有 `<a>` 按协议白名单
处理：`http`/`https` 加固为 `target="_blank"` + `rel="noopener noreferrer"` +
`referrerpolicy="no-referrer"`，`mailto`/`tel` 与文档内片段保留，其余目标（相对路径、协议相对
URL、空 href、未知与危险 scheme）被剥离并标记 `data-dsa-docx-blocked-link`。不调用任何远程转换
服务，也不上传文档。DOCX 与 PPTX、XLSX 的差别需要说明：它没有 `.rels` 关系部件扫描器，其外部目标
策略就是上述两项——渲染期关闭 altChunk，发布前清洗锚点协议。

### PPTX

PPTX 由 `@aiden0z/pptx-renderer@1.2.4` 渲染为 HTML/SVG 文本，`PptxViewer` 以 `pdfjs: false` 构造并
按窗口化列表渲染幻灯片。出处为 `[来源：<文件名>，第 N–M 张幻灯片]`，来自渲染幻灯片上的
`[data-dsa-pptx-slide]`（1-based）。与 DOCX 不同，PPTX 没有文件级回退：幻灯片标记缺失或不合法时按
`renderer-not-ready` 拒绝。

门禁与 DOCX 共用前两道（归档预检、解压校验），随后由 `parseZipLazyMedia` 以库自身的
`RECOMMENDED_ZIP_LIMITS` 建立惰性媒体索引，再由关系策略检查决定是否渲染：`TargetMode="External"`
的关系一律拒绝，只允许 OOXML Transitional/Strict 两种超链接关系类型；图片、音视频、OLE、外部数据
等外部关系直接拒绝渲染。扫描范围是渲染库解析出的五类关系部件（presentation、slide、
slideLayout、slideMaster、chart 的 `.rels`），它不枚举包内任意路径下的关系部件；该范围与库自身能
解析的关系集合一致，因此渲染管线可触及的外部关系都在被扫描集合内。

选择从不来自截图，也从不来自 OCR：适配器读取的是 `[data-dsa-pptx-content]` 内 HTML/SVG 文本上的
DOM selection，插件中不存在光栅化或文字识别路径。

### XLSX

XLSX 由 `@extend-ai/react-xlsx@0.16.4` 渲染，`XlsxViewerProvider` 与 `XlsxViewer` 均以
`readOnly={true}`、`useWorker={true}` 构造。选择是语义单元格区域，不是文本选择：区域来自该库公开的
`useXlsxViewer()` 控制器（`selection` 与 `selectedRangeAddress`），被引用的值是渲染器公开 API 给出的
显示值/计算值（`getCellSnapshotAsync(...).displayValue`，回退到 `getCellDisplayValue`）。

出处为 `[来源：<文件名>，<sheet>!<A1 区域>]`，例如 `Sheet1!A1:C3`。区域字符串按 A1 语法解析并规范化
（倒置区域如 `D4:B2` 规范为 `B2:D4`，并校验工作表边界 A..XFD 与 1..1,048,576）。

引擎与 worker 均不产生网络请求。工作簿解析用的引擎二进制（`@extend-ai/react-xlsx` 的
`duke_sheets_wasm_bg.wasm`）以确定性 gzip 压缩、Base64 内嵌进 `lib/client.js`，在浏览器中解压后按
SHA-256 摘要校验，校验失败即拒绝渲染且没有 URL 回退；解析在自包含的 `blob:` worker 中执行。浏览器
验收断言该路径下 worker 与 WASM 的 HTTP 请求数为 0。

门禁为归档预检、解压校验与关系策略检查（外部关系一律拒绝，超链接关系类型须匹配 OOXML
Transitional/Strict 且目标为 `http`/`https`/`mailto`）。工作表内嵌图片通过库公开的 `renderImage`
兼容路径发布为图像节点（标记 `data-dsa-xlsx-image`），图表与图片在真实浏览器中验证。

## 选择上限

引文文本的全局上限是 **16,384 UTF-16 code units**（即 JavaScript 的 `String.prototype.length`）。
计数单位为 UTF-16 code units 而非 code point 或 UTF-8 字节，以避免中文或 emoji 选择突破所声明的
预算。该上限在捕获路径与写入草稿的 composer bridge 上各校验一次。

XLSX 在全局上限之上另有单次选择 **200 cells** 的上限，由 XLSX 适配器在构造快照前按规范化区域的
单元格数判定。

超过任一条上限都是**拒绝**，不是重写：不修改草稿，不写入任何内容，并向用户显示错误——文本超限时
显示「选区过大，请缩小范围」，单元格超限时显示「选中的单元格过多，请选择不超过 200 个单元格」。
插件不存在静默截断路径。

## v1 不支持的项

以下能力在 v1 中完全没有实现，不存在降级形态。

- DOC / PPT / XLS：不支持。旧版二进制 Office 格式没有渲染器，插件不注册相应扩展名。
- OCR：不支持。任何格式都不从图像识别文字；PDF 只引用 PDF 自带的文本层。
- Office 编辑：不支持。预览为只读，XLSX 以 `readOnly` 渲染，插件不写回文档。
- 持久批注与高亮：不支持。选择状态是瞬时的，只用于生成一次引文，不落盘、不恢复。

## 依据

- 适配器与出处：`src/client/adapters/**`、`src/client/provenance/**`、`src/client/selection/limits.ts`
- DSH 内置预览的 DOM 契约：`src/client/adapters/dsh-text/preview-dom.ts`、`lines.ts`
- 渲染器与门禁：`src/client/renderers/**`、`src/client/ooxml/**`
- 引文与上限：`src/client/quote/format-selection.ts`、`format-xlsx.ts`、`src/client/dsh/composer-bridge.ts`
- 第三方组件版本与许可证：`package.json` 与 `../THIRD_PARTY_NOTICES.md`
- 渲染保真度与人工验收边界：见 `https://github.com/HaowenCang/dsh-document-selection-ask/blob/main/docs/manual-acceptance.md`
