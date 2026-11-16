# LumaTile 生产服务

目标架构与验收见 [升级规划](../../docs/backend-upgrade-plan.md)，业务接口见 [OpenAPI](openapi.yaml)。仓库 CI 使用合成数据验证官网、Django 和 APK 分发开关。主分支产出静态站构件和 GHCR 镜像，部署使用指定提交和镜像摘要。

## 本地检查

在仓库根目录执行：

```bash
LUMATILE_SECRET_KEY=local-tests PYTHONPATH="$PWD/deploy" uv run --directory deploy/server --locked python manage.py test portal
node --test web/tests/downloads.test.mjs
bash deploy/server/check-nginx.sh
```

最后一项需要 Nginx 和 curl，使用临时目录与 UNIX socket。

## 腾讯云部署

1. 在 `/srv/apps/lumatile/` 准备 Compose、部署脚本、定时任务配置和权限为 `0600` 的 `.env`。环境变量示例见 [.env.example](.env.example)。用随机值生成 Django 密钥。私有镜像使用只读 GHCR 凭据。
2. 将现有更新文件与 SQLite 一致性备份恢复到 `/srv/data/lumatile/`。保留 `feedback/feedback.db`、`stats/stats.db` 和 `updates/{stable,alpha,releases}/`。反馈目录与官网控制台静态文件目录 `/srv/www/lumatile-console/` 由容器 UID 10001 写入。更新目录及其公告子目录需允许该 UID 原子替换公告和分发策略，宿主机 Nginx 用户需能读取公开文件并遍历其父目录。反馈与统计数据库目录保持受限。
3. 运行 `bash deploy-web.sh <官网构件目录> <完整提交 SHA>` 和 `bash deploy-portal.sh <镜像摘要地址>`。Compose 初始化数据表并收集后台静态文件。首次运行通过 `docker compose exec portal python manage.py createsuperuser` 创建维护者账号。
4. 先启用 [HTTP ACME 站点](nginx/http-acme.conf.example)，创建 `/var/www/letsencrypt` 并开放 TCP 80 / 443。各域名解析就绪后，用 Certbot 的 `certonly --webroot -w /var/www/letsencrypt` 签发 Let's Encrypt 证书。官网证书包含 `lumatile.cn` 和 `www.lumatile.cn`。其余域名按 [站点模板](nginx/sites.conf.example) 分别签发，证书续期后 reload Nginx。
5. 将 `nginx/{proxy,updates}.conf` 放在 `/etc/nginx/lumatile/`，启用后端和 [官网 HTTPS 配置](../../web/deploy/nginx.conf.example)。使用 ACME 站点提供 HTTP 跳转，启用官网 HTTPS 时保留两个 443 站点段。运行 `nginx -t` 后 reload。新旧域名在整套上线时统一切换。
6. 安装 [systemd 定时任务](systemd/)，将旧统计收集脚本和示例配置分别安装为 `/srv/apps/lumatile/collect.py`、`/srv/apps/lumatile/stats.json`。启用定时器后各运行一次服务，核对统计报告和 SQLite 备份。启用站外 HTTPS 探测，覆盖官网、公开更新策略、APK 开启时的下载和 API `/healthz`。

默认 APK 分发关闭。登录控制台修改模式后，Nginx 用同一个 `updates/android/server.json` 的存在状态控制公开策略和新旧域名上的 APK 路由。关闭时 APK 请求返回 503，官网和新版应用提供外部下载入口。发布工具继续核对 APK 大小与 SHA-256，再按渠道原子推广清单。具体构件见 [发布指南](../../RELEASING.md)。

## GitHub Actions 自动部署

- `main` 上官网或服务端相关变更通过 `Server artifacts` 检查后，自动部署官网构件和按摘要指定的后端镜像。旧构件的源码与 `main` 对应目录不一致时跳过自动部署。PR 只检查和构建构件。
- Android 在对应渠道的签名校验和 GitHub Release 发布完成后，自动推广同一工作流的 APK 构件。Stable 与 Alpha 只更新自己的清单，沿用当前分发模式。Android 备用清单仍走 PR。桌面安装包继续由各平台 Release 工作流发布到 GitHub。
- `Deploy LumaTile` 保留手动入口，可选择部署目标以及已通过验证的构件或镜像摘要。

在 GitHub 的 **Settings → Environments → production** 配置：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret | `LUMATILE_DEPLOY_KEY` | 专用部署账号的 SSH 私钥，对应公钥加入服务器的 `authorized_keys`。 |
| Variable | `LUMATILE_DEPLOY_TARGET` | `lumatile-deploy@43.143.206.112` |
| Variable | `LUMATILE_SSH_KNOWN_HOSTS` | 经现有可信 SSH 连接核对的服务器主机公钥记录，格式为 `43.143.206.112 ssh-ed25519 <主机公钥>`。 |

生产环境若设置部署分支与标签白名单，放行 `main` 以及 Android 的 `android-v*` 和 `android-alpha-v*`。若设置必需审阅人，部署任务会等待审批。

部署账号需要官网版本目录、Android 更新目录及部署锁的写权限。后端部署通过 `sudo -n /srv/apps/lumatile/deploy-portal.sh` 执行，由管理员维护 root 所有的脚本与 Compose 配置。GHCR 公共镜像可直接拉取，私有镜像由服务器配置只读拉取凭据。Android 推广还需要 Node.js 22 和仓库发布工具目录，包含 `scripts/`、`electron/`、`config/`。

## 验证与恢复

腾讯云首次部署使用 Python 官方镜像的腾讯云镜像仓库副本，按锁文件摘要验证依赖并离线安装。线上暂用本机构建镜像，首次 GHCR 部署完成后再以其摘要作为服务器部署基准。

- `curl -fsS https://api.lumatile.cn/healthz` 应返回 `ok`，验证业务库与反馈库的读取。通过合成反馈另行验证写入和维护者访问。
- 官网验收包含首页、`/download/` 和各平台外部链接。可为官网部署脚本设置 `LUMATILE_WEB_CHECK_URL`，探测失败时恢复上一版链接。
- 通过控制台分别验证公告发布、撤回，APK 开关和旧直链。关闭 APK 分发后用 `Range` 请求验证新旧域名，确认两个入口都不返回 APK 内容。
- 后端部署前会备份 SQLite 并记录原镜像。失败后根据迁移兼容性选择原镜像与对应数据库备份。定时备份保留 14 天，异机保存并在临时目录验证恢复后再登记上线。
- 排查使用 `docker compose logs portal`、`journalctl -u lumatile-stats.service -u lumatile-backup.service` 和 `/var/log/nginx/lumatile.access.log`。部署后更新服务器 `/srv/ops/SERVICES.md` 和 LumaTile 手册。
