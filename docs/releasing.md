# 开发与发布

日常开发使用 Debug，功能完成后通过 CI、合并 PR。Alpha 和 Stable 各有一个版本号，每个版本的三个客户端一起发布。

## 开发

按 [贡献指南](../CONTRIBUTING.md)安装依赖，运行 `npm run doctor`。本地启动和普通打包默认 Debug，不需要正式或 Alpha 密钥。PR CI 完成三端测试、Debug 构建和应用身份 / 版本校验，构件保留 7 天。

Alpha / Debug 可以与 Stable 共存，私有数据互不读取；需要转移课表时，由用户主动导出再导入。Android 不同机器的 Debug 密钥可能不同，签名冲突时只处理独立 Debug 应用，不卸载 Stable。

## 发布客户端

1. 在 `config/release-versions.json` 更新对应渠道的共用版本号和三个原生构建号。分别在三份 `changelogs/<platform>.md` 添加同版本的日志。
2. 在 `config/release-migration.json` 启用该渠道发布开关，合入 main。
3. 给已合入 `main` 的提交创建并推送一个标签。Stable 用 `vX.Y.Z`，Alpha 用 `vX.Y.Z-alpha.N`。见 [版本配置](../config/README.md)。
4. `Release LumaTile` 分别构建 Windows、macOS 和 Android。Android 在独立任务中签名。三端产物齐全并验证后，工作流公开同一条 GitHub Release。Stable 标记为 Latest，Alpha 标记为 prerelease。
5. Android 自动部署同一签名 APK 到对应渠道的自建源，并生成 GitHub 备用清单分支。部署失败时可在原工作流重试部署任务，见[部署说明](../deploy/server/README.md)。

正式版和 Alpha 分别构建，不把 Alpha APK 改名当作 Stable。Android Alpha 使用独立固定证书，Stable 沿用现有正式证书。已公开版本和标签不能覆盖；失败上传可在摘要一致时补齐，修改包则增加版本和构建号。

发布记录与 SHA256SUMS 随构件保存，用于确认版本、来源提交和最终文件。保留基本来源、包身份、证书、摘要和版本递增检查；不再要求额外验收 / 晋级批准文件或强制 SBOM 归档。

## 已安装版本的升级

`2.0.5-alpha.1` 的独立预发布已撤回。已安装该版本的测试者可以从下一条统一 GitHub 预发布手动覆盖安装同渠道版本。Android 延用对应的 Alpha 证书，`versionCode` 必须高于 1。

桌面 `v2.0.4` 支持从 GitHub 正式版页面下载统一版本，Android `v2.0.4` 继续使用既有的 Stable 清单路径。新版客户端从统一 Release 中选取本平台的清单和下载资产。

## 签名与问题处理

正式四项仓库 Secret 保持原样，Alpha 使用四项独立 Secret；不要求 Environment，也不要求把长期 key 放到新 Mac。具体名称和备份原则见 [签名说明](release-security.md)。

PR 和依赖安装 / 构建任务不接收长期密钥；只有来自 main 的有效发布标签才进入签名步骤，签名前后核验实际 APK。普通功能故障走 Issue，安全或隐私问题按 [SECURITY.md](../SECURITY.md)私下报告。

发现发布问题时先停止推广，保留 run、commit 和构件摘要，再发布更高版本修复；不要替换已公开文件或把回退伪装为正常升级。
