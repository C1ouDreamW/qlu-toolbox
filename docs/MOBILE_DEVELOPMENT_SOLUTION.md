# QLU 工具箱移动端整体开发解决方案

> 文档状态：Android 可行性验证完成，正式 Kotlin 测试版开发基线
> 最近验证：2026-07-18
> 当前实现：`apps/mobile` 0.4.0-beta.1，Kotlin 正式测试包已构建并完成真机解析检查
> 目标平台：Android 优先，iOS 后续评估
> 适用项目：QLU 工具箱 v1.1.x 及后续版本

## 1. 方案结论

移动端继续在当前仓库开发，采用 Vue 3、TypeScript、Vite 与 Capacitor，优先交付 Android 版本。现有 Electron 桌面端继续使用 Python + Playwright 完成浏览器自动化；移动端不内置 Python 和 Playwright，而是通过独立、受限的系统 WebView 完成以下流程：

1. 用户自行通过 aTrust、校园网或其他方式确保教务系统可访问；
2. App 打开教务系统登录页；
3. 用户在 WebView 中手动完成登录、验证码等交互；
4. App 检测登录成功；
5. App 在同一 WebView 会话和同源页面内自动查询并请求成绩导出；
6. App 校验 XLSX 后，通过系统文件保存界面保存或分享；
7. 用户可直接将导出结果交给本地 GPA 计算器处理。

移动端不负责安装、启动、配置或控制 aTrust，也不申请 VPN 相关权限。网络不通时，只提供可理解的诊断提示。

本方案的交付目标是桌面端与 Android 端在业务能力、校验结果和 GPA 结果上等价，而不是要求两端使用相同的底层实现。由于教务系统页面、统一认证和 Android System WebView 均由外部维护，不能承诺任何版本永久可用；应通过明确的支持矩阵、自动化契约测试和真机验收保证已支持环境中的一致性。

### 1.1 Android 可行性验证结论

阶段 0 PoC 已在 Android 实机完成核心链路验证，结论是该方案可行。PoC 源码在正式 Kotlin 版通过实机回归后移除，验证结论保留如下：

- 独立 WebView 打开教务系统，并经 `sso.qlu.edu.cn` 完成统一身份认证后回到 `jw.qlu.edu.cn`；
- 首次登录和保留登录状态后的再次使用均可完成；
- 可选择不同学年以及第一、第二学期，页面查询条件、导出请求参数、文件名和工作簿实际学期保持一致；
- 导出结果按分块从 WebView 传至 Android 缓存，通过 XLSX 文件头、长度和工作簿“学期”列校验后由系统文件界面保存；
- 用户取消系统保存后可再次保存，不需要重新查询；保存后可交给 WPS/Excel 打开；
- 导出结束、失败或关闭后会释放活动任务，返回工具箱可立即开始下一次查询，不再依赖等待或重启 App；
- 错误学期、无效工作簿、未知跳转域名、TLS/网络错误不会被误报为成功。

阶段 0 PoC 的 Android 原生层由 Capacitor 脚手架生成的 Java 实现，仅用于验证行为，不是正式技术选型。正式版已按第 4 节使用 Kotlin 重写原生 Activity、插件、校验和生命周期代码，历史 Java 源码不再留在当前源码树中。

文档与历史 PoC 验证结论的优先级约定如下：

1. 技术栈、正式架构、安全目标和持久化方案以本文档为准；
2. 教务系统页面交互、学年/学期映射、查询与导出时序、异步脚本取回方式、工作簿学期校验和任务释放逻辑，以阶段 0 的实机验证结论为准；
3. 正式 Kotlin 版不是逐行翻译 Java，而是按本文档重构，并用契约测试和脱敏样本保证结果不回退；
4. Room、ArtifactStore、分享、GPA、进程恢复和完整 ZIP 安全校验仍属于正式版工作，不得标记为已由阶段 0 验证。

### 1.2 正式 Kotlin 测试版进度

正式工程已建立在 `apps/mobile/`，永久应用 ID 为 `io.github.c1oudreamw.lumatile`。v1.2.3 是最后一个显示为“QLU 工具箱”的 Android 迁移版本，已实现 Kotlin `GradeExportActivity`/Capacitor Plugin、Room 任务 snapshot、缓存 ArtifactStore、SAF 保存与再次保存、FileProvider 分享、精确域名限制、SHA-256 分块完整性验证、工作表 relationship 定位、ZIP 安全限制和实际学期校验；已接入本地 GPA 垂直链路，包括从导出 artifact 直接读取、系统文件选择器导入、Kotlin 安全提取工作表行、`academic-core` 课程分组与总评识别、桌面端等价绩点规则、逐课选择和加权 GPA 汇总；并新增冷启动孤立任务修正、Activity 重建中断保护、双更新清单、签名 APK 校验与覆盖安装流程。

尚未宣称完成的正式版范围包括 WebView renderer/完整进程回收仪器测试、已保存 SAF URI 失效处理、多设备支持矩阵和 release 签名发布。后续测试版统一在 `apps/mobile/` 开发。

## 2. 建设目标与非目标

### 2.1 建设目标

- 在 Android 手机上提供与桌面端业务等价的成绩导出、文件校验和 GPA 计算体验；
- 账号、密码、验证码、Cookie 和成绩数据不发送到开发者服务器；
- 尽量复用现有 Vue 页面、业务类型、导出参数和校验规则；
- 保持桌面端现有功能和发布流程不受影响；
- 为后续 iOS 版本预留平台抽象，但不让 iOS 阻塞 Android 首发；
- 以 TypeScript `academic-core` 作为学期、导出参数、XLSX 校验和 GPA 计算的单一业务事实源；
- 教务系统页面变化时，共享脚本、契约和核心规则能够同时服务桌面端与移动端；
- Android Activity、WebView renderer 或 App 进程被系统回收后，任务必须能够恢复为可解释的状态，不得永久停留在“运行中”。

### 2.2 非目标

- 不开发或集成 VPN/aTrust 控制功能；
- 不在后台静默登录、定时抓取或长期运行自动化任务；
- 不收集用户的教务系统账号和密码；
- 不建设代登录、Cookie 中转或成绩云端存储服务；
- 不尝试在 APK/IPA 内运行桌面版 Playwright；
- 首期不保证 iOS 与 Android 同时发布；
- 首期不重写或移除桌面端 Python 后端。

## 3. 网络与 VPN 边界

网络连接责任与当前桌面端保持一致：用户应在开始任务前自行确保 `https://jw.qlu.edu.cn/` 可访问，例如先在手机上连接 aTrust。

App 仅负责：

- 在成绩导出开始时尝试打开教务系统；
- 对加载超时、DNS、TLS、HTTP 错误和服务器异常进行分类提示；
- 提示用户检查 aTrust、校园网、网络连接或教务系统状态；
- 网络恢复后允许用户重试。

App 不负责：

- 判断 aTrust 是否安装、登录或正在运行；
- 启停 VPN；
- 读取 VPN 配置或状态；
- 引导用户绕过学校的网络访问控制。

建议提示文案：

> 无法访问教务系统。请确认手机已连接校园网或已通过 aTrust 建立连接，然后重试。

## 4. 技术栈选型

### 4.1 应用层

