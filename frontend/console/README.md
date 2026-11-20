# LumaTile 运营控制台

`public/` 是部署到 `console.lumatile.cn` 的静态构件。工作台包含概览、反馈、发布、统计、操作记录和账号设置。浏览器直接调用 `https://api.lumatile.cn/v1/`。Django 核对维护者会话、权限和 CSRF 令牌后返回 JSON。

## 验证

在仓库根目录运行：

```bash
node --test frontend/console/tests/*.test.mjs
bash deploy/server/check-compose.sh
```

第一项验证浏览器 API 客户端和静态入口。第二项需要 Linux Docker Compose，使用临时数据和 HTTPS 测试站点检查 Nginx 路由和跨域会话入口。接口契约见 [OpenAPI](../../backend/openapi.yaml)。

Console 构件由 `Console artifacts` 工作流生成。首次切换顺序和手动部署入口见[生产服务说明](../../deploy/server/README.md#启用独立控制台)。
