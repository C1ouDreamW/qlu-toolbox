# 客户端渠道与版本

`release-versions.json` 是版本的唯一人工入口。schema 3 为 Stable 和 Alpha 各保存一个三端共用版本号，以及各平台的原生构建号。

- Stable：`major.minor.patch`。
- Alpha：`major.minor.patch-alpha.N`，N 从 1 开始。
- Debug：默认开发渠道，从本平台 Alpha 基础版本生成 `major.minor.patch-debug.0`。

每次发布增加对应渠道的版本号、两端桌面的 `buildNumber` 和 Android 的 `versionCode`。三个原生计数分别递增。各平台更新日志仍记录各自交付内容。

| 平台 | Stable 标签示例 | Alpha 标签示例 |
|---|---|---|
| Windows x64、macOS arm64、Android | `v2.1.0` | `v2.1.0-alpha.1` |

每个标签对应一条 GitHub Release。已撤回的 `2.0.5-alpha.1` 原生构建号和标签是历史基线，下次发布使用更高版本和构建号。

## 构建身份

`prepare-release.mjs` 统一注入版本、原生构建号和渠道身份；桌面同步 package / lock / Python 版本，移动端同步 workspace / lock 和原生包所读元数据。Debug 和 Alpha 使用独立名称、应用 ID、私有数据目录；Stable 保留原身份和数据路径。

```bash
# 只读检查
npm run release:prepare -- --platform windows --channel debug --check
# 实际准备；platform 可换 macos / android
npm run release:prepare -- --platform windows --channel debug
```

日常 `npm run dev`、桌面打包命令、`npm run mobile:build` 默认 Debug。生成的元数据分别位于 `apps/desktop/python/lumatile/build-info.json` 和 `apps/mobile/build-info.json`，均被 Git 忽略。提交前检查版本注入产生的 package、lock 和 Python 版本文件改动，保留实际的源码和依赖变更。

Debug 不检查在线更新；Alpha / Debug 不发送匿名统计。Alpha 和 Stable 各自读取本平台渠道清单及对应 GitHub prerelease / release，Android 覆盖安装时仍校验包名、版本号、证书和摘要。

## 发布配置

`release-migration.json` 目前保持：

- `stablePublishingEnabled=false`：正式发布关闭。
- `alphaPublishingEnabled=false`：Alpha 发布关闭。
- `bridgeVersion=null`：暂未指定旧桌面迁移版本，仅保留旧更新格式兼容能力。
- 两个 Android 签名指纹只保存公开 SHA-256，Alpha 必须与 Stable 不同。

发版时启用对应开关、更新三份 `changelogs/<platform>.md` 并创建一个共用标签，见 [发布指南](../docs/releasing.md)。

发布工作流从不可变标签读取配置，要求提交已进入 main；未提交的工作区修改不能打开发布。Android 将无密钥构建、独立签名与公开 Release 分开，PR 仅生成 Debug，不接收长期签名 Secret。

客户端支持统一标签和历史平台标签。已安装 `2.0.5-alpha.1` 的测试者可从下一条统一预发布手动覆盖安装 Alpha。
