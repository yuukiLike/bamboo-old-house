# 3D 性能采集：可复用的开源工具

核对日期：2026-09-21。依据各项目官方仓库、README 与引擎文档；本页为能力与接入方式调查，没有在本项目安装或实测这些 3D 专项工具。仓库主分支的功能不等于已发布 npm 包或浏览器扩展的功能，接入时需要固定版本再验证。

**3D 页面仍需要导航、资源、主线程和交互采集，但还需要引擎计数、GPU 时间和渲染调用分析。** 已有开源工具覆盖了这些不同层次。不能用 FPS 面板代替完整页面过程，也不能用 JavaScript `render()` 返回时间代表 GPU 完成。

## 值得复用的仓库

| 仓库 | 实际提供什么 | 接入现有项目 | 能否直接替代批量采集 runner |
| --- | --- | --- | --- |
| [endel/webgpu-webgl-benchmarks](https://github.com/endel/webgpu-webgl-benchmarks) | Three.js、PlayCanvas、Babylon.js 的 WebGL2 / WebGPU 场景矩阵，跨浏览器重复采集，CPU / GPU 时间、计数、JSONL 和报告 | 跑仓库自带的确定性场景；其 harness 拥有帧循环，每个页面测一个配置。接入老屋需要适配场景和循环 | **可借鉴批量基准框架，不能直接填入老屋 URL 就测完整用户流程** |
| [BabylonJS/Spector.js](https://github.com/BabylonJS/Spector.js) | WebGL / WebGL2 抓帧：draw calls、shader、纹理、GL 状态和调用序列；可导出捕获结果 | 浏览器扩展或页面注入，适用于 Vanilla Three.js；定位到室内慢帧后使用 | 可接任意 WebGL 页面进行专项捕获，但没有替代本项目的首屏完成条件、操作路径和多轮历史比较 |
| [RenaudRohlinger/stats-gl](https://github.com/RenaudRohlinger/stats-gl) | 实时 FPS、CPU / GPU 计时；当前 README 覆盖 Three.js、原生 WebGL2 / WebGPU 和 Worker，并提供无 UI 的 `StatsProfiler` | 将 renderer / context 交给库，或围绕绘制调用接入；适合当前 Vanilla Three.js | **可替代自写的部分渲染计时采集器**，仍需外部运行、阶段分段与数据归档 |
| [TheoTheDev/three-perf](https://github.com/TheoTheDev/three-perf) | Vanilla Three.js 的 CPU / GPU / FPS 图、几何体 / 纹理 / shader 等计数；支持隐藏面板继续采集 | 接受 `THREE.WebGLRenderer`，在绘制或 composer 外围调用 `begin()` / `end()`；官方用例说明支持多 pass | 适合实时现场诊断；官方文档未提供页面导航、多轮浏览器操作与历史回归流程 |
| [utsuboco/r3f-perf](https://github.com/utsuboco/r3f-perf) | React Three Fiber 的性能面板、GL program 深入分析、`PerfHeadless`、`usePerf/getReport` | 面向 `@react-three/fiber` 的 `<Canvas>`。老屋的 React 外壳内是自行管理的 Three.js，不是 R3F | 无 UI 模式能提供数据，但不是可直接扫描任意站点的 runner；当前项目优先看 Vanilla 工具 |

上表中的“不能直接替代”是根据这些项目公开的接入接口与运行方式作出的判断，不表示它们不能经适配参与自动化。

## 最接近“专门 3D 批量基准”的方案

`webgpu-webgl-benchmarks` 已有可直接运行的批量命令、场景过滤、重复次数、JSONL 和 HTML 报告。它把渲染计数和正式计时分成不同轮次，并通过统一场景与帧循环保证引擎间可比性。**它测的是准备好的 3D 工作负载，不是通用的已有网站扫描器。** [官方 README](https://github.com/endel/webgpu-webgl-benchmarks#quick-start)

复用它时需要注意目标差异：它的 Chrome 基准关闭 vsync / 帧率限制，旨在比较渲染吞吐；老屋需要保留正常浏览器条件，观察用户进入页面和首次进屋的体验。不能直接拿该仓库的数字或引擎排名推断老屋表现。若以后要单独比较“植被生成方式”“后处理 pass”“WebGL 与 WebGPU”，可以把这些工作负载做成它的场景适配器。[采集协议及限制](https://github.com/endel/webgpu-webgl-benchmarks#what-is-measured)

Spector.js 当前主分支还包含官方 **MCP server**，使用 Playwright 加载 URL、注入 Spector、捕获帧并查询 draw calls、shader、纹理和 GL 状态。这更接近“给现有 WebGL 页面做自动诊断”。其文档默认使用 headless Chromium；若纳入老屋流程，需要核对浏览器选择、实际 GPU 和场景操作，不把它的抓帧结果当作当前 Canary 基线的同条件计时。[官方 MCP 文档](https://github.com/BabylonJS/Spector.js/tree/master/mcp)

## 三层分工与介入点

| 层次 | 应复用的能力 | 老屋仍需提供什么 |
| --- | --- | --- |
| 通用页面层 | 浏览器自动化、trace、导航 / Resource Timing、长任务、可见性、批量归档 | URL、浏览器配置、冷暖条件、真实控件操作、各段观察窗口 |
| 引擎层 | `renderer.info`、stats-gl / three-perf 的 CPU / GPU 数据、Spector 抓帧 | renderer / context 引用；整帧包含哪些 pass；计数何时 reset；设备是否支持 GPU timer |
| 业务适配层 | 原生 User Timing / 小型阶段记录 | 模型下载与解析、场景构建、首次室内管线、目标帧提交、转场完成等真实生命周期边界 |

GPU 时间必须来自支持的 GPU 计时机制。stats-gl 的原生 WebGPU 示例要求 `timestamp-query` 并在 pass 上写时间戳；WebGL GPU 监控同样依赖扩展支持。无 UI 采集接口可以输出数据，但不能把面板的平滑平均值直接当成原始逐帧 p95。[stats-gl 官方接口](https://github.com/RenaudRohlinger/stats-gl#api-reference)

如果项目使用 Babylon.js，它已有更完整的引擎侧方案：`EngineInstrumentation` / `SceneInstrumentation` 提供 GPU、shader 编译、帧内阶段和 draw call 计数；Inspector Performance Profiler 支持时间图、无界面录制、自定义事件及 CSV 导入导出。这是值得参考的架构，但依赖 Babylon scene / engine，不能直接装到 Three.js renderer 上。[引擎计数文档](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/scene/optimize_your_scene.md#instrumentation)、[Performance Profiler 文档](https://github.com/BabylonJS/Documentation/blob/master/content/toolsAndResources/inspector/performanceProfiler.md)

## 本项目建议

**保留目前的批量浏览器 runner 作为调度与证据归档入口，把 3D 专项工具作为可选采集器接入。** 这属于当前方案的技术选择，不是已有工具缺乏能力的结论。

1. 先使用已有 runner、业务阶段记录和 Chrome trace，确认慢在下载、JavaScript 构建、首次渲染准备还是持续绘制。
2. 需要持续 CPU / GPU 数据时，优先验证 **stats-gl**；其官方接口同时覆盖当前 Three.js WebGL 和未来 WebGPU。若更需要现成的 Three.js 计数面板，可评估 **three-perf**。两者先选一个，避免重复插桩。
3. 需要解释具体 WebGL pass、shader 或重复绘制时，使用 **Spector.js** 单独抓取目标帧。
4. 需要比较固定渲染算法或引擎工作负载时，再复用 **webgpu-webgl-benchmarks** 的 harness；它不负责替代老屋的用户流程脚本。

需要介入的位置是 renderer 创建、渲染循环的完整 pass 边界、模型解析和懒管线创建入口。首次使用阶段与稳定渲染阶段分开保存；每种诊断工具记录是否启用，工具自身开销通过同条件采集验证。本页没有声称上述组合已经完成接入或产生性能收益。
