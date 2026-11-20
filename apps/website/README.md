# LumaTile 官网

官网位于 `apps/website/`，采用原生 HTML、CSS 和 JavaScript，可直接部署静态文件。

## 目录与前后端边界

```text
apps/website/
├── frontend/                 静态前端，可直接部署此目录
│   ├── index.html            首页、下载、安装说明与常见问题
│   ├── style.css             响应式样式
│   ├── app.mjs               产品界面切换、版本信息刷新
│   ├── downloads.mjs         更新清单读取与下载地址校验
│   └── assets/               品牌素材与合成数据的产品截图
└── tests/downloads.test.mjs  下载逻辑测试
```

Android 下载按钮读取 `api.lumatile.cn` 的分发策略和 Stable 清单。桌面端使用对应平台的 GitHub Release，QQ群和百度网盘可在 `frontend/download-channels.json` 中按平台配置。

## 本地预览

在仓库根目录执行：

```powershell
python -m http.server 5188 --bind 127.0.0.1 --directory apps/website/frontend
```

浏览器访问 `http://127.0.0.1:5188`。不能直接用 `file://` 预览模块脚本。

```powershell
node --test apps/website/tests/downloads.test.mjs
node --check apps/website/frontend/app.mjs
```

## 下载行为

- 三个平台默认提供已公开版本的 GitHub 安装包。Android 服务器分发开启且清单有效时，下载按钮使用自建源，GitHub 链接仍可用。
- 分发关闭、策略不可用或清单无效时，Android 保留外部下载。QQ群和百度网盘仅在配置有效 HTTPS 链接时显示。
- 平台定位入口为 `/download/#download-android`、`/download/#download-windows` 和 `/download/#download-mac`。

## 部署到 lumatile.cn

将 `frontend/` 作为静态构件部署。发布桌面版本时更新 `frontend/desktop-releases.json` 及 HTML 中对应的静态回退版本和链接，并同步已配置的外部下载渠道。见[生产部署说明](../../deploy/server/README.md)和 [Nginx 配置](../../deploy/server/nginx/website.conf)。

## 品牌与素材

官网直接使用 `frontend/assets/` 中的静态副本。标志原图和使用合成数据的界面素材分别见[品牌素材](../../packages/branding/lumatile.png)和 [README 演示素材](../../docs/readme/)。

网页文案遵循根 README 的支持平台、隐私和非商业使用边界；源码公开不等同于无限制的商业许可。
