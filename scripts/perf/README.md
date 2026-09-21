# 3D 页面性能采集与分析

从导航之前开始录制，持续到三维画面出现，再通过真实控件记录首次进屋与再次进入。产出独立 HTML、Markdown、JSON，以及可导入 Chrome DevTools 的原始 trace。工具用于定位优化目标和复测，不修改画质，不自动判断某个函数就是瓶颈。

[重复采集与对比流水线](../../docs/performance/pipeline.md) · [接入另一个 Three.js 项目](../../docs/performance/adapter.md) · [页面内实时进度](../../docs/performance/diagnostic-view.md) · [页面整体流程图](../../docs/performance/page-lifecycle.md) · [选型与设计依据](../../docs/plans/preview-performance-baseline.md) · [首次实测记录](../../docs/performance/first-capture.md) · [3D 专项开源仓库](../../docs/performance/open-source-tools.md)

## 开始使用

需要 Node.js ≥22.13、pnpm、Chrome 和与其匹配的 ChromeDriver。采集器通过 `npx` 使用固定的 `sitespeed.io@42.7.0` / Browsertime 28.3.0，首次运行会下载工具；不添加项目依赖。为保留真实图形后端，使用本机可见浏览器。

```sh
# 终端一：生产构建；诊断构建附带 source maps
PERF_SOURCEMAP=1 pnpm build
pnpm preview

# 终端二：同一套 Chrome / ChromeDriver，按实际安装位置填写
export PERF_CHROME='/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
export PERF_DRIVER='/absolute/path/to/chromedriver'

# 一次命令，三轮，每轮包含五个阶段
pnpm perf --profile mobile --iterations 3 --out outputs/performance/mobile-before

# 详细归因：CPU 调用栈、浏览器时间线与截图
pnpm perf --profile mobile --mode diagnostic --iterations 1 \
  --out outputs/performance/mobile-diagnostic

# 系统按钮与声音：短窗口先检查整条路径
pnpm perf --flow system --profile mobile --iterations 1 --observe-ms 1000 \
  --out outputs/performance/system-capture

# PC 望月 / 听风专项：首次与重复双向切换，保留真实自动开声行为
pnpm perf --flow views --profile desktop --mode diagnostic --iterations 1 \
  --out outputs/performance/desktop-views-diagnostic
```

`PERF_DRIVER` 是可选参数；只有随工具安装的驱动与 Chrome 兼容时才能省略。版本不匹配会保留错误日志并非零退出。可从 [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) 取得同一版本的浏览器和驱动；也可用已安装的匹配二进制，通过 `--chrome` / `--driver` 指定。不要用 Docker 软件渲染的数字替代本机 GPU 基线。

报告在指定目录的 `report.html`，可以直接打开；若浏览器限制本地相对链接，可启动只读文件服务：

```sh
python3 -m http.server 4180 --bind 127.0.0.1 --directory outputs/performance
# 打开 http://127.0.0.1:4180/mobile-before/report.html
```

采集时让采集浏览器保持前台，避免同时运行构建、录屏、其他三维页面或另一份性能采集。移动模式是电脑上的设备模拟，用于覆盖移动端按需路径，不能据此断言真机帧率。

## 配置与操作覆盖

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `--url` | `http://127.0.0.1:4175/` | 已启动的生产预览服务 |
| `--profile` | `desktop` | `desktop` 请求 1440×900 外窗、DPR 1；`mobile` 模拟 402×874 视口、DPR 2 |
| `--iterations` | `3` | 独立浏览器轮次，1–30 |
| `--mode` | `baseline` | 轻量采集；`diagnostic` 加 trace、JS 采样和截图 |
| `--flow` | `journey` | 五段视图；`load` 仅首屏；`system` 覆盖系统按钮；`views` 专门采集望月与听风首次/重复切换 |
| `--observe-ms` | `5000` | 就绪后每段观察 1,000–30,000 ms |
| `--instrumentation` | `on` | `on` 添加 `?perf=1`；`off` 移除该参数；浏览器通用探针始终存在 |
| `--scenario` | `scene-journey.cjs` | 自定义 Browsertime 流程及对应数据导出 |
| `--adapter` | `adapters/bamboo.cjs` | 项目的就绪、诊断与状态读取适配器；传入 `.cjs` 文件 |
| `--out` | 时间戳目录 | 必须是新目录，防止覆盖历史证据 |
| `--compare` | 不比较 | 采集结束后与指定目录比较；启动前检查其 manifest，不继承基线配置 |

