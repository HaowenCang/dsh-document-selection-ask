# 手工验收程序（DSH 真实应用）

本文给出 `dsh-document-selection-ask` 在真实 DSH 应用上的人工验收步骤。程序已被实际执行过；文中出现的每个命令、选择器、菜单项和夹具名称均可追溯到本仓库或已安装 DSH 包中的实际实现。

## 1. 目的与适用范围

本程序验证的是**交互契约**，而不是编译契约。具体地，它证明以下六件事在真实运行时、真实渲染器和真实指针手势下成立：

1. 八个受支持的文档类别各自能在 DSH 自己的文档预览中被打开、被真实手势选中；
2. 每次选中生成恰好一个带出处（provenance）的引用块，追加到会话草稿；
3. 追加是纯增量的：用户原有的草稿文本完整保留在引用块之前；
4. 任何时候都不会自动提交消息；
5. 追加过程中没有文档字节或解析器资源发往远端主机；
6. 插件可以被停用，停用后产品内建的 PDF 预览仍然可用，重新启用后插件的 PDF 渲染器恢复。

它**不**证明以下内容，不应据本文得出这些结论：

- 不证明八个类别在同一台机器之外的任何环境上可用。目前只在 Windows 11 与基于 Chromium 的 DSH Web UI 上执行过；macOS、Linux 与移动端均未验证。
- 不证明其他 DSH 版本可用。本文只针对 `0.1.5-rc.2`。
- 不证明渲染保真度（DOCX/PPTX 的版式一致性）、性能上限或超大文档的完整性。大文档只用于观察加载中途关闭后的清理行为。
- 不产生结论。本文是程序，结果记入 Task 的状态记录；文中的任何断言都以「运行时应观察到」的形式陈述，不构成实测结论。

## 2. 前置条件

| 项 | 要求 | 检查方式 |
| --- | --- | --- |
| Node.js | `^22.19.0 \|\| >=24.0.0`（`package.json` 的 `engines`） | `node --version` |
| pnpm | 可用，且能执行仓库的 `pnpm` 脚本 | `pnpm --version` |
| DSH | 已安装 `0.1.5-rc.2` | `dsh --version` 输出 `0.1.5-rc.2` |
| 浏览器 | 基于 Chromium 的浏览器，能打开 DSH Web UI 与开发者工具 | 手工打开 |
| DSH home | 首次运行引导必须已经完成一次 | 见下 |

`node scripts/dsh-smoke-profile.mjs prepare` 要求目标 profile 已经存在：它只向已有 profile 追加依赖行与 bundle 行，`package.json` 缺失时以 `... does not exist; create the profile with ...` 失败退出。若 `<dsh-home>/profiles/dsa-smoke` 尚未建立，先按该脚本打印的提示用 DSH 自身的 profile 初始化方式建立它，再执行本文第 3 节。

首次运行引导是本程序的硬前置。DSH Web 客户端在未配置任何 provider 凭据时会显示一个首屏模态，该模态在配置完成之前不能被关闭，其后方的 composer 与文档预览因此不可达。这一步与插件无关，但会让本程序完全无法开始，所以每个 DSH home 必须先完成一次。判断方法很直接：打开 Web UI 后 composer 中的 `[data-composer-input]` 是否可见、可用；若首屏仍停在引导模态上，先按 DSH 自身的引导流程完成 provider 与凭据配置。

Playwright 用例通过 `tests/browser/helpers/shell.ts` 把会话工作区切换到一个名为 `dsh-universal-document-selection` 的注册根。手工验收必须做同样的选择：夹具地址是 `dsh-resource://file/session/<id>/smoke-fixtures/<name>` 形式的会话作用域地址，它相对**会话工作区根**解析，工作区不对时每个夹具都会以 `workspace-file/not-found` 失败。

该名称是 DSH 工作区注册表里的条目名，**不是**当前检出目录名。两者在规范检出（仓库目录就叫 `dsh-universal-document-selection`）下相同，从 `git worktree` 检出的目录名不同，此时选择器里仍然只有注册表里的那个条目。由此产生一个必须显式确认的前提：**夹具是从注册表指向的那棵树读取的，不是从你执行 `prepare` 的那棵树读取的**。若两棵树不是同一个工作副本，先在两棵树上各运行一次 `prepare`，并确认 `smoke-fixtures/` 下同名文件逐字节相同，再开始验收；否则你会在被构建的插件上观察到另一份夹具，而结果看起来完全正常。第 11 节的结果记录必须写明这一点。

## 3. 构建与隔离 profile 准备

以下命令全部在 `<repo>`（本仓库检出目录）中执行。

```bash
pnpm install
pnpm build
pnpm smoke:driver
node scripts/dsh-smoke-profile.mjs prepare
```

