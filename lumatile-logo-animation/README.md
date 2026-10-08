# LumaTile Logo Reveal

React + TypeScript + Remotion；1080 × 1080，30 FPS，90 帧（3 秒），无音频。

## 目录

工程、参考素材和输出统一放在 `lumatile-logo-animation/` 中，可独立移动使用：

```text
lumatile-logo-animation/
├── src/                 # React 组件、矢量图形、时间轴
├── public/lumatile.png   # 原始 Logo，最终定格素材
├── scripts/             # 轮廓提取和动画检查
├── out/                 # MP4、透明 WebM/MOV、最终定格 PNG
│   └── verification/    # 关键帧及透明通道核验图片
├── package.json         # 预览、检查、渲染命令
└── README.md
```

## 预览与导出

在此目录执行：

```powershell
npm ci
npm run dev
npm run check
npm run render:mp4
npm run render:webm
npm run render:mov
```

Studio 中 `LogoReveal` 使用透明画布，`LogoRevealWhite` 使用白底。两者共用同一动画，仅背景不同。Studio 的棋盘格是透明预览工具，不会被渲染进透明文件。

输出相对于本工程目录：

- `out/logo-reveal.mp4`：H.264 白底预览。普通 H.264 MP4 不保留 Alpha。
- `out/logo-reveal-transparent.webm`：VP9 + Alpha，适合支持透明 WebM 的浏览器。
- `out/logo-reveal-transparent.mov`：ProRes 4444 + Alpha，适合剪辑、合成，文件较大。

透明导出设置参考 [Remotion 官方说明](https://www.remotion.dev/docs/transparent-videos)。透明素材的播放支持取决于目标播放器；本工程没有接入 App 启动页或验证真机播放。

## 时间轴

`src/animation.ts` 的 `timeline` 集中定义帧区间。结束帧表示该段已完全完成；最终帧为 89。

| 帧区间 | 秒区间 | 动作 |
|---|---|---|
| 0 → 10 | 0.000 → 0.333 | 右上浅蓝块淡入，0.85 → 1 缩放 |
| 10 → 20 | 0.333 → 0.667 | 左上蓝块以同样方式出现 |
| 20 → 30 | 0.667 → 1.000 | 左下浅蓝块以同样方式出现 |
| 30 → 36 | 1.000 → 1.200 | 右下完整蓝格出现；初始范围为 (207, 258, 164, 184)，与右上格同列、左下格同行，组成整齐的 2 × 2 排列 |
| 36 → 38 | 1.200 → 1.267 | 完整蓝色方格短暂停留 |
| 38 → 44 | 1.267 → 1.467 | 保持蓝色和列位置，收拢到最终黄色块的 173 × 152 尺寸，同时纵向归位 |
| 44 → 52 | 1.467 → 1.733 | 缩小后的块平滑向右滑动；黄色图层从左向右覆盖蓝色图层，窄边缘柔和交叉淡化 |
| 52 → 58 | 1.733 → 1.933 | 第一条短线从左侧 10 个原图单位处滑入、淡入 |
| 58 → 64 | 1.933 → 2.133 | 第二条短线滑入、淡入 |
| 64 → 70 | 2.133 → 2.333 | 第三条短线滑入、淡入 |
| 70 → 75 | 2.333 → 2.500 | 底部横条从左向右展开、淡入 |
| 75 → 79 | 2.500 → 2.633 | 完整矢量图平滑交接到原始 PNG；加色混合保持交接期间的整体不透明度 |
| 79 → 90 | 2.633 → 3.000 | 原始 PNG 静止保持约 0.367 秒 |

缩放使用无过冲的 `spring`；淡入及滑动使用 `interpolate` + `Easing.bezier`。结束帧强制精确归位，静止段没有微动。

## 图形与修改位置

`src/LogoReveal.tsx` 提供 `TopRightBlock`、`TopLeftBlock`、`BottomLeftBlock`、`BottomRightBlock`、`CenterLines`、`BottomBar` 六个独立组件。三个短线节点也分别独立声明。

动画主体使用 `src/logoGeometry.ts` 中的八个 SVG 路径，保留原始非等宽间距、圆角、短线长度和画布留白；以原图 512 × 512 坐标等比例映射到 1080 × 1080。每个图形的三个颜色采样组成很轻微的纵向渐变。变色使用独立蓝黄图层和窄边缘蒙版，避免整块出现灰色中间色。

第 75 → 79 帧平滑切换到 `public/lumatile.png`，该文件是原始 Logo 的未修改副本。检查脚本用 SHA-256 核验素材，无需访问工程外部文件。第 79 帧起只显示原始 PNG，保留其颜色、边缘、Alpha 和留白。输出为 1080 × 1080 时由浏览器等比例采样，视频编码也可能引入轻微像素差异；最终定格的素材本身完全一致。

若要重新提取参考图，可在本工程目录执行 `python scripts/trace_logo.py`，需要 Pillow、NumPy、OpenCV；正常预览与渲染只需要 Node.js。

`npm run check` 检查 TypeScript、ESLint，以及出现区间、缩放边界、滑动端点和最终保持状态。

## 本次验证

已通过 TypeScript、ESLint 和时间轴检查；确认原始 PNG 副本字节一致、变色中段保留明确的蓝黄两层、PNG 交接期间图形内部 Alpha 保持 255，最后 11 帧的透明 PNG 完全相同。线条的时间和效果保持不变。

FFprobe 确认三个文件均为 1080 × 1080、30 FPS、90 帧、3 秒。解码后已确认 MP4 为白底，WebM 和 MOV 均保留透明背景、不透明图形以及边缘的半透明像素。
