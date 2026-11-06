# 平台版本与独立发布迁移

`release-versions.json` 是客户端版本的唯一人工入口。只修改本次交付的平台；Android 还需增加 `versionCode`（正整数，最大 2100000000），已公开的码不能分配给不同安装包。版本使用严格的 `major.minor.patch`，首期只接受 stable。

## 当前进度

- 阶段 A：版本配置、平台与目标解析、只读检查、版本注入、平台日志、本地入口和 CI 已接入。
- 阶段 B：平台桌面更新器、新清单、GitHub 分页兜底和旧格式生成器已实现，并通过模拟升级与故障测试。
- 阶段 C：三条独立工作流、制品身份与正式签名校验、单平台构件、draft 发布与重试保护、原子部署工具已实现；已创建 [PR #17](https://github.com/C1ouDreamW/qlu-toolbox/pull/17) 并启动 CI 与构建演练，结果以该 PR 的 Checks 为准。
- 阶段 D：选择桌面桥接版本、真实安装与升级链实测、生产切换，待实施。

现有 `release.yml` 仍由旧 `v*` 标签触发，仍是三端共同发布；它要求标签与三端配置分别一致，版本准备与本地使用相同脚本。三个独立工作流已登记对应标签，但 `release-migration.json` 中 `independentPublishingEnabled: false` 会在首个构建步骤阻止发布。不要提前创建 `win-v*`、`mac-v*`、`android-v*` 标签。阶段 A 的本地准备允许三端版本不同，不代表旧发布流程已经支持这种状态。

## 基线核对（2026-11-05）

[公开 Release v2.0.4](https://github.com/C1ouDreamW/qlu-toolbox/releases/tag/v2.0.4) 含 Windows x64 安装包、ZIP、macOS arm64 DMG 与 Android APK；Release API 可见的最新正式发布为该版本。
[桌面主源](https://lumatile.ishua.cloud/stable/desktop.json) 的版本为 2.0.4；[Android 主源](https://lumatile.ishua.cloud/stable/android.json) 为 2.0.4 / code 15，其 APK 大小 6447321 字节、SHA-256 `850b722d48193719a2fd7aa58e862f5c598fee5f61ce48e5e656137c293e3bbf` 与 GitHub 资产 digest 一致。

这是公开元数据核对。正式签名链、线上文件内容、Windows/macOS 安装和 Rosetta 用户分布仍需在桥接前验证；基线不预先升版，也不代表已完成生产迁移。桥接版本必须高于已发布的桌面版本。

## 准备与检查

先 `npm ci`；桌面再 `uv sync --locked`、`uv lock --check`，然后准备目标版本。安装锁定依赖后才注入版本，不执行 `npm version` 或重新解析依赖，不修改 `pyproject.toml` / `uv.lock` 的内部工程版本。

```bash
# 只读：校验配置、目标并列出将修改的版本载体，不写文件
npm run release:prepare -- --platform windows --check

# 注入：windows / macos / android；--platform host 只接受原生桌面目标
npm run release:prepare -- --platform macos

# 只读：要求所有本端版本载体已经与配置一致，否则失败
npm run release:prepare -- --platform macos --verify

# 新发布逻辑的预检（尚未接入自动发布）；同时要求本端非空版本日志
npm run release:prepare -- --platform macos --target macos-arm64 --tag mac-v2.0.5 --check
node scripts/extract-release-notes.mjs macos mac-v2.0.5 release-notes.md
```

最后两条中的示例要求先设置 macOS 配置为 2.0.5，并在 `changelogs/macos.md` 添加对应版本说明。标签必须精确匹配本平台配置，拒绝旧标签、跨平台标签及预发布版本。Windows 目标为 `windows-x64`，Android 为 `android`。不支持的桌面主机（含 Rosetta 下的 darwin/x64）必须使用原生支持架构，不能推测架构。

Windows/macOS 准备只写根 `package.json`、锁文件的根版本记录与 Python `__version__`；Android 只写移动 package 与锁文件工作区版本记录，Gradle 直接读配置。仓库中的这些载体是构建模板，可暂时与其他端版本不同。

推荐在临时 checkout 中构建。直接在工作区执行时，会保留其他字段与用户修改，并显示改动文件；脚本不会重置已有修改。准备完成后用 `git diff` 检查，不将临时版本注入作为新的人工版本入口。只读检查不会输出更新源清单或发布任何文件。

## 本地入口与版本一致性

`npm run dev` 自动按原生桌面主机准备版本；`dist`、`dist:zip`、`dist:installer` 固定 Windows x64，`dist:mac` 固定 macOS arm64。Python worker 必须在相应原生主机上构建，脚本的版本注入功能本身可跨平台验证。

`npm run mobile:dev`、`npm run mobile:build` 自动准备 Android；`npm run mobile:sync` 校验载体后同步。Vite 输出 `lumatile-version.json`，Gradle 在 preBuild 时检查已同步的 Web 版本与 code 是否与原生配置一致；版本变化后必须重新 build 和 sync，不能沿用旧 Web 资源。界面继续读取被注入的移动 package 版本，桌面界面继续读取 Python bootstrap。

CI 保留三端原有检查名称，在依赖安装后准备本端并校验，发布基础测试覆盖不同平台版本互不覆盖。当前校验不替代安装包真实元数据、签名及旧版升级链的后续验收。

## 阶段 A 验证记录（2026-11-05）

- `npm run test:release`：10 项通过，覆盖不同平台版本、只读模式、失败前置校验、用户其他字段保留、重复执行和锁文件依赖记录不变。
- `npm run test:desktop`：14 项通过；`npm run build`、`npm run mobile:build`、`npm run mobile:sync` 通过，Web 输出与同步目录均为 Android 2.0.4 / code 15。
- Python 测试：运行 119 项，11 项跳过，其余通过；补充 bootstrap 与桌面 package 版本一致性断言后，Bridge 4 项回归通过。`uv lock --check` 通过。
- 临时目录中设置 Windows 2.0.5、macOS 2.0.6、Android 2.0.7 / code 16，分别准备后执行 `npm ci --dry-run --ignore-scripts --offline`，三次均通过；验证了锁文件可安装性预检，未将这些示例版本写入仓库。
- 两份修改后的工作流通过 YAML 解析和 `git diff --check`。原生安装包、签名及 GitHub Actions 尚未执行；本机缺少 JDK 21 / Android SDK，原生 APK 构建及 Gradle 版本拒绝路径仍需在 Android CI 验证。

2026-11-06：使用已配置的 Corretto JDK 21 与 Android SDK 36，`lintDebug testDebugUnitTest assembleDebug` 本地通过。正式签名及旧客户端覆盖升级仍留待桥接验收。

缺少同步的 Web 元数据、或 versionCode 与原生配置不同的两个负向 Gradle 测试均按预期失败，测试后已恢复生成资源。`aapt dump badging` 与 APK 内 Web 元数据均确认为 2.0.4 / code 15。

## 更新协议与桥接配置

新桌面入口为 `stable/windows-x64.json`、`stable/macos-arm64.json`（schema 2）。下载地址必须精确匹配本平台、架构、标签和文件名；`publishedAt`、commit、SHA-256 和文件大小均须有效。不支持的主机架构会直接说明，不推荐其他架构包。桌面仍然只打开下载地址，不宣称实现下载后的哈希校验。

GitHub 兜底分页列出 Release、按严格数字版本排序，排除 draft、预发布和其他端。它读取 `update-<target>.json`，检查远程标签 commit、资产名称、大小和可用的 GitHub digest，再使用清单中的 GitHub 下载地址。最高版本缺少有效资产时继续寻找其他候选；列表失败、限流或没有可核验的较新候选时报告不可用。

`release-migration.json` 的 `bridgeVersion` 当前为 `null`，因此任何旧 `v*` Release 都不会被新客户端当作普通独立更新。阶段 D 须选择高于已发布桌面的 B，在同一份配置中明确登记 B。届时新清单和客户端只额外允许 `vB`，桥接安装包继续使用旧文件名。`generate-legacy-desktop-update-manifest.mjs` 单独保留 schema 1，要求 Windows/macOS 两个匹配版本的产物；新生成器每次只需要目标端产物。

生成独立桌面清单时，CLI 从实际 Git 标签的 commit 读取版本配置，要求标签指向 HEAD，再从实际安装包计算校验值。平台日志提取仍使用同一纯逻辑。桥接生成器允许显式登记的 `vB`；旧 `stable/desktop.json` 在阶段 D 切换后冻结于 B，并长期保留下载文件。旧客户端在主源断开时的内置兜底限制仍然存在，需要手动桥接下载指引。

## 独立发布构件与恢复

三个工作流分别只构建本端，使用平台/stable 并发组且不取消正在上传的发布。依赖先锁定安装，再准备版本；打包后核对 Windows 原生元数据、Electron/Python 版本，或 macOS 挂载 DMG、arm64 与签名，或 Android 原生/Web 版本与正式证书。

Android 的正式证书 SHA-256 已从公开 2.0.4 APK 核实为 `5ed4182baad6566311708db3699f13615f791811b389e5163917dd89ec4b3899`，记录于迁移配置。该 APK 内容哈希与前述基线一致，`apksigner verify` 确认 v2 签名有效；后续签名不同的 APK 会被拒绝，Debug 包不能作为正式产物发布。

每端生成 `update-source-<platform>-<version>`，其中 stable 只含本端文件，releases 目录包含安装包、对应更新清单、`release-record.json`、更新说明和 `SHA256SUMS.txt`。Android 的主源/备用清单复用同一 APK，只改变下载 URL。构件先上传供失败恢复，再执行发布。

发布脚本在创建 draft 前及公开前分别检查主源和已有 GitHub 发布的单调性；Android 还检查可达的两个 raw 备用清单及既有独立 Release 的 versionCode。同标签已有文件时核对实际哈希，禁止覆盖；已公开 Release 必须完整且所有哈希一致才视为可复用。缺失 digest 时下载远端资产核验。失败保留 draft，不公开半份安装包。

重试应下载已上传的完整构件，校验 `SHA256SUMS.txt`，在该标签 checkout 运行以下命令，不重新构建或用 `--clobber` 替换资产：

```bash
# 仅在完成桥接、正式启用门禁并确实需要发布时执行；需要 contents-write 的 GITHUB_TOKEN
node scripts/publish-platform-release.mjs windows win-vX.Y.Z update-source/releases/win-vX.Y.Z
```

同版本重新构建（尤其 DMG）可能产生不同哈希，不能直接替换 draft 中的旧文件；应复用原构件。确需更改公开产物时升补丁版本，Android 同时增加 code。Android 备用清单使用单独 worktree 生成分支及 PR 链接，生成前与最新 main 清单核验单调性；合并前还须确认没有更高 code 已合入，保留 main 的必需检查；不会自动部署服务器。

当阶段 D 的两端旧版主源升级、桥接后单端升级和主源断开兜底均实测通过，才能将 `independentPublishingEnabled` 设为 `true` 并提交。开关与 B 都从发布标签所指 commit 读取，临时修改工作区不能绕过。启用后旧三端发布工作流会主动失败。桥接标签 B 会保留给后续一次性的桌面桥接入口，不再通过旧流程附带发布 Android。

## 阶段 B / C 验证记录（2026-11-06）

- 桌面测试 30 项通过，包含超过 100 条无关发布后的分页、两端隔离、严格版本、无效/缺失清单、GitHub 限流、主源故障、远程 commit/哈希冲突和显式桥接链的模拟数据。
- 发布测试 29 项通过，包含单平台构件、APK 多源同包、只替换本端 stable、两端并行部署、迟到旧版拒绝、同码冲突、draft 补齐重试、已公开资产不可覆盖、上传后再次检查单调性，以及缺少 digest 时校验远端文件内容。
- `npm run build`、类型检查、`uv lock --check`、锁文件离线安装预检，以及修改后工作流的 YAML 解析和 `bash -n` 通过。本机 actionlint 安装遇到下载超时及模块校验服务访问失败，未运行完整 actionlint；仍须通过 Actions 演练验证。真实的 Windows/macOS 发布制品、正式签名的新 APK、GitHub draft/公开上传和服务器切换尚未执行；不能以模拟测试替代阶段 D 的安装与迁移验收。

## CI 与非公开构建演练

2026-11-06 已推送实施分支并创建草稿 PR #17。首轮 Windows 验证通过；macOS job 因旧 runner 不可用而取消。GitHub 已在 2026-11-02 [退役 macOS 14 镜像](https://github.com/actions/runner-images#available-images)，相关入口已迁移到 `macos-15`，仍要求 `uname -m`、Electron 和 Python worker 为 arm64，未改变交付架构。CI 另增加独立的 Workflow verification，使用固定版本 actionlint 校验所有工作流。

`release-rehearsal.yml` 在发布相关源码发生 PR 变更时运行，也提供 `workflow_dispatch` 入口（合入默认分支后可手动选择目标 ref）。三个 job 独立构建 Windows NSIS/ZIP、macOS ad-hoc DMG 与正式签名 Android APK，复用正式制品的版本、架构、证书与 bootstrap 核验。fork PR 不运行正式 Android 签名 job；同仓库 PR 使用已有 Android Secrets，私钥文件只在签名步骤存在并在退出时删除。

演练直接读取 HEAD commit 中的版本和迁移配置，不创建 Git 标签，也不要求开启发布开关或填写正式版本日志。输出只有 `LumaTile-Rehearsal-*` 安装包、`rehearsal-record.json` 与 SHA256SUMS，作为保存 7 天的 Actions 构件；不生成 stable 清单、Release、部署分支或服务器操作。

演练身份与 verification 均标记 `purpose: rehearsal`、`deployable: false`，正式清单构建器和发布器会拒绝此身份。演练包使用源配置的版本号/code，不能作为同版本的正式替换包推广。安装测试前须选择适当的隔离测试设备或环境；阶段 D 的正式桥接与安装验证仍须使用独立记录。

演练入口示例（CI 会先完成实际打包）：

```bash
node scripts/rehearse-release.mjs macos
node scripts/verify-release-build.mjs --rehearsal macos /path/to/LumaTile.app verification.json
node scripts/rehearse-release.mjs macos --record verification.json artifacts rehearsal-output
```

新增演练隔离、发布拒绝、PE 架构与 Windows 四段资源版本测试后，发布测试为 34 项；桌面测试仍为 30 项。Windows 资源中的第四段属于构建号，核验前三段与应用版本一致，并保留原始资源版本供追溯。

本机已校验官方 actionlint 1.7.7 压缩包的 SHA-256 并完成全部工作流检查。首轮 DMG 演练暴露 electron-builder 默认跳过 PR 签名的问题；Mac CI 与演练 job 已为现有 `identity: "-"` 显式启用 PR ad-hoc 签名，不传入开发者证书或私钥。真实三端制品的最新结果见 PR Checks 和对应 rehearsal 构件。
