# 参与贡献

感谢关注一格有光。提交问题或代码前，请先阅读 README 中的非官方声明、使用限制和隐私说明。

项目尚未选定正式许可证，继续遵循 README 的非商业用途说明；本指南不新增使用授权。第三方依赖的许可独立保留，新增依赖时说明用途、实际进入哪些平台构件、许可和需要保留的声明。

## 开始之前

- 小型修复和文档改进可以直接提交 Pull Request。
- 新功能、跨平台适配、依赖调整、架构改动或可能影响用户数据的修改，请先创建 Issue，说明目标、实现思路和影响范围。
- 请尽量让一个 Pull Request 只解决一个问题，避免混入无关重构或格式调整。
- 当前开发目标为 Windows x64、原生 macOS arm64 和 Android。修改共享代码时检查两种桌面目标及移动端；设备验收与 CI 构建分别记录。

推荐使用以下贡献流程：

1. Fork 本仓库。
2. 从最新的 `main` 创建独立分支，例如 `fix/task-history`、`feat/new-tool` 或 `feat/macos-support`。
3. 在自己的 Fork 中开发和验证。
4. 尽早向本仓库提交 Draft Pull Request，便于维护者确认方向。
5. 根据审查意见继续向同一分支提交修改，验证完成后再将 Pull Request 标记为 Ready for review。

## 报告 Bug

