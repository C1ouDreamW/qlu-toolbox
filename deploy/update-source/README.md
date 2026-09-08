# LumaTile 自建更新源

更新源是纯静态文件服务：宿主机 Nginx 负责 `lumatile.ishua.cloud` 的 HTTPS，Docker 容器只监听 `127.0.0.1:18080`。

除静态文件外，容器配置还提供 `/beacon/desktop` 与 `/beacon/android` 两个 204 匿名统计心跳路由（只依赖访问日志计数）、写入本地 SQLite 的 `/api/feedback` 应用内反馈接口，以及受 Basic Auth 保护的反馈管理页 `/admin/`（与统计页共用 `/etc/nginx/lumatile-stats.htpasswd`，见 compose 挂载）。反馈服务说明见 `../feedback/README.md`，公告与统计页方案见 `../stats/README.md`。

## 首次部署

1. 将本目录复制到服务器，例如 `/opt/lumatile-update`。
2. 将发布工作流生成的 `update-source` 内容放入 `data/`。
   如果服务器使用扁平目录、反馈服务位于本目录的 `feedback/`，请在 `.env` 中设置 `FEEDBACK_BUILD_CONTEXT=./feedback`。
3. 确认 `/etc/nginx/lumatile-stats.htpasswd` 已存在（统计页方案创建）；若路径不同，在 `.env` 中设置 `ADMIN_HTPASSWD`。文件缺失时 `/admin/` 鉴权会失败，但其余路由不受影响。
4. 运行 `docker compose up -d`。
5. 将 `host-nginx.conf.example` 合并到宿主机 Nginx，并为域名签发证书。
6. 验证：`curl https://lumatile.ishua.cloud/healthz`、两个 `/stable/*.json`、`/api/feedback`，以及 `curl -o /dev/null -w '%{http_code}' https://lumatile.ishua.cloud/admin/` 应返回 401。

发布文件结构：

```text
data/
├── stable/
│   ├── android.json
│   └── desktop.json
└── releases/
    └── v2.0.0/
        ├── LumaTile-Android-v2.0.0.apk
        ├── LumaTile_v2.0.0_x64_Setup.exe
        ├── LumaTile_v2.0.0_arm64.dmg
        └── SHA256SUMS.txt
```

## 每次发布

发布工作流只生成 `update-source-<tag>` 构件，**不会自动部署服务器**。完成签名构建后：

1. 下载对应 tag 的更新源构件，核对 `SHA256SUMS.txt`，以及 Android 清单中的 `versionName`、`versionCode`、`sha256` 和 `size`。
2. 先上传完整的 `releases/<tag>/` 到服务器 `data/releases/`，验证公网文件可下载且校验值一致。
3. 再将两个清单分别上传为 `stable/*.json.tmp`，在服务器同一目录通过 `mv` 替换正式清单，避免用户读到半个 JSON 或指向尚未上传的安装包。
4. 合并工作流创建的 Android 备用更新清单分支；该分支不会自行合入主分支。用已安装的旧版本分别验证自建源更新、断开主源后的备用源更新，以及正式签名覆盖安装。
5. 公告独立发布：需要公告时运行 `scripts/publish_announcement.py`；没有公告时 `/stable/announcement.json` 返回 404 属于正常状态。

## 迁移服务器

先同步整个 `data/` 并启动容器、配置同一域名的有效证书，再降低 DNS TTL 并切换解析。确认新服务器访问正常后再停旧服务器。客户端无需更新，因为域名不变。
