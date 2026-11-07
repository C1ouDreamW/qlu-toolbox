# Android 更新清单

`android.json` is copied from the verified APK's release bundle only after the complete GitHub Release is public. Do not hand-edit hashes, sizes, package IDs, version codes, or `notes`. The legacy release workflow uses `CHANGELOG.md`; the gated independent Android workflow uses `changelogs/android.md`. Both clients render the notes as Markdown.

The release workflow pushes the generated manifest to a dedicated branch and adds a pull-request link to the workflow summary. Open that link and create the pull request so that the protected `main` branch runs its required status checks. Merge it after CI passes to make the new update visible to installed apps.

LumaTile 优先检查自建源，并在迁移期独立检查两个 GitHub 地址：

- `https://lumatile.ishua.cloud/stable/android.json`
- `https://raw.githubusercontent.com/C1ouDreamW/qlu-toolbox/main/updates/android.json`
- `https://raw.githubusercontent.com/C1ouDreamW/lumatile/main/updates/android.json`

Before the repository rename, the second URL may return 404. After the rename, the first URL may redirect or fail. One working, valid manifest is sufficient.

独立发布保留 Android schema 1、应用 ID 和以上地址。主源与备用清单指向同一个已签名 APK，SHA-256、大小和 versionCode 相同，只改变下载 URL。独立工作流从发布构件复制 `update-android.json` 到单独 worktree 的分支，不在已注入临时版本的构建 checkout 中切换 main；仍须创建并合并 PR。

桌面独立清单使用 schema 2，分别为 `stable/windows-x64.json`、`stable/macos-arm64.json`，GitHub 备用读取对应 Release 的 `update-<target>.json`。旧 `stable/desktop.json` 在阶段 D 冻结于桥接版，不能改成 schema 2 或跟随某一端的新版本。生产切换和部署说明见 [`config/README.md`](../config/README.md)、[`deploy/update-source/README.md`](../deploy/update-source/README.md)。
