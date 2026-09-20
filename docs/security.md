# 安全边界

本文记录 `dsh-document-selection-ask` **实际实现**的安全机制及其适用范围。文中的每一条断言都对应仓库中的具体实现：`src/` 下的源码、`scripts/` 下的门禁脚本、测试套件，或已安装依赖的清单。凡本文没有写出的机制，都不应被假定存在；凡本文限定范围的表述，都是对实现可达范围的描述，而不是对未来的承诺。

行号指向基线提交 `f862a05d92df59708f929ca9fb5c5cbf8284e9c4`，并已按本轮并行改动后的 `package.json` 与 `scripts/` 校对。本文在 `package.json:24-35` 的 `files` 允许列表内，因此随 tarball 发布，供安装者离线阅读；同一列表不含 `docs/testing.md`、`docs/STATUS.md` 与 `docs/manual-acceptance.md`，这三份是开发者文档，被 `scripts/verify-package.mjs:109-115` 明确列为不得进入 tarball 的形状。

## 1. 本地处理与信任边界

文档的解析与呈现全部发生在 DSH 的浏览器上下文内，即用户本机的页面进程中。这个仓库不包含、也不调用云端转换服务、第三方文档上传接口或远端解析服务，也不依赖托管在 CDN 上的解析器运行时资源。宿主半边是空实现：`src/index.ts:45-47` 的 `apply()` 不注册任何服务、工具或路由，该文件同时记录了更早一版曾注册两个资源路由、以及它们因违反客户端限定设计而被移除的原因（`src/index.ts:37-43`）。

准确的边界需要分成两件事陈述。

**插件不会为了解析文档而把文档送给第三方解析服务。** 这一条有两类证据。静态门禁把它表达为可检查的形状：`scripts/verify.mjs:161` 列出构建产物中不得出现的 CDN 主机名，同文件 `R9`（`scripts/verify.mjs:1656-1682`）拒绝生产源码中出现远端字面地址。浏览器套件在运行时观察同一性质：`tests/browser/pdf-renderer.spec.ts:913-947` 断言不存在 PDF.js 的资源类请求、且每个请求要么指向实例自身 origin、要么是页面自建的 `blob:` 地址；`tests/browser/xlsx-selection.spec.ts:1140-1141` 断言解析器资源请求与远端请求均为空集合。

**Ask 的行为只是向当前 composer 草稿追加一个引用块，插件自身从不提交。** 追加完成后，草稿仍由用户持有；用户之后按下发送键时，消息进入的是 DSH 自身普通的会话流程，其传输与去向由 DSH 的会话实现决定，不属于本插件的边界。因此本文不主张「文档内容永远不会离开本机」：被引用的内容在按下 Ask 之后就已经成为草稿的一部分，是否把它发送出去由用户决定。

## 2. 撰写路径

对 composer 的唯一写入是 DSH 公开的 `inputActions.setDraft()`，写入链只有一跳：`src/client/ui/ComposerTargetRegistrar.tsx:125-127` 把 DSH 通过槽位属性注入的 `inputActions` 转成 `ComposerTarget.setDraft`（属性声明见同文件 `:68-75`，来源见 `:86-95`），`src/client/dsh/composer-bridge.ts:126` 是真正调用它的那一次写入。除此之外没有第二个写入点。

这条路径上有四项被实现明确排除的行为。

*没有自动提交。* 桥接模块只命名 `readDraft`、`setDraft` 与 `focus` 三个成员（`src/client/dsh/composer-bridge.ts:73-86`），其失败联合类型只有 `too-large` 与 `draft-write-failed` 两个成员（`:59`），没有任何提交语义的成员；模块头注释把「从不提交」列为该模块存在的原因（`:8-12`）。Overlay 在追加成功后只清理两个临时存储（`src/client/ui/SelectionAskOverlay.tsx:336-343`）。