实际 viewport、绘图缓冲尺寸和应用 pixelRatio 取浏览器诊断，不用请求外窗尺寸替代。每段另读即时 `browserViewport`，请求尺寸/DPR 未生效则整次采集失败；移动模拟使用 ChromeDriver 的 `deviceMetrics` 嵌套配置。原始网络、CPU 均不节流；报告记录图形后端和浏览器真实版本。这里使用 Canary 隔离日常 Chrome；两者的采集不能直接对比。

内置流程按顺序执行，后续阶段继承前面的状态：

| 场景 | 真实操作 | 主要观察对象 |
| --- | --- | --- |
| `initial-3d` | 打开页面 → 控件启用且画布淡入完成 | 导航、动态模块、六组模型、场景构建、编译和预热 |
| `free-outdoor` | 点击“自由看看” | 第一次视图切换与快照 |
| `interior-first` | 点击楼层入口，上楼 | 移动端首次创建室内渲染管线及首帧 |
| `outdoor-return` | 点击楼层入口，返回院坝 | 室内外切换 |
| `interior-repeat` | 再次上楼 | 与本轮首次进入的差异 |

这五段是默认 `journey` 覆盖。新增 `system` 通过真实点击和键盘操作扩展系统覆盖：首次开声、关闭及再次开声；音量面板和调节；天气面板与预设；昼夜首次/重复；望月、林间、井边、木廊、步行、自由模式；地点选择；环顾、复位、暂停与恢复。每轮的完整预期场景集合写入 `manifest.config.expectedScenes`，缺段不能报告完整覆盖。

`views` 是针对 PC 望月与听风卡顿的独立五段路径。用户所说的“林海听风”，当前页面实际按钮文案是 **“林间的风”**，脚本点击该真实按钮；每轮从新页面开始，没有预先静音改写自动开声行为：

| 场景 | 方向与声音前提 |
| --- | --- |
| `initial-3d` | 页面初始加载，声音关闭 |
| `moon-first` | 首次点击“竹林望月”，声音保持关闭 |
| `breeze-first-auto-audio` | 望月 → 首次“林间的风”，按钮自动开启声音，包含首次音频准备 |
| `moon-return-with-audio` | 听风 → 望月，保持声音开启 |
| `breeze-repeat-with-audio` | 望月 → 再次听风，保持声音开启，已加载音频可复用 |

每段保留 `startState` / `endState`、RAF 慢间隔、业务阶段与原始 trace（diagnostic 模式），用来查看视图提交、转场、音频下载/解码等是否与停顿重叠。首次和重复听风的音频前提不同，不能直接把耗时差全部算成画面收益。结束后通过真实按钮关闭声音，等待延迟挂起；收尾在测量区间之外并另存 `cleanup-<iteration>-views.json`。这一专项不会声称已覆盖全系统按钮；完整预期集合仍由 manifest 逐轮核对。

系统流程记录 `startState` / `endState`，包括声音开启、加载/错误、时间、天气、视图/地点、动态暂停、环顾、面板与可观察音量。林间/井边自动启声的负载明确命名；需要隔离时通过真实按钮静音并等待淡出/延迟挂起。关闭面板等准备操作单独记为 `preparations`，不偷偷计入下一按钮耗时。

这是一组有界操作矩阵，**不等于所有状态的排列组合**。resize、后台恢复、长期内存和每个地点×天气×声音组合仍需专项脚本。采集器不会从 URL 自动发现三维场景里的懒加载路径。