各步的作用与失败判据：

- `pnpm install` 安装依赖。`pnpm build` 产出 `lib/index.mjs` 与 `lib/client.js`；profile 通过 `link:` 指向本目录，因此构建必须在 `prepare` 之前完成，否则加载的是旧产物。
- `pnpm smoke:driver` 单独构建测试专用驱动（`tests/browser/smoke-driver/`，包名 `@dsh-smoke/dsa-smoke-driver`）。它不是发布内容，只在 smoke profile 中存在。
- `node scripts/dsh-smoke-profile.mjs prepare` 写入 `smoke-fixtures/` 下的夹具，把本插件与测试驱动两行加入 profile 的 `dsh.profile.bundles` 与 `dependencies`，建立 `node_modules` 内的目录链接，最后自行调用 `validate`。幂等：第二次运行对两个包都报告 `rows=unchanged`，并以 `dsh-smoke-profile: validation = clean` 结束。

该脚本只操作名为 `dsa-smoke` 的 profile，对任何其他名字直接拒绝。检查与清理：

```bash
node scripts/dsh-smoke-profile.mjs inspect
node scripts/dsh-smoke-profile.mjs validate
node scripts/dsh-smoke-profile.mjs cleanup
```

`inspect` 打印 profile 目录、`node_modules` 的链接状态与目标、bundle 列表、两个包的链接状态、以及每个夹具的字节数，并在最后给出校验结论；`validate` 只做校验并以非零退出码报告问题；`cleanup` 从 profile 中移除测试驱动并删除驱动自己的 `lib/`，保留本插件。

隔离范围必须说准确。`prepare` 写入的是两处：`<dsh-home>/profiles/dsa-smoke` 内的 `package.json` 与其 `node_modules` 下的目录链接，以及 `<repo>/smoke-fixtures/`。前者只涉及 `dsa-smoke` 自己的清单。但 `dsa-smoke/node_modules` 本身是指向 `web` profile 已安装树的目录链接，所以那两个目录链接在文件系统上落在**共享的那棵树**里，`cleanup` 删除驱动链接时也从同一处删除；`inspect` 打印的链接目标是判断这一点的依据。脚本不会写任何其他 profile 的清单，也不会在这棵树里运行包管理器；它不声称这条链接只影响 `dsa-smoke`。

`prepare` 输出中的 `validation problems` 或非零退出码即为构建与准备失败，必须先解决再继续。也**不要**在 profile 目录里运行 pnpm 安装命令：`pnpm` 会以 `ERR_PNPM_UNEXPECTED_VIRTUAL_STORE` 拒绝，因为它需要移动的虚拟存储正是上面那条共享链接。

## 4. 启动 DSH rc.2

在 `<repo>` 中启动：

```bash
dsh --profile dsa-smoke --port <port> --no-open
```

启动器自身的标志必须排在应用标志之前，`--patch`（第 9 节使用）与 `--profile` 属于启动器，`--port` 与 `--no-open` 属于 web 应用。应用可用的公开标志只有 `--host`、`--port`、`--no-open`、`--trusted-host` 与 `-h`；`--host 0.0.0.0` 被 DSH 主动拒绝。没有 token 标志。

启动完成后标准输出出现一行：

```text
dsh web: http://127.0.0.1:<port>/?token=<token>
```

该行由 `@deepseek-ai/dsh-web-app` 在连接就绪后打印，URL 中的 token 是本次进程新生成的启动凭据。用它组成 Playwright 所需的地址：

```bash
DSH_SMOKE_URL='http://127.0.0.1:<port>/?token=<token>' pnpm test:browser
```

`DSH_SMOKE_URL` 未设置时，需要真实 DSH 实例的用例会被跳过，`pnpm test:browser` 仍然可用但什么也不证明。手工验收时不必设置该变量，直接在浏览器中打开打印出的这一行 URL 即可，token 会随 URL 一起生效。

**token 是该进程的真实凭据。** 它可以读写该实例的全部会话与文件接口。不要把含 token 的 URL 写进提交、文档、截图、工单或聊天记录；不要把 `<token>` 替换为真实值后保存任何文件；共享屏幕或录制前先确认地址栏内容。需要提供给他人时，只描述「启动输出中 `?token=` 之后的部分」，不要给出值。

## 5. 通用观察方法

### 5.1 打开开发者工具

在 DSH Web UI 页面中按 `F12`，或使用浏览器菜单中的开发者工具。本程序用到两个面板：

- **Console**：观察未捕获异常、未处理的 Promise 拒绝，以及渲染器自己的失败日志。
- **Network**：观察是否存在指向远端主机的请求。

