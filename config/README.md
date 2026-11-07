# 平台版本与独立发布迁移

`release-versions.json` 是客户端版本的唯一人工入口。schema 2 按平台分别登记 `stable` / `alpha`；Stable 严格使用 `major.minor.patch`，Alpha 使用 `major.minor.patch-alpha.N`（N 为正整数），Debug 从本平台 Alpha 基础版本派生 `major.minor.patch-debug.0`，不创建发布标签。

Android 两个独立应用 ID 各自维护单调递增的 `versionCode`（正整数，最大 2100000000），已公开的码不能分配给不同安装包；桌面各渠道另有 `buildNumber`。现有 Stable 2.0.4 / Android code 15 保留，新增 Alpha 2.1.0-alpha.1 是待验证的开发配置，不代表已经公开发布。构建准备会生成完整身份并注入原生字段；Debug 运行时隔离已接入，Alpha 的公开更新与发布仍需继续完成。

渠道契约集中在 `electron/channel-contract.mjs`，包含严格版本解析、Alpha 数字序号比较、独立应用 ID / 数据命名空间，以及 Debug 禁用更新和统计的规则。历史 schema 1 标签仍可由辅助脚本读取，新源码统一使用 schema 2。任何实际发布前重新核对线上版本、原生构建号和签名；不以本次配置迁移重发同版本产物。

## 当前进度

桥接身份和前置核验已新增独立入口 `scripts/validate-desktop-bridge.mjs v<B>`：只接受不可变标签 commit 中明确登记的 B，要求 Windows / macOS Stable 同版本、显式原生构建号、主线来源、两端独立的 Alpha 晋级审查及公开 Alpha 资产，不要求 Android 同步版本。该入口只读，不创建标签、构件或 Release；完整双端桥接构建 / 归档 / 发布与推广仍待接入，不能拿单平台发布器发布半个桥接版本。

迁移配置新增三个默认关闭的状态：`desktopBridgePublishingEnabled` 允许发布指定桥接 B；`desktopCutoverEnabled` 表示允许受控首次桌面切换；`desktopMigrationComplete` 记录两端链路已验收完成。B 为空时不能启用任何状态，完成状态必须伴随受控切换、并关闭桥接发布。当前 B 仍为 null，三个状态均为 false；不把声明字段存在视为真实验收完成。受控切换的证据绑定和发布门禁仍需后续实现。

