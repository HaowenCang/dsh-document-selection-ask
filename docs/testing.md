# 测试与验证指南

本文面向在本仓库工作的开发者，记录验证机制、命令语义与判据。它不重复另外三份文档：测试原则与覆盖范围见 `docs/07-testing-strategy.md`，可逐条执行的人工验收步骤见 `docs/manual-acceptance.md`，每一轮的实际数值记入 `docs/STATUS.md`。本文只写机制、命令与判据。

行号指向基线提交 `f862a05d92df59708f929ca9fb5c5cbf8284e9c4`。

## 1. 静态矩阵

全部命令都在仓库根目录执行。`package.json:50-61` 是本仓库唯一的脚本集合，下表列出发布前需要跑的八个命令。

| 命令 | 性质 | 决定什么 | 失败时的第一判据 |
| --- | --- | --- | --- |
| `pnpm check:dsh-contracts` | 运行时／版本固定／编译契约门禁 | 本 checkout 的 contract 环境是否仍描述它所声称支持的运行时 | 打印的行名与退出码：`1` 为契约环境不一致，`2` 为命令行不被理解 |
| `pnpm dsh:doctor -- --runtime` | 同一判定的环境报告 | 本机安装的 DSH 是否就是 pin 描述的那一个 | 退出码非零即环境不一致；未找到安装时是否算失败取决于 `--runtime` |
| `pnpm typecheck` | 公共契约的类型门禁 | `src/**` 与 `tests/**`（含两个 `*.compile.ts` 探针）是否对已安装的 DSH 声明编译通过 | `tsc` 的首个错误；探针里的错误就是契约不匹配本身 |
| `pnpm test` | 单元／客户端正确性 | 纯函数、适配器、渲染器客户端行为与构建产物形状 | Vitest 的用例名与文件；先看失败是断言还是导入期异常 |
| `pnpm build` | 产物构建 | `lib/index.mjs`、`lib/client.js`、`lib/types/**` 是否可产出且满足构建期门禁 | 构建脚本以具名原因抛出（见下） |
| `pnpm verify` | 确定性的只读静态门禁（文本扫描） | 13 条具名启发式规则在 `src/**` 与构建产物中是否命中 | `FAIL <规则号> <含义> — N findings`，其后每条 finding 给出文件与行列 |
| `npm pack --dry-run` | 打包面 | npm 眼中将要进入 tarball 的文件清单 | 清单里出现 `tests/`、报告目录或绝对路径即为打包缺陷 |
| `pnpm verify:package` | 打包面（检查已产出的 tarball） | 一个已经存在的 `.tgz` 是否满足本仓库的打包契约 | 逐项检查行与 `verify-package: PASS`／findings；退出码 `2` 表示没有可检查的 tarball |

### 1.1 契约与环境两个命令的关系

`pnpm check:dsh-contracts`（`node scripts/check-dsh-contracts.mjs`）是 Task 14 的完整门禁。它审计 `dependencies`、`devDependencies` 与 `optionalDependencies` 中的 `@deepseek-ai/*` 精确 pin，比对已声明版本与已安装版本，报告 contract release pin、当前 DSH runtime、`sidebar-documentpreview`、`pdfjs-dist` 与 Node 版本，最后以项目自己的 typecheck 编译 contract 探针；它只读，不联网、不安装、不写文件（`scripts/check-dsh-contracts.mjs:1-57,90-105`）。

运行时位置是发现的，不是硬编码的，按固定顺序尝试三条路径：`DSH_INSTALL_NODE_MODULES`、`PATH` 上的 `dsh` CLI、`$DSH_HOME` 与主目录布局（`scripts/check-dsh-contracts.mjs:58-89`）。**`DSH_INSTALL_NODE_MODULES=<path>` 一旦设置且非空，即为唯一权威**：它决定被检查的位置、被选中的运行时与最终结论，`PATH` 上的 `dsh` 根本不会被探查、执行或报告，也不会回退到 `DSH_HOME` 或主目录；override 本身指向错误目录时按自身证据失败，而不是退回其它路径（`scripts/check-dsh-contracts.mjs:63-89,458-478,524-550`）。

