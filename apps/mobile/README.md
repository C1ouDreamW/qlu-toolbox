# QLU 工具箱 Android 正式测试版

这是 `docs/MOBILE_DEVELOPMENT_SOLUTION.md` 对应的正式 Android 工程。阶段 0 的 Java PoC 已完成使命并从当前源码树移除。

## 技术栈

- Vue 3 + TypeScript + Vite
- Capacitor 8
- Kotlin 2.2
- Android Room 2.7
- Android System WebView、Storage Access Framework、FileProvider
- JDK 21、Gradle 8.14.3、AGP 8.13、compile/target SDK 36、min SDK 24

正式原生源码只使用 Kotlin；历史 PoC 的实机验证结论已经固化到技术文档与自动化测试中。

## 当前测试版能力

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
- 与桌面端一致的应用图标、蓝色主品牌色、黄色强调色和深色模式配色。

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

正式包使用应用 ID `cn.edu.qlu.toolbox`。
