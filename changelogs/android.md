# Android 更新日志

本文件记录 Android 实际交付的变更。正式条目使用 `## [major.minor.patch] - YYYY-MM-DD`，发布时必须存在对应的非空条目。
2.0.4 及之前的记录见 [历史更新日志](legacy.md)，不重复标记为独立发布。

## [Unreleased]

- 建立 Android 独立版本配置，Web 与原生构建使用同一版本来源，并在原生构建前检查 Web 资源版本。

## [2.0.5-alpha.2] - 2026-11-24

- Android APK 随 Windows、macOS 一起发布到同一条 GitHub 预发布。APK 沿用 Alpha 签名，`versionCode` 提升为 `2`，可覆盖安装此前的 Alpha。

## [2.0.5-alpha.1] - 2026-11-24

- 从当前主分支构建首个 Android Alpha，用于验证独立签名、APK 分发和更新清单。本次发版准备仅调整版本与发布配置。
