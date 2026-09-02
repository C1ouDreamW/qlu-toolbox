# LumaTile 自建更新源

更新源是纯静态文件服务：宿主机 Nginx 负责 `lumatile.ishua.cloud` 的 HTTPS，Docker 容器只监听 `127.0.0.1:18080`。

## 首次部署

1. 将本目录复制到服务器，例如 `/opt/lumatile-update`。
2. 将发布工作流生成的 `update-source` 内容放入 `data/`。
3. 运行 `docker compose up -d`。
4. 将 `host-nginx.conf.example` 合并到宿主机 Nginx，并为域名签发证书。
5. 验证：`curl https://lumatile.ishua.cloud/healthz` 和两个 `/stable/*.json`。

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

## 迁移服务器

先同步整个 `data/` 并启动容器、配置同一域名的有效证书，再降低 DNS TTL 并切换解析。确认新服务器访问正常后再停旧服务器。客户端无需更新，因为域名不变。
