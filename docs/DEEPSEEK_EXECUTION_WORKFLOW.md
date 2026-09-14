# DSH + DeepSeek v4.1 Flash Execution Workflow

## Recommended execution mode

Use a fresh DeepSeek v4.1 Flash context for each major Task or at minimum reset/compact context before the format renderer Tasks.

Recommended grouping is **one plan Task per round**.

Why:
- the plugin touches several independent third-party renderer APIs;
- the DSH contract boundary is narrow and must remain visible;
- Flash performs more reliably when one task has one acceptance boundary;
- renderer-specific context should not contaminate later adapters.

## Round sequence

```text
Round 1  -> Task 1  package + DSH contracts
Round 2  -> Task 2  universal types/quote
Round 3  -> Task 3  selection kernel
Round 4  -> Task 4  DSH builtin text adapter
Round 5  -> Task 5  overlay/composer
Round 6  -> Task 6  OOXML preflight
Round 7  -> Task 7  PDF renderer
Round 8  -> Task 8  PDF adapter
Round 9  -> Task 9  DOCX
Round 10 -> Task 10 PPTX
Round 11 -> Task 11 XLSX
Round 12 -> Task 12 unified lifecycle
Round 13 -> Task 13 cross-format acceptance
Round 14 -> Task 14 compatibility/manual smoke
Round 15 -> Task 15 packaging/release
```

## Human review checkpoints

Mandatory review after:
- Task 1: public DSH contract confirmed
- Task 5: first complete text → Ask workflow works
- Task 8: PDF TextLayer and provenance proven
- Task 9: DOCX fidelity acceptable
- Task 10: PPTX fidelity/windowing acceptable
- Task 11: XLSX selection semantics acceptable
- Task 13: cross-format E2E
- Task 15: release package

## If a Task is blocked

Do not ask Flash to “try another way” immediately.

First classify:

### Contract blocker
Example: DSH moved `documentPreviews`.

Action:
- inspect current public declarations/docs;
- update spec/plan only after human approval.

### Renderer API blocker
Example: PPTX renderer no longer exposes stable slide lifecycle.

Action:
- evaluate another public renderer API;
- do not use CSS hash/private React internals.

### Bundler/CSP blocker
Example: local WASM worker fails.

Action:
- reproduce minimally;
- identify whether the public library supports local asset source;
- architecture change requires review.

### Fidelity blocker
Example: DOCX page markers unreliable.

Action:
- keep selection;
- degrade provenance to file-only as the spec permits;
- do not fabricate pages.

## Never batch these together

Do not implement PDF, DOCX, PPTX, and XLSX in one round.

Do not ask Flash to “finish the rest of the plan”.

Do not let a blocked format cause refactoring of already-passing format adapters without a failing regression test.
