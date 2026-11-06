# LumaTile 自建更新源

更新源是纯静态文件服务：宿主机 Nginx 负责 `lumatile.ishua.cloud` 的 HTTPS，Docker 容器只监听 `127.0.0.1:18080`。

独立发布代码与三条工作流已接入，发布门禁仍关闭，尚未修改服务器。切换必须等桌面桥接与真实升级链验收完成，详见 [`config/README.md`](../../config/README.md)。下方将旧流程与切换后的单平台流程分别说明。

除静态文件外，容器配置还提供 `/beacon/desktop` 与 `/beacon/android` 两个 204 匿名统计心跳路由（只依赖访问日志计数）、写入本地 SQLite 的 `/api/feedback` 应用内反馈接口，以及受 Basic Auth 保护的反馈管理页 `/admin/`（与统计页共用 `/etc/nginx/lumatile-stats.htpasswd`，见 compose 挂载）。反馈服务说明见 `../feedback/README.md`，公告与统计页方案见 `../stats/README.md`。

## 首次部署

1. 将本目录复制到服务器，例如 `/opt/lumatile-update`。
2. 将已核验的 `releases/<tag>/` 放入 `data/releases/`，再分别推广目标清单；不要将下载构件整体覆盖 `data/` 或 `stable/`。
   如果服务器使用扁平目录、反馈服务位于本目录的 `feedback/`，请在 `.env` 中设置 `FEEDBACK_BUILD_CONTEXT=./feedback`。
3. 确认 `/etc/nginx/lumatile-stats.htpasswd` 已存在（统计页方案创建）；若路径不同，在 `.env` 中设置 `ADMIN_HTPASSWD`。文件缺失时 `/admin/` 鉴权会失败，但其余路由不受影响。
4. 运行 `docker compose up -d`。
5. 将 `host-nginx.conf.example` 合并到宿主机 Nginx，并为域名签发证书。
6. 验证：`curl https://lumatile.ishua.cloud/healthz`、已部署的 `/stable/*.json`、`/api/feedback`，以及 `curl -o /dev/null -w '%{http_code}' https://lumatile.ishua.cloud/admin/` 应返回 401。独立路径上线前还须确认宿主机路由和缓存策略，不能仅依据容器配置判断。

发布文件结构：

```text
data/
├── stable/
│   ├── android.json
│   ├── windows-x64.json       # 桥接时初始化；schema 2
│   ├── macos-arm64.json       # 桥接时初始化；schema 2
│   ├── desktop.json           # 旧 schema 1，桥接后冻结在 B
│   └── announcement.json      # 公告独立管理
└── releases/
    ├── vB/                    # 示意：B 尚未选择；保留旧桌面桥接包
    ├── win-vX.Y.Z/            # 示意：单平台安装包、清单、发布记录、校验和
    ├── mac-vX.Y.Z/
    └── android-vX.Y.Z/
```

## 切换前的旧发布

发布工作流只生成 `update-source-<tag>` 构件，**不会自动部署服务器**。完成签名构建后：

1. 下载对应 tag 的更新源构件，核对 `SHA256SUMS.txt`，以及 Android 清单中的 `versionName`、`versionCode`、`sha256` 和 `size`。
2. 先上传完整的 `releases/<tag>/` 到服务器 `data/releases/`，验证公网文件可下载且校验值一致。
3. 再将两个清单分别上传为 `stable/*.json.tmp`，在服务器同一目录通过 `mv` 替换正式清单，避免用户读到半个 JSON 或指向尚未上传的安装包。
4. 合并工作流创建的 Android 备用更新清单分支；该分支不会自行合入主分支。用已安装的旧版本分别验证自建源更新、断开主源后的备用源更新，以及正式签名覆盖安装。
5. 公告独立发布：需要公告时运行 `scripts/publish_announcement.py`；没有公告时 `/stable/announcement.json` 返回 404 属于正常状态。

## 切换后的单平台发布

新构件名为 `update-source-<platform>-<version>`，只含本端 stable 指针与本次不可变的 `releases/<platform-tag>/`。Windows 保留安装包和便携 ZIP；macOS 保留 arm64 DMG；Android 为正式签名 APK。三端独立发布均不自动部署服务器。

1. 下载对应构件，在其 `releases/<tag>/` 下运行 `sha256sum -c SHA256SUMS.txt`（macOS 可用 `shasum -a 256 -c SHA256SUMS.txt`），核对 `release-record.json` 的平台、目标、版本、commit 和 verification。Android 记录中还包含已验证的正式证书 digest。
2. 只上传本次 `releases/<tag>/`。已有同名文件时先比对 SHA-256，不能覆盖不同内容，不能使用会删除其他平台目录的同步参数。上传后核对公网下载与哈希，保留原始构件供重试。
3. 仅上传本端 `stable/<target>.json` 为同目录临时文件；切换前重新读取服务器当前清单，拒绝版本回退。Android 还须拒绝 code 回退、同码不同包和同版本替换。两个平台同时部署时各自操作自己的指针。
4. 在服务器同一目录原子替换本端 JSON。不要替换整个 stable 目录；不要触碰公告、旧 desktop 或其他端清单。
5. Android 合并本次备用清单 PR，合并前再次确认 main 中没有更高 code；桌面使用 Release 中的 `update-<target>.json`，不产生主分支清单 PR。验证旧版本检查更新、主源断开时的 GitHub 下载，以及本端覆盖安装；记录部署时间和清单哈希。

已有 Node.js 22+ 环境时，可在服务器本地运行仓库提供的原子推广工具（只改目标指针，不联网部署）：

```bash
# 示例：input 是已下载构件里的清单，data 是服务器静态文件根目录
node scripts/promote-update-manifest.mjs windows /tmp/update-source/stable/windows-x64.json /opt/lumatile-update/data
```

工具先在 data 下校验本端所有安装包的实际 SHA-256 和大小，再获取本端互斥锁、校验版本单调性、写入并 fsync 同目录临时文件，最后 rename。其他端与公告文件不变。进程异常后若遗留 `.windows-x64.json.lock` 等锁文件，须确认没有运行中的同端部署再人工删除，不自动抢占锁。

## 桥接保留与失败恢复

- B 确定且两端桥接包均验证后，将旧 `desktop.json` 保持 schema 1、顶层 B 与 `downloads.win32/darwin`；新两个桌面入口各自初始化为 B。B 的包、旧路径和清单长期保留，不在后续单端部署中清理。
- 旧客户端主源失效时，其内置 GitHub 逻辑不能保证找到桥接版。阶段 D 必须登记准确的桥接 Release 和两端手动下载地址；当前尚未选择 B，不能把现有 2.0.4 误称为桥接版。
- 资产已上传、stable 未切换属于“产物已发布，主源尚未推广”。继续部署相同已核验构件，不重新构建或覆盖原包。
- GitHub 失败的 draft 只允许补齐缺失且一致的资产；已公开 Release 只允许完整同哈希重试。使用原构件运行发布脚本，具体命令见版本说明。
- 坏包已经公开时，以更高补丁版本修复，Android 同时增加 code 并处理所有备用源。撤回错误推荐只阻止继续升级，不会让已安装客户端自动降级。

## 迁移服务器

先同步整个 `data/` 并启动容器、配置同一域名的有效证书，再降低 DNS TTL 并切换解析。确认新服务器访问正常后再停旧服务器。客户端无需更新，因为域名不变。
