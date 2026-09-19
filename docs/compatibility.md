# DSH 兼容性矩阵与支持判定

本文记录 `dsh-document-selection-ask` 对 DSH 运行时的支持面，以及判定这一支持面所依据的门禁。文中的结论对应 Task 14 在真实运行实例上的一次测量，而不是对 DSH 未来版本的承诺。

## 1. 运行策略（Task 14 起）

DSH `0.1.5-rc.2` 是当前官方运行时（CURRENT OFFICIAL RUNTIME），同时是主要阻塞性真实应用运行时（PRIMARY BLOCKING REAL-APP RUNTIME）与主要编译契约基线（PRIMARY COMPILE-CONTRACT BASELINE）。契约版本固定、编译探针所依据的声明、以及真实应用验收所针对的实例，三者都取 `0.1.5-rc.2`。

DSH `0.1.5-rc.1` 的定位在 Task 14 发生变化：它只是历史性的、可选的向后兼容证据，不再是契约固定版本，也不再作为主要基线维护。仓库中此前记录的「必需基线 rc.1、前向编译目标 rc.2」配对已经过时，须按本节改写。该配对描述的是以 rc.1 为基线、向 rc.2 前向推进的计划；Task 14 之后 rc.2 本身已是当前运行时，两者之间不再是「基线—目标」关系，继续沿用旧配对会把一个正在运行的版本写成尚未到达的目标。

Task 14 不声明单独的前向目标，原文表述为：

> No separate forward target is declared at Task 14. A newer DSH release must pass contract + real-app acceptance before support is claimed.

其含义是：更新的 DSH 版本必须同时通过契约门禁与真实应用验收，才谈得上支持。本文不为任何尚未测量的版本预置支持声明。

## 2. 已验证基线

以下标识属于一次具体测量，而非永恒事实。它描述 `2026-09-19` 这一天在指定提交上实际测得的组合；检出内容、DSH 安装或依赖树任一发生变化，都需要重新测量，本节的数值随即失效。

| 项 | 值 |
| --- | --- |
| 轮次与日期 | Task 14，`2026-09-19` |
| 插件基线 | 合并基线 `0ed146e8ba8a4831c77eb06ef2b97cb35253849f`（`main`）加上 Task 14 尚未合并的改动，在分支 `eval/deepseek-v4.1-flash-task14-20260919` 上评估 |
| 被测 DSH 版本 | `dsh --version` 报告 `0.1.5-rc.2` |
| 生产产物 `lib/client.js` | SHA-256 `735F8B77EC0B899F9740A8C0591AB7FE0A294C9D5F185A69A9B4A8F7134A183D` |
| 生产产物 `lib/index.mjs` | SHA-256 `FAC72B86168E002CB6DD2939C1775CAD0D149AFB24C4C2264B1110B079A60F39` |

两个生产产物哈希在 rc.1 → rc.2 契约固定迁移前后完全一致，即类型依赖的版本固定升级没有改变实际发布的运行时产物。这一事实是下面 rc.1 一行仍然具有参考价值的原因，也界定了它的限度：它说明的是产物的字节未变，而不是 rc.1 仍然被维护为基线。

## 3. 兼容性矩阵

| DSH | Role | Compile contract | Real-app evidence | Support statement |
| --- | --- | --- | --- | --- |
| `0.1.5-rc.2` | `CURRENT PRIMARY` | Task 14 PASS：每个 `@deepseek-ai/*` 契约 devDependency 都精确固定为 `0.1.5-rc.2`，`tests/compatibility/contracts.compile.ts` 与 `tests/compatibility/smoke-driver.contracts.compile.ts` 两个探针针对这些声明通过编译，`pnpm check:dsh-contracts` 是作出该判定的门禁。 | Task 13 在 rc.2 上记录 63 passed / 0 failed / 0 skipped；Task 14 在同一运行时上、针对 rc.2 固定后的检出重跑同样七个套件，再次记录 63 passed / 0 failed / 0 skipped（universal-selection 10、resource-cleanup 6、xlsx-selection 13、pptx-selection 10、docx-selection 6、pdf-renderer 10、real-dsh-textpreview 8），并额外在真实 rc.2 Web UI 上执行了 `docs/manual-acceptance.md` 的验收程序：八个格式、草稿保全、零自动提交、渲染器选择器、插件禁用与恢复、大文档加载中途关闭、Console 检查与 Network 检查。 | 当前已验证基线（current verified baseline）。 |
| `0.1.5-rc.1` | `historical / backward-compatibility evidence` | Task 14 之后不再是当前固定版本。 | Task 13 在 rc.1 上记录了完整的真实应用矩阵，63 passed / 0 failed / 0 skipped。由于 `lib/client.js` 在固定版本迁移前后逐字节相同，该记录描述的仍是同一个生产产物。 | 历史兼容性证据；不再作为主要基线维护。 |
| `later versions` | `unverified` | `NOT TESTED` | `NOT TESTED` | 在契约门禁与真实应用验收两者都通过之前不受支持。 |

