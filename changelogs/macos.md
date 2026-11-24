# macOS 更新日志

本文件记录 macOS arm64 实际交付的变更。正式条目使用 `## [major.minor.patch] - YYYY-MM-DD`，发布时必须存在对应的非空条目。
2.0.4 及之前的记录见 [历史更新日志](legacy.md)，不重复标记为独立发布。

## [Unreleased]

- 建立 macOS 独立版本配置和构建准备入口，尚未发布新安装包。

## [2.0.5-alpha.2] - 2026-11-24

- macOS arm64 DMG 随 Windows、Android 一起发布到同一条 GitHub 预发布。已安装 `2.0.5-alpha.1` 的测试者可用本版替换现有 Alpha 应用。

## [2.0.5-alpha.1] - 2026-11-24

- 从当前主分支构建首个 macOS arm64 Alpha，用于验证 DMG 打包和发布流程。本次发版准备仅调整版本与发布配置。
