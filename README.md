# 竹林里的老屋 · Bamboo Old House

基于 Three.js 的交互式 3D 老屋场景，在竹林、木廊与房间之间漫游，感受晨昏、风雨和自然声景。支持沿路漫游、自由视角、360° 环顾与竹林望月，可切换四个时段和四档天气。

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
| 老屋 LOD | [`architecture-lod.bin`](public/models/architecture-lod.bin)、[`house-lod.json`](src/components/scene/generated/house-lod.json) | 复用原贴图与顶点属性的压缩远景索引 |
| 自然录音 | [`public/audio/`](public/audio/) | 九段风、雨、鸟鸣与虫鸣等录音；[来源与致谢](public/audio/credits.md) |
| 备用画面 | [桌面](public/scene-poster.webp)、[手机](public/scene-poster-mobile.webp) | 静态场景画面 |
| 图标 | [`icon.svg`](public/icon.svg)、[`favicon.svg`](public/favicon.svg) | 统一的竹节与竹叶标识，用于页头、入场面板和浏览器标签 |

GLB 已内嵌贴图与缓冲数据。声音在用户主动操作后播放，并随时段和天气变化。

## 资源更新

资源来自同级建模项目 `../blender-two/`；只有同步资源需要该目录，日常代码开发不依赖它。修改 `.blend` 后需先导出网页资源。

| 更新内容 | 处理方式 |
| --- | --- |
| 模型、贴图或录音 | 导出到 `../blender-two/website/public/` 后执行 `pnpm sync` |
| 竹子模型 | 同步后执行 `node scripts/generate-bamboo-lod.mjs`，将 `bamboo.glb` 与生成的 `bamboo-lod.json` 一起提交 |
| 老屋模型 | 同步后执行 `node --experimental-strip-types scripts/generate-house-lod.mjs`，将 `architecture.glb` 与生成的 `architecture-lod.bin`、`house-lod.json` 一起提交 |
| 模型增删改名、地形、布局、相机、灯光或天气效果 | 同时合并原项目 `website/components/scene/` 到本项目 `src/components/scene/` 的对应代码 |
| 页面或交互 | 对照原项目 `website/app/`、`website/components/experience.tsx`，合并到本项目 `src/` 的对应位置 |

`pnpm sync` 通过 `rsync` 单向复制资源并重新构建，替换同名文件、补充新资源，不自动删除额外文件。它只同步资源；代码需单独合并，并保留本项目的依赖、锁文件与构建配置。

## 修改验证

目标为 `main` 的 PR 和 `main` 更新会运行 [CI](.github/workflows/ci.yml)，检查类型、lint、回归测试、竹子 LOD 数据一致性和生产构建，并核查可部署资源，统一显示为 `Checks`。本地 `pnpm check` 还包含老屋 LOD 数据一致性检查。

涉及渲染或交互的修改，还需在手机与桌面预览中确认实际效果，尤其是首次进入、昼夜切换、风雨和视角切换。

## 画面设置

右上角的滑杆设置入口统一提供「画面 / 声音」两个页签。「画面」以紧凑分段控件提供「性能 / 均衡 / 完整」三个档位，也可以单独调整清晰度、帧率上限、阴影和老屋远景；「声音」提供自然声开关与音量。手机默认「性能」，桌面默认「均衡」；选择不根据帧率自动改变，只作用于当前访问。「画面与性能」旁的复位按钮恢复对应设备的默认画面，不改变自由模式。

时段、天气、设置与场景导航共用一套控件尺寸、间距、圆角和选中色：常规按钮高 44px，采用留白较宽敞的小圆角矩形；分段控件将边框与内边距计入同样的总高度。桌面时段组宽 384px，清晨、白天、傍晚、夜晚四项等宽排列；窄屏自适应宽度，场景按钮的图标移到文字上方，保留完整名称与加载反馈。已移除「静止观看」按钮，仍遵循系统的减少动态偏好。全屏按钮隐藏导航、文案、设置和性能面板，只保留场景，不卸载模型或关闭声音；按 Esc、双击或触屏双击退出。浏览器允许时进入原生全屏，否则使用页面内无界面模式。退出后恢复原来的观看位置。

