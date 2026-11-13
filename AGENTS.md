# AGENTS.md

适用于整个仓库；子目录如有更具体的 Agent 指令，在其范围内优先遵循。

> 自然语言内容优先使用中文；代码标识符、协议字段、工具要求的固定语法及与现有接口一致的命名不强制翻译。

## 项目事实与目录

一格有光（LumaTile）是面向齐鲁工业大学学生的非官方本地校园工具，包含课表、成绩导出、GPA 和学分统计。当前目标为 Windows x64、原生 macOS arm64 与 Android；不将 Linux、Intel Mac 或 iOS 视为已支持平台。

| 路径 | 职责 |
|---|---|
| `src/` | 桌面 Vue 3 + TypeScript 页面、组件、样式与 `store.ts` 状态 |
| `electron/` | `main.ts` 主进程、`preload.cts` 权限接口、`bridge.ts` Python IPC 客户端与更新逻辑 |
| `main.py`、`lumatile/bridge.py` | Python Bridge / Worker 入口与任务调度 |
| `lumatile/core/`、`lumatile/modules/` | 路径、设置、SQLite 任务记录、课表存储；各工具的领域规则与 Playwright 自动化 |
| `apps/mobile/src/`、`apps/mobile/android/` | 移动 Vue / Web Worker；Capacitor 8、Kotlin、Room、受限教务 WebView 与原生插件 |
| `packages/` | `contracts` 数据契约、`academic-core` 学业规则、`schedule-ui` 课表交互逻辑、`update-notes` 更新说明解析 |
| `tests/` | Python unittest、Node.js 原生测试；Vitest 测试另与移动端和共享包源码就近存放 |
| `config/`、`scripts/`、`.github/workflows/` | 平台渠道配置、开发与发布脚本、CI |
| `deploy/` | 更新源、反馈服务与匿名统计服务，各有 README |
| `lumatile-logo-animation/` | 独立 React / Remotion 动画工程，有自己的依赖与检查，不属于根 npm workspace |

按任务阅读：贡献与环境见 [CONTRIBUTING.md](CONTRIBUTING.md)；Android 构建见 [apps/mobile/README.md](apps/mobile/README.md)；版本与发布见 [config/README.md](config/README.md)、[RELEASING.md](RELEASING.md)；签名与隐私见 [docs/release-security.md](docs/release-security.md)、[SECURITY.md](SECURITY.md)。`docs/` 中的历史设计方案含未完成规划，不能据此认定功能已实现；无需每次加载全部文档。

技术版本、脚本行为或目录结构与本文不一致时，以当前配置和代码为准，不为符合过时描述修改正常配置。

## 环境与常用命令

使用 Node.js 22、npm workspaces、uv 和 Python 3.12（`.python-version`）；Android 额外需要 JDK 21、SDK API 36、build-tools 36.0.0。macOS arm64 构建使用原生 Node / Python，不能通过 Rosetta 构建。

以下命令默认在仓库根目录执行，按需选择，不是每次修改的必跑清单。

| 场景 | 命令 |
|---|---|
| 安装锁定依赖 | `npm ci`；`uv sync --locked` |
| 环境诊断 | `npm run doctor`（桌面）；`npm run doctor -- --platform android` 或 `--platform all` |
| 桌面开发 | 先 `npm run build:electron`，再 `npm run dev`；修改 Electron TypeScript 后重新编译并重启 |
| 移动 Web 开发 | `npm run mobile:dev`（原生功能仍需 Android 验证） |
| Python 测试 | `uv run --locked python -B -m unittest discover -s tests -v`；可用 `-p 'test_credit_report.py'` 等缩小范围 |
| 桌面测试 | `npm run test:desktop`（已包含 Electron 编译） |
| 移动 Vue 测试 | `npm run test:mobile` |
| 共享包测试 | `npm test --workspace @lumatile/academic-core`；同样适用于 `@lumatile/schedule-ui`、`@lumatile/update-notes` |
| 类型检查 | `npm run typecheck`（桌面 Vue 与 Electron）；`npm run typecheck --workspace @lumatile/mobile`（移动 Vue） |
| Web / Electron 构建 | `npm run build`（已包含桌面类型检查）；`npm run mobile:build`（已包含移动类型检查） |
| Android 资源同步 | 先 `npm run mobile:build`，再 `npm run mobile:sync`，之后才构建原生包 |
| Android Lint / 单测 / Debug APK | 在 `apps/mobile/android/` 执行 `./gradlew lintDebug testDebugUnitTest assembleDebug`；Windows 使用 `./gradlew.bat` |
| 发布脚本与锁文件检查 | `npm run test:release`；Python 依赖变更时 `uv lock --check` |
| 桌面 Debug 打包 | Windows：`npm run dist:installer` / `npm run dist:zip`；macOS：`npm run dist:mac`（均会构建 Python Worker） |

根应用目前没有统一的 Lint / 格式化脚本，不要假设存在 `npm run lint` 或全仓 Prettier。动画工程的命令在其目录内执行，见 [lumatile-logo-animation/README.md](lumatile-logo-animation/README.md)。

## 架构与代码组织

