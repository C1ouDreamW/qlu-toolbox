# Android 查分可行性 PoC

该工程对应 `docs/MOBILE_DEVELOPMENT_SOLUTION.md` 的“阶段 0”，只验证以下核心链路：

1. 用户在独立 Android WebView 中手动登录教务系统；
2. App 通过受信 URL 或已知 DOM 判断登录成功；
3. 在同一 WebView 会话中选择学年/学期、查询并发起导出 POST；
4. 将响应按 128 KiB Base64 分块写入 App 缓存；
5. 检查 20 MiB 上限、最终长度、XLSX/ZIP 文件头和工作簿实际学期；
6. 使用系统 `ACTION_CREATE_DOCUMENT` 保存，并交给 WPS/Excel 打开；
7. 验证保留登录状态、清除登录状态和取消后的临时文件清理。

## 安全边界

- 教务 WebView 没有调用 `addJavascriptInterface`，不暴露通用原生 Bridge。
- 目前只允许顶层页面访问精确主机 `https://jw.qlu.edu.cn:443` 和学校统一认证 `https://sso.qlu.edu.cn:443`，禁止 HTTP、子域通配、用户信息和非 443 端口。
- TLS 错误始终取消，不提供忽略证书的选项；App 也禁用明文流量和混合内容。
- 账号、密码、Cookie、HTML 和成绩内容不会上传，也不会写入业务日志。
- App 使用 `FLAG_SECURE` 避免登录页和成绩页出现在截图/最近任务预览中。

学校统一认证主机 `sso.qlu.edu.cn` 已根据学校公开登录页面加入精确白名单。如果后续又跳转到其他主机，App 会在 `NAVIGATION_BLOCKED` 提示中显示被阻止的主机；应先人工确认该 HTTPS 主机，再以精确值加入 `GradeExportSecurity`，不要改成通配匹配。

## 本地构建

需要 Node.js 22+、JDK 21 和 Android SDK（compile/target SDK 36）。

```powershell
npm install
npm run mobile:build
npm run mobile:sync
cd apps/mobile-poc/android
.\gradlew.bat testDebugUnitTest assembleDebug
```

调试 APK 生成到 `apps/mobile-poc/android/app/build/outputs/apk/debug/app-debug.apk`。

## 真机验证清单

- [ ] 已连接 aTrust/校园网时能打开 `jw.qlu.edu.cn`，未连接时错误提示明确。
- [ ] 首次登录和保留登录后的再次导出均可继续。
- [ ] 登录页的账号、密码和验证码只能由用户在学校页面输入。
- [ ] 第一、第二学期各完成一次导出，文件可由 WPS/Excel 打开。
- [ ] 导出的文件通过桌面版现有学期和工作簿校验。
- [ ] 取消登录、取消保存、断网和关闭页面后没有残留 `.part` 文件。
- [ ] “清除教务登录状态”后必须重新登录。
- [ ] 未知域名、HTTP、TLS 错误和异常大响应均被拒绝。
- [ ] 至少在两台不同 Android 设备上记录系统版本、System WebView 版本和结果。

PoC 已校验文件头、长度和工作簿实际学期；更完整的工作簿结构校验、分享和本地 GPA 计算属于后续 MVP 阶段。