`pnpm dsh:doctor -- --runtime`（`node scripts/dsh-doctor.mjs`，`--` 之后的参数传给脚本）是同一判定的环境报告。它与检查器的差别只有两点：不编译探针，以及默认把「本机没有安装」当作一条提示而非失败；加 `--runtime` 后，缺失的安装成为失败。该脚本**导入** `inspectContractEnvironment()`，不重新实现发现逻辑，因此两个命令不会给出互相矛盾的结论；override 语义也随之一并继承，包括打印同一行 `runtime discovery = DSH_INSTALL_NODE_MODULES override` 与 `PATH CLI report = NOT PROBED (explicit override)`（`scripts/dsh-doctor.mjs:1-60`）。

`pnpm typecheck` 是 `tsc -p tsconfig.client.json --noEmit`（`package.json:53`）。该配置的 `include` 覆盖 `src/**` 与 `tests/**`（`tsconfig.client.json:18`），因此 `tests/compatibility/contracts.compile.ts` 与 `tests/compatibility/smoke-driver.contracts.compile.ts` 由这条命令编译——这正是它被称为公共契约门禁的原因：探针里出现类型错误，意味着插件的公开契约与已安装的 DSH 声明不再一致。

### 1.2 构建与静态扫描

`pnpm build` 是 `tsdown && tsc -p tsconfig.build.json`（`package.json:58`）。它在两种情形下会以具名原因**拒绝构建**而不是产出一个缺件的 bundle：安装的 XLSX 引擎二进制不是已评审的那一份、压缩表示越过上界，或某个被改写的字面量出现次数不再是恰好一次（`scripts/xlsx-runtime-assets.ts:23-39`；`tsdown.config.ts:250-265,286-298`）；安装的 `pdfjs-dist` 目录布局变化导致资源族为空时同样抛错（`tsdown.config.ts:110-113,132-134`）。这些失败不是环境噪声，而是「依赖形状已经改变」的结论。

`pnpm test` 自带两次构建：Vitest 的 `globalSetup` 先运行 `pnpm build`，再运行 `pnpm smoke:driver`，任一次失败即整个运行失败，因此 `pnpm test` 不依赖调用顺序，新 clone 上也不需要先手工构建（`vitest.config.ts:48-57`；`tests/setup/build-artifacts.ts:1-53`）。第二次构建是必需的：驱动是一个独立的 private 包，`pnpm build` 不产出它的两个入口，而 `tests/unit/smoke-profile.spec.ts:145-148` 会断言这两个入口在磁盘上存在；缺了它，新 clone 上的 `pnpm test` 会以一个与被测行为无关的原因失败。Vitest 的 `include` 只有 `tests/unit/**/*.spec.ts`、`tests/client/**/*.spec.ts`、`tests/client/**/*.spec.tsx`，`tests/browser/**` 被排除（`vitest.config.ts:49-50`）。

`pnpm verify`（`node scripts/verify.mjs`）是严格只读、确定性、覆盖全部输入的静态门禁：不写文件、不联网、不读时钟、不依赖 `lib/` 的构建时间；缺失的输入是具名失败而不是静默跳过；每条失败给出规则、文件（文本输入给出行列）与命中的证据（`scripts/verify.mjs:18-41`）。它读取 `src/**` 与构建产物，因此 `R1`（必需文件存在）要求先跑 `pnpm build`（`scripts/verify.mjs:139-151`）。它只有一个选项 `--root <dir>`，用途是让评审者把同一组规则指向一棵一次性副本，以证明某条否定规则确实会触发（`scripts/verify.mjs:37-41,103-127`）。结尾的 `pathToFileURL` 计数是**咨询性提示，不决定退出码**（`scripts/verify.mjs:1931-1952,1991-1997`）。

