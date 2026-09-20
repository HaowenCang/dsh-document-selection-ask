# dsh-document-selection-ask — 开发蓝图与实施状态

该仓库用于使用 DSH + DeepSeek v4.1 Flash 实现一个通用文档“选中内容 → 询问 DeepSeek”插件。

- 代码仓库：https://github.com/HaowenCang/dsh-document-selection-ask
- 许可证：MIT（见 `LICENSE`，第三方组件许可证见 `THIRD_PARTY_NOTICES.md`）

## 当前状态

| 项目 | 状态 |
|---|---|
| Design | APPROVED |
| Tasks 1–14 | COMPLETE |
| Task 15 | NEXT / NOT AUTHORIZED |
| Current official DSH runtime | `0.1.5-rc.2` |
| Primary blocking real-app runtime | `0.1.5-rc.2` |
| Primary compile-contract baseline | `0.1.5-rc.2` |
| DSH `0.1.5-rc.1` | historical / optional backward-compatibility evidence |
| Forward target | 未声明（更新的 DSH release 须先通过 contract 与 real-app acceptance） |
| 八种格式 | 全部实现，并在真实 DSH 浏览器中验证 |
| GitHub publication | ACTIVE（public） |

TXT / Markdown / code / CSV / PDF / DOCX / PPTX / XLSX 八类文档的“选中内容 → 引用 → Ask”
流程均已实现，并在真实 DSH `0.1.5-rc.2` 的文档预览上通过 Playwright 验收：Task 13 的跨格式
矩阵为 63 passed / 0 failed / 0 skipped，Task 14 在同一 runtime 上重新运行该矩阵作为回归
gate。Ask 面位于 `shell.overlay`，composer 侧契约由 `conversation.input.overlay` 中的
`ComposerTargetRegistrar` 按 session 提供。

Task 14 同时闭合了 contract pin 与 runtime 的偏差：`@deepseek-ai/*` contract devDependencies
已从 `0.1.5-rc.1` 迁移到 `0.1.5-rc.2`，`@deepseek-ai/cordis` 保持 `4.0.2`（独立版本体系）。
迁移前后 `lib/client.js` 与 `lib/index.mjs` 的 SHA-256 完全一致，因此 Task 13 记录的 rc.1
真实应用证据仍对应同一份 production bundle。

兼容矩阵见 `docs/compatibility.md`，人工验收步骤见 `docs/manual-acceptance.md`。

## 已冻结范围

支持：

- TXT / plain text
- Markdown
- 源码 / 配置文件
- CSV
- PDF
- DOCX
- PPTX
- XLSX

后置：

- DOC / PPT / XLS
- OCR
- Office 编辑
- 批注/高亮持久化

XLSX 渲染运行时不再是阻塞项。`@extend-ai/react-xlsx` 的解析引擎是一个 WASM 二进制，DSH 只把
外部客户端插件的浏览器半边作为**一个**生成脚本提供（`exports["./client"]` 指向的文件及其可选
source map，其余路径一律 404），没有公开的、客户端专用的二进制资产投递契约。Task 11 的解法
是让构建管线把该 WASM 与 `@zip.js/zip.js` 一并内联进 `lib/client.js`：运行时 XLSX 的 WASM
以 HTTP 请求数 0 的方式从内联字节启动，worker 走 `blob:` URL，不访问 host 路由、不访问 CDN。
真实 DSH 浏览器验收见 `tests/browser/xlsx-selection.spec.ts`（13 passed / 0 failed / 0
skipped），网络本地性断言见 `tests/browser/resource-cleanup.spec.ts`。

## 核心架构

```text
DSH builtin text/markdown/code ─┐
PDF Canvas + TextLayer ─────────┤
DOCX HTML DOM ──────────────────┤
PPTX HTML/SVG ──────────────────┼→ SelectionAdapter
XLSX semantic cell range ───────┘       │
                                        ▼
                              Universal Selection Kernel
                                        │
                              provenance + quote
                                        │
                              Selection Ask Overlay
                                        │
                              inputActions.setDraft()
```

## 文档索引

DeepSeek v4.1 Flash 必须先读：

1. `AGENTS.md`
2. `docs/superpowers/specs/2026-09-14-dsh-universal-document-selection-design.md`
3. `docs/superpowers/plans/2026-09-14-dsh-universal-document-selection.md`

当前进度与已验证 gate：

`docs/STATUS.md`

从 Task 2 起的每一轮使用：

`DEEPSEEK_TASK_PROMPT.md`

Task 1 的启动指令存档在：

`DEEPSEEK_START_PROMPT.md`

完整执行流程：

`docs/DEEPSEEK_EXECUTION_WORKFLOW.md`

## 任务数量

实施计划共 15 个独立 TDD Task。每个 Task 都有：

- exact files
- interface contracts
- failing test
- expected failure
- minimal implementation boundary
- verification commands
- diff review
- commit boundary
- stop rules

不要跳 Task，也不要让 Flash 在一个会话中直接“完成整个项目”。

## 关键基线

- Current official runtime / primary blocking real-app runtime / primary compile-contract
  baseline: DSH `0.1.5-rc.2`
- Historical backward-compatibility evidence: DSH `0.1.5-rc.1`（Task 13 的真实应用矩阵；
  不再是 contract pin，也不作为维护基线）
