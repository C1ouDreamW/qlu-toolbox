<p align="center">
  <img src="assets/qlu-toolbox.png" width="128" alt="QLU 工具箱 Logo">
</p>

# QLU 工具箱

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3.5-42B883?logo=vuedotjs&logoColor=white" alt="Vue 3">
  <img src="https://img.shields.io/badge/Electron-37-47848F?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/Playwright-1.55-2EAD33?logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white" alt="Windows">
  <img src="https://img.shields.io/badge/platform-macOS-000000?logo=apple&logoColor=white" alt="macOS">
  <img src="https://img.shields.io/badge/license-non--commercial-red" alt="license">
</p>

QLU 工具箱是一款面向齐鲁工业大学学生的本地校园效率桌面软件。v1.1.0 使用 Vue 3、TypeScript 与 Electron 提供桌面界面，Python 与 Playwright 负责可靠的本地自动化。当前内置“分项成绩导出”和“绩点计算器”两个教务工具，后续工具将通过统一模块规范逐步加入。

分项成绩导出会打开本机 Edge、Chrome 或兼容 Chromium。用户在浏览器中手动登录教务系统后，工具自动查询指定学期，并将经过校验的分项成绩保存为 Excel 文件。

绩点计算器读取分项成绩导出的 XLSX 文件，完整展示课程成绩分项，并根据用户勾选的课程实时计算总学分、总成绩点和加权平均 GPA。成绩文件只在本机读取。

工具箱不会要求用户在客户端填写或复制账号、密码、验证码、Cookie，也不会把成绩发送到开发者服务器。

浏览器登录状态、任务记录和设置默认保存在当前用户的系统应用数据目录中，**程序完全本地运行**。

## 交流与其他学校适配版本