| 领域 | 选型 | 说明 |
|---|---|---|
| UI 框架 | Vue 3 | 与桌面端一致，复用组件和开发经验 |
| 开发语言 | TypeScript | 统一接口、状态和业务模型 |
| 构建工具 | Vite | 与现有项目一致 |
| 移动容器 | Capacitor 8.x | 支持将现有 Web 项目包装为 Android/iOS，并可编写原生插件；所有 Capacitor 包保持同一兼容版本 |
| 包管理 | npm workspaces | 沿用现有 npm 与 `package-lock.json`，避免同时引入另一套包管理器 |
| 图标 | lucide-vue-next | 与桌面端一致 |
| 状态管理 | 保留当前轻量 store | 首期不为迁移额外引入 Pinia；复杂度上升后再评估 |
| 单元测试 | Vitest | 测试共享 TypeScript 业务核心 |
| Android 原生 | Kotlin | 实现隔离 WebView、文件保存和平台生命周期 |
| iOS 原生 | Swift | 后续实现 WKWebView 与文件导出 |

Capacitor 官方支持直接加入现有现代 Web 项目，并通过 Kotlin/Java、Swift 自定义原生能力：<https://capacitorjs.com/docs>。

`package-lock.json` 必须锁定具体 Capacitor、官方插件和构建工具版本，不使用跨主版本或互不兼容的 `@capacitor/core`、`@capacitor/android`、`@capacitor/cli` 组合。仓库中记录 Node.js、JDK、Gradle、Android Gradle Plugin、compile SDK、target SDK、min SDK 与 Android Studio 的兼容矩阵；升级任一原生工具链时通过独立 PR 验证桌面端和移动端构建。

阶段 0 已构建通过的 Android 工具链基线如下，正式测试版先沿用该组合，再通过独立变更升级：

| 项目 | 已验证基线 |
|---|---|
| Node.js | 22+ |
| Capacitor | 8.x，`core/android/cli` 同一兼容版本 |
| JDK | 21（Android Studio JBR 21 可用） |
| Gradle | 8.14.3 |
| Android Gradle Plugin | 8.13.0 |
| compile SDK / target SDK | 36 / 36 |
| min SDK | 24 |
| AndroidX WebKit | 1.14.0 |

正式 Android 源码语言固定为 Kotlin。历史 PoC 的 Java 源码已移除，正式工程只维护 Kotlin 类和 Kotlin 测试，不采用 Java/Kotlin 双轨维护。

### 4.2 本地数据

| 数据 | 建议存储 | 说明 |
|---|---|---|
| 普通设置 | Capacitor Preferences | 主题、欢迎页状态、是否保留登录等小型键值数据，不存 Cookie 和文件内容 |
| 任务记录 | Android Room/SQLite | 从 MVP 开始使用数据库和显式 schema migration，避免 JSON 并发覆盖和崩溃损坏 |
| 临时 XLSX | 原生 ArtifactStore（App cache） | 以不透明句柄访问；导出后可保存、分享或计算 GPA，并按 TTL 清理 |
| 已保存结果 | SAF `content://` URI | 保存显示名称、MIME、大小和可持久化授权，不假设存在绝对路径 |
| 登录状态 | Android WebView 应用级数据存储或受支持的独立 Profile | 不复制到任务数据库，不上传；实现必须说明实际隔离级别 |
| 日志 | App 私有目录 | 默认脱敏，不记录 Cookie、请求体中的敏感字段或成绩内容 |

### 4.3 XLSX 处理

移动端不调用 Python。`packages/academic-core` 是学期映射、导出 POST body、XLSX 结构校验、课程分组和 GPA 计算的单一业务事实源。桌面端 Python 只继续负责 Playwright 会话和页面自动化，导出结果交给 Electron/Node 侧的 `academic-core` 校验；迁移完成后不得在 Python 与 TypeScript 中长期维护两份同义业务规则。

迁移期间保留 Python 旧实现用于对照，使用同一组脱敏工作簿和 JSON golden fixtures 比较两端输出。只有课程分组、警告、学期判断、绩点和错误码完全一致后，桌面端才切换到新核心。

XLSX 解析选型验证顺序：

1. 使用脱敏样本验证 ExcelJS 的兼容性、包体积、解析耗时和低内存设备峰值；
2. 如体积或内存不理想，使用轻量 ZIP/XML 方案，仅解析项目需要的 workbook relationship、worksheet、sharedStrings 和 inlineStr；
3. 解析在 Web Worker 或桌面 Node worker 中执行，不阻塞 Vue UI 主线程；
4. 同时限制压缩文件大小、ZIP 条目数、单条目解压大小、总解压大小和压缩比，拒绝路径异常、损坏或超限工作簿；
5. 正式版只接受 OOXML `.xlsx`。服务器返回旧式 OLE `.xls` 时明确报“不支持且无法完成学期校验”，不得按成功结果保存；
6. 不依赖完整办公套件能力，只实现当前成绩文件所需的读取和校验。

需要移植的共享规则包括：

- 学年与学期参数映射；
- 导出 POST body 构造；
- 文件扩展名和 ZIP/XLSX 魔数判断；
- 工作表中实际学期校验；
- 课程分组与“总评”识别；
- GPA 计算公式；
- 错误码和用户提示。

`academic-core` 可以接收 `Uint8Array`/`ArrayBuffer`，但页面层和公开平台 API 不传递完整 Base64 文件。桌面端通过 Node 文件流读取；Android 端通过受信任的主 WebView 私有只读资源通道读取 ArtifactStore 中的专用文件。该通道只暴露随机、短期、只读的 artifact token，不暴露 App data/cache 根目录，也不向教务系统 WebView 开放。

## 5. 仓库与代码组织

### 5.1 仓库策略

继续使用当前仓库，不新建独立移动端仓库。理由：

- 桌面端和移动端属于同一产品；
- Vue、类型、GPA 和导出校验具有明显复用价值；
- 教务系统接口变化时需要同步修改两端；
- 单仓库便于统一 Issue、文档、版本记录和安全说明；
- 可以通过独立工作流分别构建桌面端和移动端。

仅当未来出现独立维护团队、独立授权、完全不同发布节奏或几乎不再共享代码时，再考虑拆仓库。

### 5.2 渐进式目录调整

第一阶段不立即移动所有现有文件，先新增：

```text
qlu-toolbox/
├─ src/                         # 现有桌面 Vue 前端，暂时保持
├─ electron/                    # 现有 Electron 容器
├─ qlu_toolbox/                 # 现有 Python 后端
├─ apps/
│  └─ mobile/                   # 新增 Capacitor 移动端
│     ├─ src/
│     ├─ android/
│     ├─ ios/                   # Android 验证后再生成/维护
│     ├─ capacitor.config.ts
│     └─ package.json
├─ packages/
│  ├─ contracts/                # 跨端接口、事件和数据模型
│  ├─ academic-core/            # 学期、导出校验、GPA 纯逻辑
│  └─ design-tokens/            # 颜色、字号、间距等设计变量
└─ docs/
   └─ MOBILE_DEVELOPMENT_SOLUTION.md
```

移动端技术验证通过后，再评估把桌面端整理为 `apps/desktop`。这样可以避免在可行性尚未验证前进行大规模目录迁移。

### 5.3 共享边界

适合共享：

- TypeScript 类型与事件协议；
- `academic-core` 中的纯函数业务规则；
- GPA 计算、XLSX 内容解析和安全限制；
- 脱敏工作簿、JSON golden fixtures 与契约测试；
- 教务系统选择器、登录检测和查询脚本的版本化资源；
- 工具清单和元数据；
- 设计变量、图标使用方式；
- 不依赖 Electron/Capacitor 的 Vue 小组件。