`npm pack --dry-run` 列出将要打包的内容。真正的约束在 `package.json:24-35` 的 `files` 允许列表：`lib/index.mjs`、`lib/client.js`、`lib/types/**/*.d.ts`、`cordis.patch.yml`、`README.md`、`LICENSE`、`THIRD_PARTY_NOTICES.md`，以及三份面向安装者的文档 `docs/renderer-support.md`、`docs/security.md`、`docs/compatibility.md`。`src/`、`tests/`、`scripts/` 与其余 `docs/` 文件都不在其中，因此**本文不会进入 tarball**，`docs/STATUS.md` 与 `docs/manual-acceptance.md` 同样不会；打包后的 `README.md` 以相对路径引用这三份随包文档，`docs/testing.md` 只以绝对 GitHub 链接被引用。静态门禁覆盖这件事的两个方向：`R10` 拒绝把测试树、报告或本机路径写进发布面（`scripts/verify.mjs:1688-1719`，规则清单见 `:1925-1926`），`R13` 检查 `main`、`types`、`exports.*` 与 `dsh.bundle.patch` 每一个声明入口都在允许列表内，并拒绝允许列表里出现 `.wasm`、`pdf.worker.*`、`xlsx-worker.*`、`.map` 这类会被误当成第二条交付路径的条目；该规则同时说明自己只比对 `package.json` 内部的文本，不打开 tarball，也不运行 `npm pack`（`scripts/verify.mjs:1827-1905`，规则清单见 `:1928`）。

`pnpm verify:package`（`node scripts/verify-package.mjs`）是打包面的检查器，读取一个**已经存在**的 `.tgz`，不重新打包：它在仓库内只读，不创建、修改或删除仓库根下的任何东西，也不调用打包器；它离线运行，唯一输入是 tarball 自身的字节（`scripts/verify-package.mjs:1-62`）。不带参数时它检查仓库根下最新的 `dsh-document-selection-ask-*.tgz`，显式路径不会被二次猜测（`:437-454`）。它先在本进程内解析 tar 索引，**只有三项 preflight 全部通过后才调用平台 `tar`**：归档布局（索引可解析、有结束标记、每个成员的原始路径都在 `package/` 之下）、条目类型（只允许普通文件与目录；symlink、hardlink、设备节点、FIFO 与未知类型一律失败）、成员路径安全（空名、名字域内的 NUL、绝对 POSIX 路径、盘符路径、反斜杠、`.` 与 `..` 组件、空组件，以及规范化后离开 `package/` 的形式）（`:275-357,478-534`）。`safeToExtract` 是这三项的合取（`:535`）；它不成立时不创建临时目录、不调用 `tar`，依赖解压的每一项检查各自打印 `FAIL … extraction was not attempted because archive preflight failed` 而不是静默跳过（`:599-603`）。安全判定由本脚本自己作出，不依赖 `tar` 的遍历处理——「平台工具通常会拒绝」不是这条契约的实现（`:698-703`）。解压目标仍是系统临时目录下的自建目录，并在退出前（含失败路径）删除（`:605,681-683`）。无论走哪条路径，报告都会打印 `extractor invocations = N`，使「本脚本自己拒绝」与「交给 tar 之后被 tar 拒绝」成为两个可以区分的结论（`:208,472,601,684`）。其余契约是：必需文件在包内（含三份随包文档）、禁止形状不在包内（测试树、夹具树、报告目录、`docs/STATUS.md`、`docs/testing.md`、`docs/manual-acceptance.md`、`.wasm`、source map、图片、归档、凭据文件、绝对或盘符开头的路径等）、随包 prose（`README.md`、`THIRD_PARTY_NOTICES.md`、`docs/*.md`）不携带盘符路径与用户主目录路径、包名正确、`main`/`types`/`exports`/`dsh.bundle.patch` 每一个声明目标都落在包内、以及随包 `README.md` 的每个**相对**链接都能在包内解析（`:106-157,537-597,607-679`）。文本路径审计读的是解压前从归档取出的成员字节，因此不依赖解压（`:360-374,558-597`）。它不评估浏览器 bundle、不运行插件，也不能断言 DSH 会成功加载该包——那是真实应用验收的事（`:29-46`）。它与 `npm pack --dry-run` 的分工是：后者回答「npm 将要打包什么」，前者回答「已产出的这个 tarball 里实际是什么」。

## 2. 浏览器套件