- QLU 工具箱 QQ 交流群：`438767737`
- 山东师范大学：[SDNU 工具箱](https://github.com/LoMoCatAp/sdnu-toolbox)——经授权基于本项目改造，由 [LoMoCatAp](https://github.com/LoMoCatAp) 独立维护。版本发布、使用说明和问题反馈请以该仓库为准。

## v1.1.0 更新亮点

- 首次提供 Apple Silicon（arm64）macOS DMG，并使用 macOS 原生窗口控制和标准应用数据目录。
- Edge 和 Chrome 均不可用时，可在应用内按需下载备用 Chromium，支持进度、取消、重试和删除。
- Windows 与 macOS 由独立 CI 验证，正式 Release 同时提供两端安装包及 SHA-256 校验文件。

完整变更与已知限制请参阅 [CHANGELOG.md](CHANGELOG.md)。

## 使用

1. 前往 [Releases](https://github.com/C1ouDreamW/qlu-toolbox/releases) 下载最新版本：
   - Windows：推荐下载 `QLUToolbox_v*_x64_Setup.exe`；需要免安装使用时，下载 `QLUToolbox_v*.zip`，完整解压后运行 `QLUToolbox.exe`。
   - Apple Silicon Mac：下载 `QLUToolbox_v*_arm64.dmg`，打开后将 `QLUToolbox.app` 拖入“应用程序”。当前 DMG 未使用 Apple 开发者证书签名或公证，首次启动可能被 macOS 拦截。
     - 先尝试打开一次 `QLUToolbox.app` 并关闭警告，然后前往“系统设置 → 隐私与安全性”，在“安全性”中点按“仍要打开”，输入 Mac 登录密码确认。该按钮通常只在尝试打开应用后约一小时内显示。
     - 详细步骤请参阅 [Apple 官方教程：打开来自未知开发者的 Mac App](https://support.apple.com/zh-cn/guide/mac-help/-mh40616/mac)。只应信任从本仓库 GitHub Releases 下载的安装包，不要使用来源不明的第三方包，也不建议关闭 macOS 的全局安全保护。
2. 若无法访问 GitHub，可从蓝奏云下载：[wwavy.lanzouq.com/b00b5q2orc](https://wwavy.lanzouq.com/b00b5q2orc)（密码 `d7os`）

### 更新方式

- 软件会检查 GitHub Releases 并提示新版本，但不会自动下载或安装更新。
- 已使用安装程序安装时，关闭正在运行的 QLU 工具箱，再运行新版安装程序即可覆盖升级，无需先卸载。保持相同的 Windows 用户和安装方式时，安装程序会识别已有安装。
- 使用免安装 ZIP 时，关闭程序，完整解压新版并替换旧程序目录；不要只替换 `QLUToolbox.exe`。
- macOS 使用新版 DMG 中的 `QLUToolbox.app` 替换“应用程序”中的旧版本即可升级。
- 上述更新方式都会保留设置、任务记录、日志和浏览器登录状态；导出的文件位于用户选择的目录，也不会被更新程序删除。

## 作者与反馈

- 联系邮箱：[cloud_aaa@163.com](mailto:cloud_aaa@163.com)
- Bug 与功能建议：[GitHub Issues](https://github.com/C1ouDreamW/qlu-toolbox/issues/new/choose)
- 版本发布：[GitHub Releases](https://github.com/C1ouDreamW/qlu-toolbox/releases)

提交 Bug 时请注明软件版本、操作系统及版本、处理器架构、复现步骤、预期结果和实际结果。请勿在公开 Issue 中上传账号、密码、验证码、Cookie、成绩文件或未经脱敏的日志；涉及安全、隐私或个人信息的问题请通过邮箱私下联系作者。

## 使用说明与免责声明

本项目仅供个人学习、交流和非商业用途。未经开发者明确书面许可，禁止将本项目或其修改版本用于收费服务、商业产品、商业推广、代运营或其他营利活动。

本项目不是齐鲁工业大学官方软件，与齐鲁工业大学及其教务系统服务商不存在隶属、授权、合作或担保关系。本项目不代表学校官方立场，学校系统变更可能导致部分功能暂时不可用。

本软件按相应接口现状提供，**不保证功能持续可用**，也不保证导出结果绝对完整或准确。

使用者应仅处理本人有权访问的数据，遵守学校规定、目标系统规则及适用法律法规，**并自行承担使用、误用或无法使用本软件产生的风险和后果**。在适用法律允许的范围内，开发者不承担由此造成的账号、数据、学业、设备或其他损失。

## v1.1.0 当前模块

- 首页：工具入口和最近任务。
- 全部工具：搜索和打开内置工具。
- 分项成绩导出：选择学年、学期和保存目录，完成登录后自动导出。
- 绩点计算器：导入分项成绩 XLSX，查看成绩明细并自由勾选课程计算 GPA。
- 任务记录：查看成功、失败、取消和异常中断记录。
- 设置：默认目录、浏览器、主题和登录状态管理。
- 更新提醒：启动时检查 GitHub Release，也可在设置中手动检查；不会自动下载安装。
- 关于：版本、非商业说明和非官方免责声明。

## 源码运行

1. 安装 [Node.js](https://nodejs.org/) 和 [uv](https://docs.astral.sh/uv/getting-started/installation/)；uv 会按 `.python-version` 准备 Python 3.12。
2. 克隆本仓库，进入项目目录。
3. 运行：
    ```powershell
    uv sync --locked
    npm ci
    npm run dev
    ```

前端与桌面依赖声明在 `package.json`，Python 依赖声明在 `pyproject.toml`。Vue 渲染进程通过 Electron 安全预加载层与本地 Python Bridge 通信，不直接访问文件系统或数据库。

## 浏览器顺序

默认依次尝试：

1. Microsoft Edge
2. Google Chrome
3. 备用 Chromium

可在“设置”中调整首选浏览器。若 Edge 和 Chrome 均无法启动且尚未安装备用 Chromium，软件会先征求用户同意，再按需下载与当前版本匹配的浏览器组件；下载完成后原任务自动继续。组件保存在应用数据目录中，可在“设置 → 浏览器组件”查看占用或删除。浏览器登录数据使用工具箱专用档案，不读取日常浏览器个人资料。

## 本地数据位置

软件的“设置 → 数据管理”会显示完整路径，并可直接打开对应位置：

- Windows 设置文件：`%APPDATA%\QLUToolbox\settings.json`
- Windows 任务记录、日志、浏览器登录状态和备用浏览器组件：`%LOCALAPPDATA%\QLUToolbox`
- macOS 设置、任务记录、日志、浏览器登录状态和备用浏览器组件：`~/Library/Application Support/QLUToolbox`
- 导出文件：默认为当前用户的“下载”目录，也可在设置中修改

安装包覆盖升级或替换免安装程序目录不会删除这些数据。浏览器登录状态目录可能包含 Cookie 等敏感信息，请勿上传或分享。

## 当前限制

- 仅针对 `https://jw.qlu.edu.cn/` 当前使用的正方教务系统页面。
- 登录等待时间为 15 分钟。
- 当前提供 Windows x64 安装包、免安装 ZIP 和 Apple Silicon（arm64）DMG，暂不提供 Intel Mac 版本。
- Windows 安装包尚未数字签名，可能显示来源未知或 SmartScreen 提示；macOS DMG 尚未使用 Apple 开发者证书签名和公证，首次启动需要用户在系统设置中确认。
- 更新提醒依赖访问 GitHub；网络异常不会影响工具使用。

## 项目结构

```text
src/                                Vue 3 页面、组件、状态与设计系统
electron/                           Electron 主进程、安全预加载层和 Python IPC
main.py                             Python Bridge 和 Worker 统一入口
qlu_toolbox/bridge.py               设置、任务和后台任务通信桥
qlu_toolbox/core/                   设置、路径、任务数据库、工具注册
qlu_toolbox/modules/grade_export/   分项成绩导出业务核心
qlu_toolbox/modules/gpa_calculator/ 绩点解析与计算核心
tests/                              Python 核心与 Bridge 自动化测试
package.json                        Electron/Vue 依赖与联合构建配置
pyproject.toml                      Python 项目元数据与依赖声明
```

## 开发验证

```powershell
uv run --locked python -B -m unittest discover -s tests -v
npm run typecheck
npm run build
```

生成 Windows 发布目录：

```powershell
build.bat
```

在 Apple Silicon Mac 上生成 DMG：

```bash
npm run dist:mac -- --arm64
```

macOS 包必须在 macOS 环境中构建；提交 PR 后，仓库的 macOS CI 会自动构建并挂载检查测试 DMG。
