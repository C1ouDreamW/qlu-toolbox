# 平台与渠道版本

`release-versions.json` 是版本的唯一人工入口，schema 2 按 Windows / macOS / Android 分别保存 Stable 和 Alpha：

- Stable：`major.minor.patch`。
- Alpha：`major.minor.patch-alpha.N`，N 从 1 开始。
- Debug：默认开发渠道，从本平台 Alpha 基础版本生成 `major.minor.patch-debug.0`。

每个平台独立更新版本和变更日志，不要求同时发三端。桌面增加本渠道 `buildNumber`，Android 增加本渠道 `versionCode`；已公开版本不能替换成不同字节。

| 平台 | Stable 标签 | Alpha 标签 |
|---|---|---|
| Windows x64 | `win-v2.1.0` | `win-alpha-v2.1.0-alpha.1` |
| macOS arm64 | `mac-v2.1.0` | `mac-alpha-v2.1.0-alpha.1` |
| Android | `android-v2.1.0` | `android-alpha-v2.1.0-alpha.1` |

以上是命名示例，不代表这些版本已经发布。当前配置中的 Alpha 版本也只是开发起点。

## 构建身份

`prepare-release.mjs` 统一注入版本、原生构建号和渠道身份；桌面同步 package / lock / Python 版本，移动端同步 workspace / lock 和原生包所读元数据。Debug 和 Alpha 使用独立名称、应用 ID、私有数据目录；Stable 保留原身份和数据路径。

```bash
# 只读检查
npm run release:prepare -- --platform windows --channel debug --check
# 实际准备；platform 可换 macos / android
npm run release:prepare -- --platform windows --channel debug
```

日常 `npm run dev`、桌面打包命令、`npm run mobile:build` 默认 Debug。生成的 build-info.json 不提交；版本注入产生的 package / lock / Python 改动要与真实源码、依赖改动区分，不能自动清空用户工作区。

Debug 不检查在线更新；Alpha / Debug 不发送匿名统计。Alpha 和 Stable 各自读取本平台渠道清单及对应 GitHub prerelease / release，Android 覆盖安装时仍校验包名、版本号、证书和摘要。

## 发布配置

`release-migration.json` 目前保持：

- `independentPublishingEnabled=false`：正式发布关闭。
- `alphaPublishingEnabled=false`：Alpha 发布关闭。
- `bridgeVersion=null`：暂未指定旧桌面迁移版本，仅保留旧更新格式兼容能力。
- 两个 Android 签名指纹只保存公开 SHA-256，Alpha 必须与 Stable 不同。

当前只开发并合并代码，不创建发布标签。以后发版时再启用对应开关、更新本端 `changelogs/<platform>.md` 并创建标签，见 [发布指南](../RELEASING.md)。不需要晋级批准文件、候选验收状态机或 SBOM 前置任务。

发布工作流从不可变标签读取配置，要求提交已进入 main；未提交的工作区修改不能打开发布。Android 将无密钥构建、独立签名与公开 Release 分开，PR 仅生成 Debug，不接收长期签名 Secret。

旧桌面用户的更新源迁移在首次独立正式发版时处理，不作为本 PR 合并条件。首次切换可能需要用户手动下载安装；当前不更改线上清单。
