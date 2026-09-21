# 竹林里的老屋 · Bamboo Old House

基于 Three.js 的交互式 3D 老屋场景，在竹林、木廊与房间之间漫游，感受晨昏、风雨和自然声景。支持沿路漫游、自由视角、360° 环顾与竹林望月，可切换五个时段和四档天气。

使用 React、TypeScript、Three.js、Tailwind CSS 与 Vinext/Vite，源码位于 [`src/`](src/)。

## 预览

| 桌面端 | 移动端 |
| --- | --- |
| 傍晚老屋<br><img src="docs/screenshots/desktop.jpg" alt="桌面端傍晚老屋场景预览" width="640"> | 傍晚老屋<br><img src="docs/screenshots/mobile.jpg" alt="移动端傍晚老屋场景预览" width="220"> |
| 竹林望月<br><img src="docs/screenshots/desktop-moon.jpg" alt="桌面端竹林望月场景预览" width="640"> | 竹林望月<br><img src="docs/screenshots/mobile-moon.jpg" alt="移动端竹林望月场景预览" width="220"> |

桌面端截图为 1440 × 900；移动端为浏览器视口模拟，尺寸为 402 × 874。

## 资源

| 资源 | 位置 | 用途 |
| --- | --- | --- |
| 老屋建筑 | [`architecture.glb`](public/models/architecture.glb) | 老屋主体、室内外建筑结构与陈设 |
| 竹林 | [`bamboo.glb`](public/models/bamboo.glb) | 四组竹竿与竹叶模型 |
| 廊下竹枝 | [`porch-bamboo.glb`](public/models/porch-bamboo.glb) | 木廊附近垂落、随风摆动的竹枝与竹叶 |
| 背景植被 | [`background-foliage.glb`](public/models/background-foliage.glb) | 背景乔木、树冠与灌木 |
| 林下植被 | [`understory.glb`](public/models/understory.glb) | 林下与山坡上的蕨类、草丛 |
| 干柴堆 | [`dry-fuel.glb`](public/models/dry-fuel.glb) | 院落中的干柴堆 |
| 竹子 LOD | [`bamboo-lod.json`](src/components/scene/generated/bamboo-lod.json) | 从竹子模型生成的远景简化数据 |
| 自然录音 | [`public/audio/`](public/audio/) | 九段风、雨、鸟鸣与虫鸣等录音；[来源与致谢](public/audio/credits.md) |
| 备用画面 | [桌面](public/scene-poster.webp)、[手机](public/scene-poster-mobile.webp) | 静态场景画面 |
| 图标 | [`icon.svg`](public/icon.svg)、[`favicon.svg`](public/favicon.svg) | 网站图标 |

GLB 已内嵌贴图与缓冲数据。声音在用户主动操作后播放，并随时段和天气变化。

## 资源更新

资源来自同级建模项目 `../blender-two/`；只有同步资源需要该目录，日常代码开发不依赖它。修改 `.blend` 后需先导出网页资源。

| 更新内容 | 处理方式 |
| --- | --- |
| 模型、贴图或录音 | 导出到 `../blender-two/website/public/` 后执行 `pnpm sync` |
| 竹子模型 | 同步后执行 `node scripts/generate-bamboo-lod.mjs`，将 `bamboo.glb` 与生成的 `bamboo-lod.json` 一起提交 |
| 模型增删改名、地形、布局、相机、灯光或天气效果 | 同时合并原项目 `website/components/scene/` 到本项目 `src/components/scene/` 的对应代码 |
| 页面或交互 | 对照原项目 `website/app/`、`website/components/experience.tsx`，合并到本项目 `src/` 的对应位置 |

`pnpm sync` 通过 `rsync` 单向复制资源并重新构建，替换同名文件、补充新资源，不自动删除额外文件。它只同步资源；代码需单独合并，并保留本项目的依赖、锁文件与构建配置。

## 修改验证

目标为 `main` 的 PR 和 `main` 更新会运行 [CI](.github/workflows/ci.yml)，检查类型、lint、回归测试、竹子 LOD 数据一致性和生产构建，统一显示为 `Checks`。

涉及渲染或交互的修改，还需在手机与桌面预览中确认实际效果，尤其是首次进入、昼夜切换、风雨和视角切换。

## 性能采集

`pnpm perf` 使用 sitespeed.io / Browsertime 批量采集生产预览，报告以关键数字、场景横条和重点停顿展示结果，再展开原始证据。支持首屏、首次/重复进屋、PC 望月与听风切换，以及声音、天气、昼夜和主要系统按钮流程；`?perf=1` 开启可选业务计时，另加 `&perfUI=1` 显示运行时实时监测与加载时间线。实时页保留滚动帧间隔图、卡顿上下文和渲染器计数，支持暂停、清空和本地导出。

从 [建立基线与一键复测](docs/performance/pipeline.md) 开始；运行条件和 Chrome Canary 配置见 [采集工具说明](scripts/perf/README.md)。换 Three.js / Blender 项目时参照 [适配器契约](docs/performance/adapter.md)。另有 [实时运行与加载时间线](docs/performance/diagnostic-view.md)、[整体页面流程图](docs/performance/page-lifecycle.md)、[首次实测与瓶颈证据](docs/performance/first-capture.md) 和 [3D 专项开源工具对比](docs/performance/open-source-tools.md)。

## 预览与正式发布

使用现有 Cloudflare Workers Builds：功能分支和 `main` 都只上传预览版本，验收后由维护者手动将同一版本发布到正式站。首次使用需要先调整控制台，仓库配置本身不会关闭现有自动上线。

完整设置、首次切换顺序、版本核对和回退步骤见 [部署说明](docs/deployment.md)。四项后续工作见 [本地 issue](docs/issues/README.md)。
