# Preview 渲染性能基线与采集方案

记录日期：2026-09-21。

状态：工具选型与采集方案；尚未安装采集工具、接入埋点或运行性能测量。命令与脚本示例依据官方文档和发布源码核对，尚未经本项目实跑验证。

开发分支：`preview/performance-baseline`。产品参考提交：`4ccde789b494d31a568f0cb4d6a6741e649e036d`。

关联：[LOCAL-003：3D 性能基线与优化证据记录流程](../issues/003-3d-performance-baseline.md)。本文记录本轮确定的工具、采集方式和介入位置；旧议题中的 `perf/3d-baseline` 建议分支以本轮分支为准。

## 1. 目的与约束

建立从页面导航、资源加载、场景初始化，到首次可操作、画面展示，以及后续按需加载视图的性能链路。每项优化建议都应能指向 trace 时间区间、具体代码或渲染 pass，并用同条件复测确认收益。

- 全程不新增测试用例。操作脚本用于采集和导出，没有测试断言，也不接入测试运行器。
- 首轮使用当前电脑的原生 Chrome，覆盖桌面与移动模拟。移动模拟用于覆盖移动代码路径，不代表真实手机 GPU 表现。
- 使用生产构建，区分本地预览与线上 preview 的结果。
- 基线阶段保持原有加载顺序、预热、分辨率和画质。先观测，再形成优化假设。
- preview 日常访问的轻量记录与一次性完整诊断互补；集中查看首先复用现成性能报告，保留多轮结果供比较。
- 目标是渲染性能归因；本轮不接入异常监控平台。

## 2. 开源工具选择

优先采用 **sitespeed.io + Browsertime** 承担批量采集和报告，Chrome DevTools 分析原始 trace，业务侧只补充工具无法自动认识的阶段。

| 工具 | 职责 | 是否修改业务源码 |
| --- | --- | --- |
| sitespeed.io | 批量 URL、重复采集、用户操作流程、HTML 汇总及原始证据组织 | 不需要；流程脚本放在采集端 |
| Browsertime | sitespeed.io 的浏览器采集引擎；也可独立使用，获得 JSON、HAR、Chrome trace | 不需要 |
| Chrome DevTools Performance / Network | 调用栈、CPU self/total time、资源瀑布、布局、绘制、GC、帧轨道 | 不需要；source maps 能改善源码归因 |
| User Timing / PerformanceObserver | 应用阶段、资源条目、长任务、长动画帧与交互信息 | 浏览器通用条目可由采集端注入；精确业务阶段需少量源码标记 |
| RAF + CPU 分段计时 + Three.js `renderer.info` | 帧间隔、场景更新、渲染提交、整帧绘制量与资源数量 | 部分可复用 `window.__BAMBOO__`；完整帧内分段需业务介入 |
| stats-gl | 按需查看 FPS、包裹区间的 CPU 与受支持设备上的 GPU 趋势 | 需要接入 renderer 或原始 WebGL context |
| Spector.js | 专项捕获 WebGL 调用、shader、纹理与各个 pass | 可用浏览器扩展；通过拦截 WebGL 工作，有测量扰动 |
| Chrome Memory | 反复进入视图后的分配、保留对象和 GC 问题 | 不需要，单独运行专项采集 |
| Lighthouse / Lighthouse CI | 补充页面加载审计、批量 URL 与版本回归信息 | 不需要；仅导航审计不足以覆盖所有视图 |
| Playwright Library / Puppeteer + CDP | 现成流程接口不能满足要求时，定制浏览器控制和 trace 采集 | 不需要，但需自行维护采集与报告编排 |

sitespeed.io 已提供采集和报告能力，因此不再把从头构建 Playwright 采集框架作为首选。Lighthouse User Flows 可测交互时间段，但不会自动理解 Three.js 场景何时就绪。本项目第一轮优先本机原生 GPU 与可重复的视图操作。