不应强行共享：

- Electron 标题栏、侧边栏和桌面文件路径 UI；
- Android/iOS 底部导航和安全区域布局；
- Electron IPC、Python Bridge；
- Android WebView、iOS WKWebView；
- 平台文件选择器与更新机制。

共享不等于让页面直接访问所有平台能力。Vue 页面只依赖 `ToolboxPlatform`；Electron IPC、Capacitor Plugin、Android Room、SAF 和 ArtifactStore 都隐藏在各自适配器内部。

## 6. 跨端平台抽象

当前页面直接调用 `window.qlu`。移动端开发前，应增加平台适配层，避免页面绑定 Electron。

建议接口。`ArtifactHandle` 是对临时或导入工作簿的不透明引用，不包含 Base64、绝对路径或 Cookie；`SavedArtifact` 在 Android 上保存 `content://` URI 和显示元数据：

```ts
export interface ArtifactHandle {
  id: string
  displayName: string
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  size: number
  sha256: string
  expiresAt: string | null
}

export interface SavedArtifact {
  uri: string
  displayName: string
  mimeType: string
  size: number
}

export interface ToolboxPlatform {
  readonly kind: 'desktop' | 'android' | 'ios'
  readonly capabilities: PlatformCapabilities

  bootstrap(): Promise<CoreBootstrapData>
  saveSettings(patch: Partial<CoreSettings>): Promise<CoreSettings>
  listTasks(limit?: number): Promise<TaskRecord[]>
  clearTasks(): Promise<void>

  startGradeExport(options: GradeExportOptions): Promise<{ taskId: string }>
  cancelGradeExport(taskId: string): Promise<void>
  getActiveGradeTask(): Promise<GradeTaskSnapshot | null>
  getGradeTask(taskId: string): Promise<GradeTaskSnapshot | null>
  onGradeEvent(listener: (event: GradeEvent) => void): () => void

  selectWorkbook(): Promise<ArtifactHandle | null>
  parseWorkbook(artifact: ArtifactHandle): Promise<GPAWorkbook>
  saveArtifact(artifact: ArtifactHandle): Promise<SavedArtifact | null>
  shareArtifact(artifact: ArtifactHandle | SavedArtifact): Promise<void>
  openSavedArtifact(artifact: SavedArtifact): Promise<void>
  releaseArtifact(artifactId: string): Promise<void>
}
```

分别实现：

```text
ElectronPlatform
  ├─ Electron IPC → Python Bridge → Playwright（仅浏览器会话与页面自动化）
  └─ Node file stream → academic-core（校验、解析和 GPA）

MobilePlatform
  ├─ Capacitor Plugin → GradeExportActivity → 独立 WebView → 同源导出脚本
  ├─ ArtifactStore/SAF/Room → 不透明句柄、文件和任务持久化
  └─ 主 WebView 私有只读资源通道 → Web Worker → academic-core
```

不要继续扩张一个同时包含桌面浏览器组件、桌面路径和移动能力的 `BootstrapData`。建议拆分为：

- `CoreBootstrapData`：版本、工具、学期、通用设置；
- `DesktopCapabilities`：浏览器组件、路径、打开文件夹；
- `MobileCapabilities`：系统保存、分享、WebView 导出；
- `PlatformCapabilities`：页面根据能力决定显示什么，而不是根据 UA 猜测平台。

平台接口还必须定义以下不变量：

- 同一时间最多存在一个活动成绩导出任务；
- 监听器在调用 `startGradeExport` 前注册，重新订阅后可通过 snapshot 补回最新状态；
- `taskId`、`artifactId` 和事件序号用于拒绝旧任务或重复事件；
- 页面卸载不会自动取消原生任务，只有用户明确取消、Activity 关闭或系统中断才改变任务结果；
- 临时 artifact 过期或被系统清理后返回 `ARTIFACT_UNAVAILABLE`，不得继续展示可保存/可打开。

## 7. 移动端成绩导出架构

### 7.1 为什么不用 Playwright

桌面端 Playwright 依赖可执行的 Chromium/Edge、子进程、持久化 profile 和 Python Worker。普通移动 App 中无法以相同方式可靠部署这套环境。Playwright 的移动设备能力主要用于测试环境中的设备模拟或通过开发连接控制 Android 设备，不是面向普通用户 APK 的内置自动化运行时：<https://playwright.dev/docs/intro>。

移动端应使用系统 WebView：

- Android：`android.webkit.WebView`；
- iOS：`WKWebView`；
- 原生层主动调用页面 JavaScript；
- 登录、查询和导出始终发生在同一个 WebView 会话中。

Android WebView 和 WKWebView 均提供执行页面 JavaScript 的公开 API：

- Android：<https://developer.android.com/reference/android/webkit/WebView.html#evaluateJavascript(java.lang.String,%20android.webkit.ValueCallback)>；
- iOS：<https://developer.apple.com/documentation/webkit/wkwebview/evaluatejavascript(_:completionhandler:)>。

### 7.2 为什么必须使用独立 WebView

Capacitor 主 WebView 加载的是工具箱自己的 Vue 应用，并拥有 Capacitor 原生能力。不能让这个主 WebView 直接导航到教务系统后继续暴露完整原生 Bridge。

移动端应创建专门的成绩导出页面：

```text
Vue/Capacitor 主 WebView
        │ 受限的插件调用和事件
        ▼
GradeExportActivity（Android）
或 GradeExportViewController（iOS）
        │
        ▼
教务系统专属 WebView
```

教务系统 WebView 不暴露通用文件、剪贴板、设置或任意命令接口。Android 官方指出，向加载外部内容的 WebView 注入通用原生桥会带来 XSS、来源伪造和权限滥用风险：<https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges>。

### 7.3 域名允许列表

阶段 0 真机验证后，Android 成绩 WebView 的静态允许列表确定为：

```text
https://jw.qlu.edu.cn/
https://sso.qlu.edu.cn/
```

`sso.qlu.edu.cn` 是统一身份认证链路的必要主机。后续若出现新的登录跳转主机，应先记录被阻止的 hostname、人工确认归属和用途，再把确切值加入静态允许列表。不得使用以下宽泛匹配：

```text
*.qlu.edu.cn
url.contains("qlu.edu.cn")
```

每次主框架跳转均验证：

- scheme 必须为 `https`；
- hostname 必须与允许列表完全匹配；
- URL 不得包含 user info，端口只能省略或为 `443`；
- 不允许 `file:`、`content:`、`javascript:` 等 URL；
- 未知的登录跳转必须阻止并显示实际 hostname，不得为了“放开认证”改成通配；普通外部链接后续可按产品需求交给系统浏览器，且不附带 WebView Cookie；
- 登录检测可在两个允许域名上运行，但查询和导出脚本只能在 `jw.qlu.edu.cn` 的已确认教务页面执行。

### 7.4 登录状态

用户在独立 WebView 中手动输入账号、密码和验证码。App 不读取输入框内容，不监听页面键盘输入，也不记录表单内容。

提供“保留登录状态”开关：

- 开启：使用持久化 WebView 数据存储；
- 关闭：任务结束后清理教务 WebView 使用的 Cookie、缓存和网站数据；
- 设置中提供“清除教务系统登录状态”；
- Cookie 只存在 Android WebView 管理的数据目录/Profile 中，不写入任务记录和日志；
- Capacitor 主 WebView 不使用 Cookie 保存产品设置或任务状态，避免清除教务登录状态时影响产品数据。