*没有 Lexical 私有节点操作。* 焦点回送模块只做一件事：从会话锚点向上找到 `[data-composer-card]`，在其中查 `[data-composer-input]`，然后调用 `focus({ preventScroll: true })`（`src/client/dsh/focus-composer.ts:57-92`）。模块头注释逐项列出它不做的操作，包括不写 `value`、不设 `textContent`、不派发输入事件、不触碰选区与插入符、不读 React fiber、不接触 Lexical 编辑器（`:36-40`）。

*没有 composer DOM 的 `.value` 赋值，也没有合成输入事件。* 这两条形状由静态门禁 `R6` 与 `R7` 拒绝。`R6`（`scripts/verify.mjs:827-952`）只在接收方可以追溯到 composer 选择器时报告 `.value` 写入，覆盖「查询结果的直接写入」与「被同一文件绑定到该查询结果的标识符上的写入」两种形状（`:830-842`）。`R7`（`scripts/verify.mjs:975-1045`）拒绝四种签名：表单提交（`requestSubmit(`，`:985`）、composer action face 的 `submit` 动词的点号或索引访问（`:988`）、在 composer 节点上派发的合成 Enter 键事件（`:990-1038`），以及私有的发送／提交表面（`:1040-1044`）。两个规则都作用于 `src/**` 与构建产物，`R7` 明确不扫描 `tests/**`（`:958`）。

*草稿在点击时读取，不在捕获时冻结。* 目标对象通过 ref 报告 composer 当前已发布的草稿（`src/client/ui/ComposerTargetRegistrar.tsx:106-111`），写入因此是「当前草稿 + 一个引用块」而不是覆盖一个旧值；引用块的追加复用 `appendSelectionToDraft`（`src/client/dsh/composer-bridge.ts:123`），既有文本不被改写、移动或删除。写入失败时快照保留在 kernel 中，读者仍可重试，且失败路径不记录草稿内容或选中文本（`:125-136`）。

## 3. 选中隔离

一个选中只有在同一个逻辑文档根内才会被接受。判定由 `selectionLivesInSameRoot` 完成，它分别检查选区的 `anchorNode` 与 `focusNode` 是否都被根包含（`src/client/selection/scope.ts:117-126`）；两个端点分别检查而不是检查公共祖先，是因为从文档预览拖到会话正文的选区，其公共祖先正是 DSH 页面外壳，用公共祖先判定会把必须拒绝的手势判为「在根内」（`:103-111`）。分类顺序固定为 `collapsed` → `cross-root` → `interactive-control` → `empty-after-normalization`（`:148-169`）。

跨根选区被拒绝，而且这个拒绝是终局的。适配器注册表按注册顺序咨询，第一个 `canHandle` 为真的适配器拥有该上下文，其 `capture` 结果就是最终结果，拒绝不会对后面的适配器重试（`src/client/selection/registry.ts:159-168`）；文件头把这一点记为安全性质而非整洁性要求：拒绝的适配器正是执行范围约束的那些，向下穿透会让更宽松的适配器重新接纳被拒绝的选区（`:20-26`）。没有任何适配器认领的上下文得到 `outside-supported-preview`（`:104-107`）。