来源：[sitespeed.io 配置](https://www.sitespeed.io/documentation/sitespeed.io/configuration/)、[Browsertime](https://github.com/sitespeedio/browsertime)、[操作脚本](https://www.sitespeed.io/documentation/sitespeed.io/scripting/)、[Chrome Performance](https://developer.chrome.com/docs/devtools/performance/reference)、[Lighthouse User Flows](https://github.com/GoogleChrome/lighthouse/blob/main/docs/user-flows.md)、[Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)。

## 3. 三种介入程度

| 层次 | 做法 | 能看到什么 | 边界 |
| --- | --- | --- | --- |
| 外部录制 | 浏览器导航前启动 trace；脚本点击、滚动、等待并保存结果 | 网络、CPU 栈、GC、布局、绘制、帧表现及操作区间 | 能看到发生了什么，不一定知道业务步骤叫什么 |
| 启动时注入 | 通过 Browsertime `injectJs` 或 Playwright `addInitScript`，注入 PerformanceObserver、RAF 记录器 | 无需改仓库即可增加通用指标，读取现有诊断数据 | 改变了运行时，仍有开销；不能直接访问模块内部闭包变量 |
| 业务边界埋点 | 在少量已存在的阶段前后写 User Timing，补充场景状态和渲染统计 | 区分模型解析、管线构建、首次绘制、视图揭示等业务阶段 | 最准确地连接浏览器证据与代码，需 preview 采集开关 |

“无需改源码”不等于“没有性能开销”。调用栈采样、注入观察器、截图和 WebGL 拦截均需与基线采集区分。不批量包装所有函数，也不替换全局 fetch/render 来推测全部业务阶段。

注入只作用于采集器打开的访问。若要求任意普通 preview 访问都自动记录，需要把轻量采集器接入 preview 构建的应用启动路径。构建开关建议使用 `VITE_PERF_MONITOR=1`；默认关闭，详细面板按需加载。

来源：[Browsertime 配置](https://www.sitespeed.io/documentation/browsertime/configuration/)、[Playwright addInitScript](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script)、[User Timing](https://developer.mozilla.org/en-US/docs/Web/API/Performance/mark)。

## 4. 一次性批量采集

本轮核对版本：sitespeed.io `42.7.0`、其使用的 Browsertime `28.3.0`，Node.js 要求 `>=22`。本项目使用 Node.js 24，满足声明要求。实际采集仍需记录 Chrome、ChromeDriver 与图形后端；不要将 Mac 上容器内的软件渲染结果作为本机 GPU 基线。

生产构建与预览服务：

```sh
pnpm build
pnpm preview
```

预览地址为 `http://127.0.0.1:4175/`。在另一个终端进行一次性采集：

```sh
npx --yes --package=sitespeed.io@42.7.0 sitespeed.io http://127.0.0.1:4175/ \
  -b chrome -n 3 \
  --cpu \
  --video false --visualMetrics false \
  --outputFolder outputs/performance/page-diagnostic
```

这是无需改站点的页面级诊断入口，会下载并运行工具，要求本机有可用 Chrome/驱动。视频与视觉分析关闭时不进行 FFmpeg 视频采集；需要影片证据时另行配置相关依赖并单独录制。`--cpu` 采集主线程时间线与长任务；原始 trace 可放入 DevTools 分析。

上述默认结束条件不等于本项目 3D 就绪，不能把这条快速命令的结果标注成完整场景基线。完整采集必须改用业务完成条件或操作脚本，持续到场景就绪后指定的观测窗口。

对多个 URL，可将地址逐行放入 `urls.txt`，将命令的位置参数改为 `urls.txt`。本项目只有一个页面：懒视图需用操作脚本触发，单纯增加 URL 或使用网络 idle 无法覆盖。

可比较的轻量轮次与 `--cpu` 归因轮次分开，分别明确配置并保存。无需一次打开全部工具。对永远存在风、雨等动画的画布，也不以“画面完全不再变化”作为结束条件。

来源：[批量与参数](https://www.sitespeed.io/documentation/sitespeed.io/configuration/)、[CPU 采集](https://www.sitespeed.io/documentation/sitespeed.io/cpu/)、[浏览器完成条件](https://www.sitespeed.io/documentation/sitespeed.io/browsers/#choose-when-to-end-your-test)、[本机安装条件](https://www.sitespeed.io/documentation/sitespeed.io/installation/)。

### 不改业务源码的首屏采集脚本示例

下面内容可保存为 `scripts/perf/initial-3d.cjs`。该文件尚未创建；这里只记录经过 API 核对、未经实跑的示例。项目是 ESM，因此采用 `.cjs` 与工具 CommonJS 脚本接口匹配。

```js
module.exports = async function (_context, commands) {
  const url = process.env.PERF_URL || 'http://127.0.0.1:4175/';

  await commands.measure.start('initial-3d-ready');
  await commands.navigate(url);
  await commands.wait.byCondition(`(() => {
    const mount = document.querySelector('.scene-mount.ready');
    return Number(window.__BAMBOO__?.startupMs) > 0 &&
      !!mount && Number(getComputedStyle(mount).opacity) >= 0.999;
  })()`, 120000);
  await commands.wait.byTime(5000);
  await commands.measure.stop();
};
```

保存脚本后，一条命令连续录制三轮：

```sh
npx --yes --package=sitespeed.io@42.7.0 sitespeed.io \
  scripts/perf/initial-3d.cjs \
  -b chrome -n 3 \
  --browsertime.headless false \
  --browsertime.chrome.timeline true \
  --browsertime.pageCompleteCheck 'return document.readyState === "complete"' \
  --video false --visualMetrics false \
  --outputFolder outputs/performance/initial-3d-diagnostic
```

`measure.start(alias)` 先开始区间，导航、业务等待、额外观测都包含在区间内。不要改成 `measure.start(URL, alias)` 后再追加等待，因为那个重载会导航并自动结束测量。

此示例只覆盖首屏，不包含进屋等交互。现有 `startupMs` 与 CSS opacity 能为无源码改动的初次录制提供实用停止条件，但轮询存在检测延迟，不能作为精确首帧时间。录制区间包含最后 5 秒观测，也不能把整个区间长度命名为 3D 加载耗时。精确阶段时间依赖后文的业务 User Timing。

懒视图采用同样结构：开始命名区间 → 真实控件操作 → 等待目标状态与转场完成 → 固定观测窗口 → 结束；再做一次重复进入。采集只覆盖实际操作过的路径。

API 来源：[Browsertime 28.3.0 Measure](https://github.com/sitespeedio/browsertime/blob/v28.3.0/lib/core/engine/command/measure.js)、[Wait](https://github.com/sitespeedio/browsertime/blob/v28.3.0/lib/core/engine/command/wait.js)、[sitespeed.io 42.7.0 包配置](https://github.com/sitespeedio/sitespeed.io/blob/v42.7.0/package.json)。

## 5. 项目介入位置

下列行号以产品参考提交为准；实施时按符号定位。

| 位置 | 介入边界 | 建议阶段 |
| --- | --- | --- |
| `src/components/experience.tsx:99–104` | 动态 import 前后、createScene 前后、ready 状态提交 | `scene.module`、`scene.initialize`、`scene.controls-ready` |
| `src/components/scene/scene.ts:124–134` | 每个模型 fetch/流读取、拼接缓冲、parseAsync 前后 | `model.download`、`model.buffer`、`model.parse`，带资源名 |
| `src/components/scene/scene.ts:140–179` | 环境、房屋、植被、地表、风雨等现有构建段 | `scene.build.*` |
| `src/components/scene/scene.ts:247–269` | 现有 compileAsync、室内预热、首个完整 render | `scene.compile`、`scene.prewarm`、`scene.first-render-submitted` |
| `src/components/scene/interior-contact.ts:124/196` | `pipeline ??= build()` 中的实际首次 build，以及随后首次 composer.render | `interior.pipeline-build`、`interior.first-render-submitted` |
| `src/components/experience.tsx:197–205`、`src/components/scene/view-transition.ts:103–134` | 用户切换请求、目标状态提交、目标帧提交、reveal 完成回调 | `view.request`、`view.commit`、`view.first-render-submitted`、`view.revealed` |
| `src/components/scene/scene.ts:271–294` | tick 场景更新与 renderFrame 各自前后；全部 pass 之后读取统计 | `frame.update`、`frame.render-submit`，按视图分段 |
| `src/components/scene/soundscape.ts:286–304` | 首次音频 fetch 与 decodeAudioData | `audio.download`、`audio.decode`，解释与渲染的资源竞争 |

优先补充动态导入、模型解析、启动编译/预热、首次室内管线、转场完成五类业务边界。每帧以数值缓冲记录，不向 Performance 时间线无限追加逐帧 mark，也不每帧 setState。

公共采集接口保持最小：记录具名阶段、绑定 run/操作 ID、快照与导出。可在现有 `window.__BAMBOO__` 旁提供专用性能入口，避免改变原有诊断字段语义；尚未实施此接口。

并行模型操作使用独立操作 ID，避免 measure 配对到另一并行操作的同名 mark。取消、被后续视图替代和未完成的阶段保留状态，不虚构完成耗时。同一操作的浏览器资源、阶段与帧使用一致的时间基准。

## 6. 时间口径与采集链路

```text
页面导航
  → HTML / CSS / 静态首屏 / React 挂载
  → 3D 模块导入
  → 模型下载与解析、环境生成（并行与交错）
  → 场景装配 / 植被 / 天气构建
  → 现有 shader 编译与预热
  → 首次完整渲染提交
  → 控件可操作、画布揭示
  → 后续首次进入视图、重复进入、稳定渲染
```

- 模型下载完成不等于 parse 完成；parse 含异步等待，阶段总耗时不能标为纯 CPU 执行时间。纹理解码、GPU 上传与首次 shader 成本结合 trace 和专项抓帧归因。
- 并行阶段保留实际依赖与重叠，分析关键路径，不简单相加。
- `renderer.render()` 返回仅代表调用完成/命令提交，不代表 GPU 已执行完或像素已显示；结合 Frames 轨道和画面证据核对。
- `setReady(true)` 后画布仍有 opacity 过渡。分别记录控件 ready 与过渡完成，不能混为“加载完成”。
- 现有 `startupMs` 从 createScene 开始，遗漏导航与动态导入；`__BAMBOO__` 存在也不表示初始化结束。现有帧数组跳过最初 30 帧，且不自动按视图分段，需要补齐。
- 保留 `renderFrame()` 在整帧开始 reset 的口径，读取全部 pass 累计值。`renderer.info.memory` 是对象数量，不是显存字节。
- stats-gl 自动接入所包裹的 render 不包含之前的全部场景更新；GPU query 异步返回，不能用面板聚合值计算逐帧 GPU p95。无效或不支持时记 N/A。
- LCP 候选不包含 WebGL canvas；LCP/INP/CLS 是补充页面体验指标，不能替代 3D 首帧或目标视图完成时间。

来源：[Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)、[stats-gl](https://github.com/RenaudRohlinger/stats-gl)、[GPU timer query](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)、[Spector.js](https://github.com/BabylonJS/Spector.js)、[LCP](https://web.dev/articles/lcp)。

## 7. 操作覆盖、报告与验收

采集流程至少覆盖：

1. 冷启动、暖启动；从导航持续到 3D 展示后。
2. 五段路径与木廊。
3. 首次进入室内、回到屋外、再次进入；覆盖所有室内/室外地点，区分环顾中与停下后的细节恢复。
4. 首次夜晚与望月、返回日间、重复切换。
5. 林间风景、井边雨景和天气切换；视觉与首次音频开销分别记录。
6. 天气/音量面板、地点选择器首次与重复打开。
7. 后台返回、resize、反复室内外和昼夜切换后的资源/内存变化。

固定设备、浏览器、图形后端、视口、DPR、实际画布尺寸、相机、天气历史、昼夜、声音、缓存、CPU/网络节流与采集工具开关。桌面和移动模拟重新创建页面，不能只缩小已打开的桌面窗口。

每个配置至少重复 3 轮；首次成本不预热。稳定渲染暖机至少 10 秒后采集 30 秒，保留实际时长和轮间波动。降分辨率或关闭 pass 的单变量诊断另存为实验，不混进原画质基线。

报告沿用 sitespeed.io HTML、JSON、HAR 与 trace，增加项目阶段和帧摘要：加载瀑布与关键路径、视图首次/重复耗时、帧间隔中位数/p95/p99/最长帧、场景更新/渲染提交、绘制量变化。重型 trace 需保留 JS samples，并提供与对应构建匹配的 source maps。

原始数据按 run ID 存入已忽略的 `outputs/performance/`；选定基线后保存到可长期访问的证据位置，在 `docs/performance/` 记录版本、采集配置、文件哈希及链接，不能只依赖临时文件。当前还没有性能证据，不能将示例数字或候选瓶颈写成实测结论。

验收要求：

- 首屏和所有按需视图都有可解释的起止事件，前 30 帧和首次使用尖峰没有被丢弃。
- trace 中可以从慢阶段追到资源或源码调用；并行耗时、CPU、GPU、帧间隔定义清楚。
- 同一操作多轮数据可对比，缺失指标为 N/A。
- 采集器不会无限积累帧、mark 或日志；进行采集开关对照确认自身开销。
- 沿用项目已有检查；不新增测试用例。文档改动只需检查内容、链接及 diff 格式。

后续优化记录遵循：**现象 → trace 区间与代码 → 瓶颈假设 → 单项改动 → 同条件复测**。保留无收益与回退结果。
