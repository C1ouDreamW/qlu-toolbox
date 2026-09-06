# LumaTile 应用内反馈

零依赖的 Python HTTP 服务，接收桌面端和 Android 端的简短反馈并写入 SQLite。服务只应通过更新源 Nginx 的 `/api/feedback` 暴露。

数据库默认位于 `/data/feedback.db`。

首次部署前创建只允许反馈服务访问的数据目录：

```bash
install -d -o 10001 -g 10001 -m 0700 /opt/lumatile-update/feedback-data
```

查看未处理反馈：

```bash
sqlite3 /opt/lumatile-update/feedback-data/feedback.db \
  "SELECT id,type,platform,app_version,created_at,content,contact FROM feedback WHERE status='new' ORDER BY created_at DESC;"
```

处理后可更新状态：

```bash
sqlite3 /opt/lumatile-update/feedback-data/feedback.db \
  "UPDATE feedback SET status='resolved' WHERE id='FB-XXXXXXXX';"
```

服务不接收附件、日志、账号或成绩数据；来源地址只在进程内用于每小时 5 次的限流，不写入数据库。