默认 5 秒观察适合快速定位与检查采集链路。长期稳定帧率应增加观察时长，并在自定义脚本中明确暖机段；当前脚本交互后仅有 500 ms 固定稳定等待，不宣称满足 10 秒暖机、30 秒观测的正式基线标准。

## 三层数据与介入位置

| 层 | 实现 | 作用 |
| --- | --- | --- |
| 外部浏览器录制 | `run.mjs` + sitespeed/Browsertime | 浏览器配置、重复轮次、UI 操作、trace 和原生报告 |
| 页面启动时注入 | `observe.js` | 有界 RAF、长任务、长动画帧、User Timing、后台时段 |
| 可选业务阶段 | `src/lib/performance.ts`，仅 `?perf=1` | 为浏览器不知道的业务边界命名 |

业务入口与阶段：

- `experience.tsx`：动态模块、创建场景、React 控件提交、视图请求到提交。
- `scene.ts`：各 GLB 下载、缓冲拼接、解析；环境、房屋植被、地表、天气、落叶；着色器编译、已有预热、初始渲染提交。
- `interior-contact.ts`：首次管线构建、渲染目标准备、编译、接触阴影预热、首次渲染提交。
- `view-transition.ts`：真实 capture、目标帧提交与 reveal 完成回调，包含成功、取消、替换、跳过、错误状态。
- `soundscape.ts`：首次音频 context、逐录音下载/解码、分组连接、恢复与启声、雨声按需加载。`audio.enable` 表示 API 准备与播放调度完成，不表示扬声器首次发声；`audio.disable` 表示淡出已安排。

业务标记使用唯一操作 ID，按 `entry.detail.phase` 聚合；不能直接按带 `#ID` 的 entry.name 分组。业务记录最多保留 500 条，浏览器 RAF 内部最多 12,000 条，输出每段最多 2,000 条帧样本，同时保留完整保留窗口的汇总与截断说明。没有逐帧写 User Timing，也没有全局替换 `fetch` 或 renderer。

移植到另一个项目时，通过 `--adapter` 提供项目的就绪、诊断与状态读取，通过 `--scenario` 提供真实控件流程；通用采集与报告无需修改。`adapters/three-example.cjs` 和[接入说明](../../docs/performance/adapter.md)给出最小契约，示例尚未在第二个项目验证。需要精确归因时，在该项目加载/视图切换边界加入小型 User Timing helper；不必安装监控 SDK。

## 自定义流程契约

`--scenario` 接受标准 `module.exports = async (context, commands) => {}`。用 `commands.measure.start(alias)` 开始区间，执行真实操作、等待并读取快照，再 `commands.measure.stop()`。`measure.start(URL, alias)` 会自动导航并结束，不适合扩展业务等待。

自定义报告需要每个阶段通过 `context.storageManager.writeJson()` 输出 `scene-<iteration>-<alias>.json`。最简单的方式是修改内置场景脚本的操作部分，复用 `scene-helpers.cjs` 的 `createCollector()`、`finish()` 与快照格式；换项目时替换适配器中的业务诊断和 DOM 状态读取。核心字段：

```js
{
  alias, iteration, adapter,
  start: { nowMs, frameIndex, firstFrameMs },
  observedAtMs,
  summary: { conditionObservedMs, windowObservedMs, stableObservedMs,
    startupMs, frames, stableFrames },
  diagnostics: { viewport, drawSize, pixelRatio, quality, gpu,
    drawCalls, triangles, textures, geometries },
  frames, stableFrames, frameDataAvailable, frameWindowValid,
  probe, probeStable, measures, resources, navigation, visibility,
  startState, endState,
  completionRule, limitation
}
```

时间统一使用该文档 `performance.now()`，不是 Node 时钟。每次真正导航会重置时间原点；`initial-3d` 才表示初始导航指标。场景名相同、轮次不同才能形成该场景多轮汇总。