- 桌面调用链为 Vue → `window.lumatile` / preload → Electron IPC → Python Bridge。文件系统、数据库和进程操作留在对应特权层；保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- Python 沿用现有分工：`domain.py` 放领域规则与校验，`service.py` 编排浏览器和文件操作，`worker.py` 处理任务入口与事件；仅在任务需要时增加对应文件，不为每个工具补齐空层。
- 修改 IPC 方法或事件时，沿实际调用链同步受影响的 preload、类型、调用方、Python 分发与测试。Bridge / Worker 的 stdout 用于逐行 JSON 协议，诊断信息写 stderr，不能混入普通日志。
- 移动端通过已有 Capacitor 插件访问原生能力；教务页面留在无通用 JavaScript Bridge 的独立 WebView，不能导航到拥有 Capacitor 权限的主 WebView 中。
- 共享 TypeScript 领域规则放在 `packages/academic-core`，契约放在 `packages/contracts`，不引入 Electron、Capacitor 或 UI 依赖。桌面仍有 Python 对应规则；变更学年、学期、导出字段、GPA 或学分规则时核对双端语义与现有合成样本，不顺带迁移整套实现。
- Vue 使用 `<script setup lang="ts">`、Composition API；保持 TypeScript `strict`。沿用文件局部风格；Android 原生源码使用 Kotlin。
- 修改依赖使用 npm 或 `uv add` / `uv remove`，同步对应 `package-lock.json` 或 `uv.lock`；不要引入另一套包管理器。遵守 `.gitattributes` 换行规则，避免无关格式化。

## 错误处理与数据安全

- 保持本地处理、用户手动登录与最小权限；不新增代登录、Cookie 中转或成绩云端存储。账号、密码、验证码、Cookie、真实成绩、浏览器档案与未脱敏日志不得进入提交、测试材料或公开反馈。
- 保留外部输入边界的必要校验；新增校验、异常捕获、回退或兼容分支应有实际风险或明确需求依据，避免在已校验的数据流内部重复验证相同条件。
- 复用现有错误类型、错误码与任务终态；失败、取消和中断应可区分，不能把未完整读取的数据当作成功结果。
- 修改存储或清理逻辑时，保留受影响路径已有的原子写入、事务、损坏数据备份与临时文件清理机制；测试使用临时目录和合成数据，不能读写用户实际应用数据。桌面路径复用 `AppPaths`，Android 文件保存与分享沿用现有原生接口。
- 不提交构建产物、数据库、安装包、生成的 `build-info.json`、证书、私钥、keystore 或凭据；不要通过打印环境变量或读取签名材料排查普通开发问题。

## 修改范围与验证

- 复用现有组件与状态组织，避免无关重构、过度封装及未经要求的依赖引入；少量重复不足以成为新增抽象的理由。
- 调查当前任务涉及的代码、调用方和契约；小改动不要求全库扫描或详细计划。
- 按受影响行为与风险选择验证，优先运行相关测试；新增或修复的非平凡行为缺少覆盖时，补充小型回归测试。纯文档或格式调整检查 diff 及涉及的路径、命令即可。相关检查通过后，无新风险不重复运行或扩大到完整套件。
- 共享逻辑检查受影响的桌面与 Android 使用方；存储、权限、更新、签名或构建变更按受影响链路选择集成验证。涉及校园网登录、原生 WebView、安装升级时，说明实际完成及尚未完成的设备验证，不将全平台真机验收作为每次修改的前置条件。
- 日常开发、调试和本地验证优先使用 Debug 渠道；执行打包命令前，按实际渠道配置确认构建目标；未经明确授权，不生成或发布正式渠道产物。
- 启动和构建会注入版本，检查 package / lock / Python 版本载体的 diff；只处理本次生成的改动，不覆盖用户原有修改或真实依赖变更。
- 完成时简要说明修改内容、已执行验证及未验证部分；不创建未经要求的验收报告、总结文档或检查清单。

## Git 与发布边界

- 分支与 PR 约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。外部贡献按其 Issue 流程处理；用户已明确授权的开发任务可直接实施，无需另开 Issue 或重复批准。
- 不擅自执行 `git reset --hard`、`git clean -fd`、强制推送、删除用户数据等破坏性操作；不为消除工作区差异批量还原文件。提交只包含当前任务改动。
- Git保持原子化提交，一次提交尽量对应一个逻辑面，单次提交不要过大。
- 所有 Git Commit 使用 Conventional Commits，正文与页脚可选：

  ```text
  <type>(<scope>): <description>

  [body]

  [footer]
  ```

- `type` 必填且为小写英文，仅用 `feat`、`fix`、`refactor`、`perf`、`docs`、`style`、`test`、`build`、`ci`、`chore`、`revert`。`scope` 可选，使用英文并优先沿用已有模块名。`description` 必填，使用简洁明确的中文，末尾不加句号；例如 `docs(agents): 完善项目开发规范`。
- 除明确的发布任务外，不修改应用版本号、不创建或推送发布标签、不改写发布记录、不打开发布开关或更改线上更新清单。`config/release-versions.json` 是版本唯一人工入口，具体流程按 `config/README.md` 与 `RELEASING.md`，不手改生成版本载体。
- Debug、Alpha、Stable 保持各自应用身份、数据和签名边界；不卸载 Stable 来解决 Debug 安装冲突。PR / 普通构建不接收 Alpha 或正式长期密钥，签名与发布仅通过维护者控制的既有流程；不自动迁移或替换签名 Secret。
