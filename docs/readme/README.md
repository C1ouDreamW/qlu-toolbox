# README 展示素材

根 README 的产品截图、动图及组合图集中在这里，不进入桌面端或 Android 安装包。

| 素材 | 内容 |
|---|---|
| `hero.webp` | 桌面端与 Android 端课表组合封面 |
| `desktop-home.webp` | 桌面端首页 |
| `desktop-schedule.webp` | 桌面端周视图课表原始截图 |
| `mobile-schedule.webp` | Android 端周视图课表原始截图 |
| `schedule.gif` | 切周、查看重叠课程、切换显示 |
| `gpa.gif` | 勾选课程，实际更新 GPA 与学分 |
| `credit.webp` | 实际学分结果区域的组合展示 |
| `logo-reveal.gif` | 现有 3 秒 Logo 动画，另加 2 秒定格 |

## 素材来源

- 使用项目实际 Vue 组件截图，不另造应用界面；移动端截图是 Android Web 界面在 412 × 892 浏览器视口中的预览，不包含系统状态栏。
- 课表来自 `createShowcaseSchedule`，包含单双周、停课、重叠与非本周课程等虚拟场景。
- GPA 样本由已有 XLSX 测试工具生成，再经真实 Python 解析器读取；成绩、课程与学院完全合成。
- 学分样本经真实 Python 学分统计逻辑计算，演示使用内置要求，没有读取任何真实培养方案或个人成绩。
- 截图浏览器独立运行，仅允许访问本机开发服务器；桌面 IPC 使用合成返回值，不连接真实教务、更新源、统计服务或个人数据目录。
- WebP 使用无损编码保留文字；两张功能 GIF 展示实际界面状态变化，Logo GIF 为白底、15 FPS。

## 重新生成（Windows）

先安装项目现有依赖，在两个终端中分别启动桌面和移动 Web 界面：

```powershell
npx vite --host 127.0.0.1 --port 5179 --strictPort
npm run mobile:dev -- --host 127.0.0.1 --port 5180 --strictPort
```

首次准备 Logo 工程，或原始 MP4 不在本机时：

```powershell
cd lumatile-logo-animation
npm ci
npm run render:mp4
cd ..
```

在根目录执行素材生成；Pillow 仅作为临时工具依赖，不修改项目依赖文件：

```powershell
uv run --locked python -m playwright install chromium
uv run --locked --with pillow python docs/readme/capture.py
```

脚本内置检查：课程数量与统计结果有效、实际 GPA 随勾选变化且恢复、浏览器无页面异常。原始 PNG 与临时帧在忽略的 `tmp/readme-capture/` 下；发布用文件直接更新到本目录。

组合图排版在 `showcase.html`，版本号从根 `package.json` 读取。调整文案、尺寸或排列后重新运行生成脚本即可；根 README 的版本徽章和功能描述仍需随版本核对。

这些展示检查不替代 Android 真机、登录、文件保存或升级验证。