手机的默认配置为较低分辨率、30 帧绘制上限、关闭实时阴影、精简老屋远景。不同档位不再改变竹林模型或叶片数量；清晰度、阴影和动态流畅度仍有取舍。这是降低渲染负担的配置，不是帧率保证，选择完整档位也不会自动开启自由模式。

| 老屋远景 | 行为 |
| --- | --- |
| 精简 | 较早切换远景，距离更远时使用第二级简化 |
| 均衡 | 保守的远景简化，近处保留原始模型 |
| 原始 | 关闭老屋 LOD，所有距离使用原始模型 |

自由模式在所有设备上默认关闭，从画面设置主动开启后，可选屋外位置和六个房间。「院内竹荫」作为固定视角常驻；关闭自由模式时退回这里。已移除“隐藏房间内部的细节”开关，不再按画质档位过滤室内入口。

老屋使用 Three.js 原生 LOD 和 20% 距离滞回。标准 60° 视野下，均衡模式约 24 米启用远景；精简模式约 16 米启用第一层、24 米启用第二层。「林间的风」默认视角进入远景层。只有远景副本略去安全分组的室内陈设，七盏室内灯随远景层停用，两盏廊灯保留。靠近、放大观察或进入房间时恢复原始老屋、陈设及按昼夜变化的室内灯光；室内始终使用原始建筑。

老屋生成器复用已安装的 `meshoptimizer`：`simplifyWithAttributes` 在 2 / 5 厘米误差预算内简化建筑，并约束真实烘焙的雨水属性；`reorderMesh` 改善索引缓存顺序，`encodeIndexBuffer` 压缩索引。不会在手机上现场减面。

竹海补密保留；撤回本轮额外的竹竿减面、竹叶内部减面和精简档抽叶。竹林恢复此前的渲染策略：近景原始竹竿，远景原有 5 毫米误差预算索引，原有远处及移动端整叶采样不变，不受老屋远景档位影响。

LOD 下载失败、超时或索引不兼容时保留对应原模型几何。远景略去陈设不移除建筑外壳，也不销毁原贴图和模型，因此恢复细节不必重新下载，但不意味着彻底释放模型内存。关闭实时阴影会释放已分配的阴影图；切到老屋远景时释放不再使用的室内后处理目标，重新入室再按需创建。

首次进入在静态底图上显示单一的轻量加载面板，以竹子标识和缓慢流动的细线呈现等待状态，不叠加转圈、不显示模拟百分比，也不将下载进度频繁写入 React 状态。文案跟随模型加载、竹海布置、林下草地、风和光照准备等真实阶段轻柔淡入；短阶段合并为最新状态，切换间隔至少 1.6 秒，不为展示所有文案延长加载。实时场景就绪后立即开放操作，面板随画面淡入而淡出；完成、失败和离开页面时取消文案定时任务，隐藏后停止动画，系统开启减少动态时使用静态细线。失败时撤下加载面板，保留静态回退和重新载入入口；重试时重新显示入场面板。场景切换与声音加载的轻量反馈保留，不与入场面板同时显示。

高开销场景切换先更新按钮选中态，将目标按钮前的图标替换为缓慢旋转的加载图标；保留相同图标占位、按钮文字和宽度，不再弹出「正在前往」提示。约 180 毫秒后再统一提交视角、昼夜和天气，新场景首帧提交后恢复原图标。声音加载同样只替换声音按钮的图标，不临时改变按钮文字。画面仅有最高 4.5% 的中性明暗过渡，不增加彩色遮罩、模糊滤镜或 GPU 截图。快速连续选择只提交最后一个目的地；减少动态、页面隐藏和尺寸变化可立即结束转场。