Android 传统 WebView 默认使用应用/进程级 Cookie 和站点数据，并非每个 `WebView` 自动拥有独立容器。正式实现采用以下兼容策略：

1. 基线方案使用应用级 WebView 数据存储，但教务外部页面只在不含 Capacitor Bridge 的 `GradeExportActivity` 中加载；
2. 当 AndroidX WebKit 运行时确认支持 `MULTI_PROFILE` 时，可为教务 WebView 使用命名 Profile，进一步隔离 Cookie、WebStorage 与缓存；
3. 不支持 Multi-Profile 的设备不得伪装成“独立 Cookie 容器”；清除登录状态时清理应用 WebView Cookie/站点数据，而 Preferences 和 Room 数据不受影响；
4. 不为获得隔离而默认把 Activity 放入另一个进程，因为这会显著增加插件事件、ArtifactStore 和任务恢复的跨进程复杂度。只有安全评审确认必要时再单独设计。

iOS 的 WKWebView 具有独立网站数据存储，因此登录和导出必须使用同一个 WKWebView 或同一个持久化数据存储：<https://developer.apple.com/documentation/foundation/httpcookiestorage>。

### 7.5 WebView 固定安全配置

教务 WebView 需要 JavaScript 才能完成学校页面交互，但不得继承浏览器式的宽泛能力。Android 正式版固定满足：

- `allowFileAccess=false`、`allowContentAccess=false`；
- 禁止 `file:` 页面访问其他文件或任意网络资源；
- `mixedContentMode=MIXED_CONTENT_NEVER_ALLOW`，Manifest/Network Security Config 禁止明文 HTTP；
- `onReceivedSslError` 直接取消，不调用 `proceed()`；
- Release 关闭 WebView debugging，启用 Safe Browsing；
- 不调用 `addJavascriptInterface` 向外部页面暴露通用对象；原生只主动执行固定、版本化脚本并拉取固定结构结果；
- `window.open`、`target=_blank`、重定向和顶层导航使用同一静态 hostname 允许列表；未知外链交给系统浏览器；
- 文件选择、下载、地理位置、摄像头、麦克风、剪贴板等能力默认拒绝，需要时逐项安全评审；
- 登录与导出 Activity 默认设置 `FLAG_SECURE`，避免密码、验证码或成绩进入截图和最近任务预览；GPA 明细页提供一致的隐私保护策略；
- 实现 `onRenderProcessGone`：销毁失效 WebView、持久化 `WEBVIEW_RENDERER_GONE`/`interrupted` 状态并允许用户重新开始，不复用旧实例。

## 8. 完整业务流程

### 8.1 App 启动

1. 读取普通设置和最近任务；
2. 恢复主题和欢迎状态；
3. 将没有可恢复原生会话的历史 `running` 任务修正为 `interrupted`，不能永久显示运行中；
4. 清理过期、无任务引用或上次崩溃遗留的临时 artifact；
5. 检查任务记录中的已保存 URI 是否仍可访问；无法访问时只标记 artifact 失效，不删除任务历史；
6. 不在启动时检测 aTrust；
7. 不在启动时自动访问教务系统；
8. 用户进入成绩导出工具后才创建 WebView。

### 8.2 开始导出

1. 用户选择学年、学期；
2. 用户点击“开始导出”；
3. 创建任务记录，状态为 `running`；
4. 打开独立教务系统 WebView；
5. 加载 `https://jw.qlu.edu.cn/`，设置 60 秒首屏超时；
6. 加载失败时提示用户检查 aTrust、校园网或服务器状态；
7. 加载成功后进入登录检测阶段；
8. 如果已有活动任务则返回现有 snapshot，不创建第二个任务；只有 Activity 仍存在且任务未进入终态时才算活动任务；
9. 每次开始新任务时，Vue 层先丢弃上一次的 `taskId` 和终态 UI；原生层按新 UUID 创建任务，禁止旧事件影响新任务。

### 8.3 用户登录

1. 用户在教务系统原始页面中手动登录；
2. 原生层监听顶层导航完成事件；
3. 在允许域名内检查登录成功 URL 和已知 DOM；
4. 自动识别失败时，允许用户点击“我已完成登录”；
5. 点击后再次严格验证 URL/DOM，不允许无条件继续；
6. 登录等待默认 15 分钟，和桌面端一致；
7. 用户关闭 WebView时，任务记为取消而不是失败。

登录识别规则可以移植当前桌面实现：

- URL 包含已知首页标记；
- 页面存在 `#sessionUser`、`#sessionUserKey` 或退出链接；
- 当前 URL 必须属于允许列表。

### 8.4 查询成绩

1. 登录成功后导航至成绩查询页；
2. 等待 `#xnm`、`#xqm` 及其选项加载，控件和选项等待上限各为 30 秒；
3. 学年输入在 TypeScript、Capacitor 参数和原生层之间始终使用四位字符串，例如 `"2025"`，不得由 `<select>` 隐式变成 number；页面学年选项优先按 `option.value` 精确匹配；
4. 学期业务参数固定使用教务系统代码：第一学期为 `"3"`，第二学期为 `"12"`；先在全部选项中按 `option.value` 全局精确匹配；
5. 只有精确值不存在时才允许按“第一/第二”或独立数字 `1/2` 回退匹配。数字必须满足边界 `(^|\D)N(\D|$)`，严禁使用 `text.includes("1")`/`includes("2")`，否则学年文本中的数字会误选学期；
6. 取得页面实际选项值 `selectedYear`、`selectedTerm` 后设置控件，分别派发冒泡的 `change` 事件，再点击 `#search_go`；
7. 点击后至少等待 800 ms，再等待 `window.jQuery` 不存在或 `jQuery.active === 0`，容错等待上限 15 秒；
8. 查询结束后重新读取 `#xnm` 和 `#xqm`，若与 `selectedYear`、`selectedTerm` 不一致则以 `SEMESTER_MISMATCH` 拒绝导出；
9. 记录不含个人数据的阶段日志。

上述顺序来自桌面端逻辑并已在移动 PoC 实机验证，正式 Kotlin 版必须原样保持其行为语义。脚本应放入共享、版本化的本地资源，不在运行时从远程下载。

### 8.5 请求导出

导出请求必须在当前已登录、同源的 WebView 页面内发起，以自然携带 WebView 会话。不要让业务层读取并长期持有 Cookie。

导出 POST 必须直接使用查询阶段确认过的页面值 `selectedYear` 和 `selectedTerm`。`"3" → "1"`、`"12" → "2"` 只用于用户文案、文件名和工作簿内容校验，绝不能用于改写导出请求中的 `xqm`。已验证的关键参数为：

```text
gnmkdmKey=N305005
xnm=<selectedYear>
xqm=<selectedTerm>
dcclbh=JW_N305005_GLY
exportModel.exportWjgs=xls
fileName=成绩单
```

`exportModel.selectCol` 按桌面端现有字段清单重复提交。即使参数名 `exportWjgs` 的值为 `xls`，当前服务器实际返回的是 OOXML `.xlsx`；仍必须以响应字节和工作簿结构判断格式，不能信任参数名、文件扩展名或 Content-Type。

```js
const response = await fetch(exportUrl, {
  method: 'POST',
  credentials: 'same-origin',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  },
  body,
})

if (!response.ok) throw new Error(`HTTP_${response.status}`)
const bytes = new Uint8Array(await response.arrayBuffer())
```

