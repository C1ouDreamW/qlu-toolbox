# 参与贡献

感谢关注一格有光。提交问题或代码前，请先阅读 README 中的非官方声明、使用限制和隐私说明。

## 开始之前

- 小型修复和文档改进可以直接提交 Pull Request。
- 新功能、跨平台适配、依赖调整、架构改动或可能影响用户数据的修改，请先创建 Issue，说明目标、实现思路和影响范围。
- 请尽量让一个 Pull Request 只解决一个问题，避免混入无关重构或格式调整。
- 当前正式发布基线为 Windows 10/11 64 位。跨平台改动应保持现有 Windows 功能和构建流程可用。

推荐使用以下贡献流程：

1. Fork 本仓库。
2. 从最新的 `main` 创建独立分支，例如 `fix/task-history`、`feat/new-tool` 或 `feat/macos-support`。
3. 在自己的 Fork 中开发和验证。
4. 尽早向本仓库提交 Draft Pull Request，便于维护者确认方向。
5. 根据审查意见继续向同一分支提交修改，验证完成后再将 Pull Request 标记为 Ready for review。

## 报告 Bug

请使用 [Bug 报告模板](https://github.com/C1ouDreamW/qlu-toolbox/issues/new/choose)，并尽量提供：

- 一格有光版本；
- 操作系统、系统版本和 CPU 架构；
- 问题发生前执行的步骤；
- 预期结果和实际结果；
- 已经脱敏的错误信息或截图。

不要在公开 Issue 中提交账号、密码、验证码、Cookie、成绩文件、浏览器个人资料或包含个人信息的日志。涉及安全、隐私或个人信息的问题，请发送邮件至 `cloud_aaa@163.com`。

## 建议新功能

请说明使用场景、希望解决的问题、预期交互和可能影响的数据。新增工具应遵守本地优先、手动登录、最小权限和不收集账号信息的原则。

## 本地开发

需要 [Node.js](https://nodejs.org/) 和 [uv](https://docs.astral.sh/uv/)：

```shell
npm ci
uv sync --locked
npm run dev
```

验证：

```shell
uv lock --check
uv run --locked python -B -m unittest discover -s tests -v
npm run typecheck
npm run build
npm run build:backend
```

Windows 完整打包验证：

```shell
npx electron-builder --win dir --publish never
```

Pull Request 会通过 GitHub Actions 自动执行以上检查。其他平台的适配应补充对应平台的打包命令和真实设备验证。

修改 Python 依赖请使用 `uv add` 或 `uv remove`，修改前端依赖请使用 `npm install`，并一并提交更新后的锁文件。

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