来自 composer、表单控件、`contenteditable` 区域、会话正文与侧边栏的选区都不是文档选区，这由两条独立规则共同约束。其一是交互式文本表面的排除：选择器覆盖 `input`、`textarea`、`select`、两种拼写的 `contenteditable` 与 `role="textbox"`（`src/client/selection/scope.ts:36-37`），判定沿整个祖先链进行（`:80-101`）。其二是根归属：内建文本适配器只承认同时带 `data-textpreview-state="text"`、`data-textpreview-url` 与 `data-document-preview` 三个属性的预览根，且其 `data-document-preview` 值必须是它理解的三个渲染器 id 之一，并要求节点实际位于该根的 `[data-textpreview-body]` 文档区域内（根选择器见 `src/client/adapters/dsh-text/preview-dom.ts:86`，渲染器 id 见同文件 `:74-81`，判定见 `src/client/adapters/dsh-text/adapter.ts:90-96,125-142,181-183`），因此选中文件路径、预览控件或未完成的加载外壳都不会被当作文档内容；PDF、DOCX、PPTX 适配器各自要求带 kind 属性与资源地址的本插件根，并要求端点落在各自的文本层或内容宿主内（`src/client/adapters/pdf/adapter.ts:39-40,51-69`；`src/client/adapters/docx/adapter.ts:41-45`）；XLSX 适配器根本不读浏览器文本选区，它只接受语义桥发布的、且仍然连接在文档中的根（`src/client/adapters/xlsx/adapter.ts:7-12,38-49`）。适配器的注册顺序是有意的优先级：XLSX → PDF → DOCX → PPTX → 内建文本（`src/client/dsh/register.ts:203-212`）。

过期的资源快照会被清除。捕获产生拒绝时，kernel 把已存快照置空并通知，因为拒绝本身就是「此刻没有活动选区」这一事实（`src/client/selection/kernel.ts:85-102`）；浏览器侧在 `selectionchange`、`pointerup`、`keyup` 上一致地重新捕获（合并到一帧），并在 `Escape` 时取消待处理帧后清空（`src/client/selection/browser-lifecycle.ts:58,219-234,246-250`）；滚动与窗口缩放触发重新捕获而不是对旧矩形施加位移（`:27-45,194-217`）。

资源作用域的失效防止旧文档的清理清掉当前选区。清理入口比较快照自身的资源地址：地址不匹配时直接返回，只有描述该资源的快照才会被清除（`src/client/selection/lifecycle.ts:314-326`）。渲染器不自行清理，它只通过注入的 `onResourceInvalidated` 回调上报「该资源不再拥有可发送的选区」这一个事实，触发点只有卸载、地址变化与标签页 `AbortSignal`（`src/client/renderers/resource-invalidation.ts:19-34,46-65`）；运行时对 PDF 与 PPTX 的「可选中 DOM 被替换」路由到重新捕获而非清除，因为读者的浏览器选区可能仍然活动在新 DOM 之上（`src/client/dsh/register.ts:243-266`）。XLSX 的语义桥用 owner token 隔离不同工作簿，旧工作簿的 `clear()` 与 `dispose()` 只在自己仍是当前所有者时才清空（`src/client/renderers/xlsx/selection-bridge.ts:80-116`），其订阅在桥发布 `null` 时也只清除属于 XLSX 适配器的快照（`src/client/renderers/xlsx/selection-lifecycle.ts:27-34`）。

## 4. OOXML 门禁

DOCX、PPTX 与 XLSX 都是 ZIP 归档，三者共用同一组冻结上限，定义在 `src/client/ooxml/limits.ts:52-57`：

| 上限 | 取值 | 作用对象 |
| --- | --- | --- |
| `maxEntries` | 10,000 | 中央目录声明的条目数，目录条目计入 |
| `maxTotalUncompressedBytes` | 512 MiB | 全部条目声明解压尺寸之和 |
| `maxSingleUncompressedBytes` | 128 MiB | 任一条目声明解压尺寸 |
| `maxCompressionRatio` | 200 | 单条目的声明解压尺寸 ÷ 声明压缩尺寸 |

调用方传入的 limits 对象本身也要通过校验：三个整数上限必须是正的安全整数，比例上限必须是正的有限数，任何一项不合法即以 `invalid-limits` 在读取字节之前拒绝（`limits.ts:115-120`，`preflight.ts:473-477`）。