Android `WebView.evaluateJavascript()` 的回调不会等待 JavaScript `Promise` 完成。正式版必须沿用已验证的两阶段协议：固定脚本同步返回“已启动”，异步任务把最终 JSON 写入任务专属结果槽，原生层每 250 ms 轮询，整体查询/导出上限为 120 秒。不得把 `async` 函数直接作为 `evaluateJavascript()` 的最终返回值。

为避免一次性通过 JavaScript 回调传输较大的 Base64 字符串，采用分块协议：

1. 页面脚本将下载结果临时保存在该 WebView 的内存变量中；
2. 页面脚本返回原始字节总数与 Base64 长度；正式版同时使用 Web Crypto 计算 SHA-256；
3. 原生层按 128 KiB 分块主动读取；
4. 原生层写入 App cache 临时文件；
5. 传输完成后清除页面内存变量；
6. 取消或失败时删除不完整文件。

分块协议必须包含：

- 任务 ID；
- 总长度；
- 分块序号和偏移；
- 最大文件大小限制；
- 超时和取消；
- 重复块检测；
- 最终长度校验；
- 原生落盘后重新计算 SHA-256，并与页面端摘要严格一致。

最大文件大小设为 20 MiB，超过时中止并提示，防止异常响应占满内存。结果槽和文件槽必须包含 `taskId` 或使用任务专属随机名称，终态后立即删除，避免旧任务结果被下一次导出消费。

### 8.6 文件校验

保存给用户或交给 GPA 计算器之前完成：

1. HTTP 状态检查；
2. 响应长度检查；
3. Content-Type 记录但不单独作为可信依据；
4. 只接受 ZIP/OOXML `.xlsx` 文件头，明确拒绝 HTML、旧式 OLE `.xls` 和未知格式；
5. ZIP 条目数、单条目大小、总解压大小、压缩比和路径安全检查；
6. 工作簿 relationship、目标 worksheet 和必需列结构检查；
7. 实际学期与用户选择一致性检查；
8. 文件名清洗，禁止路径分隔符和控制字符；
9. SHA-256 与分块传输摘要一致性检查。

如果服务器返回 HTML 登录页、错误页、`.xls`、结构异常、超限 ZIP 或不一致学期，拒绝创建成功 artifact。

学期一致性校验必须读取工作表中标题为“学期”的列，收集非空数据值，再将 UI 参数 `"3"/"12"` 映射为内容值 `"1"/"2"` 比较。文件名中的学期不构成校验依据。阶段 0 已验证 `sheet1.xml` + `sharedStrings.xml`/`inlineStr` 的轻量解析可识别当前服务器工作簿；正式 `academic-core` 应保留该行为，同时补齐 relationship 定位、ZIP 条目/解压上限和路径安全检查。

### 8.7 保存与分享

Android 稳定版优先使用 Storage Access Framework 的 `ACTION_CREATE_DOCUMENT`，让用户选择文件名和保存位置，不申请广泛存储权限。

建议交互：

- “保存到文件”：打开系统保存界面；
- “发送到 WPS/Excel/QQ”：使用 `FileProvider`/`content://` URI、正确 MIME 和临时读取授权打开系统 Share Sheet；
- “计算 GPA”：直接读取 App cache 中刚导出的文件，不要求用户再次选择；
- 任务记录保存用户最终可访问的 URI、显示名称、MIME、大小和 artifact 状态，不假设存在传统绝对路径；
- 对 `ACTION_CREATE_DOCUMENT` 返回的 URI 申请可持久化读写授权；App 重启后仍可从任务记录打开；
- URI 对应文件被用户移动、删除或文档提供器失效时，将 artifact 标记为 `unavailable` 并提示重新导出，不把任务改成导出失败；
- 用户取消系统保存只关闭保存面板，不改变“导出成功”，仍允许在临时 artifact 有效期内再次保存、分享或计算 GPA。

iOS 后续使用 Document Picker/Share Sheet。移动端 UI 不显示桌面式“输出目录路径”输入框。

临时 artifact 默认保留到以下任一条件最先发生：用户明确释放、到达 TTL、缓存压力清理或 App 卸载。TTL 由设置常量定义并在 UI 中提示，不把 cache 当成永久文件。只要 artifact 仍有效，`retrySave` 不得重复访问教务系统。

### 8.8 GPA 计算

支持两条入口：

1. 成绩导出成功后直接进入 GPA 计算；
2. 通过系统文件选择器导入已有 `.xlsx`。

全部解析和计算在本机完成。导出入口直接复用 `ArtifactHandle`；导入入口先把 SAF 选择的文件复制到 App 受控临时目录，完成大小和格式预检后立即解析并删除临时副本。Kotlin 平台适配层执行 ZIP/XML 安全检查并只向专用 Worker 提供有行数、列数、单元格数和文本总量限制的二维表格；页面状态只保存规范化的 `GPAWorkbook`，不获得文件绝对路径或完整 Base64。

`academic-core` 在 Web Worker 中解析，主线程只负责进度和渲染。解析结果必须与桌面端同一版本核心和 golden fixtures 一致。页面使用移动端卡片和折叠明细，不保留桌面拖放交互。

## 9. 任务状态机

任务的“业务结果”和“文件去向”必须分开记录。用户取消保存不等于导出失败，已保存文件后来被删除也不改变历史导出结果。

业务阶段：

```text
idle
  → checking_access
  → opening_login
  → waiting_login
  → opening_scores
  → querying
  → downloading
  → validating
  → artifact_ready

任意运行状态
  → cancelled
  → failed
  → interrupted
```

持久化任务结果：

```ts
type TaskOutcome = 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted'
type ArtifactState = 'none' | 'temporary' | 'saved' | 'unavailable'
```

- `artifact_ready` 后立即把任务结果记为 `success`，artifact 状态为 `temporary`；
- 保存成功后 artifact 状态变为 `saved`，记录 SAF URI 和元数据；
- 用户取消保存时保持 `success + temporary`；
- 临时文件过期或已保存 URI 失效时变为 `unavailable`，任务历史仍保留；
- Activity/进程/WebView renderer 非用户原因中断时记为 `interrupted`，与用户主动 `cancelled` 区分；
- `Room` 中每次状态迁移使用事务和单调事件序号，非法回退、重复事件和其他 taskId 的事件必须拒绝。

建议事件：

```ts
type MobileGradeEvent =
  | { type: 'snapshot'; seq: number; task: GradeTaskSnapshot }
  | { type: 'status'; seq: number; taskId: string; stage: GradeStage; message: string }
  | { type: 'login_required'; seq: number; taskId: string }
  | { type: 'transfer_progress'; seq: number; taskId: string; loaded: number; total: number }
  | { type: 'artifact_ready'; seq: number; taskId: string; artifact: ArtifactHandle }
  | { type: 'artifact_saved'; seq: number; taskId: string; artifact: SavedArtifact }
  | { type: 'save_cancelled'; seq: number; taskId: string }
  | { type: 'cancelled'; seq: number; taskId: string; message: string }
  | { type: 'interrupted'; seq: number; taskId: string; code: GradeErrorCode; message: string }
  | { type: 'error'; seq: number; taskId: string; code: GradeErrorCode; message: string }
```