任意没有输出此契约的 Browsertime 脚本仍可能产生原生工具文件，但自定义报告会明确失败，不能算整条工具链成功。内置和自定义脚本都可以在导出的函数上设置 `module.exports.expectedScenes = ['initial-3d', 'your-action']`，runner 会在采集前读取并核对非空、无重复的字符串数组，将其写入 manifest 用于逐轮完整性检查。未声明预期覆盖的自定义流程只报告实际得到的数据，不声称完整系统覆盖；内置 `load` 固定只要求 `initial-3d`。

## 阅读报告与比较

先看报告顶部的**卡顿位置**：具体操作、轮次、相对操作起点区间、最长前台 RAF 间隔，以及与其重叠的业务阶段、长任务/长动画帧。初始加载区分画布就绪之前的无响应风险；交互段定位到按钮操作后的停顿区间。稳定段平均 RAF 回调率与最长帧同时展示，避免高平均帧率掩盖首次操作尖峰。

RAF ≥50 ms 作为慢帧诊断门槛，100 / 300 ms 用于突出较长停顿；这些是本工具的提示规则，不是通用体验标准。卡顿片段重叠并不自动证明因果，更不等于 GPU 时间或屏幕实际冻结。跨越操作起点的慢间隔保留并标注窗口内重叠部分，不能把整个间隔都归到本次点击。

普通帧输出可能截断，因此探针另存有界的 `slowFrames` 和完整保留窗口汇总，避免只取前 2,000 帧漏掉后段尖峰；缓冲覆盖、样本截断与后台时段都会标出。没有 RAF 证据的主线程长任务只列为风险。

每次采集目录保留：

```text
manifest.json        版本、配置、Git 状态及工作区 fingerprint、脚本哈希、实际条件与退出状态
capture.log          原始采集日志
report.html          自包含的可交互报告
report.md            可直接归档的摘要
summary.json         机器可读数据
sitespeed/           原生报告、场景 JSON；诊断模式另含 trace 与截图
```

优化前先建基线，之后固定同一组参数，采集结束即输出对比报告：

```sh
pnpm perf --url http://127.0.0.1:4175/ --flow views --profile desktop \
  --mode baseline --observe-ms 5000 --iterations 3 --instrumentation on \
  --adapter scripts/perf/adapters/bamboo.cjs --out outputs/performance/desktop-views-before

# 修改并重新构建后，仍使用同一浏览器、驱动和预览服务配置
pnpm perf --url http://127.0.0.1:4175/ --flow views --profile desktop \
  --mode baseline --observe-ms 5000 --iterations 3 --instrumentation on \
  --adapter scripts/perf/adapters/bamboo.cjs --out outputs/performance/desktop-views-after \
  --compare outputs/performance/desktop-views-before

# 已有原始数据时，可独立重生成报告，不启动浏览器
pnpm perf:report outputs/performance/desktop-views-after \
  --compare outputs/performance/desktop-views-before
```

报告会检查模式、脚本与适配器哈希、浏览器/驱动、视口、实际画布、DPR、画质、设备和图形后端等条件，并逐场景核对适配器声明的操作前后状态；不一致时列出原因，不输出收益百分比。Git 提交允许改变，画质条件不允许悄悄改变。比较表包含近似就绪、应用 p95、**逐轮完整 RAF 最大间隔的中位数**与**逐轮稳定平均 RAF Hz 的中位数**，同时展示每轮最大间隔；缺少有效帧的轮次不会被当成零值或完整样本。三轮只是起步，要根据波动增加轮数；条件一致也不等于差值有统计显著性。

`--compare` 不会复制基线参数；基线路径或 manifest 无法读取会在启动浏览器前失败。采集或报告失败返回非零；采集和报告成功时，即使条件不可比或读数变慢，退出码仍为 0。不可比原因会写入控制台、`report.log` 和报告，比较状态另存 manifest；当前没有自动性能预算或退化门禁。完整使用与归档步骤见[流水线说明](../../docs/performance/pipeline.md)。