元数据预检有两级顺序，级别不同：先按归档整体判定条目总数（`preflight.ts:289-291`，`entries.length > maxEntries` 在逐条目校验之前执行），随后按条目顺序逐条判定——声明名不是字符串、含 NUL、为空、规范化后以 `/` 开头、以盘符加冒号开头、或含恰好等于 `..` 的路径段（`preflight.ts:237-246` → `paths.ts:109-135`）；声明加密的条目（`preflight.ts:248-250`）；声明解压尺寸超过单条目上限（`:255-257`）；声明压缩比超过 200（`:259-267`，分母取 `Math.max(1, compressedSize)` 以避免 `Infinity` 与 `NaN`）——并在同一次遍历中累加总量，累计值超过上限即拒绝（`:293-306`，逐条累加并每一步校验，避免和值先失去安全整数精度）；任一声明尺寸缺失或不是非负安全整数同样拒绝（`:206-215`，缺失尺寸不被当作 0）。单个条目的诊断因此先于整档诊断，而条目总数是唯一在遍历之前就给出的结论。`getEntries` 本身失败时映射为 `invalid-archive`，且 `try` 块只包含那次库调用，使本模块自身的 `TypeError` 不会被误报为文档损坏（`:309-350`）。

第二道门禁是提取校验，`verifyOoxmlExtraction` 把每个文件条目的内容流式解压进一个只计数的丢弃槽（`src/client/ooxml/verify-extraction.ts:113-138`），即时拒绝超出声明尺寸、超出单条目上限或超出总量上限的流；流结束时要求实际字节数与声明值精确相等，短于声明也拒绝（`:158-161`）。该门禁读取条目时显式要求 `checkCrc32: true` 与 `checkOverlappingEntry: true`（`:141-146`），即 CRC-32 校验与重叠条目拒绝由 `@zip.js/zip.js` 在读取时执行，本仓库不重新实现这两项检查；缺失尺寸同样以 `missing-metadata` 拒绝（`:98-105`）。

预检与提取校验都不保留解压内容：预检返回 `Promise<void>`，不交出 reader、条目数组或中央目录对象，也不调用 `Entry.getData`（`preflight.ts:6-9,27-33`）；提取校验只把 chunk 长度计入计数器，不保存字节、blob 或解析结果（`verify-extraction.ts:16-19,113-138`）。两者的 reader 都显式使用 `useWebWorkers: false`（`preflight.ts:429-434`，`verify-extraction.ts:66-69`），使门禁不依赖宿主的内容安全策略是否允许 blob worker——一个无法运行的门禁会拒绝所有文档，或者更糟，被跳过（`preflight.ts:420-424`）。资源释放在三条路径上都执行，且清理失败不会替换已经得出的结论；只有在归档被接受（即没有需要保护的结论）时，`close` 失败才向上传播（`preflight.ts:481-503`，`verify-extraction.ts:164-173`）。

强制顺序为 `preflightOoxml` → `verifyOoxmlExtraction` → 关系安全扫描 → viewer，但三个格式的落地方式不同，需要分别陈述。

XLSX 是唯一在一个资源世代内只做一次防御性拷贝、并让其后所有门禁与第三方 viewer 都只读那一份字节的格式：`validated` 在门禁之前创建，三个门禁严格串行、每个都以标签页自己的 signal await，viewer 拿到的也是同一份（`src/client/renderers/xlsx/XlsxBody.tsx:263-305`）。DOCX 与 PPTX 把调用方的 `Uint8Array` 交给两个共享门禁，之后各自处理：DOCX 在两道门禁之后先清空目标宿主，再在**detached staging DOM** 中调用 `renderAsync`，随后在 staging 上做链接清洗，最后才把子节点发布到活动宿主（`src/client/renderers/docx/engine.ts:74-120`）；PPTX 在两道门禁之后为库创建一份 `ArrayBuffer` 拷贝，再依次执行惰性媒体解析、关系安全扫描、展示模型构建（`src/client/renderers/pptx/engine.ts:75-96`）。

## 5. 外部关系

三种 OOXML 格式对「外部目标」的处理并不相同，以下只记录各自实际实现的拒绝范围。