事件只是 UI 实时通知，不是唯一事实源。Room 中的 `GradeTaskSnapshot` 才是恢复依据；Vue 重新挂载、监听器丢失或 App 冷启动后必须先调用 `getActiveGradeTask/getGradeTask` 获取 snapshot，再消费后续事件。

建议错误码：

| 错误码 | 用户含义 |
|---|---|
| `SCHOOL_UNREACHABLE` | 教务系统不可访问，请检查 aTrust/校园网 |
| `TLS_ERROR` | 安全连接失败，不允许绕过证书校验 |
| `LOGIN_TIMEOUT` | 登录等待超时 |
| `LOGIN_NOT_DETECTED` | 尚未检测到登录成功 |
| `NAVIGATION_BLOCKED` | 页面跳转到了不允许的域名 |
| `PAGE_CHANGED` | 页面结构可能已更新 |
| `QUERY_FAILED` | 成绩查询失败 |
| `EXPORT_HTTP_ERROR` | 教务系统导出请求失败 |
| `EXPORT_NOT_WORKBOOK` | 返回内容不是有效工作簿 |
| `WORKBOOK_PARSE_FAILED` | 已收到 XLSX，但无法读取必需工作表、列或学期信息 |
| `FILE_FORMAT_UNSUPPORTED` | 返回的是不支持或无法完成校验的文件格式 |
| `SEMESTER_MISMATCH` | 返回学期与所选学期不一致 |
| `FILE_TOO_LARGE` | 文件超过安全限制 |
| `ZIP_LIMIT_EXCEEDED` | 工作簿解压结构超过安全限制 |
| `TRANSFER_INTEGRITY_FAILED` | 分块长度或 SHA-256 不一致 |
| `TRANSFER_FAILED` | WebView 到原生缓存的分块传输失败 |
| `SAVE_FAILED` | 系统保存失败，可在临时文件有效期内重试 |
| `ARTIFACT_UNAVAILABLE` | 临时或已保存文件已不可访问 |
| `WEBVIEW_CLOSED` | 用户关闭登录/导出页面 |
| `WEBVIEW_RENDERER_GONE` | WebView renderer 崩溃或被系统回收 |
| `TASK_INTERRUPTED` | Activity/App 进程中断，任务需要重新开始 |

## 10. 移动端 UI 方案

### 10.1 导航

使用底部导航替代桌面侧边栏：

```text
首页 | 工具 | 任务 | 设置
```

“关于”放入设置页。成绩导出和 GPA 作为工具详情页，通过系统返回键回到工具列表。

任务页继续覆盖桌面端的成功、失败和取消记录，并新增“异常中断”“文件仅临时保存”“文件已不可访问”提示。任务结果按钮根据 `ArtifactState` 显示“打开”“再次保存”“重新导出”，不能仅根据 URI 字符串是否为空决定。

### 10.2 成绩导出页

- 学年选择；
- 学期选择；
- 网络责任提示；
- “打开教务系统并开始”主按钮；
- 阶段式进度；
- 登录 WebView 全屏页；
- 保存、分享、计算 GPA 三个完成操作。

从 `artifact_ready` 开始即显示完成操作。用户取消系统保存后仍停留在完成页，并可再次保存；只有 artifact 失效后才要求重新导出。

网络提示建议明确：

> 工具箱不会连接或控制 VPN。请先自行通过 aTrust 或校园网确保教务系统可访问。

### 10.3 GPA 页面

- 系统文件选择按钮代替拖放区；
- 汇总卡片改为两列或横向滑动；
- 课程使用折叠卡片；
- 底部固定显示所选课程数、学分与 GPA；
- 支持安全区域、字体缩放、深色模式和系统返回键。

### 10.4 设置、数据与更新

移动端继续提供主题、欢迎/免责声明状态、保留登录状态、清除登录状态、清理日志和任务记录、版本、关于、非官方声明与更新检查。平台差异按 capability 呈现：

- 不显示桌面“首选浏览器”“备用 Chromium”“输出目录绝对路径”；
- 可以记录最近一次 SAF 文档提供器位置作为系统 Picker 提示，但不把它当作稳定目录路径；
- 清理任务记录不删除用户通过 SAF 保存到外部位置的文件；
- 清理临时文件会使 `temporary` artifact 变为 `unavailable`，执行前明确提示；
- 侧载版更新检查打开项目可信 Release 页面，应用商店版打开商店详情页，不申请静默安装权限；
- “关于”页内容与桌面端保持产品版本、许可证、非商业说明和隐私声明一致。

## 11. 安全与隐私设计

必须满足：

- 不收集账号、密码、验证码；
- 不上传 Cookie、成绩文件或成绩内容；
- 不关闭 TLS 校验，不提供“忽略证书错误”；
- 自动化脚本只在静态允许域名的顶层页面执行；
- 教务 WebView 不暴露通用原生 Bridge；
- 外部网页不能调用保存文件、读取设置等原生能力；
- 登录状态可由用户一键清除；
- 日志不记录完整 HTML、Cookie、Authorization、个人成绩内容；
- 临时文件任务结束后按策略清理；
- 登录/导出 Activity 默认启用 `FLAG_SECURE`，GPA 明细和最近任务预览采用一致的隐私遮挡策略；
- Android Auto Backup、云备份和设备迁移规则明确排除 WebView Cookie/Profile、成绩临时文件、日志和其他敏感缓存；
- Android 12+ 同时配置 `dataExtractionRules`，旧版本配置 `fullBackupContent`，并在 CI/真机恢复测试中验证；
- ArtifactStore 目录与主 WebView 私有只读资源目录独立，不暴露整个 App data/cache；
- Release 禁止 WebView debugging、明文 HTTP 和忽略证书错误；
- 发布包使用正式签名并提供 SHA-256。

应在隐私说明中明确：

- App 是非官方工具；
- 登录发生在学校教务系统页面；
- 用户应仅访问本人有权访问的数据；
- VPN 与教务系统连通性由用户自行负责；
- 学校系统变化可能导致功能暂时不可用。

## 12. Android 原生插件边界

建议插件名：`GradeExportPlugin`。

公开给 Vue 的最小方法：

```ts
interface GradeExportPlugin {
  start(options: GradeExportOptions): Promise<{ taskId: string }>
  continueAfterLogin(options: { taskId: string }): Promise<void>
  cancel(options: { taskId: string }): Promise<void>
  getActiveTask(): Promise<GradeTaskSnapshot | null>
  getTask(options: { taskId: string }): Promise<GradeTaskSnapshot | null>
  saveArtifact(options: { artifactId: string }): Promise<SavedArtifact | null>
  retrySave(options: { taskId: string }): Promise<SavedArtifact | null>
  shareArtifact(options: { artifactId: string }): Promise<void>
  openSavedArtifact(options: { taskId: string }): Promise<void>
  releaseArtifact(options: { artifactId: string }): Promise<void>
  clearLoginState(): Promise<void>
  addListener(
    eventName: 'gradeExportEvent',
    listener: (event: MobileGradeEvent) => void,
  ): Promise<PluginListenerHandle>
}
```

原生内部负责：

- WebView 创建与销毁；
- 允许域名校验；
- Activity、App 进程、WebView renderer 生命周期和系统返回键；
- 固定脚本执行、分块传输和 SHA-256 校验；
- ArtifactStore、随机句柄、TTL 和临时文件清理；
- Storage Access Framework、可持久化 URI 授权和 FileProvider 分享；
- Room 任务 snapshot、事件序号和异常中断修正；
- 任务取消；
- 登录状态清理；
- 向 Vue 发送已脱敏事件。

