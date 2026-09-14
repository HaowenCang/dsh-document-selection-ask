# DeepSeek v4.1 Flash — Subsequent Task Prompt

把 `<N>` 替换成要执行的 Task 编号。

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
