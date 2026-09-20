# dsh-document-selection-ask

在 DSH 文档预览中选中内容，把带出处（provenance）的引用块追加到当前会话草稿的 DSH 客户端插件。

- 代码仓库：https://github.com/HaowenCang/dsh-document-selection-ask
- 许可证：本仓库自身代码为 MIT，见 [LICENSE](LICENSE)；随包第三方组件各自保留其许可证，权威清单为 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- 项目状态：实施计划 15 个 Task 全部完成，release candidate 已在真实 DSH `0.1.5-rc.2` 上验证；**尚未发布**——npm registry 上没有该包，没有 git tag，也没有 GitHub Release。本轮（Task 15）只涉及发布文档与打包准备，`src/client/**` 的运行行为未改动。

## 项目用途

DSH 右侧的文件预览可以显示 TXT、Markdown、源码与配置文件、CSV、PDF、DOCX、PPTX 与 XLSX。该插件
解决阅读过程中的一个具体问题：把「这一段」交给模型时，用户不需要先复制、另开文件，也不需要
手工输入文件名、页码或工作表位置。插件工作在 DSH 客户端的文档预览面上，读取用户已经做出的
选择，生成带出处的引用块，并写入当前会话的草稿输入框；发送与否由用户决定。

## 功能

一次完整的流程是：用户在受支持的预览中选中内容，插件把该选择捕获为格式无关的快照（文本、出处、
几何信息）；浮层出现 `询问 DeepSeek` 按钮；按下后插件在当前草稿末尾追加一个引用块，其结构为
出处行、引用内容，以及 `请针对以上选中内容回答：` 后缀；随后焦点回到输入框，用户补完问题并自行
发送。

三条语义边界固定不变。已有草稿被保留，新引用块只做追加，第二次选择产生第二个引用块并位于其后。
插件从不自动发送消息，对输入框的唯一写入是 DSH 公开的草稿写入动作。DSH 内置的纯文本、Markdown 与
代码预览不被替换，插件只读取它们产生的 DOM；PDF、DOCX、PPTX、XLSX 四类由插件注册自带渲染器。

浮层按钮只在选区所属会话与当前会话一致、且该会话的输入框已注册时出现，因此按钮不会把引用写入
另一个会话的草稿。

## 支持格式

| 格式 | 渲染器 | 选择 | 出处 |
| --- | --- | --- | --- |
| TXT / 纯文本 | DSH 内置纯文本 | 真实 DOM selection | 文件；渲染器给出逐行行号时附源码行号 |
| Markdown | DSH 内置 Markdown | 真实 DOM selection | 文件（渲染结果不合成源行号） |
| 源码 / 配置 | DSH 内置代码 | 真实 DOM selection | 文件；行可证明时附源码行号 |
| CSV | DSH 内置纯文本 | 真实 DOM selection | 文件；行可证明时附源码行号 |
| PDF | `pdfjs-dist@6.3.289`（Canvas + TextLayer） | TextLayer 上的真实 selection | 文件 + `第 N–M 页` |
| DOCX | `docx-preview@0.4.0` | 渲染后 HTML DOM 上的真实 selection | 文件 + `第 N–M 渲染页` |
| PPTX | `@aiden0z/pptx-renderer@1.2.4` | HTML/SVG 文本上的真实 selection | 文件 + `第 N–M 张幻灯片` |
| XLSX | `@extend-ai/react-xlsx@0.16.4` | 语义单元格区域，不是文本选择 | 文件 + `` `<sheet>!<A1 区域>` ``，例如 `Sheet1!A1:C3` |

完整矩阵——每种格式的渲染器版本、选择机制、出处来源属性、门禁与限制——见
[docs/renderer-support.md](docs/renderer-support.md)。

## 安装

该包在 `package.json` 中为 `private`，未发布到 npm registry，因此不存在按 registry 包名安装的
方式。当前经过验证的分发路径是本地 tarball 安装。

### 本地 tarball 安装

在本仓库检出上构建并打包：

```bash
pnpm install
pnpm build
pnpm pack
```

`pnpm pack` 产出 `dsh-document-selection-ask-0.1.0.tgz`，文件名由 `package.json` 的 name 与 version
决定。随后在一个自有 profile 中安装并启动：

```bash
dsh --profile dsa-dev --from-default-profile web
dsh plugin --profile dsa-dev add <tarball 的绝对路径>
dsh --profile dsa-dev --port 50120 --no-open
```

浏览器打开 `http://127.0.0.1:<port>/?token=<token>`，token 由启动输出给出。

`dsh plugin --profile <name> <args...>` 把参数原样转发给 profile 目录中的 `pnpm`；安装成功后它按
已安装状态自行维护 profile 的 `dsh.profile.bundles` 列表（声明了 `dsh.bundle` 的包加入插件层），
因此不需要手工编辑 profile 清单。profile 不存在时该命令会先初始化；`--from-default-profile web`
用于显式地从随发行版本提供的 web 模板创建新 profile。

安装前需要明确一点：profile 必须是可丢弃的自有 profile。插件会成为该 profile 的一个层，把它装进
日常使用的 profile 会改变那个 profile 的启动内容。卸载使用
`dsh plugin --profile dsa-dev remove dsh-document-selection-ask`，依赖移除后该包名会同时从
`dsh.profile.bundles` 中移除。`pnpm pack` 与 `private: true` 并不冲突，`private` 只阻止发布到
registry。