Vue 不直接获得 Cookie、绝对文件路径或完整 Base64，也不允许传入任意 URL 或任意 JavaScript。插件只接受白名单化选项、taskId 和 artifactId。插件初始化时恢复最近 snapshot；同一时间只允许一个活动导出任务。

## 13. 测试策略

### 13.1 共享核心自动化测试

- 学年格式和默认学年；
- 学期映射；
- POST body 构造；
- XLSX/HTML/损坏 ZIP 识别；
- ZIP 条目数、解压大小、压缩比、异常 relationship 和路径限制；
- 实际学期校验；
- GPA 课程分组和计算；
- 文件名清洗；
- 传输分块重组；
- SHA-256 不一致和重复/缺失块；
- 错误码映射。

所有样本必须脱敏，不提交真实账号、Cookie 或可识别成绩。Python 旧核心和 TypeScript `academic-core` 迁移并行期间，CI 使用相同 golden fixtures 比较课程、分项、警告、绩点、学期和错误码；不一致时禁止合并。迁移完成后桌面端和移动端都只发布同一 `academic-core` 版本。

### 13.2 Android 单元与集成测试

- 域名允许列表；
- URL scheme 拦截；
- WebView 生命周期；
- Activity 配置变化、后台回收、冷启动 snapshot 恢复；
- `onRenderProcessGone` 清理和错误映射；
- 返回键与用户取消；
- 临时文件清理；
- 单活动任务限制、重复/乱序事件和 listener 重订阅；
- SAF 保存成功/取消/失败、重启后打开、URI 移动或删除；
- FileProvider 分享授权和 MIME；
- 登录状态清除；
- 大文件和分块异常；
- Auto Backup/Data Transfer 排除规则；
- Release WebView debugging、明文 HTTP、文件访问和 SSL 错误处理配置。

### 13.3 真机测试矩阵

至少覆盖：

- Android 10、12、14 及当前主流版本；
- 不同 Android System WebView 版本；
- aTrust 已连接与未连接；
- Wi-Fi 和移动数据；
- 首次登录、已保留登录、退出登录；
- 验证码错误、登录超时；
- App 前后台切换；
- App 前后台切换后由系统杀进程再返回；
- WebView renderer 被测试工具终止；
- 旋转屏幕、分屏/折叠屏、系统深色模式、大字体；
- 导出后保存到本机、网盘、WPS/Excel；
- 取消保存后再次保存、直接 GPA、临时 artifact 过期；
- 重启 App 后从任务记录打开文件，以及文件被移动/删除；
- 教务系统慢响应和临时不可用。

CI 不运行真实账号的教务系统端到端测试。真实系统验证使用人工测试清单，避免把凭据放入 GitHub Actions。

## 14. CI/CD 与发布

建议拆分工作流：

```text
desktop-test.yml       Python tests + Vue typecheck
desktop-release.yml    Windows/macOS 构建
mobile-test.yml        shared tests + Android lint/unit test
android-release.yml    signed APK/AAB
ios-test.yml           后续添加
```

Android 首期发布建议：

1. 先提供内部测试 APK；
2. 技术验证稳定后提供签名 APK；
3. Release 中附 SHA-256；
4. 再决定是否发布应用商店/AAB；
5. 签名密钥不得提交仓库，通过 CI Secret 管理。

发布构建还必须：

- 使用锁文件安装依赖并校验 Capacitor/官方插件主版本一致；
- 执行 `academic-core` golden tests、Android lint、单元测试和 release 构建；
- 检查 backup/data extraction rules、Network Security Config、WebView debugging 和导出组件权限；
- 分别保存 AAB/APK、mapping、版本清单和 SHA-256；
- 不在 APK 内实现静默更新。侧载版更新提示打开可信 Release 页面，应用商店版打开对应商店详情页。

版本建议共享产品版本号，但产物带平台：

```text
QLU-Toolbox-Android-v1.2.3.apk
QLUToolbox_v1.2.3_windows_x64_Setup.exe
```

如果移动端发布节奏明显不同，可使用同一产品版本加构建号，而不是立即拆仓库。

## 15. 分阶段实施计划

### 阶段 0：Android 可行性验证（核心链路已通过）

目标：只回答“手机 WebView 登录后能否稳定导出”。该问题已得到肯定结论，验证结果已固化到文档、契约测试和 Git 历史中，PoC 源码不再继续保留或扩展。

工作：

- 建立最小 Capacitor Android App；
- 创建独立受限 WebView；
- 用户通过 aTrust 后打开教务系统；
- 验证登录、URL/DOM 检测；
- 在同一会话调用成绩导出接口；
- 将响应保存为临时 XLSX；
- 验证分块长度；SHA-256 完整性校验纳入正式测试版；
- 使用系统界面保存并用 WPS/Excel 打开；
- 测试保留和清除登录状态。

通过标准：

- 至少在两台不同 Android 设备上成功；
- 首次登录和保留登录均可工作；
- 返回文件通过桌面端现有校验；
- 返回 `.xls`、HTML 或学期不一致时拒绝成功；
- 断网/aTrust 未连接时有明确错误；
- App 不读取账号密码，不上传数据；
- 取消后无残留不完整文件；
- 用户取消系统保存后仍可再次保存，不需要重新访问教务系统；
- Activity 重建和 WebView renderer 终止后任务进入可解释状态。

本轮实机已经确认首次/保留登录、统一认证、跨学年、第一/第二学期、查询、导出、实际学期校验、系统保存、打开文件以及连续重复任务的核心链路。两台设备矩阵、断网/aTrust 诊断、Activity 重建、renderer 终止、完整传输摘要和完整 ZIP 安全限制继续作为正式测试版验收项，不因单机核心链路通过而豁免。

预计：3～7 个开发日，不包含等待学校系统恢复或收集测试设备的时间。

### 阶段 1：共享核心与平台接口

- 新增 npm workspaces；
- 建立 `contracts` 与 `academic-core`；
- 抽象 `ToolboxPlatform`；
- 移植 GPA、学期、导出参数和 XLSX 校验；
- 建立脱敏工作簿、JSON golden fixtures、Vitest 和 Python 对照测试；
- 调整桌面 Python 为浏览器自动化边界，桌面校验和 GPA 切换到 `academic-core`；
- 引入 `ArtifactHandle`，页面不再依赖桌面绝对路径；
- 保证桌面端测试继续通过。

预计：1～2 周；桌面端单一事实源迁移未完成时不得删除 Python 旧实现。

### 阶段 2：Android MVP

- 移动端首页、工具、任务、设置；
- 完整成绩导出状态机；
- Room snapshot、异常中断恢复和单活动任务限制；
- ArtifactStore、私有读取通道、文件保存与分享；
- GPA 导入和计算；
- 登录状态管理；
- 平台化更新提示、隐私数据清理；
- 深色模式、无障碍和基础适配。

预计：2～3 周。

### 阶段 3：稳定化与发布

- 多设备测试；
- 安全检查和日志脱敏；
- WebView renderer、进程回收、URI 失效和备份恢复测试；
- 页面变化容错；
- 无障碍和大字体；
- Release 签名、CI 和文档；
- 用户测试反馈修复。

预计：2～4 周，取决于教务系统、统一认证、aTrust 和不同厂商 WebView 的真机兼容性。

### 阶段 4：iOS 评估与实现

Android 稳定后再验证：

