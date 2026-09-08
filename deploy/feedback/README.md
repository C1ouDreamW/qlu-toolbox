# LumaTile 应用内反馈

零依赖的 Python HTTP 服务，接收桌面端和 Android 端的简短反馈并写入 SQLite。服务只应通过更新源 Nginx 的 `/api/feedback` 暴露。

数据库默认位于 `/data/feedback.db`。

首次部署前创建只允许反馈服务访问的数据目录：

```bash
install -d -o 10001 -g 10001 -m 0700 /opt/lumatile-update/feedback-data
```

## 反馈管理页（/admin/）

`https://lumatile.ishua.cloud/admin/` 提供简易查看界面，与统计页共用同一份 Basic Auth 凭据：

- 列表支持按状态（未处理/已处理/全部）、类型、平台筛选，按内容、联系方式或编号搜索，分页加载；
- 每条反馈可一键「标记已处理 / 重新打开」；
- 顶部卡片展示未处理与已处理计数，支持 30 秒自动刷新。

鉴权分两层：容器 Nginx 的 `/admin/` 路由做 Basic Auth（挂载 `/etc/nginx/lumatile-stats.htpasswd`，compose 中可用 `ADMIN_HTPASSWD` 覆盖路径），通过后注入 `X-Admin-User` 头；反馈服务校验该头，绕过 Nginx 直接访问容器端口会得到 403。`FEEDBACK_DEV_ADMIN=1` 仅用于本地预览（跳过校验），生产环境禁止设置。

管理 API（均要求 `X-Admin-User` 头）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/` | 管理页（自包含 HTML） |
| GET | `/admin/api/feedback` | 列表，参数 `status`、`type`、`platform`、`q`、`limit`（≤200）、`offset` |
| POST | `/admin/api/feedback/status` | `{"id":"FB-XXXXXXXX","status":"new\|resolved"}` |

修改 `server.py` 后重新部署（服务器 compose 目录如 `/opt/lumatile-update`）：

```bash
# 1. 上传新 server.py 到反馈构建上下文目录（FEEDBACK_BUILD_CONTEXT 指向的位置）
scp deploy/feedback/server.py root@ishua.cloud:/opt/lumatile-update/feedback/server.py

# 2. 重建反馈镜像并更新 Nginx 配置（新增 /admin/ 路由与凭据挂载）
ssh root@ishua.cloud 'cd /opt/lumatile-update && docker compose up -d --build'

# 3. 验证
curl -s https://lumatile.ishua.cloud/healthz
curl -s -o /dev/null -w '%{http_code}\n' https://lumatile.ishua.cloud/admin/   # 401 = 已受 Basic Auth 保护
```

命令行查看仍然可用：

```bash
sqlite3 /opt/lumatile-update/feedback-data/feedback.db \
  "SELECT id,type,platform,app_version,created_at,content,contact FROM feedback WHERE status='new' ORDER BY created_at DESC;"
```

服务不接收附件、日志、账号或成绩数据；来源地址只在进程内用于每小时 5 次的限流，不写入数据库。统计页会以只读方式展示反馈概览（见 `../stats/README.md`）。
