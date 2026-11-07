# Android 签名说明

开发和 PR 使用独立 Debug 应用及临时 Debug key，不需要在新 Mac 上保存正式或长期 Alpha 密钥。

| 渠道 | 仓库 Secrets |
|---|---|
| Stable | `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` |
| Alpha | `ANDROID_ALPHA_KEYSTORE_BASE64`、`ANDROID_ALPHA_KEYSTORE_PASSWORD`、`ANDROID_ALPHA_KEY_ALIAS`、`ANDROID_ALPHA_KEY_PASSWORD` |

现有正式四项 Secret 保持原样，不迁移、不替换，不要求 Environment。维护人已在 Windows 创建并确认备份 Alpha key，报告 Alpha Secrets 已配置；公开指纹保存在 `config/release-migration.json`，不同于正式证书。当前未实际使用长期 Alpha key 或执行新版本发布。

## 基本安全边界

- PR CI 只构建 Debug，权限只读，不引用长期签名 Secrets。
- 发布标签与该平台 / 渠道配置一致，源码必须已经进入 main；任意分支不能直接取得签名能力。
- Android 分为无密钥构建、独立签名、公开 Release 三个任务。签名 runner 不运行 npm / Gradle 构建或构件内脚本。
- 签名前核对构建任务独立输出的 APK 与回执摘要、来源 commit、run / attempt、原生和 Web 身份；签名后核对证书、包名、Release 状态与最终摘要。
- Alpha 和 Stable 显式选择各自 Secrets，不在 Alpha 缺失时回退到正式 key。
- 签名临时文件在成功和失败路径均清理；密钥、密码、Base64 不进入日志、缓存或构件。签名任务不持有 Release 写权限，公开任务不接收密钥。

仓库写权限人员仍属于仓库 Secret 的信任范围；代码约束不能替代维护人对仓库权限和源码的管理。

## 保管

密钥和口令保留独立备份，GitHub Secret 不能代替备份。密码由维护人在私有终端或密码管理器中输入，不发到聊天、Issue 或日志；Base64 是可逆编码，也属于密钥。

需要检查证书时，可在私有终端运行 `keytool -list -v -keystore <仓库外密钥文件> -alias <alias>`，由提示输入口令。这里只核对公开证书；实际私钥口令是否有效，在需要签名时由签名任务确认。原正式密码找回不阻塞日常开发。

本轮不发布正式或桥接版本。后续按 [发布指南](../RELEASING.md)决定版本和标签，不增加单独的验收 / 晋级批准流程。早期正式签名 PR 演练已取消；历史日志未确认密钥外泄，也不能据此证明没有暴露，不因本次精简自动轮换正式 key。
