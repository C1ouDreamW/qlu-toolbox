# 开发与发布

日常开发使用 Debug，功能完成后通过 CI、合并 PR。什么时候发 Alpha 或正式版，由维护人另行决定；当前所有发布开关关闭，本轮不发版。

## 开发

按 [贡献指南](CONTRIBUTING.md)安装依赖，运行 `npm run doctor`。本地启动和普通打包默认 Debug，不需要正式或 Alpha 密钥。PR CI 完成三端测试、Debug 构建和应用身份 / 版本校验，构件保留 7 天。

Alpha / Debug 可以与 Stable 共存，私有数据互不读取；需要转移课表时，由用户主动导出再导入。Android 不同机器的 Debug 密钥可能不同，签名冲突时只处理独立 Debug 应用，不卸载 Stable。

## 以后发版时

1. 在 `config/release-versions.json` 更新本平台对应渠道的版本和构建号，并更新 `changelogs/<platform>.md`。
2. 在 `config/release-migration.json` 启用该渠道发布开关，合入 main。
3. 创建本平台标签并推送；标签格式见 [版本配置](config/README.md)。Alpha 生成 prerelease，Stable 生成正式 Release，其他平台不受影响。
4. 工作流构建并校验包，上传完整资产后公开。需要更新自建源时，下载该平台 / 渠道的 update-source，上传 release 目录，再用 `scripts/promote-update-manifest.mjs` 切换对应清单；Android 备用清单通过单独分支更新。

正式版和 Alpha 分别构建，不把 Alpha APK 改名当作 Stable。Android Alpha 使用独立固定证书，Stable 沿用现有正式证书。已公开版本和标签不能覆盖；失败上传可在摘要一致时补齐，修改包则增加版本和构建号。

发布记录与 SHA256SUMS 随构件保存，用于确认版本、来源提交和最终文件。保留基本来源、包身份、证书、摘要和版本递增检查；不再要求额外验收 / 晋级批准文件或强制 SBOM 归档。

首次桌面独立正式发版时，再决定旧更新源如何迁移；旧版用户可能需要手动下载安装。当前不运行迁移、不修改线上文件。

## 签名与问题处理

正式四项仓库 Secret 保持原样，Alpha 使用四项独立 Secret；不要求 Environment，也不要求把长期 key 放到新 Mac。具体名称和备份原则见 [签名说明](docs/release-security.md)。

PR 和依赖安装 / 构建任务不接收长期密钥；只有来自 main 的有效发布标签才进入签名步骤，签名前后核验实际 APK。普通功能故障走 Issue，安全或隐私问题按 [SECURITY.md](SECURITY.md)私下报告。

发现发布问题时先停止推广，保留 run、commit 和构件摘要，再发布更高版本修复；不要替换已公开文件或把回退伪装为正常升级。