请使用 [Bug 报告模板](https://github.com/C1ouDreamW/qlu-toolbox/issues/new/choose)，并尽量提供：

- 一格有光版本；
- 渠道（Stable / Alpha / Debug）、公开 Release 或构建 run 链接，以及可提供的源码 commit；
- 操作系统、系统版本和 CPU 架构；
- 问题发生前执行的步骤；
- 预期结果和实际结果；
- 已经脱敏的错误信息或截图。

不要在公开 Issue 中提交账号、密码、验证码、Cookie、成绩文件、浏览器个人资料或包含个人信息的日志。涉及安全、隐私或个人信息的问题，请发送邮件至 `cloud_aaa@163.com`。

## 建议新功能

请说明使用场景、希望解决的问题、预期交互和可能影响的数据。新增工具应遵守本地优先、手动登录、最小权限和不收集账号信息的原则。

## 本地开发

按[项目结构](README.md#项目结构)查找源码。`apps/` 下按桌面端、Android、官网和服务端分目录，仓库级开发和打包命令在根目录运行。官网与服务端有自己的[本地验证命令](deploy/server/README.md#本地检查)。

桌面使用 Node.js 22、uv 与 Python 3.12；Android 额外需要 JDK 21、SDK API 36、build-tools 36.0.0。桌面只支持原生 Windows x64 / macOS arm64，不使用 Rosetta 构建 arm64 包。新机器无需正式或 Alpha 签名材料。

先安装锁定依赖，再检查当前目标：

```shell
npm ci
uv sync --locked
npm run doctor
# 仅 Android：npm run doctor -- --platform android
# 两者一起：npm run doctor -- --platform all
```

`doctor` 不读取密钥，缺项会逐项给出修复命令；它不能代替首次运行、真实打包或设备安装验收。基础工具尚未安装时，可以先运行 `node scripts/doctor.mjs`，不依赖 node_modules。

桌面启动：

```shell
npm run build:electron
npm run dev
```

移动端 Web 开发使用 `npm run mobile:dev`；原生 Debug 构建步骤见 [`apps/mobile/README.md`](apps/mobile/README.md)。两个开发入口均默认 Debug，使用独立名称、包名和私有数据目录，关闭在线更新与匿名统计。不要用正式 key 给 Debug 签名。不同机器的 Android Debug key 不同，无法直接覆盖时只卸载 Debug 应用并保留所需 Debug 测试数据；不要卸载 Stable 解决开发安装冲突。

针对修改范围验证：

```shell
uv lock --check
uv run --locked --directory apps/desktop/python python -B -m unittest discover -s ../../../tests -v
npm run test:release
npm run test:desktop
npm run test:mobile
npm run typecheck
npm run build
```

桌面完整 Debug 打包使用 Windows 的 `npm run dist:installer` / `npm run dist:zip`，或原生 arm64 Mac 的 `npm run dist:mac`；这些入口自动准备身份并构建 Python worker。只运行 electron-builder 可能打入上次构建的 worker，不作为版本一致性验收。

Windows 也可运行[免安装目录构建脚本](apps/desktop/scripts/build.bat)或[安装包构建脚本](apps/desktop/scripts/build-installer.bat)。脚本会从仓库根目录安装依赖并运行对应的 Debug 构建命令。

开发准备会把当前渠道版本注入 package / lock / Python 版本载体，并生成被忽略的 build-info.json。提交前检查 diff，勿将本地 Debug 注入当作版本发布提交；只还原本次生成的版本字段，保留真实依赖和源码修改。平台渠道权威配置、实际产物核验与迁移状态见 [`config/README.md`](config/README.md)。

PR CI 和构建演练只使用 Debug / 临时密钥；同仓库与 fork PR 均不接收 Alpha 或正式长期签名 Secret。Alpha 是独立的长期测试应用，需要单独的版本、包身份、更新源及 Android 签名；把 Debug 包重新命名或把 Alpha 包覆盖到 Stable 都不构成发布。流程与停点见[签名规则](docs/release-security.md)。

修改桌面 Python 依赖时在根目录使用 `uv add` 或 `uv remove`。服务端 Python 依赖在 `backend/` 管理。修改前端依赖请使用 `npm install`，并一并提交相应的锁文件。

### CI 按改动范围执行

| 改动 | 运行的检查 |
| --- | --- |
| 桌面源码、桌面 Python 依赖 | Windows 和 macOS 的测试、Debug 打包及包内身份校验 |
| Windows 安装素材或脚本、macOS 图标或权限文件 | 对应桌面平台的检查 |
| Android 应用源码或构建入口 | Android 的测试、Debug 打包及包内身份校验 |
| 双端共享包、根 npm 锁文件 | Windows、macOS 和 Android 检查 |
| 发布工具、渠道配置、工作流 | 对应的发布工具测试、工作流检查和受影响的客户端构建 |
| 官网、后端 | 各自的验证和 `main` 自动部署，详见[生产服务说明](deploy/server/README.md#github-actions-自动部署) |

一次提交触及多个范围时，相关任务都会运行。客户端 PR 保留原有检查名称，无关任务在工作流内跳过。需要完整重跑客户端检查时，可手动运行 `CI`。

Alpha / Stable 按平台标签发布，命令与签名规则见[发布指南](docs/releasing.md)。发布流程不要求提交额外的验收或晋级批准记录。

## 代码与数据要求

- 保持 Vue 渲染进程、Electron 主进程和 Python Bridge 之间的权限边界；渲染进程不应直接访问文件系统、数据库或任意系统命令。
- 新增工具应遵守本地优先、手动登录、最小权限和不收集账号信息的原则。
- 不要提交账号、密码、验证码、Cookie、成绩文件、浏览器档案、未经脱敏的日志或包含个人信息的测试材料。
- 不要提交构建目录、安装包、压缩包、数据库、代码签名证书、私钥或其他凭据。
- 除非维护者明确要求，不要在功能 Pull Request 中修改应用版本号、创建 Git 标签或改写发布记录。
- 新增或修改行为时，应补充与风险相称的自动化测试；无法自动化验证的部分，请在 Pull Request 中说明手动验证步骤和结果。

## 提交 Pull Request

Pull Request 需要说明：

- 修改目的及关联的 Issue；
- 主要改动和未包含在本次提交中的内容；
- 测试所用的操作系统、系统版本和 CPU 架构；
- 已执行的自动化测试和手动验证；
- 对依赖、本地数据、隐私、兼容性和发布流程的影响；
- 已知问题或后续工作；
- 涉及界面修改时，提供不包含个人信息的截图或录屏。

跨平台适配还应在真实目标系统上验证开发启动、应用打包、首次启动、本地 Python 后端、文件选择与打开、浏览器登录和核心工具流程。可以在 Pull Request 中提供测试构建的生成方法，但不要把生成的二进制文件提交进 Git。

所有外部贡献都需要经过维护者审查后合入。正式安装包、GitHub Release、发布标签和签名材料仅由维护者控制的发布流程处理；贡献者提供的二进制文件不会直接作为正式版本发布。
