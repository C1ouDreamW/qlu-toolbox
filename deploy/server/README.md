# LumaTile 生产服务

默认 Compose 运行 `portal` 和 `jobs`，分别处理 Django 请求及定时统计、备份。两者共用同一个 Python 镜像。腾讯云的共享 Nginx 提供 HTTPS、官网和更新下载。使用独占 80/443 的服务器时可加载[独立部署配置](compose.standalone.yaml)，由同一套 Compose 启动 Nginx。

服务端 Python 源码、Dockerfile 和接口定义在 [`backend/`](../../backend/)，官网构件在 [`frontend/website/public/`](../../frontend/website/public/)。从仓库根目录执行 `docker build backend` 构建后端镜像，构建上下文为 `backend/`。业务接口见 [OpenAPI](../../backend/openapi.yaml)。

## 本地检查

在仓库根目录执行：

```bash
LUMATILE_SECRET_KEY=local-tests uv run --python 3.12 --directory backend --locked python manage.py test portal
uv run --python 3.12 --directory backend --locked python -m unittest test_jobs
uv run --python 3.12 --directory backend --locked python -B -m unittest discover -s tests -v
node --test frontend/website/tests/downloads.test.mjs
bash deploy/server/check-compose.sh
```

最后一项在 Linux Docker Compose 环境中以临时证书、环回端口和合成数据验证两种部署方式的路由、APK 分发、统计和备份。

## 现有腾讯云共享入口

1. 在 `/srv/apps/lumatile/` 放置 `compose.yaml`、部署脚本和权限为 `0600` 的 `.env`。按 [示例](.env.example) 配置后端镜像摘要，沿用原 Django 密钥。私有镜像使用只读 GHCR 凭据。
2. 准备或恢复 `/srv/data/lumatile/{feedback,stats,updates,backups}` 和 `/srv/www/{lumatile,lumatile-console}`。`feedback`、`stats`、`stats/report` 和 `backups` 由 UID/GID 10001 管理，目录权限为 `0700`。升级时备份并调整已有统计数据与备份的所有者。控制台静态目录和更新目录由 UID 10001 写入，公开文件及其父目录允许 Nginx 读取和遍历。
3. 首次切换前，停用旧的 LumaTile 统计、备份定时器，收集最后一批旧任务日志并留存一致性快照。宿主机 Nginx、Certbot 和现有站点配置继续使用。Portal 仍发布到 `127.0.0.1:18080`。`jobs` 通过只读挂载读取宿主机 `lumatile.access.log` 和轮转后的 `lumatile.access.log.1`，默认使用 Ubuntu `adm` 的 GID 4。其他主机可设置 `LUMATILE_NGINX_LOG_DIR` 和 `LUMATILE_NGINX_LOG_GID`。
4. 更新配置、脚本和镜像后，运行 `docker compose pull` 和 `docker compose up -d --wait`，检查 18080 和原 HTTPS 域名。首次运行可通过 `docker compose exec portal python manage.py createsuperuser` 创建维护者账号。

`jobs` 每天北京时间 00:25 统计、01:25 备份，重启后会补跑到期任务。统计库和任务日期都保存在 `stats/`。SQLite 快照保留 14 天。可以立即核对任务：

```bash
docker compose exec jobs python jobs.py collect
docker compose exec jobs python jobs.py backup
docker compose logs jobs
```

默认 APK 分发关闭。登录控制台修改模式后，Nginx 用同一个 `updates/android/server.json` 的存在状态控制公开策略和新旧域名上的 APK 路由。关闭时 APK 请求返回 503，官网和新版应用提供外部下载入口。发布工具继续核对 APK 大小与 SHA-256，再按渠道原子推广清单。具体构件见 [发布指南](../../docs/releasing.md)。

公开分发入口为 `api.lumatile.cn`。Nginx 提供 `/android/distribution.json`、`/{channel}/android.json`、`/{channel}/announcement.json` 和 APK 下载。兼容入口 `lumatile.ishua.cloud` 继续提供已发布客户端使用的地址。新版客户端和官网读取自建清单时会将旧 APK 下载地址转换为 API 域名。

## 独立服务器全容器部署

1. 准备上述数据和官网目录，并在同一目录放置 `compose.standalone.yaml` 和整个 `nginx/`。在 `.env` 中设置 `COMPOSE_FILE=compose.yaml:compose.standalone.yaml`。独立模式将 80/443 交给容器 Nginx，Portal 通过 Compose 内网提供服务。
2. 将数据根目录下的 `logs/` 设为 UID 10001、GID 101、权限 `2770`。Nginx Alpine 工作进程写每日访问日志，`jobs` 读取并保留 14 天。
3. 将 TLS 证书目录恢复到 `/etc/letsencrypt`，保留 `live/` 下的符号链接及其指向的 `archive/`。证书 `lumatile.cn` 覆盖官网、`www`、`api` 和 `console`，`lumatile.ishua.cloud` 使用独立证书。新签发可在 DNS 指向新机且 80 端口空闲时使用 Certbot 容器的 `certonly --standalone`。运行后可用 Certbot 容器挂载证书目录和 `/var/www/letsencrypt`，以 `renew --webroot -w /var/www/letsencrypt` 续签，再运行 `docker compose exec nginx nginx -s reload`。
4. 执行 `bash deploy-web.sh <官网构件目录> <完整提交 SHA>`，再运行 `docker compose pull` 和 `docker compose up -d --wait`。

