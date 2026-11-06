# 平台版本与独立发布迁移

`release-versions.json` 是客户端版本的唯一人工入口。只修改本次交付的平台；Android 还需增加 `versionCode`（正整数，最大 2100000000），已公开的码不能分配给不同安装包。版本使用严格的 `major.minor.patch`，首期只接受 stable。

## 当前进度

- 阶段 A：版本配置、平台与目标解析、只读检查、版本注入、平台日志、本地入口和 CI 已接入。
- 阶段 B：平台桌面更新器、新清单与 GitHub 兜底，待实施。
- 阶段 C：三条独立工作流、单平台部署构件与发布重试保护，待实施。
- 阶段 D：选择桌面桥接版本、真实安装与升级链实测、生产切换，待实施。

现有 `release.yml` 仍由旧 `v*` 标签触发，仍是三端共同发布；它现在要求标签与三端配置分别一致，版本准备与本地使用相同脚本。独立标签尚未启用，不要提前创建 `win-v*`、`mac-v*`、`android-v*` 标签。阶段 A 的本地准备允许三端版本不同，不代表旧发布流程已经支持这种状态。

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