**PPTX 拒绝除超链接之外的全部外部关系。** `src/client/renderers/pptx/security.ts:26-29` 用一个严格允许列表，只承认两个超链接关系 URI（Transitional 与 Strict）；扫描用 `DOMParser` 解析每个 `.rels` 文本，解析出现 `parsererror` 即拒绝（`:65-76`），任何 `TargetMode="External"` 且 `Type` 不在允许列表中的 `<Relationship>` 都抛出 `PptxRelationshipSecurityError`，使整个渲染被拒（`:88-99`）。扫描范围是解析得到的 `PptxFiles` 中实际存在的五类关系部件：`presentationRels`、`slideRels`、`slideLayoutRels`、`slideMasterRels`、`chartRels`（`:109-137`）；它并不枚举包内任意路径下的 `.rels` 部件。该扫描只检查关系的 `Type`，不检查超链接 `Target` 的 scheme：被允许的外部超链接目标由浏览器在用户点击时处理。

**XLSX 拒绝除「受认可的超链接关系 + 安全 scheme 目标」之外的全部外部关系。** 允许列表同样是那两个 URI（`src/client/renderers/xlsx/security.ts:42-45`），并额外要求目标匹配 `/^(?:https?:|mailto:)/i`，两个条件同时成立才放行（`:47,90-99`），因此 `javascript:`、`data:`、`file:` 等目标即使关系类型是超链接也被拒。扫描遍历中央目录中所有以 `.rels` 结尾的非目录条目（`:243-282`），读取文本时使用一个可复核的选项对象：`checkCrc32`、`checkOverlappingEntry` 与 `useWebWorkers: false`（`:49-76`）。取消扫描以 `AbortError` 拒绝，而不是安静返回——把未完成的检查报告为通过，是门禁唯一不能产生的结论（`:25-29,213-222`）。清理策略与前两道门禁一致（`:284-295`）。

**DOCX 没有关系部件扫描器。** 该格式实际实现的两项外部目标策略是：渲染时固定 `renderAltChunks: false`，禁止嵌入式 HTML 块进入预览 DOM（`src/client/renderers/docx/engine.ts:102`，意图见 `:16-18`）；渲染完成后、发布之前，对 staging DOM 中的全部 `<a>` 元素执行 scheme 允许列表清洗（`src/client/renderers/docx/engine.ts:110-111` → `src/client/renderers/docx/security.ts:47-93`）。清洗规则是：`#` 开头的内部书签保留；`http`/`https` 放行并加 `target="_blank"`、`rel="noopener noreferrer"`、`referrerpolicy="no-referrer"`；`mailto`/`tel` 放行但不加新标签页属性；其余目标（无 scheme、相对路径、协议相对 URL、空 href、未批准的 scheme）被判定为阻断，移除 `href`、`target`、`rel`、`referrerpolicy` 并加上标记属性 `data-dsa-docx-blocked-link=""`，同时保留其文本与子节点。没有 `href` 属性的锚点被跳过，既不计数也不修改（`security.ts:56-58`）。

清洗发生在 `renderAsync` 返回之后，这一点限定了它的可达范围：它约束的是**发布到预览 DOM 之后**这些锚点能把读者导航到哪里，而**不约束第三方渲染器在生成该 DOM 的过程中可能发起过什么请求**。本文因此不主张「每种格式的每个外部链接都不可达」，也不主张 DOCX 渲染过程中不产生任何外部请求。

## 6. 运行时资源