## 换服务器

1. 预先在新机准备 Compose、镜像和证书。记录原镜像摘要与站点配置。趁源站继续服务时先同步较大的 `updates/releases/` 和官网版本目录。
2. 切换窗口暂停发布并停止源站的 LumaTile 入口。共享入口模式下，只停用 LumaTile 站点，手动收集最后一批日志并保存一致性快照。宿主机日志按 inode 记录进度，历史数据通过统计库迁移。独立模式下，用 `docker compose stop nginx` 停止入口，手动运行一次统计和备份，保留数据目录中的每日访问日志。两种模式均用 `docker compose stop portal jobs` 停止写入后同步数据。
3. 保留目录权限和符号链接，迁移 `/srv/apps/lumatile/`、`/srv/data/lumatile/`、`/srv/www/lumatile/` 和 TLS 证书目录。新机使用同一镜像摘要执行 `docker compose up -d --wait`，核对健康检查、登录、官网、公告与分发策略后切换 DNS。控制台静态文件会由 Portal 重新生成。
4. 保留原机数据和配置供回滚。容器内数据库快照包含业务库、反馈库、统计库及当时生效的公告和分发策略。完整迁移还需要 APK、清单、官网构件和访问日志等挂载目录。

## GitHub Actions 自动部署

- 官网改动运行 `Website artifacts`，验证静态站，并在推送到 `main` 后部署官网构件。后端、Compose 和 Nginx 改动运行 `Server artifacts`，通过服务端检查后构建并部署镜像。共享部署工作流有改动时，两条流程都会验证。
- 自动部署会检查构件的对应源码与 `main` 是否一致。PR 运行受影响的验证，官网 PR 也会生成静态构件。
- Android 在对应渠道的签名校验和 GitHub Release 发布完成后，自动推广同一工作流的 APK 构件。Stable 与 Alpha 只更新自己的清单，沿用当前分发模式。Android 备用清单仍走 PR。桌面安装包继续由各平台 Release 工作流发布到 GitHub。
- `Deploy LumaTile` 保留手动入口，可选择部署目标以及已通过验证的构件或镜像摘要。

在 GitHub 的 **Settings → Environments → production** 配置：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret | `LUMATILE_DEPLOY_KEY` | 专用部署账号的 SSH 私钥，对应公钥加入服务器的 `authorized_keys`。 |
| Variable | `LUMATILE_DEPLOY_TARGET` | `lumatile-deploy@43.143.206.112` |
| Variable | `LUMATILE_SSH_KNOWN_HOSTS` | 经现有可信 SSH 连接核对的服务器主机公钥记录，格式为 `43.143.206.112 ssh-ed25519 <主机公钥>`。 |

生产环境若设置部署分支与标签白名单，放行 `main` 以及 Android 的 `android-v*` 和 `android-alpha-v*`。若设置必需审阅人，部署任务会等待审批。

部署账号需要官网版本目录、Android 更新目录及部署锁的写权限。后端部署通过 `sudo -n /srv/apps/lumatile/deploy-portal.sh` 执行，由管理员维护 root 所有的脚本与 Compose 配置。GHCR 公共镜像可直接拉取，私有镜像由服务器配置只读拉取凭据。

Android 推广需要 Node.js 22。同步 `/srv/apps/lumatile/release-tools/` 时，从同一个提交复制 `scripts/`、`packages/release-contract/` 和 `config/`，保留目录层级。发布脚本按相对路径加载更新契约。使用自定义挂载路径时，给发布脚本传入与 Compose 对应的 `LUMATILE_WEB_DIR` 或 `LUMATILE_UPDATE_DIR`。

## 验证与恢复

腾讯云首次部署使用 Python 官方镜像的腾讯云镜像仓库副本，按锁文件摘要验证依赖并离线安装。线上暂用本机构建镜像，首次 GHCR 部署完成后再以其摘要作为服务器部署基准。

- `curl -fsS https://api.lumatile.cn/healthz` 应返回 `ok`，验证业务库与反馈库的读取。通过合成反馈另行验证写入和维护者访问。
- 官网验收包含首页、`/download/` 和各平台外部链接。可为官网部署脚本设置 `LUMATILE_WEB_CHECK_URL`，探测失败时恢复上一版链接。
- 通过控制台分别验证公告发布、撤回，APK 开关和旧直链。关闭 APK 分发后用 `Range` 请求验证新旧域名，确认两个入口都不返回 APK 内容。
- 后端部署前会备份 SQLite 并记录原镜像。失败后根据迁移兼容性选择原镜像与对应数据库备份。定时备份保留 14 天，异机保存并在临时目录验证恢复后再登记上线。
- 排查使用 `docker compose logs portal jobs`。在共享模式下查阅宿主机 Nginx 日志。独立模式另用 `docker compose logs nginx` 和数据根目录的 `logs/`。现有服务器首次升级时由管理员安装新版 Compose 和部署脚本，再切换定时任务。之后镜像更新沿用现有工作流。