提交前运行类型检查、lint、自动化测试、LOD 数据一致性检查和生产构建；本轮不使用浏览器自动化或真机性能测试，不能据此承诺具体帧率提升。

## 性能采集

平时用页面内面板找出「哪里卡了」，优化前后用批量流水线比较「有没有改善」。工具只做观测，不改变画质、声音、加载顺序或转场行为。

### 日常使用与开关

在 Chrome Canary 使用生产预览，避免影响日常 Chrome，也避免把开发模式的开销当成产品性能：

```sh
pnpm build
pnpm preview
```

- **打开面板**：[http://127.0.0.1:4175/?perf=1&perfUI=1](http://127.0.0.1:4175/?perf=1&perfUI=1)。
- **普通页面**：[http://127.0.0.1:4175/](http://127.0.0.1:4175/)。可以把两个地址加入书签。
- `?perf=1` 只开启业务阶段记录；同时添加 `&perfUI=1` 才加载实时面板。线上部署包含工具的版本后，也能使用 `https://yuuki.fans/?perf=1&perfUI=1`。

目前没有页面内的一键诊断总开关；**完整退出需移除 `perf`、`perfUI` 参数并重新加载页面**。仅修改地址而不重新加载不会改变本项目的诊断模式。

| 面板操作 | 实际效果 |
| --- | --- |
| 折叠 | 继续采集，标题保留当前频率与流畅状态 |
| 暂停实时采样 | 冻结运行时读数与时间轴；不停止全部业务阶段与资源记录 |
| 继续实时采样 | 开始新的连续采样，通常约 5 秒后给出流畅状态 |
| 停止检测 | 停止 RAF、观察器、刷新定时器、业务计时和场景诊断；保留最后记录供查看、导出 |
| 清空并重启 | 停止后可用：清空本轮加载、资源和实时记录，重新开始检测；不刷新场景、不清 HTTP 缓存 |
| 清空窗口 | 清除实时历史，保留加载时间线；不清浏览器缓存、不卸载模型或音频 |
| 导出 JSON | 保存当前保留的卡顿、运行时、加载阶段和资源数据到本机 |

推荐的日常检查顺序：

1. 从诊断地址重新进入，查看「加载时间线」里的模型、模块、场景构建、着色器准备和 HTTP 缓存证据。
2. 切到「实时运行」，保持页面前台约 5 秒，再做一个明确操作，例如「竹林望月 → 林间的风」、开启声音或切换天气。
3. 查看绿色「合适」、黄色「中等」、红色「卡顿」，并打开「最近卡顿」确认操作后的停顿位置、时长及当时的声音和场景状态。上方 Hz 是浏览器 RAF 回调频率，不是屏幕实际呈现的 FPS；平均频率正常也要留意最大间隔。
4. 复现后及时暂停、导出。图表保留最近 30 秒，卡顿记录最多 120 条；检查另一组操作前可以清空窗口。
5. 分别观察首次和重复操作。首次开声的下载、解码与再次开声的资源复用是不同条件，清空窗口不会恢复首次加载状态。

### 优化前后批量对比

`pnpm perf` 使用 sitespeed.io / Browsertime 操作真实控件，产出独立 HTML、Markdown、JSON 和可选浏览器 trace。先按[采集工具说明](scripts/perf/README.md#开始使用)配置 Canary 与匹配的 ChromeDriver，然后选择专项：

| `--flow` | 覆盖范围 |
| --- | --- |
| `load` | 从导航开始的首屏加载 |
| `views` | PC 望月与听风的首次、重复双向切换，保留自动开声行为 |
| `system` | 声音、音量、天气、昼夜及主要系统按钮 |
| `journey` | 首屏、自由视角、首次进屋、返回、再次进屋 |
| `cache` | 同会话首访与复访，记录本地缓存、协商验证及网络传输证据 |

```sh
# 优化前，保存三轮场景切换基线
pnpm perf --flow views --profile desktop --mode baseline \
  --iterations 3 --out outputs/performance/views-before

# 优化并重新构建后，用相同条件采集、对比
pnpm perf --flow views --profile desktop --mode baseline \
  --iterations 3 --out outputs/performance/views-after \
  --compare outputs/performance/views-before
```

打开新目录内的 `report.html`。输出目录必须尚不存在，后续复测使用新的名字。固定设备、浏览器、画质、声音、天气和采集配置；正式比较使用不显示实时面板的默认配置。需要调用栈时使用 `--mode diagnostic --iterations 1` 单独定位，不与 baseline 混算收益。工具会检查条件，缺失或不一致时拒绝输出可比的收益百分比。

### 用于其他 3D 项目或拆卸

通用工具位于 [`tools/scene-perf/`](tools/scene-perf/README.md)，可整体复制到其他项目，无须复制竹屋场景、模型或页面组件：

| 层 | 接入方式 | 依赖与用途 |
| --- | --- | --- |
| 浏览器核心 | `createRuntimeCollector(adapter)`、`createPhaseRecorder(options)` | 不依赖 React 或 Three.js；RAF、长任务、业务阶段和明确的 `dispose()` |
| 页面面板 | `usePerformancePanel(adapter, { enabled })` | React hook；按需加载面板，关闭或卸载时清理采集资源；面板使用 Base UI Progress |
| 批量流水线 | CLI `--adapter`、`--scenario` | Node、Canary、ChromeDriver；适配就绪条件、状态和真实控件操作 |

本项目差异集中在 [`src/performance/bamboo-adapter.ts`](src/performance/bamboo-adapter.ts)、[`src/lib/performance.ts`](src/lib/performance.ts) 和 [`scripts/perf/`](scripts/perf/README.md) 的项目适配器／操作流程。通用核心不读取竹屋 DOM 或 `__BAMBOO__`，也不接管项目的渲染循环。

可以复用到 Three.js、React Three Fiber 及其他浏览器 3D 项目；渲染器指标由项目显式提供。Blender 导出的 GLB/glTF 在网页中的加载和渲染适用，Blender 桌面软件内的建模、烘焙、离线渲染不在覆盖范围内。WebGPU 项目可复用浏览器指标，但不能把 WebGL 的读取方法直接套用到 WebGPU。

**可拆卸分为两层**：卸载面板／关闭 hook 会释放 RAF、观察器、监听器和定时器；若要彻底移除源码，还需移除集中入口与业务计时调用，再删除工具目录。保留埋点但令 recorder 禁用时，业务函数仍照常执行。完整的复制、最小接入、清理边界与限制见[独立工具 README](tools/scene-perf/README.md)。

从 [建立基线与一键复测](docs/performance/pipeline.md) 开始；运行条件和 Chrome Canary 配置见 [采集工具说明](scripts/perf/README.md)。换 Three.js / Blender 项目时参照 [适配器契约](docs/performance/adapter.md)。另有 [实时运行与加载时间线](docs/performance/diagnostic-view.md)、[HTTP 缓存与首访／复访](docs/performance/http-cache.md)、[整体页面流程图](docs/performance/page-lifecycle.md)、[首次实测与瓶颈证据](docs/performance/first-capture.md) 和 [3D 专项开源工具对比](docs/performance/open-source-tools.md)。

## 预览与正式发布

使用现有 Cloudflare Workers Builds：功能分支和 `main` 都只上传预览版本，验收后由维护者手动将同一版本发布到正式站。首次使用需要先调整控制台，仓库配置本身不会关闭现有自动上线。

完整设置、首次切换顺序、版本核对和回退步骤见 [部署说明](docs/deployment.md)。四项后续工作见 [本地 issue](docs/issues/README.md)。
