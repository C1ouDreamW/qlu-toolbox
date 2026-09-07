# LumaTile 更新源统计

零常驻服务方案：`collect.py` 由 cron 每日执行，增量解析宿主机 nginx 访问日志，把匿名心跳（`/beacon/*`）、更新清单检查（`/stable/*.json`）和安装包下载（`/releases/*`）写入 SQLite，并生成自包含的统计页。

## 服务器布局（ishua.cloud）

```text
/opt/lumatile-stats/
├── collect.py       # 本目录同名文件的部署副本
├── config.json      # 日志路径、GitHub 仓库、报告目录
├── stats.db         # SQLite 原始数据（可用 sqlite3 直接查询）
└── report/          # stats.html + stats.json，由 nginx Basic Auth 保护
/etc/cron.d/lumatile-stats              # 每日 00:25 执行
/etc/nginx/lumatile-stats.htpasswd      # /stats/ 的 Basic Auth 凭据
/etc/nginx/conf.d/lumatile-update.conf  # lumatile 站点，含 access_log 与 /stats/ location
```

统计页：<https://lumatile.ishua.cloud/stats/>（账号 `admin`，密码在首次部署时生成，忘记可重建 htpasswd）。

## 日常操作

```bash
# 手动重跑一次统计（GitHub 计数默认 6 小时节流）
ssh root@ishua.cloud 'python3 /opt/lumatile-stats/collect.py --force-github'

# 重建统计页密码
ssh root@ishua.cloud 'printf "admin:%s\n" "$(openssl passwd -apr1 新密码)" > /etc/nginx/lumatile-stats.htpasswd'

# 直接查询原始数据
ssh root@ishua.cloud "sqlite3 /opt/lumatile-stats/stats.db 'SELECT day, COUNT(DISTINCT install_id) FROM beacon_hits GROUP BY day'"
```

## 口径说明

- **日活**：当日 `/beacon/*` 心跳中不同随机安装编号的去重数；旧版客户端（v2.0.0 之前）不发心跳，只体现在 `/stable/*.json` 的更新检查计数里。
- **下载**：`/releases/` 的 2xx 请求按次统计（含断点续传的 206），未按 IP 去重；GitHub 下载量是官方 API 的累计值快照，仓库改名期对两个仓库名取最大值避免重复。
- 日志轮转由 Ubuntu logrotate 处理（daily + delaycompress），脚本按 inode 记录水位，改名不会重复统计；`.gz` 压缩档不解析，服务器宕机跨天会缺那一天的统计。

## 修改后重新部署

```bash
scp deploy/stats/collect.py root@ishua.cloud:/opt/lumatile-stats/collect.py
```

客户端开关语义见 README「隐私与安全边界」；公告发布见 `scripts/publish_announcement.py`。