**PDF。** 工作线程与 PDF.js 的运行时资源都内嵌在 `lib/client.js` 中，没有任何抓取。worker 的模块源码由构建期从**精确安装的** `pdfjs-dist` 读取并作为字符串字面量嵌入（`src/client/renderers/pdf/worker-source.ts:16-23`；`tsdown.config.ts:129-136`），运行期以 `URL.createObjectURL` 建立 `blob:` 地址后启动 module worker，构造函数抛出时释放该地址并抛出类型化的 `PdfWorkerFailure`（`src/client/renderers/pdf/runtime.ts:361-374`）。CMap、标准字体与 wasm 三个资源族在构建期被读成文件表并整体 base64 内嵌（`src/client/renderers/pdf/assets.ts:1-22`；`tsdown.config.ts:97-119`），运行期通过 PDF.js 的 `BinaryDataFactory` 按请求的族与文件名解码恰好一个条目返回（`assets.ts:67-85`）。构建不携带某个资源时以 `PdfAssetFailure` 拒绝，并给出 `kind` 与 `filename`，不回落到 URL（`assets.ts:76-83`；`src/client/renderers/pdf/errors.ts:31-57`）。加载配置同时关闭了 PDF.js 自己的资源抓取：`useWorkerFetch: false`，且不设 `cMapUrl`/`standardFontDataUrl`/`wasmUrl`（`runtime.ts:227-245`）。

**XLSX。** 4.4 MB 的引擎二进制以确定性 gzip + base64 的内联负载随单一 bundle 交付，运行期首次打开工作簿时解码、inflate，并做长度校验与 SHA-256 校验，两者任一不符即抛出 `XlsxWasmIntegrityError` 且不安装任何引擎（`src/client/renderers/xlsx/wasm.ts:198-216`）；初始化是会话级单例，失败不写入缓存（`:229-242`），没有任何回落路径（`:290-307`）。构建期另有一道身份门禁：原始字节长度与 SHA-256 必须等于已评审值，gzip 与 base64 表示不得超过既定上界，否则构建失败（`scripts/xlsx-runtime-assets.ts:49-81`）。库的工作线程以构建期合成的**自包含模块源码**交付：构建在合成之后逐项断言它不含静态导入、动态导入、`require` 调用、`importScripts` 与 source map 引用，任一项命中即以 `XLSX RUNTIME SHAPE CHANGED` 使构建失败（`scripts/xlsx-runtime-assets.ts:459-497`）——并在运行期经 `blob:` URL 构造为 module worker，URL 在构造后立即 revoke（`tsdown.config.ts:315-345`）。

**不存在 `/dsa-assets` 宿主路由、CDN 与远端回落。** 宿主半边不注册任何路由（`src/index.ts:37-47`）；浏览器套件主动请求 `/dsa-assets/duke_sheets_wasm_bg.wasm` 并要求响应码为 404（`tests/browser/xlsx-selection.spec.ts:1147-1154`）；bundle 规格断言 `dsa-assets` 字符串不出现在 `lib/client.js` 中（`tests/unit/xlsx-bundle.spec.ts:84-85`）；静态门禁 `R2` 拒绝构建产物中的 CDN 主机名，以及指向远端 worker 脚本或 `.wasm` 文件的字面地址（`scripts/verify.mjs:161-178`）。基线的构建身份为：`lib/client.js` 16,331,628 字节，SHA-256 `735F8B77EC0B899F9740A8C0591AB7FE0A294C9D5F185A69A9B4A8F7134A183D`；该字节数由 `THIRD_PARTY_NOTICES.md` 的 shipped 表记录，哈希记录于 `docs/STATUS.md` 的 Task 14 build identity 条目，两者在本轮重建后均已复核。

## 7. 已实现的限制

以下限制是当前实现的真实边界，不是待办事项的转述。

**浏览器内存层面的拒绝服务无法被完全消除。** OOXML 的四条上限约束的是中央目录**声明**的尺寸（`src/client/ooxml/limits.ts:20-38`），提取校验随后约束实际解压输出并在越界时立即中断（`src/client/ooxml/verify-extraction.ts:113-137`）。这两道门禁限制的是本插件在解压一个归档时的行为，而不是浏览器整体的内存预算：归档字节由 DSH 以完整文件的形式交给插件，在任何门禁运行之前就已经在内存中；PDF 路径的内存行为由 PDF.js 的页面渲染与画布尺寸决定，同样不受这四条上限约束。这些界限降低暴露面，**不构成形式化证明**。