- 阶段 A：版本配置、平台与目标解析、只读检查、版本注入、平台日志、本地入口和 CI 已接入。
- 阶段 B：平台桌面更新器、新清单、GitHub 分页兜底和旧格式生成器已实现，并通过模拟升级与故障测试。
- 阶段 C：三条独立工作流、制品身份与正式签名校验、单平台构件、draft 发布与重试保护、原子部署工具已实现；已创建 [PR #17](https://github.com/C1ouDreamW/qlu-toolbox/pull/17) 并启动 CI 与构建演练，结果以该 PR 的 Checks 为准。
- 阶段 D：选择桌面桥接版本、真实安装与升级链实测、生产切换，待实施。

现有 `release.yml` 仍由旧 `v*` 标签触发，但 Android job 在安全整改期间保持关闭，旧组合发布不会完成；它要求标签与三端配置分别一致，版本准备与本地使用相同脚本。三个独立工作流已登记对应标签，但 `release-migration.json` 中 `independentPublishingEnabled: false` 会在首个构建步骤阻止发布。不要提前创建 `win-v*`、`mac-v*`、`android-v*` 标签。阶段 A 的本地准备允许三端版本不同，不代表旧发布流程已经支持这种状态。

## 基线核对（2026-11-05）

[公开 Release v2.0.4](https://github.com/C1ouDreamW/qlu-toolbox/releases/tag/v2.0.4) 含 Windows x64 安装包、ZIP、macOS arm64 DMG 与 Android APK；Release API 可见的最新正式发布为该版本。
[桌面主源](https://lumatile.ishua.cloud/stable/desktop.json) 的版本为 2.0.4；[Android 主源](https://lumatile.ishua.cloud/stable/android.json) 为 2.0.4 / code 15，其 APK 大小 6447321 字节、SHA-256 `850b722d48193719a2fd7aa58e862f5c598fee5f61ce48e5e656137c293e3bbf` 与 GitHub 资产 digest 一致。

这是公开元数据核对。正式签名链、线上文件内容、Windows/macOS 安装和 Rosetta 用户分布仍需在桥接前验证；基线不预先升版，也不代表已完成生产迁移。桥接版本必须高于已发布的桌面版本。

## 准备与检查

先 `npm ci`；桌面再 `uv sync --locked`、`uv lock --check`，然后准备目标版本。安装锁定依赖后才注入版本，不执行 `npm version` 或重新解析依赖，不修改 `pyproject.toml` / `uv.lock` 的内部工程版本。

```bash
# 只读：校验配置、目标并列出将修改的版本载体，不写文件
npm run release:prepare -- --platform windows --channel stable --check

# 注入：windows / macos / android；--platform host 只接受原生桌面目标
npm run release:prepare -- --platform macos --channel stable

# 只读：要求所有本端版本载体已经与配置一致，否则失败
npm run release:prepare -- --platform macos --channel stable --verify

# 新发布逻辑的预检（尚未接入自动发布）；同时要求本端非空版本日志
npm run release:prepare -- --platform macos --channel stable --target macos-arm64 --tag mac-v2.0.5 --check
node scripts/extract-release-notes.mjs macos mac-v2.0.5 release-notes.md
```

最后两条中的示例要求先设置 macOS 配置为 2.0.5，并在 `changelogs/macos.md` 添加对应版本说明。标签必须精确匹配本平台配置，拒绝旧标签、跨平台标签及不匹配渠道的版本。Alpha 准备需显式传入 `--channel alpha`，匹配 `mac-alpha-v2.1.0-alpha.1` 等标签；Alpha 发布工作流和更新器已接入，公开发布与设备升级验收尚待完成。Windows 目标为 `windows-x64`，Android 为 `android`。不支持的桌面主机（含 Rosetta 下的 darwin/x64）必须使用原生支持架构，不能推测架构。

Windows/macOS 准备写根 package / 锁文件版本、Python `__version__`、构建器的渠道应用身份与原生版本映射，并生成 `lumatile/build-info.json`；Android 写移动 package / workspace 锁文件版本，生成 `apps/mobile/build-info.json`，Gradle 读取同一份身份。生成的两个 JSON 被 Git 忽略，PyInstaller / Electron 构建会将目标信息嵌入产物。仓库中的这些载体是构建模板，可暂时与其他端版本不同。

推荐在临时 checkout 中构建。直接在工作区执行时，会保留其他字段与用户修改，并显示改动文件；脚本不会重置已有修改。准备完成后用 `git diff` 检查，不将临时版本注入作为新的人工版本入口。只读检查不会输出更新源清单或发布任何文件。

## 本地入口与版本一致性

日常 CLI、`npm run dev`、移动端开发 / Web 构建默认选择 Debug；发布工作流显式设置 `LUMATILE_BUILD_CHANNEL=stable`。`--verify` 在未指定渠道时核验最后一次生成的构建身份。需要其他渠道时使用 `--channel` 或该构建环境变量。

`npm run dev` 自动按原生桌面主机准备 Debug；`dist`、`dist:zip`、`dist:installer` 固定 Windows x64，`dist:mac` 固定 macOS arm64。Python worker 必须在相应原生主机上构建，脚本的版本注入功能本身可跨平台验证。

`npm run mobile:dev`、`npm run mobile:build` 自动准备 Android；`npm run mobile:sync` 校验载体后同步。Vite 输出 `lumatile-version.json`，Gradle 在 preBuild 时检查同步资源的渠道、ID、版本、code 与 commit 是否一致；版本变化后必须重新 build 和 sync，不能沿用旧 Web 资源。界面继续读取被注入的移动 package 版本，桌面界面继续读取 Python bootstrap。

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

`independentPublishingEnabled` 仍为 `false`，须在维护人批准对应 Stable 独立发布时启用。Android 只检查自身来源、签名与晋级条件，不要求桌面 B 就绪；Windows / macOS 额外要求桥接 B 及相应旧版升级、独立更新和主源断开兜底验收。开关与 B 都从发布标签所指 commit 读取，临时修改工作区不能绕过。启用后旧三端发布工作流会主动失败。桥接标签 B 会保留给后续一次性的桌面桥接入口，不再通过旧流程附带发布 Android。

## 阶段 B / C 验证记录（2026-11-06）

- 桌面测试 30 项通过，包含超过 100 条无关发布后的分页、两端隔离、严格版本、无效/缺失清单、GitHub 限流、主源故障、远程 commit/哈希冲突和显式桥接链的模拟数据。
- 发布测试 29 项通过，包含单平台构件、APK 多源同包、只替换本端 stable、两端并行部署、迟到旧版拒绝、同码冲突、draft 补齐重试、已公开资产不可覆盖、上传后再次检查单调性，以及缺少 digest 时校验远端文件内容。
- `npm run build`、类型检查、`uv lock --check`、锁文件离线安装预检，以及修改后工作流的 YAML 解析和 `bash -n` 通过。本机 actionlint 安装遇到下载超时及模块校验服务访问失败，未运行完整 actionlint；仍须通过 Actions 演练验证。真实的 Windows/macOS 发布制品、正式签名的新 APK、GitHub draft/公开上传和服务器切换尚未执行；不能以模拟测试替代阶段 D 的安装与迁移验收。

## CI 与非公开构建演练

2026-11-06 已推送实施分支并创建草稿 PR #17。首轮 Windows 验证通过；macOS job 因旧 runner 不可用而取消。GitHub 已在 2026-11-02 [退役 macOS 14 镜像](https://github.com/actions/runner-images#available-images)，相关入口已迁移到 `macos-15`，仍要求 `uname -m`、Electron 和 Python worker 为 arm64，未改变交付架构。CI 另增加独立的 Workflow verification，使用固定版本 actionlint 校验所有工作流。

`release-rehearsal.yml` 在发布相关源码发生 PR 变更时运行，也提供 `workflow_dispatch` 入口（合入默认分支后可手动选择目标 ref）。三个 job 独立构建 Windows NSIS/ZIP、macOS ad-hoc DMG 与独立 `.debug` Debug Android APK。2026-11-07 安全修复已移除所有 PR 演练的长期 Secret 引用，同仓库 / fork PR 均只用 Debug key，并核验实际包名、可调试标记和 runner Debug 证书。正式签名使用仓库 Secrets 的独立构建 / 签名 / 发布任务，详见 [签名规则](../docs/release-security.md)。

演练直接读取 HEAD commit 中的版本和迁移配置，不创建 Git 标签，也不要求开启发布开关或填写正式版本日志。输出只有 `LumaTile-Rehearsal-*` 安装包、`rehearsal-record.json` 与 SHA256SUMS，作为保存 7 天的 Actions 构件；不生成 stable 清单、Release、部署分支或服务器操作。

演练身份与 verification 均标记 `purpose: rehearsal`、`deployable: false`，正式清单构建器和发布器会拒绝此身份。演练包使用源配置的版本号/code，不能作为同版本的正式替换包推广。安装测试前须选择适当的隔离测试设备或环境；阶段 D 的正式桥接与安装验证仍须使用独立记录。

演练入口示例（CI 会先完成实际打包）：

```bash
node scripts/rehearse-release.mjs macos
node scripts/verify-release-build.mjs --rehearsal macos "/path/to/LumaTile Debug.app" verification.json
node scripts/rehearse-release.mjs macos --record verification.json artifacts rehearsal-output
```

新增演练隔离、发布拒绝、PE 架构与 Windows 四段资源版本测试后，发布测试为 34 项；桌面测试仍为 30 项。Windows 资源中的第四段属于构建号，核验前三段与应用版本一致，并保留原始资源版本供追溯。

本机已校验官方 actionlint 1.7.7 压缩包的 SHA-256 并完成全部工作流检查。首轮 DMG 演练暴露 electron-builder 默认跳过 PR 签名的问题；Mac CI 与演练 job 已为现有 `identity: "-"` 显式启用 PR ad-hoc 签名，不传入开发者证书或私钥。真实三端制品的最新结果见 PR Checks 和对应 rehearsal 构件。

2026-11-07 渠道版本基础：发布测试 49 项、actionlint 通过，新增 Alpha 严格解析、序号比较、三渠道身份及 schema 1 历史兼容测试。现有四项正式仓库 Secrets 保持不变，不引入 Environment；本地正式密码找回不阻塞开发。

## Debug 运行时隔离（2026-11-07）

Debug / Alpha 使用独立的应用 ID、产品名、可执行名称、NSIS 快捷方式和默认目录、macOS `.app` 名称及 Electron 单实例数据空间。Stable 保留原应用身份与用户路径；Python 的配置、数据库、日志、浏览器 profile / 组件目录也按同一渠道分开。应用读取打包后的身份，不能靠运行环境变量把 Debug 改成 Stable。

桌面 bootstrap 的完整用户版本与原生数字版本分别校验：macOS 短版本为基础三段，构建版本为渠道 buildNumber；Windows 数字 FileVersion 为三段基础版本加 buildNumber，ProductVersion 与完整用户版本或基础版本匹配。关于页显示完整渠道版本，Debug 默认关闭在线更新 / 公告与统计。

Windows 开发脚本固定生成 / 安装 `.debug`，不再接受 `.test` 自定义后缀或占用正式 ID 的 NoCoexist。CI 保持原有必需检查名称，并新增 PowerShell 辅助脚本解析；PR 演练的桌面包也使用 Debug 身份，不能推广为正式产物。

阶段 1 本地验证：发布 / 渠道测试 51 项、桌面测试 31 项、Python 124 项（11 项因环境跳过）通过，类型检查与 actionlint 通过。实际 Android Debug APK 通过 lint / 单测、包名 / 版本 / Web 元数据 / Debug 证书核验；macOS arm64 Debug `.app` 通过 ad-hoc 签名、原生版本、嵌入身份和打包 worker bootstrap 核验。DMG 构建器在本机下载工具包后无进一步输出，任务已取消，DMG 与 Windows 产物仍须由 CI 验证，不计为本地通过。

## Alpha 更新与发布工具（2026-11-07）

Alpha 使用 `win-alpha-vX.Y.Z-alpha.N`、`mac-alpha-vX.Y.Z-alpha.N`、`android-alpha-vX.Y.Z-alpha.N`；严格按数字比较 Alpha 序号，拒绝 beta、Debug、前导零和附加版本修饰。桌面与 Android 客户端只请求本渠道清单；GitHub 兜底同时检查本平台标签与 prerelease 标志，并核验清单、源码 commit 和安装资产。Debug 在发出网络请求前拒绝在线更新。

Android 现有 Stable raw 地址保持 `updates/android.json`，Alpha 使用 `updates/android-alpha.json`，主源分别为 `/stable/android.json` 与 `/alpha/android.json`。新清单保留 schema 1 并增加 tag / commit；客户端仍允许历史 Stable raw 清单，GitHub 独立发布候选必须提供可核验的源码身份。同 code 多源 APK 元数据冲突时拒绝更新；原生安装前仍校验包名、已安装应用的签名、code、Release 标记和版本渠道。

`alphaPublishingEnabled` 是独立显式开关，目前为 `false`；不受桌面 Stable 桥接完成状态影响。`androidAlphaSigningSha256` 已登记维护人在 Windows 生成的长期 Alpha 证书公开指纹 `2fa1b1662922a1bd7c14d39077b6f2f0883107cd42b0172637fa9f72500ddc04`，与正式证书不同。维护人已报告四项 Alpha 仓库 Secrets 配置完成；维护人已确认备份完成；恢复核验、Secret 有效性和实际签名仍未验收。现有四项正式仓库 Secrets 不变。

构件工具支持单平台单渠道，Alpha 文件名前缀为 `LumaTile-Alpha-`，bundle 只携带对应 `alpha/<target>.json`，Release 使用 prerelease 且不设置仓库 latest。并行推广按渠道与平台分别加锁；同渠道内禁止回退及同版本异包，不能跨渠道推广。部署 Alpha 时显式传入渠道：

```bash
node scripts/promote-update-manifest.mjs windows bundle/alpha/windows-x64.json /srv/updates alpha
```

该命令只操作给定服务器目录，不上传包；须先复制并核验完整不可变 releases 目录。省略渠道仍为 Stable，传错渠道会拒绝。首次 Alpha 允许其主源清单返回 404，已有 GitHub prerelease 与备用清单仍参与单调性核验；其他网络错误不会被当作初次发布。

发布工具及工作流安全回归现为 59 项、桌面测试 34 项、移动端测试 34 项通过。`npm run test:mobile` 已加入 Android PR CI，不需要生成构建身份或任何签名材料。真实 Alpha 发布、Alpha key 恢复、两次覆盖升级及设备上的三渠道共存尚未验收。

## Stable 晋级来源核验（2026-11-07）

Stable 独立发布必须在标签 commit 中包含本平台的晋级审查记录。脚本对照 Alpha 标签 / commit 与 Stable 的实际源码差异，只放行精确的版本载体、构建身份和发布说明；业务、依赖、构建规则或非版本配置变化需要新 Alpha，紧急例外须逐路径记录批准。审查记录随 `release-record.json` 归档。

工作流在注入长期 Secret 前，还核验 Alpha 的公开 prerelease、源码 commit、目标清单与安装资产；发布器在上传前和公开前复查。只读预检、记录格式和紧急修复要求见 [`promotions/README.md`](promotions/README.md)。该机制不自动生成验收结论，也不打开当前发布门禁。本轮发布回归共 71 项通过，当前源码没有实际晋级批准记录；预检当前 Stable 版本会明确报缺少记录，不能视为具备发版资格。

## 主线 Alpha 候选验收入口

`alpha-candidate.yml` 只提供 `workflow_dispatch`，选择一个平台并填写当次 main 的完整 commit。工作流与脚本均要求本仓库、main ref、dispatch SHA、checkout 和已 fetch 的 origin/main 精确相同；不接受 PR、任意分支或“虽然合入过但不是当次主线”的来源。若构建期间 main 前进，签名前复核会失败，应重新选择最新 main 的明确 commit。

三个平台候选均使用真实 Alpha 身份与 Release 级配置。Windows / macOS 无长期证书；Android 仍拆分无密钥构建与仅签名 job，只给一个签名步骤注入四项 Alpha 仓库 Secrets。全部 job 只读、所有 Action 固定 SHA，不创建 tag、Release、更新清单或部署分支，不访问生产服务器，也不改变正式 / Alpha 公开发布开关。

输出 `alpha-candidate-<platform>-<run>-<attempt>`，保留 7 天：安装包、`candidate-record.json`、`SHA256SUMS.txt`。安装包名包含平台、Alpha 版本和源码 commit；记录固定为 `purpose: candidate` / `deployable: false`，公开发布工具拒绝直接推广。Android 额外将最终已签名 APK 的证书、原生 / Web 身份、最终字节摘要绑定到同次 run / attempt。

这是显式手动请求的主线候选签名入口，**公开发布开关关闭并不禁用此入口的 Alpha 签名**。它用于在公开发版前验证 Alpha 凭据和安装升级；不是 PR 演练，也不允许调用正式签名 Secrets。首次实际调用须在代码审核并合入 main 后，明确授权目标、commit 和签名用途；当前仅实现入口，尚未执行长期签名。

候选安装在同一个 Alpha 应用中，使用长期 Alpha 证书。每次交给测试者的不同构件都应增加 Alpha 序号及对应原生构建号 / Android code，保留原构件及记录；同版本重试只复用同哈希文件。候选 → 下一候选 → 首个公开 Alpha 继续递增，避免已安装候选的用户遇到同 code 异包或收不到更新。不能把带 candidate 标记的归档改名当成正式发布 bundle。

本机已用临时测试 key 验证实际 Alpha Release APK 的候选签名路径、证书 / Web / 原生 / 最终摘要与非部署标记；测试 key 和测试签名包已清理。长期 Secret 的有效性、主线实际调度、Windows/macOS Alpha 安装及两次覆盖升级仍需候选验收。PR CI 只验证这些来源约束、拒绝边界、工作流语法和 Debug 包，不触发此手动入口。

候选入口实现回归：发布 / 渠道 / 来源测试共 79 项通过，类型检查与 actionlint 通过；Windows PR CI 还会解析工作流内嵌 PowerShell（只解析，不执行），覆盖主线候选尚未调度时的脚本语法。

## 构建依赖清单与许可材料

新桌面更新清单同时记录 `buildNumber` 和 `nativeBuildVersion`，分别与打包身份中的 PE / CFBundleVersion 映射一致。公开和部署时要求同平台同渠道的新版本递增 buildNumber，同版本重试保持原生版本和安装包字节不变；跨基础版本也不能重置构建号。发布器还检查已有公开版本的本端清单，防止主源落后时漏掉较高历史构建号。客户端可继续读取旧清单；发布 / 部署遇到缺失原生基线时停止，须先完成桥接原生版本核验，不猜测为 1。

`scripts/generate-build-inventory.mjs <platform> <empty-output-dir> [android-native-sbom.json]` 从已安装、已锁定的生产依赖生成 CycloneDX 1.6 清单、第三方许可原文、项目条款快照、待审查许可记录及未签名的构建来源记录。它只接受当前 commit 对应的构建身份和准确的自动生成版本载体；未提交源码、依赖修改、旧原生清单或缺失依赖会失败。

桌面清单包括 npm 生产依赖、Python 运行时依赖、PyInstaller 引导程序、实际 Electron / Playwright Node 运行时及随附第三方通知。Android 原生清单使用固定版本的 Gradle CycloneDX 插件，命令为 `bash apps/mobile/android/gradlew -p apps/mobile/android --init-script "$PWD/scripts/android-sbom.init.gradle" :app:cyclonedxDirectBom`，输出位于 `apps/mobile/android/app/build/reports/sbom/android.cdx.json`。仅在显式执行清单任务时加载插件，普通 Debug 开发无需运行它。

现有 README 非商业使用说明保留在 `PROJECT-TERMS.txt`；维护人尚未选定正式项目许可证，不填入 MIT / Apache 等授权。依赖声明和许可原文分别保留，缺失许可明确列为待审查。清单范围是实际解析的生产依赖输入；厂商运行时内部组件覆盖不完整、系统组件及另行下载的浏览器均明确标注边界。这些材料不是许可证合规批准，也不是签名的供应链证明。

三端 Debug 演练、主线 Alpha 候选和独立 Alpha / Stable 发布均在无密钥构建 job 生成材料。归档包含 `dependency-inventory.cdx.json`、`THIRD-PARTY-NOTICES.txt`、`PROJECT-TERMS.txt`、`license-review.json`、`build-provenance.json`，并由候选 / 演练 / 发布记录与 `SHA256SUMS.txt` 绑定。发布 job 在任何 GitHub 写入前重验身份及摘要。

Android unsigned 回执采用 schema 2：除 APK 摘要，还绑定构建来源记录摘要；完整回执摘要单独登记为 build job output。全新签名 runner 从同次 run / attempt 下载输入，签名前同时校验独立回执摘要、APK、所有清单文件和来源记录中的 run / attempt。签名报告保存清单摘要，最终归档再核对；签名 job 不运行 npm、Gradle、Python 清单生成或构件携带脚本。

本机已从提交 `afd6fd1` 的已安装依赖实际生成 macOS 37 个、Android 102 个组件的清单，二者通过官方 CycloneDX 1.6 JSON schema 校验，未包含本机用户目录路径。桌面清单有厂商组件覆盖边界，项目与自有工作区许可证仍待维护人决定；这不是完整许可审查完成记录。