`--instrumentation off` 可评估业务埋点开销，但仍包含浏览器驱动和通用探针，不能叫“零开销”。on/off、baseline/diagnostic 是不同测量配置，不能当作产品优化前后比较。

如需专项验证可见性能面板，可在 `--url` 中保留 `?perf=1&perfUI=1`。采集器依据最终 URL 将面板是否实际启用写入 `manifest.config.performancePanel`；`--instrumentation off` 会移除 `perf`，此时该条件为 false。可见面板会增加自身的 UI 更新工作，**不能与隐藏面板的 baseline 混比**；比较两次面板采集时也要保持该条件一致。

诊断方法是：先看慢阶段 → 在 trace 查对应时间区间的调用栈 → 核对代码与重叠任务 → 改一个因素 → 同条件复测。`PERF_SOURCEMAP=1` 产生的 `.map` 必须和本次 JS 构建一起保留，旧 trace 配上新构建无法准确还原源码。CPU 栈采样用于定位，不将抽样 self time 当成精确执行计时。

## 读数的边界

- `load` / FCP / LCP 不能表示 WebGL 场景完成。`startupMs` 又只从 `createScene` 开始；完整导航到画面需要外部记录。
- “近似就绪”来自驱动轮询，会包含轮询等待。业务 `view.reveal` 提供转场逻辑真实回调区间；二者分别保留。
- RAF / 应用帧间隔反映调度，不是 GPU 时间、屏幕显示帧率或掉帧的唯一证据。原有应用帧丢弃最初 30 帧，启动注入探针补充早期调度与长任务记录。
- `renderer.render()` 返回以及 `*-submit` 只代表 CPU 渲染调用完成，不代表 GPU 已完成。模型 parse 阶段含异步等待，不能标为纯 CPU 时间。
- `renderer.info` 是末端快照，约每 15 帧更新；triangles 含所有 pass，memory 是对象数量，不能称为模型唯一面数或显存字节。
- 阶段可嵌套、并行或跨窗口，不能相加成总耗时。原生工具在同页交互中重复展示的 FCP/LCP 仍属于初始文档，自定义报告只在首屏展示导航数据。
- 没有接入逐 pass GPU timer query、自动堆快照或自动 Spector 抓帧。需要 GPU 细分时单独使用 [Spector.js](https://github.com/BabylonJS/Spector.js) 检查 WebGL 命令和资源，或按需接入 [stats-gl](https://github.com/RenaudRohlinger/stats-gl) / timer query；这些重型采集另存为诊断，不能混进基线。

sitespeed 42.7.0 对没有真实导航的多段 WebGL 交互会产生 HAR 页索引错误，因此 `journey` 明确关闭 HAR，并移除无关的 coach 页面评分；网络阶段保留 Resource Timing 和诊断 trace。`--flow load` 可单独保留首屏 HAR。采集失败仍返回非零，并尝试导出已有数据，不用忽略退出码掩盖失败。

官方依据：[sitespeed/Browsertime 操作脚本](https://www.sitespeed.io/documentation/sitespeed.io/scripting/) · [Chrome Performance 调用栈与 trace](https://developer.chrome.com/docs/devtools/performance/reference/) · [WebGL GPU timer query](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)。

## 验证与归档

本实现不新增测试用例。使用已有类型检查、lint、生产构建、现有渲染回归检查，以及实际浏览器采集来验证。完整性检查和参数校验用于防止坏数据进入报告，不接入测试运行器。

`outputs/performance/` 已被 Git 忽略。将选定采集目录与匹配构建归档到自己的证据存储，在 `docs/performance/` 保留配置、摘要和文件哈希；本地目录不是永久外部存储，也不会由 `git push` 自动上传。manifest 的工作区 fingerprint 包括 tracked diff 和未忽略的 untracked 文件哈希，用于区分同一个 HEAD 下的本地改动；它不能证明目标 URL 正在服务该构建，仍需保留实际 JS、maps 或部署版本。
