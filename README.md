# dsh-document-selection-ask — 开发蓝图与实施状态

该仓库用于使用 DSH + DeepSeek v4.1 Flash 实现一个通用文档“选中内容 → 询问 DeepSeek”插件。

- 代码仓库：https://github.com/HaowenCang/dsh-document-selection-ask
- 许可证：MIT（见 `LICENSE`，第三方组件许可证见 `THIRD_PARTY_NOTICES.md`）

## 当前状态

| 项目 | 状态 |
|---|---|
| Design | APPROVED |
| Task 1 | COMPLETE |
| Task 1A | COMPLETE |
| Task 2 | COMPLETE |
| Task 3 | COMPLETE |
| Task 3A | COMPLETE |
| Next task | Task 4 — DSH builtin text/Markdown/code/CSV selection adapter |
| Primary runtime | DSH `0.1.5-rc.1` |
| Forward contract target | DSH `0.1.5-rc.2` |
| GitHub publication | ACTIVE（public） |

插件功能尚未实现。仓库当前包含已批准的设计与计划、DSH public contract 骨架、可复现构建/测试入口，以及 Task 2、Task 3 建立的选择与引用核心。逐项事实与 commit 见 `docs/STATUS.md`。

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

- Primary verified runtime: DSH `0.1.5-rc.1`
- Forward contract target: DSH `0.1.5-rc.2`（仅 contract-compatible；未做真实应用 smoke，不得声称完整 runtime 支持）
- Node: `^22.19.0 || >=24.0.0`
- client-only v1
- no cloud conversion
- no automatic submit
- no private DSH/React/Lexical hacks

## 开发环境

Contract 编译所需的 DSH public packages 在本项目 `devDependencies` 中按同一 release 精确固定，`pnpm install` 只写本项目 `node_modules`：

```bash
git clone https://github.com/HaowenCang/dsh-document-selection-ask.git
cd dsh-document-selection-ask
pnpm install
pnpm typecheck   # normative public-contract gate
pnpm test
pnpm build
```

不需要、也不允许预先修复用户级 DSH 安装。`pnpm dsh:doctor` 仅做检测：比对 contract pin 与本机 DSH 安装版本，不一致时以非零退出码报告；`--runtime` 要求必须找到本机安装。仓库不含任何机器绝对路径：全新 clone 只需 `pnpm install` 即可通过上述 gate。

## 真实 DSH 预览 smoke（开发者用，非用户功能）

`tests/browser/ask-flow.spec.ts` 在一个运行中的 DSH 里注入 preview body；它验证插件自身行为，但不证明真实文档预览会产出 adapter 读取的 DOM。`tests/browser/real-dsh-textpreview.spec.ts` 补齐这一点：该 spec 不创建任何 preview 节点，它点击 test-only companion plugin 提供的控件，由该控件调用公开的 `ctx.sidebarRight.openResource(...)`，真实 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` 随即自行 mount TXT / code / Markdown fixture，Ask 全流程都在这份真实预览上观察。两类测试必须分开报告，只有后者是 Task 5B 的 gate。

该 companion driver 位于 `tests/browser/smoke-driver/`，是独立、最小、private、test-only 的 DSH client plugin：它不 import 被测插件，不创建 `data-textpreview-*` 节点，除 `ctx.sidebarRight.openResource` 外不做任何导航。它不进入主包 `files` 发布集合，也不作为 npm/runtime 依赖发布；用户无需安装它。

复现步骤（只操作隔离 profile `dsa-smoke`，不触碰任何用户 profile）：

```bash
pnpm install
pnpm build                 # 主插件产物（不含 driver）
pnpm smoke:driver          # 构建 test-only driver（tests/browser/smoke-driver/lib）
pnpm smoke:profile prepare # 生成 fixture + 幂等维护 dsa-smoke 的 link/bundle 行
dsh --profile dsa-smoke --port 50111 --no-open
DSH_SMOKE_URL='http://127.0.0.1:50111/?token=…' pnpm test:browser
```

`pnpm smoke:profile` 支持 `inspect` / `prepare` / `validate` / `cleanup`，固定 profile 名 `dsa-smoke`，写入前会拒绝其它 profile；重复执行不产生 duplicate loader entry。未设置 `DSH_SMOKE_URL` 时真实预览 spec 自动 skip，`pnpm test:browser` 在没有 DSH 的机器上仍可用。
