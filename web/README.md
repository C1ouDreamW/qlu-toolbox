# LumaTile 官网

官网独立放在根目录 `web/`，不参与桌面端或 Android 构建。采用原生 HTML、CSS 和 JavaScript，无需安装依赖或打包。

## 目录与前后端边界

```text
web/
├── frontend/                 静态前端，可直接部署此目录
│   ├── index.html            首页、下载、安装说明与常见问题
│   ├── style.css             响应式样式
│   ├── app.mjs               产品界面切换、版本信息刷新
│   ├── downloads.mjs         更新清单读取与下载地址校验
│   └── assets/               品牌素材与合成数据的产品截图
├── tests/downloads.test.mjs  下载逻辑测试
└── deploy/nginx.conf.example 官网静态服务配置示例
```

前端通过 HTTPS 读取现有独立更新源 `lumatile.ishua.cloud/stable/android.json` 与 `desktop.json`，下载按钮直接访问清单中的安装包。后端复用 `deploy/update-source/` 已有的静态文件服务；官网不新增账号、代理登录、文件上传或数据库服务，也不改动现有更新源。更新源当前已允许跨域读取。

## 本地预览

在仓库根目录执行：

```powershell
python -m http.server 5188 --bind 127.0.0.1 --directory web/frontend
```

浏览器访问 `http://127.0.0.1:5188`。不能直接用 `file://` 预览模块脚本。

```powershell
node --test web/tests/downloads.test.mjs
node --check web/frontend/app.mjs
```

## 下载行为

- 无 JavaScript 时，三个平台仍有已发布 v2.0.4 的直接下载链接，以及 GitHub Releases 备用渠道。
- 有 JavaScript 时，分别读取 Android 与桌面清单，更新对应版本和地址；不推导文件名，也不将某个平台的版本号用于其他平台。
- 校验清单结构、版本号、Android 应用 ID、大小和摘要格式，只接受现有更新源或本项目 GitHub Release 下的平台安装包地址。
- 清单请求 6 秒超时；单个平台清单失败不影响其他平台。页面保留已发布版本链接并提示使用备用下载。后续发版应维护 HTML 中的静态回退版本，截图也应按需更新。
- 官网是浏览器文件下载入口，不代替应用内更新校验；Android 安装权限和安装操作由系统与用户完成。

## 部署到 lumatile.cn

将 **`frontend/` 内的文件**整体上传到服务器静态站点目录，例如 `/var/www/lumatile`，然后参考 `deploy/nginx.conf.example` 配置独立站点。证书、DNS 解析和实际站点目录按服务器环境配置，示例不会自动执行任何远程操作。

安装包继续由独立更新源提供，无需将 APK、EXE 或 DMG 复制到官网目录。确认更新源 HTTPS、跨域响应、三个安装包及备用链接均可访问后再上线。域名备案展示信息尚未提供，正式上线前按实际备案信息补充页脚及对应链接。

## 品牌与素材

Logo 来自 `assets/lumatile.png`，界面素材来自 `docs/readme/`。展示的是实际产品界面，课程、成绩与学分数据均为合成数据，不读取真实教务资料。

网页文案遵循根 README 的支持平台、隐私和非商业使用边界；源码公开不等同于无限制的商业许可。
