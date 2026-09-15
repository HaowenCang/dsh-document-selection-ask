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