本表记录的是已测组合，不是对未来版本的无条件保证。表中每一行的证据都绑定在某一轮次、某一提交与某一 DSH 安装上；离开这些条件，行内的结论不再自动成立。

## 4. Node 与平台

Node 版本要求为 `^22.19.0 || >=24.0.0`，由 `package.json` 的 `engines` 字段声明。

主要人工验证平台是 Windows 11 与基于 Chromium 的 DSH Web UI。macOS、Linux 与移动端在本轮**未验证**，本文不为其作任何可用性声明；在这些平台上运行既未通过真实应用验收，也未产生可引用的观察记录。

## 5. 支持如何判定

`pnpm check:dsh-contracts` 是契约门禁，其实现是仓库中的 `scripts/check-dsh-contracts.mjs`。它先读出契约环境的状态并打印出来，再执行编译步骤，然后以退出码给出判定。打印的内容包括：

- 项目契约的发布版本固定值；审计的字段是 `dependencies`、`devDependencies` 与 `optionalDependencies`，`peerDependencies` 明确排除在外——peer 范围描述的是消费者可以带来什么，不是本次编译所依据的内容，本仓库唯一一条 peer 是 `^4.0.2`，并非精确固定；
- 仓库中每一个声明了 `@deepseek-ai/*` 固定的 `package.json`，连同其声明版本与已安装版本；这一发现过程会遍历仓库（深度受限，并跳过 `node_modules`、`lib`、`dist`、`coverage`、`test-results`、`playwright-report`、`smoke-fixtures` 等目录），因为测试专用的 smoke driver 带有自己的契约固定，遗留在那里的旧版本与根清单里的旧版本是同一个缺陷；
- 当前 DSH 运行时版本，其发现从不硬编码，按三条路由依次尝试：`DSH_INSTALL_NODE_MODULES`（设置后即为唯一被检查的位置，指向错误目录必须显式失败而不是回落到其他位置）；`PATH` 上的 `dsh` CLI（执行其自身的版本命令并校验输出形状，而不是假定它可用；启动器存在但版本命令失败时判定为失败而非提示，因为该目录同时提供了被比较的安装，缺了这条证据就无法确认所比较的正是本机运行的实例）；以及公开的 `DSH_HOME` 布局（`$DSH_HOME` 或默认主目录下的 `profiles/node_modules`，其后是主目录自己的 `node_modules`）；
- 该运行时中 `sidebar-documentpreview` 的版本；
- 已安装的 `pdfjs-dist` 版本与 Node 版本。

`@deepseek-ai/cordis` 按独立版本号发布（`4.0.2`），因此被排除在发布版本比较之外，但仍作为其自身的精确固定被检查，以免把它折进发布号比较而在一套正确的环境上误报不匹配。

编译步骤不是可选项。脚本先确认两个探针文件存在、`typecheck` 脚本存在（当前为 `tsc -p tsconfig.client.json --noEmit`）、且该配置的 `include` 覆盖 `tests/`——否则一次没有把探针纳入程序的 `tsc` 会为它从未读过的文件报出绿色结果——然后执行项目自己的 `typecheck` 脚本。执行方式是直接调用仓库本地安装的 TypeScript 编译器，而不是经包管理器转发：`pnpm run` 会先判断依赖树是否为最新，遇到它不认识的树就安装一个，这正是本门禁承诺不会产生的副作用。编译失败即判定契约不一致。

任何不一致都会让脚本以非零退出码结束。退出码 `0` 表示全部检查通过，`1` 表示契约环境不一致，`2` 表示命令行未被理解。整个脚本只读：它不查询 registry、不下载包、不执行安装、不写文件，也不改动 DSH 安装。

`pnpm dsh:doctor` 报告同一份环境判定，并共享同一实现（它从门禁脚本导入环境检查函数），因此两条命令不可能给出互相矛盾的结论。两者的差别在于默认语义与编译步骤：`dsh:doctor` 回答的是「本机的 DSH 是否是这些固定值所描述的那一个」，并把「未发现安装」记为说明性提示，除非传入 `--runtime` 才把它当作失败；`check:dsh-contracts` 要求必须找到安装，并在报告 PASS 之前编译契约探针。

版本比较通过本身不构成兼容性证据。固定值一致只说明清单与安装相互匹配，既不能证明插件所依赖的公开契约仍然存在且形状未变，也不能证明它在真实应用里可用。作出支持判定的是两件事：编译步骤证明探针针对已安装的声明能够编译，真实应用验收证明交互契约在真实运行时、真实渲染器与真实指针手势下成立。

## 6. 本文件不主张的内容

本文不涉及 npm 发布、release 或 tag，也不包含 Task 15 的工作。

`docs/manual-acceptance.md` 是可执行的验收程序；验收结果记入 `docs/STATUS.md`，不写在本文件中，也不写回该程序文件，以免程序与结论互相污染。

本文不主张 rc.2 之外的任何 DSH 版本可用，不主张任何非 Windows 11 平台或非 Chromium 浏览器可用，也不声明前向目标。