`pnpm test:browser` 是 `playwright test`（`package.json:55`），配置见 `playwright.config.ts:14-35`：`testDir: 'tests/browser'`，`workers: 1`，`fullyParallel: false`，`retries: 0`，reporter 为 `list`，locale 固定 `zh-CN`，`trace: 'retain-on-failure'`。

串行不是保守设置而是前提。这些 spec 驱动的是一份**共享的外部资源**——一个运行中的 DSH web 实例，其 composer 只有一个草稿、会话只有一个——两个 worker 会在同一个 composer 里互相输入并读到对方的状态（`playwright.config.ts:3-13`）。locale 固定为 `zh-CN` 同样有实质原因：DSH 依据浏览器语言解析自己的 locale 并写入 `<html lang>`，而本插件的文案契约命名的是中文字符串，默认 `en-US` 会把整个应用切成英文，使文案断言在测另一张表（`playwright.config.ts:22-32`）。

真实实例通过环境变量 `DSH_SMOKE_URL` 传入。每个 spec 文件在模块顶层读取它并在为空时整文件跳过，例如 `tests/browser/universal-selection.spec.ts:106-108`、`tests/browser/xlsx-selection.spec.ts:54-56`、`tests/browser/pdf-renderer.spec.ts:64-66`。**未设置时，`pnpm test:browser` 仍然可以运行并通常以退出码 0 结束，但每个用例都被 skip，这次运行不构成任何证据**——这正是发布运行必须确认 `DSH_SMOKE_URL` 非空、且报告里 skipped 为 0 的原因。

必需的七个套件及其当前源码中的用例声明数：

| 套件文件 | 覆盖 | 当前 `test(` 声明数 |
| --- | --- | --- |
| `universal-selection.spec.ts` | 跨格式的选中与 Ask 全流程 | 10 |
| `resource-cleanup.spec.ts` | worker、object URL、DOM 与网络的清理 | 6 |
| `xlsx-selection.spec.ts` | 语义单元格选区、`blob:` worker、无宿主路由 | 13 |
| `pptx-selection.spec.ts` | 幻灯片文本选中与幻灯片出处 | 10 |
| `docx-selection.spec.ts` | 渲染文本选中与渲染页出处 | 6 |
| `pdf-renderer.spec.ts` | 文本层选中、页出处、worker 失败关闭 | 10 |
| `real-dsh-textpreview.spec.ts` | 由 DSH 自己 mount 的真实预览上的 Ask 全流程 | 8（7 处声明 + 1 个按两个视口展开的循环用例） |

必需形状是**每个套件 0 failed、0 skipped**。逐套件的下界见第 5 节。

`tests/browser/ask-flow.spec.ts` 是第八个 spec 文件，不属于上述七个套件，也不计入基线。它把预览标记注入活动页面，因此证明的是插件自身行为，而不是真实预览会产出适配器读取的 DOM（`tests/browser/ask-flow.spec.ts:11-35`）；`real-dsh-textpreview.spec.ts` 才不创建任何预览节点、由真实的内建预览产出全部 `data-textpreview-*` 节点，两者必须分开报告，只有后者是 Task 5B 的门禁（`tests/browser/real-dsh-textpreview.spec.ts:6-17`）。

`tests/browser/helpers/shell.ts` 是这些套件共用的外壳准备：它把会话工作区切换到一个注册根，因为夹具地址是会话作用域地址、相对**会话工作区根**解析，工作区不对时每个夹具都会以 `workspace-file/not-found` 失败（`tests/browser/helpers/shell.ts:1-53`）。默认工作区名是一个注册表条目名，不一定等于当前检出目录名；`docs/manual-acceptance.md` 第 2 节记录了由此产生的确认前提。

## 3. 门禁分类

各门禁的性质不同，不能用同一个标准解读，也不能互相替代。

**`pnpm check:dsh-contracts` 是运行时／版本 pin／编译契约门禁。** 它回答的是「这份 checkout 编译与验收所依据的 DSH 运行时与声明，是否仍是它声称支持的那一个」。它给出的是关于环境与契约的结论，不是关于文档安全或渲染正确性的结论。