- 未声明独立的 forward target：更新的 DSH release 必须同时通过 contract gate 与 real-app
  acceptance，之后才可以声称支持
- Node: `^22.19.0 || >=24.0.0`
- 人工验证平台: Windows 11 + Chromium-based DSH web UI（macOS / Linux / mobile 未验证）
- client-only v1
- no cloud conversion
- no automatic submit
- no private DSH/React/Lexical hacks

`@deepseek-ai/cordis` 保持 `4.0.2`，它属于独立版本体系，不参与 DSH release 编号。

## 兼容性与验收文档

- `docs/compatibility.md` — DSH 支持矩阵、contract baseline 与真实应用证据
- `docs/manual-acceptance.md` — 可逐条执行的 DSH rc.2 人工验收步骤（八种格式、草稿保全、
  渲染器切换、插件禁用/恢复、大文档中途关闭、console / network 检查）
- `docs/STATUS.md` — 每轮的验证结果记录

## 开发环境

Contract 编译所需的 DSH public packages 在本项目 `devDependencies` 中按同一 release 精确固定，`pnpm install` 只写本项目 `node_modules`：

```bash
git clone https://github.com/HaowenCang/dsh-document-selection-ask.git
cd dsh-document-selection-ask
pnpm install
pnpm check:dsh-contracts   # Task 14 gate: pin + runtime + compiled contract probes
pnpm typecheck             # normative public-contract gate
pnpm test
pnpm build
```

不需要、也不允许预先修复用户级 DSH 安装。`pnpm dsh:doctor` 仅做检测：比对 contract pin 与本机 DSH 安装版本，不一致时以非零退出码报告；`--runtime` 要求必须找到本机安装。`pnpm check:dsh-contracts` 是 Task 14 的完整 gate：它报告 contract release pin、各 manifest 的已声明与已安装版本、当前 DSH runtime、sidebar-documentpreview、`pdfjs-dist` 与 Node 版本，随后编译 contract probes，任何一项不一致即以非零退出码失败。它不联网、不安装、不写文件；`DSH_INSTALL_NODE_MODULES` 可显式指定 runtime，一旦指定即为唯一权威：`PATH` 上的 `dsh` 不会被探查，也不会回退到 `DSH_HOME` 或主目录 `node_modules`，override 本身有误时显式失败。二者共用同一份判定逻辑，不会给出互相矛盾的结论。构建、类型检查与测试都不读取仓库之外的路径，全新 clone 只需 `pnpm install` 即可通过上述 gate；`docs/STATUS.md` 的历史记录中引用了若干一次性隔离安装的路径，那是对既往执行的描述，不是本仓库的依赖。

## 真实 DSH 预览 smoke（开发者用，非用户功能）

`tests/browser/ask-flow.spec.ts` 在一个运行中的 DSH 里注入 preview body；它验证插件自身行为，但不证明真实文档预览会产出 adapter 读取的 DOM。`tests/browser/real-dsh-textpreview.spec.ts` 补齐这一点：该 spec 不创建任何 preview 节点，它点击 test-only companion plugin 提供的控件，由该控件调用公开的 `ctx.sidebarRight.openResource(...)`，真实 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` 随即自行 mount TXT / code / Markdown fixture，Ask 全流程都在这份真实预览上观察。两类测试必须分开报告，只有后者是 Task 5B 的 gate。

该 companion driver 位于 `tests/browser/smoke-driver/`，是独立、最小、private、test-only 的 DSH client plugin：它不 import 被测插件，不创建 `data-textpreview-*` 节点，除 `ctx.sidebarRight.openResource` 外不做任何导航。它不进入主包 `files` 发布集合，也不作为 npm/runtime 依赖发布；用户无需安装它。

复现步骤（只维护隔离 profile `dsa-smoke` 自己的清单；共享 `node_modules` 链接的含义见下方说明）：

```bash
pnpm install
pnpm build                 # 主插件产物（不含 driver）
pnpm smoke:driver          # 构建 test-only driver（tests/browser/smoke-driver/lib）
pnpm smoke:profile prepare # 生成 fixture + 幂等维护 dsa-smoke 的 link/bundle 行
dsh --profile dsa-smoke --port 50111 --no-open
DSH_SMOKE_URL='http://127.0.0.1:50111/?token=…' pnpm test:browser
```

`pnpm smoke:profile` 支持 `inspect` / `prepare` / `validate` / `cleanup`，固定 profile 名 `dsa-smoke`，写入前会拒绝其它 profile；重复执行不产生 duplicate loader entry。未设置 `DSH_SMOKE_URL` 时真实预览 spec 自动 skip，`pnpm test:browser` 在没有 DSH 的机器上仍可用。逐条的人工验收步骤（含渲染器切换与插件禁用/恢复）见 `docs/manual-acceptance.md`。

隔离范围需要说明清楚：`prepare` 写的是 `dsa-smoke` 自己的 `package.json` 与 `<repo>/smoke-fixtures/`，不写任何其他 profile 的清单；但 `dsa-smoke/node_modules` 本身是指向 `web` profile 已安装树的目录链接，因此它维护的两个目录链接在文件系统上落在同一棵共享树里。`inspect` 会打印该链接的目标。