DSH Web UI 自身不提供应用内的 console 或 network 面板，观察面就是浏览器自己的开发者工具。建议在开始第 6 节之前清空一次 Console 与 Network，并在整个验收过程中保持面板打开；验收结束前不要刷新页面，刷新会清空两个面板的记录。

### 5.2 Console 的失败判据

只有以下三类条目算失败：

1. **未捕获异常**。Console 中以红色错误形式出现、且带有堆栈的脚本异常。它对应 Playwright 的 `pageerror` 事件。
2. **未处理的 Promise 拒绝**。Console 中形如 `Uncaught (in promise)` 的条目。
3. **来自被测渲染器的错误级日志**。本插件四个字节渲染器共用 `[dsa-pdf]`、`[dsa-docx]`、`[dsa-pptx]`、`[dsa-xlsx]` 四个日志前缀，任何以这四个前缀之一开头的错误级条目都算失败。

**DSH 自身或其他插件的日志不是失败。** 真实运行实例上通常能看到 shell、存储、遥测或其他已装配插件的告警与错误，它们与本程序无关，不得计入。判断依据是条目的来源与内容，而不是「Console 是否为红色」：一个来自 shell 的 `error` 不构成本程序的失败，一个以 `[dsa-pdf]` 开头的 `error` 一定构成失败。若某条错误无法归属，记录其完整文本与来源 URL，在状态记录中标注为待确认，不要默认忽略也不要默认计为失败。

### 5.3 Network 的失败判据

对整个验收过程（从打开第一个夹具到关闭最后一个）检查 Network 面板：

**不允许出现：**

- 承载被测文档字节、发往本应用 origin 之外任何主机的请求（上传或下载都算）；
- 远端解析器资源：远端 worker 脚本、远端 WASM 模块、CDN 上的 CMap 或标准字体；
- 任何 CDN 主机上的资源，例如 `cdnjs`、`jsdelivr`、`unpkg`、`esm.sh`、`skypack` 之类；
- 任何指向 `pdf.worker`、`.bcmap`、`standard_fonts`、`duke_sheets`、`dsa-assets`、`xlsx-worker` 的请求，无论其 origin。

**属于预期，不算失败：**

- 指向 DSH 应用自身 origin 的 HTTP(S) 请求：shell 自身、插件的 `client.js`、DSH 的 API 调用与样式表；
- WebSocket 流量：DSH 应用自身的 API 通道，在 Network 面板中表现为 `ws://` 或 `wss://` 连接，其 host 应与页面 origin 相同；
- `blob:` URL：页面自己铸出的 worker 与图片地址。它们在 Network 面板中可能以 `script` 类型的请求形式出现，但来源是本页面自己调用 `URL.createObjectURL` 的结果，不是对外抓取。

**当前已测得的事实**（用于判断观察结果是否合理，不替代本次运行自己的观察）：

- XLSX 的工作簿引擎是压缩内联在客户端 bundle 中的，解析在 `blob:` worker 里进行，因此**工作簿相关的 WASM 通过零个 HTTP 请求送达**，worker 的地址是 `blob:` URL；
- PDF 渲染器的 worker 同样从页面自建的 `blob:` 地址启动，**从不来自远端或 CDN**；
- PDF.js 的 CMap、标准字体与 WASM 家族随构建内嵌，因此不存在可供抓取的远端地址。

若本次运行观察到与上述事实不符的请求，先记录该请求的完整 URL、方法与资源类型，再判断它属于哪个阶段；不要因为「应该不会发生」而跳过记录。上述三条是既有测量结果，本次运行仍须自行观察并向状态记录提供本轮的请求清单。

## 6. 八种格式的逐项验收

每个格式的过程都必须是同一套七步，顺序固定：

1. 选择第 9 节以外的正常启动方式启动实例，打开页面，清空 Console 与 Network；
2. 在 shell 的工作区选择器中选中 `dsh-universal-document-selection`；
3. **在打开任何文档之前**，向 composer 输入哨兵草稿 `MANUAL-DRAFT`（见第 7 节）；
4. 打开该格式的夹具；
5. 用该格式的真实手势产生选中；
6. 确认 Ask 按钮出现，按下它；
7. 确认草稿仍以 `MANUAL-DRAFT` 开头、其后恰好追加了一个引用块、且没有任何消息被发出。

八个类别的夹具、手势与期望值如下。夹具都通过 shell 自己的文件导航打开；smoke 驱动会为每个夹具渲染一个按钮，其 DOM 选择器是 `[data-dsa-smoke-open="<key>"]`，按钮文字形如 `Open smoke TXT`、`Open PDF single`、`Open DOCX paragraphs`、`Open PPTX two slides`、`Open XLSX simple`。手工验收也可以用 shell 的文件面板打开 `smoke-fixtures/` 下的同名文件，效果等价。

