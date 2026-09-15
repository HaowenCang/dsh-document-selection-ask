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
| Task 3B | COMPLETE |
| Task 4 | COMPLETE |
| Task 5 | COMPLETE |
| Task 5A | LOCAL CODE PASS / REAL DSH TEXTPREVIEW SMOKE BLOCKED |
| Task 5B | REAL DSH TEXTPREVIEW SMOKE PASS / 已记录一处 production defect（未修） |
| Next task | 未授权（Task 6 未开始）；先修 Ask overlay 被展开的右栏遮挡的问题 |
| Primary runtime | DSH `0.1.5-rc.1` |
| Forward contract target | DSH `0.1.5-rc.2` |
| GitHub publication | ACTIVE（public） |

TXT / Markdown / code / CSV 的选择 → 引用 → Ask 流程已经实现，并且已在真实 DSH 预览上通过 Playwright smoke。仍存在一处 production defect：右栏展开时，composer 浮动 overlay 的 stacking context 低于右栏，Ask 按钮在屏幕上可见但无法点击（详见 `docs/STATUS.md`）。该问题不在 Task 5B 范围内修复。

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