**`pnpm verify` 是确定性的只读启发式静态门禁，本质是一次文本扫描。** 它**不是**安全证明，也**不是**解析器。它自己的契约写明：每条规则都是表达为字符串或结构匹配的**必要条件**而非充分条件，规则通过只说明它命名的签名没有在被读取的文件中出现——「没有找到 `ReactFiber` 字符串」不能证明不存在其它私有 React 访问，「没有找到 CDN 主机」不能证明运行期不会请求远端资源；真正的正确性门禁是 `pnpm test` 与 `pnpm test:browser`（`scripts/verify.mjs:5-16`）。该声明在每次运行中都打印，成功时也打印（`scripts/verify.mjs:1976-1980`）。它还有两处被自己记录的盲区：`R9` 看不到运行期用变量拼出的 URL（`scripts/verify.mjs:1667-1670`），`R2` 无法度量运行期行为（`scripts/verify.mjs:9-15`）。因此绿色只意味着这些具名签名未被命中，不应被引用为任何运行时性质成立的证据。

**Vitest（`pnpm test`）是单元／客户端／兼容性正确性门禁。** 它在 Node 环境与 jsdom 下判断纯逻辑、适配器契约、渲染器客户端行为与构建产物形状；几何与真实布局行为不属于它，那类断言在 Playwright 中（`AGENTS.md` 的测试规则：浏览器渲染／几何行为属于 Playwright，不属于 jsdom mock）。兼容性探针在这一层由 `pnpm typecheck` 编译，而不是由 Vitest 运行。

**Playwright（`pnpm test:browser`）是真实引擎与真实 DSH 实例上的浏览器行为门禁。** 它是唯一能观察真实选中几何、真实预览 DOM、真实焦点行为与真实网络面的门禁。它需要 `DSH_SMOKE_URL`，未设置时全部跳过。

**`npm pack --dry-run` 与 `pnpm verify:package` 是打包面门禁。** 前者由 npm 自己列出将要打包的内容，后者检查一个已产出的 tarball 的实际内容。二者都不判断运行时行为。

**`docs/manual-acceptance.md` 是真实应用上的最终发布证据，由人在真实 rc.2 Web UI 中执行。** 它不是命令，也不产生机器可判定的退出码；它验证的是交互契约（八种格式的可选中性、草稿保全、无自动提交、无远端请求、渲染器切换、插件禁用与恢复），结果按行记入该轮的状态记录。任何一项 `FAIL` 阻塞发布。

## 4. 本地 tarball 安装与发布验证路径

发布验证要安装的是**将要发布的那个 tarball**，而不是源码工作树。命令序列如下，`<disposable-profile>`、`<port>`、`<path-to-tgz>`、`<token>` 都是占位符。

```bash
pnpm build
pnpm pack
dsh --profile <disposable-profile> --from-default-profile web
dsh plugin --profile <disposable-profile> add <path-to-tgz>
dsh --profile <disposable-profile> --port <port> --no-open
DSH_SMOKE_URL='http://127.0.0.1:<port>/?token=<token>' pnpm test:browser
```

`pnpm build` 必须先于 `pnpm pack`：`files` 允许列表指向 `lib/`，未构建时打出的 tarball 里没有客户端 bundle。`pnpm pack` 产出的文件名由 `package.json` 的 `name` 与 `version` 决定，即 `dsh-document-selection-ask-0.1.0.tgz`，写在仓库根目录。该文件是这棵树自己的构建产物而不是源文件：它不在 `files` 允许列表内，并且被 `.gitignore` 的 `dsh-document-selection-ask-*.tgz` 一行忽略，因此既不要提交它，也不要让上一次的 tarball 被误当成当前候选。打包之后紧接着运行 `pnpm verify:package`（第 1 节）检查这个 tarball 的实际内容：它会检查必需文件、禁止形状、声明入口与随包 `README.md` 的相对链接，早于把它装进 profile，这样打包缺陷在花时间准备实例之前就被发现。

`dsh --profile <disposable-profile> --from-default-profile web` 从随附的 web 模板**创建**一个自定义 profile，随后继续引导它（已安装 DSH 的启动器帮助文本写为 “create rescue from the shipped web template, then boot it”）。因此初始化完成后需要先结束该进程，再执行下一步；对一个已经存在的 profile 重复使用 `--from-default-profile` 会被拒绝（`omit --from-default-profile to use it`），随附模板名也不能作为自定义 profile 名。启动器自身的标志必须排在应用标志之前。