### 6.1 TXT

| 项 | 值 |
| --- | --- |
| 夹具 | `smoke-fixtures/task5b-smoke.txt`（三行：`alpha` / `beta` / `gamma`） |
| 渲染器 | 产品内建纯文本渲染器，DOM 根 `[data-textpreview-body]`，每行一个 `[data-textpreview-line]`，行号从 1 起 |
| 手势 | 在 `data-textpreview-line="2"` 那一行的正文内按下指针并释放（一次单击落点），按住 `Shift`，在本行第一个 token 的右端再次按下并释放 |
| 期望选中内容 | `beta`（精确相等） |
| 期望出处 | `[来源：task5b-smoke.txt，第 2 行]` |
| Ask 按钮 | 出现，且可点击 |

### 6.2 Markdown

| 项 | 值 |
| --- | --- |
| 夹具 | `smoke-fixtures/task5b-smoke.md`（含 `# Smoke Heading` 与段落 `alpha paragraph`） |
| 渲染器 | 产品内建 Markdown 渲染器，DOM 根 `[data-textpreview-body]` |
| 手势 | 跨段落做一次真实的渐进式鼠标拖拽：起点落在该段第一个非空文本节点的第一个客户端矩形内，终点落在最后一个非空文本节点的最后一个客户端矩形内，并逐像素向左扫描到命中的元素确实位于渲染器内容根之内的像素 |
| 期望选中内容 | `alpha paragraph`（精确相等） |
| 期望出处 | `[来源：task5b-smoke.md]`，即只有文件名、没有行号 |
| Ask 按钮 | 出现，且可点击 |

渲染后的 Markdown 不生成源行映射：源码的行不是读者看到的行，因此带行号的引用会是编造的。按上表断言时应当**确认草稿中不含 `第 N 行` 形式的出处**。

### 6.3 code / config

| 项 | 值 |
| --- | --- |
| 夹具 | `smoke-fixtures/task5b-smoke.ts`（三行：`const alpha = 1` / `const beta = 2` / `const gamma = 3`） |
| 渲染器 | 产品内建代码渲染器，行选择器 `[data-code-block-content] pre .line`，每行由若干 Shiki token 组成 |
| 手势 | 与 TXT 相同的行选择手势（行内按下，`Shift` 后在该行最后一个 token 的右端按下并释放）；因为一行由多个 token 组成，需要重复同一真实手势并重新测量 token 边界，直到浏览器报告的选中串正好是整行 |
| 期望选中内容 | `const beta = 2`（精确相等） |
| 期望出处 | `[来源：task5b-smoke.ts，第 2 行]` |
| Ask 按钮 | 出现，且可点击 |

### 6.4 CSV

| 项 | 值 |
| --- | --- |
| 夹具 | `smoke-fixtures/task13-smoke.csv`（四行：表头 `region,units,note`，数据行 `north,41,alpha` / `south,57,beta` / `east,63,gamma`） |
| 渲染器 | 产品内建**纯文本**渲染器。CSV 由它按 `.csv` 后缀接管并发布 `[data-textpreview-line]` 行，而不是代码渲染器；这一点在运行时应通过 `[data-document-preview]` 的值确认 |
| 手势 | 与 TXT 相同的行选择手势，作用于第 3 行 |
| 期望选中内容 | `south,57,beta`（精确相等） |
| 期望出处 | `[来源：task13-smoke.csv，第 3 行]` |
| Ask 按钮 | 出现，且可点击 |

CSV 的四种数据行互不相同，因此选中相邻行会以文本不等而失败，而不是碰巧通过。

### 6.5 PDF

| 项 | 值 |
| --- | --- |
| 夹具 | `smoke-fixtures/task7-single-page.pdf`（一页，首行文字 `Alpha Beta Gamma`） |
| 渲染器 | 本插件的 `dsh-document-selection-ask/pdf`，标题 `PDF · Selectable`；根元素 `[data-dsa-document-kind="pdf"]`，页包装 `[data-dsa-pdf-page="1"]`，文本层 `[data-dsa-pdf-text]` |
| 就绪判据 | 页包装可见、`[data-dsa-pdf-canvas]` 的 `width` 与 `height` 均大于 0、该页的 `[data-dsa-pdf-placeholder]` 计数为 0、文本层中的 `span` 数量大于 0 |
| 手势 | 在文本层中把一行的各 `span` 按上边缘分组还原为渲染行，取首行，沿该行的水平中线从行内左端起、到行内右端止做一次真实拖拽 |
| 期望选中内容 | `Alpha Beta Gamma`（精确相等） |
| 期望出处 | `[来源：task7-single-page.pdf，第 1 页]` |
| Ask 按钮 | 出现，且可点击 |