- WKWebView 登录流程；
- Cookie 持久化；
- 统一认证跳转和弹窗；
- Document Picker/Share Sheet；
- App Store 的演示模式、隐私说明与最低功能要求。

Apple 要求应用具有超越简单网站封装的实际功能，因此 iOS 版本应同时提供本地 GPA、任务记录、文件管理等完整工具体验：<https://developer.apple.com/app-store/review/guidelines/#minimum-functionality>。

## 16. 阶段 0 验证结果与正式版输入

以下状态记录阶段 0 已完成的实机验证结果：

- [x] 历史 PoC 已验证最小 Capacitor Android 工程和独立 `GradeExportActivity`；
- [x] `jw.qlu.edu.cn`、`sso.qlu.edu.cn` 精确 HTTPS/443 允许列表；
- [x] 教务系统加载、网络/TLS/HTTP 错误和未知域名阻止；
- [x] 登录成功 URL/DOM 检测、统一认证跳转、保留和清除登录状态；
- [x] 跨学年、第一/第二学期设置、查询和导出 POST 脚本；
- [x] Promise 异步结果槽、250 ms 轮询、120 秒总超时；
- [x] 128 KiB Base64 分块传输、20 MiB 上限和最终长度校验；
- [x] XLSX/ZIP 文件头、工作表“学期”列和所选学期一致性校验；
- [x] `ACTION_CREATE_DOCUMENT` 保存、取消保存后再次保存、通过 WPS/Excel 打开；
- [x] 终态任务释放、旧 `taskId` 清理和连续重复导出；
- [x] 取消/失败时删除临时文件，启动新 Activity 时清理遗留缓存；
- [x] Kotlin 正式工程、Kotlin 单元测试、Android lint 和可安装调试 APK；
- [x] ArtifactStore、不透明 `artifactId`、SHA-256 和完整 ZIP 安全限制；
- [x] Room snapshot、冷启动孤立任务修正和 Activity 重建中断保护；
- [ ] 完整进程回收、`onRenderProcessGone` 和事件重订阅的完整仪器测试矩阵；
- [x] FileProvider/Share Sheet 分享、持久化 SAF URI和任务记录；
- [ ] 已保存 SAF URI 被移动、删除或撤销授权后的失效检测与状态修正；
- [x] 本地 GPA 导入、课程选择与加权计算；
- [ ] 至少两台 Android 真机的完整支持矩阵记录。

下一步进入阶段 1 和阶段 2 的正式 Kotlin 测试版开发。PoC 中已验证的页面交互和业务不变量先形成契约测试，再迁移原生实现；在正式 Android 基线稳定前，不进行桌面端目录大迁移，也不实现 iOS。

## 17. 主要风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 教务页面不兼容 WebView | 无法登录或查询 | 阶段 0 真机验证；保留桌面端 |
| 登录跳转到未知统一认证域 | 被允许列表拦截 | 记录导航，人工审核后静态加入准确域名 |
| 教务页面 DOM 更新 | 登录/查询检测失败 | 版本化选择器、多信号检测、友好错误 |
| App 切后台后被系统回收 | 任务中断或永久显示运行中 | Room snapshot、冷启动修正为 `interrupted`、允许重新开始 |
| WebView renderer 被回收或崩溃 | App 崩溃或复用无效实例 | `onRenderProcessGone`、销毁旧实例、持久化中断原因 |
| 大 Base64/ExcelJS 导致内存峰值 | 崩溃或卡顿 | 限制大小、分块传输、Web Worker、ArtifactStore、基准测试 |
| ZIP bomb 或异常 OOXML | 内存耗尽或解析阻塞 | 条目数、解压大小、压缩比、relationship 和路径限制 |
| Cookie/原生桥泄露 | 高安全风险 | 独立 WebView、无通用 Bridge、严格域名和固定脚本 |
| Android WebView Cookie 并非天然独立 | 清理范围或隔离声明错误 | 明确应用级基线；运行时支持时使用命名 Profile |
| 用户取消保存或 SAF URI 失效 | 成功任务被误判失败、文件打不开 | 业务结果与 ArtifactState 分离、持久化授权、失效检测 |
| Python 与 TypeScript 规则漂移 | 桌面和移动结果不同 | `academic-core` 单一事实源、迁移期 golden tests |
| Android Auto Backup 复制敏感数据 | Cookie/成绩被云备份或迁移 | 双版本备份排除规则和恢复测试 |
| 用户未连接 aTrust | 无法访问教务系统 | 明确提示，用户自行连接后重试 |
| iOS 登录 Cookie 不连续 | iOS 导出失败 | 同一 WKWebView/数据存储，Android 稳定后单独 PoC |
| 应用商店审核 | 发布延迟 | 强化本地工具价值、隐私说明和演示模式 |

## 18. 最终架构决策

本方案确定以下原则：

1. 移动端继续使用当前仓库；
2. 使用 Vue 3 + TypeScript + Capacitor；
3. Android 优先，iOS 后续；
4. 桌面端保留 Python + Playwright 负责浏览器自动化，纯业务规则统一迁移到 TypeScript `academic-core`；
5. 移动端采用独立受限 WebView，而不是移动端 Playwright；
6. 用户手动登录，App 只自动完成登录后的查询、导出和校验；
7. VPN/aTrust 和教务系统连通性完全由用户负责；
8. App 不上传账号、Cookie 或成绩数据；
9. 页面和公开 Bridge 只使用不透明 `ArtifactHandle`，不传递完整 Base64、Cookie 或绝对文件路径；
10. 任务业务结果与文件保存状态分离，用户取消保存不等于导出失败；
11. Android 任务使用 Room snapshot 恢复，Activity/进程/renderer 中断不得遗留永久运行状态；
12. Android WebView 数据隔离按运行时能力实施，不把“独立 Activity”误写成“独立 Cookie 容器”；
13. SAF URI、FileProvider、ArtifactStore TTL 和 URI 失效共同构成移动端文件生命周期；
14. 敏感 WebView、Cookie、成绩缓存和日志必须从备份与设备迁移中排除；
15. 先完成 Android 技术验证，再迁移单一业务核心和开发完整 UI；
16. 所有移动端自动化都必须在允许域名、前台可见和用户知情的条件下运行。

阶段 0 已完成，因此第 15 条从决策门槛转为实施顺序：正式测试版使用 Kotlin，先把已验证的登录、精确学期选择、查询、异步结果轮询、同源导出、工作簿学期校验和终态任务释放迁移为可测试模块，再接入 Room、ArtifactStore、`academic-core`、GPA 与完整产品 UI。

正式进入 Android 稳定版发布前，必须同时满足以下 Go/No-Go 条件：

1. 桌面端与 Android 端对全部脱敏 golden fixtures 产生一致的课程、学期、警告和 GPA 结果；
2. 首次登录、保留登录、统一认证跳转和手动继续在支持矩阵设备上通过；
3. 导出、取消保存、再次保存、分享、直接 GPA 和导入 GPA 全链路通过；
4. Activity 重建、后台进程回收、listener 重订阅和 WebView renderer 终止均产生可恢复或可解释状态；
5. App 重启后可打开仍有效的 SAF 文件，文件移动/删除时能正确降级；
6. Release 安全配置、备份排除、日志脱敏、签名和 SHA-256 检查通过；
7. 教务系统不可达、TLS 错误、HTML 响应、`.xls`、损坏/超限 ZIP 和学期不一致均拒绝错误成功。