**第三方解析器与渲染器本身就在信任边界之内。** 冻结的生产依赖是 `@aiden0z/pptx-renderer@1.2.4`、`@extend-ai/react-xlsx@0.16.4`、`@zip.js/zip.js@2.15.0`、`docx-preview@0.4.0`、`pdfjs-dist@6.3.289`（`package.json:94-100`），随包进入 `lib/client.js` 的传递依赖与许可证记录在 `THIRD_PARTY_NOTICES.md`。本插件约束这些库的**输入**并为 OOXML 关系设置策略，但不审计它们内部实现；其中任一库的缺陷就是信任边界上的缺陷。

**`scripts/verify.mjs` 是启发式文本扫描，不是安全证明。** 该文件自己的契约写明：它不是解析器、不是沙箱、也不能替代运行时测试；每条规则都是表达为字符串或结构匹配的**必要条件**而非充分条件，「没有找到 `ReactFiber` 字符串」不能证明不存在其它私有 React 访问，「没有找到 CDN 主机」不能证明运行期不会请求远端资源；规则通过只说明它命名的签名没有在被读取的文件中出现，真正的正确性门禁是 `pnpm test` 与 `pnpm test:browser`（`scripts/verify.mjs:5-16`）。该声明在成功运行中同样被打印（`scripts/verify.mjs:1976-1980`）。同文件另记录了两条具体的不可达范围：`R9` 看不到运行期用变量拼出的 URL（`scripts/verify.mjs:1667-1670`），`R2` 无法度量运行期是否真的不请求远端资源（`scripts/verify.mjs:9-15`）。

**对恶意文档的安全仍然取决于第三方库与浏览器的安全模型。** 插件作为 classic script 运行在 DSH 页面上下文中，与 DSH 及其他已加载的客户端插件共享该上下文；它不建立自己的沙箱，也不设置或强制内容安全策略。宿主策略若不允许 `blob:` worker，PDF 与 XLSX 渲染器以可见错误失败关闭而不是回落（`src/client/renderers/pdf/runtime.ts:368-374`；`src/client/renderers/pdf/errors.ts:20-29`）。

**没有 OCR。** 无文本的页面产生一个空的文本层，而不是错误、文件名替代文本或合成的占位文本（`src/client/renderers/pdf/text-layer.ts:136-139`）。扫描件不会因为被光栅化就变得可选中，`tests/fixtures/pdf/image-only.pdf` 正是为这一情形准备的夹具。

**旧版二进制 Office 格式（DOC、PPT、XLS）不受支持。** 本插件只注册 `docx`、`pptx`、`xlsx`、`pdf` 四种扩展名的预览定义（`src/client/renderers/*/register.ts`）与内建文本适配器（`src/client/dsh/register.ts:203-212`）。这些格式既没有本插件的渲染器，也没有本插件的选择适配器；打开它们时提供什么由 DSH 自身的预览决定。

**选中内容在捕获与按下 Ask 之间存在插件内存中，引用内容随后进入草稿。** 插件不记录文档字节或选中内容：桥接层吞掉写入异常时不打印草稿也不打印文本，其注释给出的理由正是选中内容可能来自机密文档（`src/client/dsh/composer-bridge.ts:127-135`）。选区本身的长度上限为 16,384 个 UTF-16 码元，超限以拒绝处理而不是截断（`src/client/selection/limits.ts:11-19,38-40`）。

**两道共享门禁与 XLSX 关系扫描都在调用线程上运行。** `useWebWorkers: false` 是一个「门禁必须能运行」的取舍而非性能判断（`src/client/ooxml/preflight.ts:420-424`；`src/client/renderers/xlsx/security.ts:63-70`），代价是这些检查的开销落在主线程。

静态门禁的判定性质、各命令的分工，以及浏览器基线的实测数据，见 `docs/testing.md`。