### 源码检出（开发路径）

```bash
git clone https://github.com/HaowenCang/dsh-document-selection-ask.git
cd dsh-document-selection-ask
pnpm install
pnpm build
```

源码检出上的人工验收步骤（八种格式、草稿保全、渲染器切换、插件禁用与恢复、网络与 console 检查）
见 [docs/manual-acceptance.md](https://github.com/HaowenCang/dsh-document-selection-ask/blob/main/docs/manual-acceptance.md)。

## 使用

在右侧文件预览中打开受支持格式的文件，选中想要询问的内容——鼠标拖选与键盘选择都可以，选择必须
落在同一份文档内。选择成立后浮层出现 `询问 DeepSeek` 按钮。按下按钮，引用块被追加到当前草稿：

```text
已有问题

> [来源：paper.pdf，第 3–4 页]
> 选中的内容
> 选中的内容

请针对以上选中内容回答：
```

随后在输入框补完问题并自行发送。引用块只在预览属于当前会话时写入当前会话的草稿，插件不会切换
会话，也不会提交消息。

## 安全与隐私

文档字节按不可信输入处理。插件不使用远程 Office/PDF 查看器，不上传文档，不依赖 CDN 资源，也不调用
LibreOffice、MS Office 或 COM；PDF 的 worker 与运行时资源、XLSX 的解析引擎都内嵌在客户端产物中。
DOCX、PPTX、XLSX 在进入渲染器之前一律先过共享的归档预检与解压校验。worker、object URL、观察器与
查看器会话在卸载时释放，选中的内容与文档字节不写入日志。细节见
[docs/security.md](docs/security.md)。

## 兼容性

- 已验证运行时：DSH `0.1.5-rc.2`（本机 `dsh --version` 输出 `0.1.5-rc.2`），它同时是主要阻塞性
  真实应用运行时与主要编译契约基线。
- 契约依赖：`@deepseek-ai/*` 客户端契约是本项目的普通 `devDependencies`，精确固定到
  `0.1.5-rc.2`；`@deepseek-ai/cordis` 属独立版本体系，保持 `4.0.2`。
- Node：`^22.19.0 || >=24.0.0`，由 `package.json` 的 `engines` 声明。
- 人工验证平台：Windows 11 与基于 Chromium 的 DSH Web UI。macOS、Linux 与移动端未验证，本文不为
  其作可用性声明。
- 未声明独立的 forward target：更新的 DSH 版本需要同时通过契约门禁与真实应用验收之后才谈得上支持。

支持矩阵、契约门禁的判定方式与真实应用证据见
[docs/compatibility.md](docs/compatibility.md)。

## 开发与验证

```bash
pnpm install
pnpm check:dsh-contracts   # 契约门禁：版本固定、已安装版本、契约探针编译
pnpm typecheck
pnpm test                  # vitest：单元与 jsdom 客户端用例
pnpm build
pnpm verify                # 只读静态门禁：源码与构建产物的启发式规则
pnpm test:browser          # Playwright；需要运行中的 DSH 与 DSH_SMOKE_URL
```

- 每条命令的语义、判据与失败时的第一判据：
  [docs/testing.md](https://github.com/HaowenCang/dsh-document-selection-ask/blob/main/docs/testing.md)
- 人工验收步骤：
  [docs/manual-acceptance.md](https://github.com/HaowenCang/dsh-document-selection-ask/blob/main/docs/manual-acceptance.md)
- 逐轮验证结果与历史记录：
  [docs/STATUS.md](https://github.com/HaowenCang/dsh-document-selection-ask/blob/main/docs/STATUS.md)

浏览器验收中有一部分依赖一个仅测试用的 companion driver（`tests/browser/smoke-driver/`）。它是一个
独立、最小、`private` 的 DSH client plugin，用于让真实的内置预览 mount fixture；它不 import 被测
插件，不进入主包的 `files` 发布集合，也不是主包的依赖，用户无需安装。

## 限制

- v1 不支持 DOC / PPT / XLS，不支持 OCR，不支持 Office 文档编辑，也不支持持久批注与高亮。这些
  能力没有降级形态。
- 引文文本的全局上限是 16,384 UTF-16 code units；XLSX 在此之上另有一次选择最多 200 cells 的上限。
  超过任一条上限都会被拒绝，并显示对应的用户可见错误，不会静默截断。
- 渲染保真度不作保证。DOCX 出处的「渲染页」是浏览器分页的结果，不是源文档自身的分页；PDF、DOCX、
  PPTX、XLSX 的版式由各自的第三方渲染器决定，人工验收程序也不以版式一致性为判据。
- 当前状态为 release candidate：未发布、无 tag、无 GitHub Release，也没有 npm 发布包。

## 许可证与第三方声明

本仓库自身代码以 MIT 许可证发布，全文见 [LICENSE](LICENSE)。随包分发的第三方组件保留其各自许可证
（例如 `pdfjs-dist` 为 Apache-2.0、`docx-preview` 为 Apache-2.0、`@aiden0z/pptx-renderer` 为
Apache-2.0、`@zip.js/zip.js` 为 BSD-3-Clause、`@extend-ai/react-xlsx` 为 MIT），完整清单与许可证
文本见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