`dsh plugin --profile <disposable-profile> add <path-to-tgz>` 是薄转发器：首次使用时按模板初始化 profile，把剩余参数原样交给 profile 目录中的 `pnpm`（`cwd` 即 profile 目录），随后按**已安装状态**调和 `dsh.profile.bundles`——一个解析到声明了 `dsh.bundle` 的包的依赖会加入层栈，被移除或不再声明该字段的依赖会离开层栈（`@deepseek-ai/dsh` 的 `plugin` 模块，`@module @deepseek-ai/dsh/plugin`）。本插件的 `package.json:36-39` 声明 `dsh.bundle.patch: ./cordis.patch.yml`，且该文件在 `files` 允许列表内，因此这一步之后插件会自动进入 profile 的 bundle 列表，不需要手工编辑 profile 清单。

该转发器会把以 `.` 或 `..` 开头的 path spec 锚定到**调用目录**，绝对路径原样通过；裸文件名两者都不是，pnpm 会在 profile 目录里解析它。因此 `<path-to-tgz>` 应写成绝对路径或以 `./` 开头。

安装用的 profile 必须是可丢弃的，且不能是开发者依赖的任何 profile。profile 内的 `node_modules`、`package.json` 与 `dsh.profile.bundles` 都会被这一步改写，而 `dsh plugin` 只提供 pnpm 自己的动词，没有「停用已装配插件」这一操作。

`dsh --profile <disposable-profile> --port <port> --no-open` 启动实例。启动完成后标准输出会打印一行 `dsh web: http://127.0.0.1:<port>/?token=<token>`（该行由 web 应用在连接就绪后打印，见 `docs/manual-acceptance.md` 第 4 节）；把该行的实际地址填入 `DSH_SMOKE_URL` 后运行 `pnpm test:browser`。**token 是该进程的真实凭据，可以读写该实例的全部会话与文件接口。不要把它写进提交、文档、截图或任何保存下来的文件，也不要在本文或其它文档中把占位符替换成真实值。**

两点必须说清楚。

**tarball 安装是发布证据路径；`link:` 到源码工作树的安装不等价。** `link:` 指向的是工作树本身，`files` 允许列表不会被行使，未提交的改动与过期产物都会参与运行，因此它证明的是「当前这棵树能用」，而不是「将要发布的包能用」。`docs/manual-acceptance.md` 第 3 节描述的是 `link:` 安装的开发路径，可用于人工验收，但不能替代本节的发布验证。

**浏览器套件另外需要测试专用的驱动与夹具，它们不在 tarball 里。** 驱动位于 `tests/browser/smoke-driver/`，是 private、test-only 的独立 DSH 客户端插件，不进入本包 `files`（见第 6 节）；夹具由仓库脚本写进 `smoke-fixtures/`。仓库内的 profile 辅助脚本只维护固定名字 `dsa-smoke` 的清单，对其它 profile 名直接拒绝（`scripts/dsh-smoke-profile.mjs:30-59`），而且它把包链接建在 `dsa-smoke/node_modules` 里 —— 那是一条指向 `web` profile 已安装树的目录链接，所以它会把链接写进共享树，不能用于发布验证 profile。

因此发布验证 profile 的驱动由 ad-hoc 命令装入，全部在发布验证 profile 自己的 `node_modules` 内落位，不触碰共享树。以下四条在 Task 15 的发布验证轮中实际执行过，`<repo>` 是检出目录，`<profile>` 是发布验证 profile 名（该轮为 `dsa-release-t15`）：

