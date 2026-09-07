# 一格有光 · LumaTile Android

这是 `docs/MOBILE_DEVELOPMENT_SOLUTION.md` 对应的正式 Android 工程。阶段 0 的 Java PoC 已完成使命并从当前源码树移除。

## 技术栈

- Vue 3 + TypeScript + Vite
- Capacitor 8
- Kotlin 2.2
- Android Room 2.7
- Android System WebView、Storage Access Framework、FileProvider
- JDK 21、Gradle 8.14.3、AGP 8.13、compile/target SDK 36、min SDK 24

正式原生源码只使用 Kotlin；历史 PoC 的实机验证结论已经固化到技术文档与自动化测试中。

## 当前能力

- 精确允许 `jw.qlu.edu.cn` 与 `sso.qlu.edu.cn` 的 HTTPS/443 顶层导航；
- 独立、无通用 JavaScript Bridge 的教务 WebView；
- 手动登录、登录状态保留/清除；
- 跨学年、第一/第二学期查询与同源导出；
- Promise 结果轮询、128 KiB Base64 分块、20 MiB 上限和 SHA-256 双端校验；
- XLSX 文件头、ZIP 路径/体积/压缩比、工作表关系和实际学期校验；
- Room 任务 snapshot、单活动任务、终态释放和最近任务列表；
- 临时 ArtifactStore、24 小时 TTL、系统保存、重新保存、打开与分享接口；
- 网络、TLS、未知域名、页面变化、传输、格式和学期不一致错误分类。
- 从导出结果直接计算 GPA，或通过系统文件选择器导入分项成绩 XLSX；
- 课程分组、总评识别、逐课勾选、总学分、成绩点和加权 GPA 本地计算；
- GPA 与桌面端共用的成绩规则测试，以及 Android 真机 OOXML 行读取测试。
- 冷启动孤立任务修正与 Activity 重建中断保护，不会静默重复启动导出；
- 课表工具：周视图（今日列高亮）、滑动切周、课程编辑器、多课表切换管理、开学日期与作息时间设置；
- 课表导入：应用内登录教务后接管"输出EXCEL"导出并校验文件，或从系统文件选择器导入 Excel 与 `.lumatile-schedule.json` 备份；课表可导出备份并经系统分享面板发送，与桌面端互相导入；
- 课表页面适配系统返回键逐级返回，首页双击返回退出；
- 与桌面端一致的应用图标、蓝色主品牌色、黄色强调色和深色模式配色。
- 使用永久 Android 应用 ID `io.github.c1oudreamw.lumatile`，显示名称为“一格有光”。
- 优先读取自建更新源，并保留 `qlu-toolbox` 与 `lumatile` 两个 GitHub 清单作为迁移期备用渠道。
- 下载更新 APK 后校验 applicationId、versionCode、签名证书、文件大小和 SHA-256，再交给 Android 系统覆盖安装。

WebView renderer/完整进程回收测试、已保存 URI 失效处理和多设备支持矩阵仍按技术方案继续开发，不在本测试包中宣称完成。

## 构建

```powershell
npm install
npm run mobile:build
npm run mobile:sync
cd apps/mobile/android
./gradlew.bat testDebugUnitTest assembleDebug
```

APK 输出：`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`。

安装到已连接设备：

```powershell
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

正式包使用永久应用 ID `io.github.c1oudreamw.lumatile`。从本迁移版开始，后续“一格有光 / LumaTile”版本必须保持相同 applicationId、正式签名证书和递增的 versionCode，才能覆盖安装并保留应用数据。

此前安装过 `cn.edu.qlu.toolbox` 测试包的设备需要先卸载旧测试包；Android 不会把不同 applicationId 识别为同一个应用。

## 更新渠道

应用独立请求以下公开清单：

```text
https://lumatile.ishua.cloud/stable/android.json
https://raw.githubusercontent.com/C1ouDreamW/qlu-toolbox/main/updates/android.json
https://raw.githubusercontent.com/C1ouDreamW/lumatile/main/updates/android.json
```

更新器会从所有成功且有效的结果中选择 versionCode 最大的版本，相同版本出现不同 SHA-256 时拒绝更新。v2.0.0 继续使用 GitHub APK 完成旧客户端桥接；后续 APK 可由自建源分发。

## 正式签名

复制 `android/keystore.properties.example` 为 `android/keystore.properties` 并填写本地密钥信息，或设置：

```text
ANDROID_KEYSTORE_FILE
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

没有正式签名配置时只能构建 Debug APK，`assembleRelease` 会主动失败，防止误发布无法延续升级链的未签名包。密钥文件和密码不得提交到仓库。

GitHub Actions 正式发布还需要配置以下仓库 Secrets：

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

工作流会强制使用 CI 中解码出的正式密钥库完成 Release 构建；构建成功后直接上传 APK，不再执行额外的证书文本解析校验。