PDF 页是画布加绝对定位的文本层，没有包裹文字的元素，因此手势必须落在文本层的 `span` 上；该夹具只有一页，页号应当恰好是 1。

### 6.6 DOCX

| 项 | 值 |
| --- | --- |
| 夹具 | `smoke-fixtures/task9-paragraphs.docx`（一个页节，三个段落） |
| 渲染器 | 本插件的 `dsh-document-selection-ask/docx`，标题 `DOCX · Selectable`；根元素 `[data-dsa-document-kind="docx"]`，内容 `[data-dsa-docx-content]`，页标记 `[data-dsa-docx-page]` |
| 就绪判据 | `[data-dsa-docx-page]` 计数为 1，`[data-dsa-docx-content] p` 计数为 3，第一个 `<p>` 的文本等于下方期望值 |
| 手势 | 在首个段落的第一个可达像素上做一次真实三击（三对真实的按下与释放，detail 依次为 1、2、3）。**不要用拖拽**：该预览列固定为 576 px 宽，DOCX 页面在左侧溢出该列，最早的指针可达像素大约已经在首行两个字符之后，任何拖拽端点都够不到段首；三击的范围由浏览器按像素所在的块计算，因此能覆盖整段 |
| 期望选中内容 | `DOCX Alpha: Leading paragraph with bold text for native selection.`（精确相等） |
| 期望出处 | `[来源：task9-paragraphs.docx，第 1 渲染页]` |
| Ask 按钮 | 出现，且可点击 |

出处写作「渲染页」而不是「页」，因为这是浏览器分页的结果，不是源文档自身的分页；两者的证据强度不同，措辞不统一是刻意的。

### 6.7 PPTX

| 项 | 值 |
| --- | --- |
| 夹具 | `smoke-fixtures/task10-text-two-slides.pptx`（两页幻灯片） |
| 渲染器 | 本插件的 `dsh-document-selection-ask/pptx`，标题 `PPTX · Selectable`；根元素 `[data-dsa-document-kind="pptx"]`，内容 `[data-dsa-pptx-content]`，幻灯片 `[data-dsa-pptx-slide="1"]` 与 `[data-dsa-pptx-slide="2"]` |
| 就绪判据 | `[data-dsa-pptx-slide]` 计数为 2，`[data-dsa-pptx-content]` 含文本 `PPTX Slide One Alpha` |
| 手势 | 先在第 1 张幻灯片内定位「自身文本正好等于目标串、且没有后代也等于该串」的最内层元素，然后跨该元素做真实拖拽：起点取自其第一个非空文本节点的第一个客户端矩形，终点取自最后一个非空文本节点的最后一个客户端矩形，两端都逐像素扫描到命中元素位于 `[data-dsa-pptx-content]` 之内 |
| 期望选中内容 | `PPTX Slide One Alpha`（精确相等） |
| 期望出处 | `[来源：task10-text-two-slides.pptx，第 1 张幻灯片]` |
| Ask 按钮 | 出现，且可点击 |

必须定位「最内层」元素：幻灯片会把文本放在一层较宽的盒子里，按包含关系匹配会把拖拽对准比字形宽得多的盒子。

### 6.8 XLSX

| 项 | 值 |
| --- | --- |
| 夹具 | `smoke-fixtures/task11-simple.xlsx` |
| 渲染器 | 本插件的 `dsh-document-selection-ask/xlsx`，标题 `XLSX • Read-only`；根元素 `[data-dsa-document-kind="xlsx"]`，内容 `[data-dsa-xlsx-content]`，网格 `[role="grid"]` |
| 就绪判据 | `[data-dsa-xlsx-content]` 可见且其内 `[role="grid"]` 可见，网格的 `aria-label` 不再是解析前的 `Workbook grid` |
| 手势 | 在工作簿网格自己的坐标空间内拖拽：以 `[role="grid"]` 的包围盒左上角为原点，从 `(75, 26)` 拖到 `(180, 84)`，CSS 像素。网格包围盒含行头与列头，这两点是针对该夹具实测校准的 |
| 选中确认 | 拖拽后渲染器在自己的根上发布 `data-dsa-xlsx-selection`，其值必须正好是 `Sheet1!A1:C3`；出处以此值为准，而不是以「打算选中的范围」为准 |
| 期望出处 | `[来源：task11-simple.xlsx，Sheet1!A1:C3]` |
| 期望引用内容 | 见下方表格，作为**显示值**引用 |
| Ask 按钮 | 出现，且可点击 |

XLSX 没有可引用的文本，被选中是一片显示值的矩形。渲染器把该矩形序列化为带合成表头的 Markdown 表（超过 20 行、超过 12 列或任一单元格含换行时退化为 `tsv` 围栏块）。`Sheet1!A1:C3` 的期望引用内容是：