```powershell
# 1. 生成夹具。夹具表是 scripts/dsh-smoke-profile.mjs 内的字面量，而该脚本只操作
#    dsa-smoke，并且会把包链接写进 web profile 的共享树；因此用一份改过 REPO_ROOT 的
#    临时副本执行，仓库文件不被修改。
node -e "const fs=require('fs');const s=fs.readFileSync('<repo>/scripts/dsh-smoke-profile.mjs','utf8').replace(\"resolve(dirname(fileURLToPath(import.meta.url)), '..')\",'resolve(process.cwd())');fs.writeFileSync(process.env.TEMP+'/dsa-fixture-writer.mjs',s)"
node "$env:TEMP\dsa-fixture-writer.mjs" prepare
# 2. 把驱动链接建在发布验证 profile 自己的 node_modules 内（不是共享树）
cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\<profile>\node_modules\@dsh-smoke\dsa-smoke-driver" "<repo>\tests\browser\smoke-driver"
# 3. 把 "@dsh-smoke/dsa-smoke-driver" 追加到该 profile 的 dsh.profile.bundles
```

第 1 步的 `prepare` 会运行到脚本自己的末尾：它在两个包上报告 `link=repaired`、把两行写进 `dsa-smoke` 的清单，然后打印验证结论。它的副作用只落在被忽略的 `smoke-fixtures/` 与 `dsa-smoke` 上，夹具本身写入当前检出；发布验证 profile 与共享树不受影响。

第 3 步是必需的：loader 只装配 `dsh.profile.bundles` 里列出的层，链接本身不会让它加载。**只有驱动与夹具允许来自本仓库检出**；被测插件必须来自第 4 节的 tarball，否则这次运行就退回成 `link:` 安装，失去本节要证明的性质。

夹具地址相对**会话工作区根**解析，因此还要确认实例的工作区根指向夹具所在的那棵树；`tests/browser/helpers/shell.ts:34` 的默认工作区名是注册表条目名，不一定等于检出目录名（`docs/manual-acceptance.md` 第 2 节记录了这一点）。若两棵树不是同一个工作副本，先确认 `smoke-fixtures/` 下同名文件逐字节相同再开始。

## 5. 当前浏览器基线

下表的数字是 **Task 14 在真实 DSH `0.1.5-rc.2` 上的历史实测基线**（profile `dsa-smoke`，`DSH_SMOKE_URL` 非空，`--workers=1`），逐套件来源为 `docs/STATUS.md` 的 “Task 14 primary rc.2 browser matrix” 条目；`docs/07-testing-strategy.md` 第 9 节记录了同一组数字的 63 / 0 / 0。**Task 15 与 Task 15U 已针对 tarball 安装的插件复测过这组数字**；本文固定的是必需形状与历史基线，某一轮实际跑出的逐套件数值由该轮的 `docs/STATUS.md` 条目记录，本文不预填。

`required matrix` 不是 `pnpm test:browser` 的全部。该命令收集 `tests/browser/` 下的每一个 spec，因此完整集合是 `required matrix` + `ui-release` + `ask-flow` 三者之和。以 Task 15U 之后的声明数为准：`63 + 17 + 7 = 87`。报告 `pnpm test:browser` 的结果时只写 63 会把两个真实套件从证据里抹掉，因此三部分必须分开列出（见 `docs/STATUS.md` 的 Task 15U 与 Task 15UR 条目）。

| Suite | Required |
| --- | --- |
| universal-selection | >= 10 passed / 0 failed / 0 skipped |
| resource-cleanup | >= 6 / 0 / 0 |
| xlsx-selection | >= 13 / 0 / 0 |
| pptx-selection | 10 / 0 / 0 |
| docx-selection | 6 / 0 / 0 |
| pdf-renderer | 10 / 0 / 0 |
| real-dsh-textpreview | 8 / 0 / 0 |
| required matrix total | 63 / 0 / 0 |
| ui-release | 17 / 0 / 0 |
| ask-flow | 7 / 0 / 0 |
| `pnpm test:browser` total | 87 / 0 / 0 |

“Required” 一列的判读方式：`>=` 表示该套件允许增加用例，通过数不得低于该值；等号表示该套件当前声明的用例数就是要求数。任一列出现非零 failed 或非零 skipped 即使通过数达标也不成立。上表的用例数与各文件当前声明的 `test(` 数一致（第 2 节的表），其中 `real-dsh-textpreview` 的 8 来自 7 处声明加一个按两个视口展开的循环用例。

## 6. 夹具与测试驱动

