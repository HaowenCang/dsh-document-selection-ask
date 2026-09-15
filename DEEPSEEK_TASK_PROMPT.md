# DeepSeek v4.1 Flash — Subsequent Task Prompt

把 `<N>` 替换成要执行的 Task 编号。

## 汇报语言

与用户交流的所有进度说明、最终汇报、偏差说明和阻塞说明均使用简体中文。
代码、命令、错误原文、API 名、文件名和 commit subject 无需翻译。
除非用户明确要求，不得切换为日语、英语或繁体中文进行自由说明。

报告模板中的英文字段名可以保留，字段取值与自由说明使用简体中文。此规则只约束面向人的自然语言，不要求翻译仓库中已有的英文文档、源码标识符或 commit subject。

## 每轮执行提示词

```text
继续执行 `docs/superpowers/plans/2026-09-14-dsh-universal-document-selection.md` 中的 Task <N>。

开始前：
1. 重新阅读 AGENTS.md；
2. 阅读设计规格中与 Task <N> 相关的章节；
3. 阅读 Task <N> 的完整 Files / Interfaces / Steps；
4. 查看上一 Task 的 commit 和当前 git status。

只执行 Task <N>，不要开始 Task <N+1>。

严格按 RED → GREEN → REVIEW → COMMIT：
- 先写计划指定的失败测试并确认失败原因正确；
- 再实现最小代码；
- 运行 Task 指定测试；
- 运行 pnpm typecheck；
- 按 Task 要求运行 build/browser/verify（若该 Task 要求）；
- 执行 git diff --check 和 git diff 自审；
- 检查 AGENTS.md 的 hard constraints 和 stop rules；
- commit；
- 使用 AGENTS.md 的固定报告格式汇报；
- 停止。
```

若 Task 因第三方库 API 与计划不同而无法按既定 public contract 实现，不要用私有 API 补洞。报告：
- 计划预期 API
- 实际已安装版本/API
- 编译/运行错误
- 是否存在公开替代 API
- 对设计的最小变更建议

等待人工确认后再修改计划。