```text
| Column 1 | Column 2 | Column 3 |
| --- | --- | --- |
| Name | Qty | Price |
| Apple | 2 | 3.50 |
| Pear | 4 | 2.25 |
```

引用的是显示值：夹具以数字格式 `0.00` 存放 `3.5`，查看器发布的是格式化后的 `3.50`。单次选择还有 200 个单元格的上限，超出时会出现「选中的单元格过多」的拒绝提示而不是被静默截断。

## 7. 草稿保全的强制步骤

第 6 节每个格式的过程都必须以草稿保全的完整检查开始和结束。使用空草稿测试**不构成证据**：追加本身就能让草稿非空，这样的观察无法区分「追加」与「覆盖」。

起始步骤（在打开文档之前执行）：

1. 点击 composer 的编辑区 `[data-composer-input]`；
2. 选中全部并删除，然后逐键输入哨兵文本 `MANUAL-DRAFT`。不要直接给 composer 的 DOM 赋 `value`，也不要合成输入事件；
3. 读回 composer 当前文本，确认它正好等于 `MANUAL-DRAFT`。不等于时停止，不要继续。

结束步骤（按下 Ask 之后执行）：

1. 确认 composer 文本以 `MANUAL-DRAFT` 开头，位置为偏移 0；
2. 确认在其后恰好追加了一个引用块，顺序为：出处行、被引用内容各行、问题行 `请针对以上选中内容回答：`；
3. 确认问题行之后没有任何内容；
4. 确认整个草稿中只出现一次该出处行（出现两次意味着追加执行了两遍）；
5. 确认消息没有被发出：会话记录中不出现新的对话轮次，页面没有发出表单提交事件；
6. 确认焦点回到 composer 的编辑区。

按下 Ask 之前，Ask 按钮会读取 composer 当时的草稿。因此「草稿被保全」是关于按钮实际被按下时草稿状态的断言，而不是关于更早某个时刻的断言。

## 8. 渲染器选择器（打开方式）

文档预览的标题栏中有一个渲染器选择控件：一个带文字的按钮，其 `aria-label` 取自 `openWith` 语言键（中文 `打开方式`，英文 `Open with`），其 DOM 锚点带 `data-document-viewer-menu`，按钮文字是当前生效渲染器的标题。按钮位于换行与重新加载控件旁边。点击它展开一个菜单，菜单项是**全部匹配的渲染器标题**，最后追加一项纯文本回退项。

对 `.pdf` 地址，匹配集合里同时存在：本插件的 `dsh-document-selection-ask/pdf`（标题 `PDF · Selectable`，`priority: 'extension'`，排序在前）与产品内建的 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/pdf`（标题 `PDF`，`priority: 'builtin'`）；纯文本回退项的标题取自 `viewer.text` 语言键，中文 `纯文本`、英文 `Plain text`。本文其余各处给出的中文界面文案（`打开方式`、`纯文本`）都只在中文界面下成立；界面语言由 DSH 依浏览器语言解析，非中文环境下应按上表所述的 `aria-label` 锚点与渲染器标题识别控件，而不是按文字比对。

操作步骤：

1. 用第 6.5 节的方式打开 `smoke-fixtures/task7-single-page.pdf`；
2. 点击 `[data-document-viewer-menu]`，**逐字记录菜单实际给出的标题列表**，不要按上面的预期填写；
3. 在菜单中选中另一个 PDF 渲染器，记录可观察到的差异：菜单按钮文字的变化、根元素属性的变化（本插件的渲染器根带 `data-dsa-document-kind="pdf"` 与 `[data-dsa-pdf-page]`，内建渲染器不带这两个属性）、以及文本可选择性是否仍然存在；
4. 在该渲染器下重做一次第 6.5 节的手势，记录选中是否产生、Ask 按钮是否出现；若 Ask 按钮不出现，这正是「只有插件自己的渲染器提供可引用选中」这一事实的表现，应当如实记录；
5. 切回原渲染器，确认菜单按钮文字与可选择性恢复。

**若菜单中没有出现第二个 PDF 渲染器，就照实记录「菜单未提供第二个 PDF 渲染器」以及菜单实际给出的完整标题列表，不要编造一个。** 第三项与第四项里凡是本次运行没有观察到的东西，也一律记为未观察到。

## 9. 禁用与恢复

这一节是硬门禁：如果插件不能被停用、或停用后不能恢复内建预览，则整个验收不成立。

### 9.1 不存在公开的启用/禁用命令

rc.2 没有提供任何 CLI 或 UI 命令来启用或停用单个 profile bundle 插件。CLI 侧的证据可以直接观察到：

```bash
dsh plugin --profile dsa-smoke --help
```

该命令的输出是 **pnpm 自己的帮助文本**。原因是 `dsh plugin` 是一个薄转发器：它把 `--help` 在内的全部剩余参数原样交给 profile 目录中的 `pnpm`，因此只有 pnpm 自己的动词（`add`、`remove`、`ls`、`why` 等）存在，其中没有任何一个表示「停用已装配的插件」。UI 侧的证据同样直接：Settings → Plugins → Plugin list 标签页是只读的，设计如此。

另外，该 profile 的 `node_modules` 是指向 `web` profile 已安装树的目录链接，所以 `dsh plugin --profile dsa-smoke add ...` 会以 `ERR_PNPM_UNEXPECTED_VIRTUAL_STORE` 失败。本仓库 `docs/STATUS.md` 记录了这次尝试及其结论。

### 9.2 实际可用的停用机制：`--patch` 覆盖层

可用的机制是启动器自己的 patch 覆盖层。`dsh` 启动器接受 `--patch <path>`，含义是「在 profile 层之后追加应用的 patch 列表覆盖层」。该文件是一个顶层 YAML 数组，数组元素是 loader 的 patch 条目：带 `insert` 的条目向条目树插入插件，不带 `insert` 的条目按 `id` 命中一条已存在的条目并覆盖其字段（`config`、`disabled`、`name`、`inject` 等）。

本插件由 `cordis.patch.yml` 插入，该条目在仓库根文件中写着：

```yaml
- insert:
    - id: document-selection-ask
      name: 'dsh-document-selection-ask'