夹具由仓库自己的脚本生成，不从网络下载，这一点在四份格式 README 中均有明确表述。PDF、DOCX、PPTX、XLSX 的夹具已提交在 `tests/fixtures/**`，生成器分别是 `scripts/generate-pdf-fixtures.mjs`、`scripts/generate-docx-fixtures.mjs`、`scripts/generate-pptx-fixtures.mjs`、`scripts/generate-xlsx-fixtures.mjs`。确定性的证据强度各不相同，需要分开陈述：PDF 生成器把文档元数据固定到一个不变日期、自己不写时间戳，因此同一输入两次运行产出逐字节相同的文件（`tests/fixtures/pdf/README.md:21-33`）；DOCX 与 XLSX 的 README 声明其生成器是确定性的；其中只有 XLSX 的确定性被测试断言——`tests/unit/xlsx-fixtures.spec.ts:305-316` 比较生成器两次调用的输出，并断言已提交 workbook 中的 media part 与生成器输出逐字节相等。PPTX 夹具由生成器产出并提交，套件中没有对应的可复现性断言。文本、CSV 夹具，以及 `task11-corrupt.xlsx` 这一份**故意损坏的 XLSX**，由 `pnpm smoke:profile prepare` 按字面量写入 `smoke-fixtures/`（`scripts/dsh-smoke-profile.mjs:99-148`），该目录被 `.gitignore` 忽略，每次运行重新生成而不是提交副本。损坏夹具不是提交的二进制，而是表中的一串字节（`PK\x03\x04` 之后即为结尾），因为它的作用正是让产品走到 `.dsa-xlsx-error` 这一条拒绝路径；该路径是暗色主题下失败文案对比度唯一的真实观测面，写成一个字面量可以让读者直接看到被拒绝的是哪些字节。

OOXML 的安全夹具不以归档文件形式提交：元数据边界与恶意路径由测试代码在内存中构造，以便性质本身可以在 diff 中被审阅；两个构造器是 `tests/helpers/ooxml-zip.ts` 中的 `buildZip` 与 `buildMetadataZip`（`tests/fixtures/ooxml/README.md:1-45`）。

真实预览 spec 依赖一个测试专用的伴随驱动包，位于 `tests/browser/smoke-driver/`。它的事实如下，均可在仓库内核对：包名 `@dsh-smoke/dsa-smoke-driver`，`"private": true`，`version: 0.0.0`，描述自述为 test-only（`tests/browser/smoke-driver/package.json:1-17`）；它**不 import 被测插件**——其客户端源码的全部导入只有 DSH 的公开包、React 类型与它自己的模块（`tests/browser/smoke-driver/src/client/index.tsx:28-34`，`tests/browser/smoke-driver/src/client/SmokeDriverControl.tsx:55-59`）；它只调用一个公开导航 API `ctx.sidebarRight.openResource(address)`，并在调用中显式指定产品内建文档预览注册的 kind，因为实例上可能存在优先级更高的文件查看器（`tests/browser/smoke-driver/src/client/SmokeDriverControl.tsx:1-53`）。它由 `tsdown.smoke-driver.config.ts` 单独构建，该配置刻意镜像主插件的 loader 封装契约，并同样产出一个惰性的宿主产物，因为 loader 行缺少宿主入口会导致启动失败（`tsdown.smoke-driver.config.ts:1-61`）。

该驱动不在发布内容中：`package.json:24-35` 的 `files` 允许列表不含 `tests/`，`pnpm verify` 的 `R10` 也拒绝发布面出现测试树（`scripts/verify.mjs:1688-1719`），`pnpm verify:package` 则拒绝 tarball 内出现 `tests/` 形状（`scripts/verify-package.mjs:93-114`）。它只存在于被准备的 smoke profile 中。

## 7. 与其它文档的分工

本文只写机制与判据。某一轮实际跑出什么数值，记入 `docs/STATUS.md`；人工验收的逐步操作、判据与结果记录格式，见 `docs/manual-acceptance.md`；测试覆盖应当包含哪些类别，见 `docs/07-testing-strategy.md`；本文所描述机制的安全含义与限制，见 `docs/security.md`。把某一轮的结论写回本文会让机制与结论互相污染，因此不要这样做。
