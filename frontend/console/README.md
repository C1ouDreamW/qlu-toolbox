# LumaTile 运营控制台

Console 使用 Vue 3、TypeScript、Vite 和 Vue Router 的 hash 路由。业务页面位于 `src/views/`。浏览器直接调用 `https://api.lumatile.cn/v1/`，使用 Django 会话及 CSRF 校验。类型在开发和构建时从 [OpenAPI](../../backend/openapi.yaml) 生成。

## 开发与验证

在仓库根目录运行：

```bash
npm ci --workspace @lumatile/console
npm run dev --workspace @lumatile/console
```

生产 API 仅允许 `https://console.lumatile.cn` 携带会话凭据访问。用浏览器冒烟测试在本地验证登录等交互。

构建包含 Vue 类型检查。浏览器测试使用构建产物和合成数据校验路由、会话、反馈和发布流程。

```bash
npm run build --workspace @lumatile/console
npm test --workspace @lumatile/console
npm exec --workspace @lumatile/console -- playwright install chromium --only-shell
npm run test:e2e --workspace @lumatile/console
```

`Console artifacts` 工作流上传 `dist/`。入口为部署脚本校验的 `app.mjs`，分包和样式使用带内容哈希的文件名。首次切换顺序和手动部署入口见[生产服务说明](../../deploy/server/README.md#启用独立控制台)。