```

`document-selection-ask` 就是需要停用的 loader 条目 id。停用文件在 **`<repo>` 内**创建，例如 `<repo>/smoke-disable-plugin.yml`，内容为：

```yaml
# 临时覆盖层：停用本插件的 loader 条目。
- id: document-selection-ask
  disabled: true
```

然后带该文件启动：

```bash
dsh --profile dsa-smoke --patch ./smoke-disable-plugin.yml --port <port> --no-open
```

关键在于这是一个**命令行上的覆盖层文件，不是对 profile 目录内任何文件的修改**：profile 的 `package.json`、`cordis.patch.yml` 与 `node_modules` 都不需要改动，该文件的内容只对这一次启动生效，删掉它或用不带 `--patch` 的命令重启即回到启用状态。

一个可选的预检查：`dsh --profile dsa-smoke --patch ./smoke-disable-plugin.yml --dump-config` 会打印组合后的条目树并退出，不引导应用。如果该文件的语法有问题、不是顶层数组、或某个字段非法，启动会直接以可读错误失败，而不是被静默跳过；若 `id` 对应的条目在树中不存在，loader 会给出该条目的警告并继续，这一点需要在执行时确认 `--dump-config` 的输出里确实存在 `document-selection-ask` 且 `disabled: true`。

### 9.3 停用后的观察

用 9.2 的命令启动后，重做第 8 节的菜单检查：

1. 打开 `smoke-fixtures/task7-single-page.pdf`；
2. 打开 `[data-document-viewer-menu]`：**`PDF · Selectable` 必须不再出现**，菜单中剩下的应当只有内建渲染器与纯文本回退项（中文界面下为 `PDF` 与 `纯文本`）；
3. 确认内建预览仍然工作：PDF 能正常显示、页面可见；
4. 确认本插件贡献的 Ask 按钮不存在（DOM 中没有 `[data-dsa-selection-ask-button]`）；
5. 用第 6.5 节的手势在内建渲染器上尝试选择，记录结果，不预设结论。

### 9.4 恢复

1. 停止该 DSH 进程；
2. 用不带 `--patch` 的命令重新启动：`dsh --profile dsa-smoke --port <port> --no-open`；
3. 重新打开同一个 PDF 夹具，确认 `打开方式` 菜单中 `PDF · Selectable` 重新出现，且选中与 Ask 行为与第 6.5 节一致；
4. 停用文件若不再需要，从 `<repo>` 中删除；它不需要被提交。

## 10. 大文档加载中途关闭

本节验证加载被中途打断时，前一个文档不会留下残影。使用的三个真实大夹具：

| 格式 | 夹具 | 备注 |
| --- | --- | --- |
| PPTX | `smoke-fixtures/task10-large-120-slides.pptx` | 约 717 KB，120 张幻灯片，解析与安全门禁都在进行中时可被中断 |
| XLSX | `smoke-fixtures/task11-large.xlsx` | 约 176 KB，解析在 `blob:` worker 中进行 |
| PDF | `smoke-fixtures/task7-two-page.pdf` | 六页 A2；页 1 之外仍处于惰性状态，适合观察「加载已开始但未结束」 |

DOCX 一侧使用 `smoke-fixtures/task9-table-image.docx`：它带表格与内嵌图片，因此元数据预检、实际提取校验与渲染三者在被中断时都还未完成。

每个大文档执行同一套步骤：

1. 先输入 `MANUAL-DRAFT` 并读回确认；
2. 打开该夹具；
3. **确认加载确已开始且尚未结束**，然后立刻切换走或关闭。确认信号随格式不同：
   - PPTX / DOCX：插件自己的加载文案 `正在加载文档…` 仍在渲染器根中，且 `[data-dsa-pptx-slide]`（或 `[data-dsa-docx-page]`）计数仍为 0；
   - XLSX：`[role="grid"]` 存在但 `aria-label` 仍是解析前的 `Workbook grid`；
   - PDF：页 1 的 `[data-dsa-pdf-placeholder]` 仍在，或页 1 的 `[data-dsa-pdf-text] span` 计数仍为 0。
   一个已经加载完成的文档不能作为本节证据：它没有可中断的尾部。
4. 切换到另一个格式的夹具（或关闭该标签），然后等待页面进入 DOM 静默状态：连续 10 个动画帧内整个文档没有任何 DOM 变更。存在低速率 shell 变动时允许重试，但一段被异步尾部打断的静默窗口不会成立；
5. 观察并记录：
   - **没有滞留的 Ask 控件**：`[data-dsa-selection-ask-button]` 计数为 0。这个计数要用定位器读取并如实断言，不是「先隐藏再看」；
   - **没有前一个文档的迟到 DOM**：按地址检查已关闭文档的渲染器根不再存在于页面中；对应格式的内容宿主、页/幻灯片标记计数为 0；
   - **没有未捕获错误**：第 5.2 节的三类判据全空，另加未处理的 Promise 拒绝为空；
   - 草稿仍是 `MANUAL-DRAFT`（若在打开大文档前已按下过 Ask，则是按下后的完整草稿）；
   - 没有拒绝提示 `[data-dsa-selection-error]` 被抛进取代它的新文档。
6. 确认取代它的文档本身可用（完成就绪判据），否则「静默」可能只是因为两侧都没渲染。

## 11. 结果记录

结果记入 Task 的状态记录（本仓库 `docs/STATUS.md` 的对应条目、以及该轮 Task 的报告），**不要修改本文**。本文描述程序，结果属于那一轮运行的记录，写进本文会让程序与结论互相污染。

逐行记录以下名称，取值用 `PASS` / `FAIL` 或实际的观察描述，不要用含义模糊的措辞：

```text
text
markdown
code
csv
pdf
docx
pptx
xlsx
draft-preserve
auto-submit-zero
renderer-selector
disable/restore
rapid-close
console-clean
network-local
```

前八行对应第 6 节的八个类别；`draft-preserve` 与 `auto-submit-zero` 对应第 7 节；`renderer-selector` 对应第 8 节；`disable/restore` 对应第 9 节；`rapid-close` 对应第 10 节；`console-clean` 与 `network-local` 对应第 5 节在整个验收过程中的观察。任何一项为 `FAIL` 都阻塞发布。行名之外需要补充的内容——未观察到的项、无法归属的 console 条目、菜单实际给出的标题列表——写在行值或记录正文中，不要只写一个词。

## 12. 清理

1. 从 profile 中移除测试驱动并删除驱动自己的构建产物：

   ```bash
   node scripts/dsh-smoke-profile.mjs cleanup
   ```

   该命令只移除测试驱动 `@dsh-smoke/dsa-smoke-driver` 及其 `lib/`，本插件保留在 profile 中。

2. 停止 DSH 进程：在运行该进程的终端中按 `Ctrl+C`。确认端口不再监听，或确认进程已退出。
3. 若第 9 节使用的覆盖层文件仍在 `<repo>` 中且不再需要，删除它；它本来也不应被提交。
4. 确认没有写入其他 profile 的清单：本程序写入 `<dsh-home>/profiles/dsa-smoke` 的 `package.json` 与 `<repo>/smoke-fixtures/`，此外不写任何 profile 的清单。检查方式是列出 `<dsh-home>/profiles` 下的目录，确认除 `dsa-smoke` 外没有本程序造成的**清单**修改；`node scripts/dsh-smoke-profile.mjs inspect` 的输出中也会打印它实际操作的 profile 目录。该脚本对任何非 `dsa-smoke` 的 profile 名直接拒绝执行。如第 3 节所述，`dsa-smoke/node_modules` 是共享树的目录链接，因此链接本身的变化会出现在 `inspect` 打印的目标里，这一点不能由「列出 profiles 目录」看出来，必须读 `inspect` 的链接目标。
