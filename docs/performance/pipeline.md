# 可重复的 Three.js 页面性能流水线

这条流水线负责记录、定位和复测。未来修改 Three.js 场景、Blender 导出资源或加载逻辑后，重新构建，再用同一命令采集到新目录，即可比较首次加载、首次操作和重复操作。它不会自动改模型、调整画质或修复卡顿。

## 一次建立基线

先按[采集器使用说明](../../scripts/perf/README.md#开始使用)准备匹配的 Chrome / ChromeDriver。固定机器、浏览器版本和前台运行条件；选择生产构建，关闭其它构建、录屏与三维工作负载。

```sh
# 终端一：在待记录版本上构建并启动预览
PERF_SOURCEMAP=1 pnpm build
pnpm preview

# 终端二：按实际安装位置填写，后续复测保持这组二进制不变
export PERF_CHROME='/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
export PERF_DRIVER='/absolute/path/to/chromedriver'

pnpm perf --url http://127.0.0.1:4175/ --flow views --profile desktop \
  --mode baseline --observe-ms 5000 --iterations 3 --instrumentation on \
  --adapter scripts/perf/adapters/bamboo.cjs --out outputs/performance/desktop-views-before
```

本例固定 PC 望月 / 听风五段路径，三轮、每段就绪后观察 5 秒。首次听风自动开声，返回望月和再次听风保持开声；报告按同名操作及相同声音前提比较，不把首次 / 重复差值全部算作画面收益。5 秒适合快速复测，长期稳定性应另建更长观察的基线。

`baseline` 用于反复比较；需要调用栈定位时另采 `--mode diagnostic`。诊断模式包含 trace、CPU 栈采样和截图，其开销与 baseline 不同，两种模式不能混比。页面内实时进度由 URL 的 `perfUI=1` 打开，也必须前后一致，详见[诊断视图说明](./diagnostic-view.md)。

## 优化后使用同条件复测

修改代码或资产后，重新运行相同的生产构建，确认预览 URL 服务的是这份构建。以下命令只改变输出目录并指定原基线：

```sh
pnpm perf --url http://127.0.0.1:4175/ --flow views --profile desktop \
  --mode baseline --observe-ms 5000 --iterations 3 --instrumentation on \
  --adapter scripts/perf/adapters/bamboo.cjs --out outputs/performance/desktop-views-after \
  --compare outputs/performance/desktop-views-before
```

采集结束会自动写出 `report.html`、`report.md`、`summary.json`。输出目录必须是新目录，后续可用日期或版本命名。`--compare` 先只读检查基线 manifest 可读取，**不会从基线继承任何配置**；仍需显式保持流程、设备、模式、窗口和轮数一致。

已有原始数据时可以独立重生成报告，不需要再次启动浏览器：

```sh
pnpm perf:report outputs/performance/desktop-views-after \
  --compare outputs/performance/desktop-views-before
```

采集或报告失败返回非零，已有部分数据仍尽量生成报告。采集和报告成功时，不可比较或指标变慢都不会改变退出码 0；控制台、`report.log` 和报告会明确列出不可比原因。`manifest.comparison` 记录比较资格，`summary.json` 保存逐指标差值；这里没有自动退化门禁，也没有人为设定“通过”的收益阈值。

## 先核对条件，再读变化

先确认报告是完整采集，再看“基线比较”的环境与逐场景状态检查。声音、视图、天气预设、暂停与面板等可控状态按适配器声明核对；某场景不一致，只禁止该场景的收益比较。连续天气插值浮点数不作为相等条件。Git 提交可以改变，浏览器、画质、采集脚本 / 适配器、诊断面板开关等测量条件应保持一致。不同部署 URL 可以比较，但其网络差异仍可能影响读数。

| 读数 | 如何解释 |
| --- | --- |
| 近似就绪差值 | 当前中位数减基线中位数；负值更快，含自动化轮询等待，不等于 GPU 呈现时间 |
| 完整 RAF 最大间隔的逐轮中位数 | 先取每轮完整前台间隔的最大值，再取轮次中位数；负值表示典型轮次的最长调度停顿减小 |
| 每轮最大间隔 | 与中位数一起读，避免单轮尖峰被隐藏；跨操作起点的间隔另看“卡顿位置”，不能整段归给本次点击 |
| 稳定平均 RAF Hz 的逐轮中位数 | 每轮按回调数 / 总间隔估算，再取轮次中位数；正值表示回调更频繁，不是屏幕 FPS 或 GPU 吞吐 |
| 应用帧 p95 | 可选应用诊断的调度间隔；缺失时为 N/A，浏览器 RAF 仍可独立存在 |

在“卡顿位置”看停顿发生于哪个操作、操作后多久，以及重叠业务阶段和长任务。首屏详情的统一时间轴按导航起点对齐网络、业务、资源和卡顿，可以看出并行关系；各段不相加。要判断原因，在匹配的 diagnostic trace 中核对调用栈；时间重叠本身只提供线索。三轮中位数不是统计显著性证明，真实波动较大时保持条件不变增加轮次。

以下情况不能据此判定性能退化：

- 采集失败、缺段、轮次不全，或者请求视口 / DPR 未实际生效。
- 前后台切换、浏览器 RAF 缓冲覆盖窗口前段、未知工具或适配器版本。
- 可见诊断面板、声音、画质、观察窗口或采集模式前后不同。
- 指标是 N/A；特别是缺应用帧数据不代表 0 ms，应用帧缓冲无效也不自动否定独立浏览器探针。
- 缺少有效轮次的最大 RAF / 稳定平均 Hz；报告保留已有值与样本数，但不计算完整轮次收益。
- 慢帧原始列表截断后没有看到某片段。完整保留窗口汇总可能仍可用，但截断列表不能证明未发生卡顿。

## 换一个项目时保留哪些部分

| 部分 | 文件 | 换项目时的责任 |
| --- | --- | --- |
| 通用核心 | `run.mjs`、`observe.js`、`report.mjs`、`scene-helpers.cjs` | 浏览器采集、时间窗口、原始数据、报告和比较 |
| 页面适配器 | `adapters/bamboo.cjs`；参考 `adapters/three-example.cjs` | 声明就绪规则，读取渲染器 / 业务阶段 / 页面状态，列出必须保持一致的离散状态字段 |
| 操作流程 | `scene-journey.cjs`、`view-journey.cjs`、`system-journey.cjs` 或自定义 `.cjs` | 用真实控件执行可重复路径，声明 expectedScenes |

当前内置流程包括 `load`（首屏）、`journey`（室内外首次 / 重复）、`views`（PC 望月 / 听风）、`system`（系统控件与声音）。`load` 可搭配其它适配器；后三者的按钮选择器属于竹屋，搭配非竹屋适配器会在打开浏览器前提示提供 `--scenario`。换成另一个 Three.js 页面时，需要适配器和该项目的真实操作流程，不能只替换 URL。Blender 资产通过所在页面的实际下载、解析和渲染路径被观测，采集核心不依赖 Blender 文件结构。

自定义入口使用 `--adapter /path/to/project.cjs --scenario /path/to/flow.cjs`；runner 通过绝对路径 `PERF_ADAPTER` 传给 helper，manifest 记录适配器 ID、版本、文件哈希和状态字段。比较不要求适配器文件存放在同一路径，但要求内容与契约一致。自定义脚本必须实际输出匹配的适配器元信息，不能只在命令行声明。接口与原始数据要求见[采集器契约](../../scripts/perf/README.md#自定义流程契约)。

通用示例建议使用 `--instrumentation off`：浏览器 RAF、长任务、资源和页面已有的原生 User Timing 仍会记录。`on` 只控制 `perf=1`，不会自动替其它项目埋点；当前只有竹屋适配器记录对应业务 helper 的源码哈希。其它适配器使用 `on` 时会说明缺少该哈希，避免无法确认埋点开销却输出优化收益。

## 归档可重新解释的证据

每个保留的基线 / 复测目录应一并保存 `manifest.json`、日志、三个报告、`sitespeed/` 原始场景 JSON、diagnostic trace 与截图。另保存**当时服务的构建 JS 和匹配 source maps**、源码提交及必要的未提交 diff / untracked 文件；只留 Git SHA 不能重建 dirty 工作区，manifest 的本地 fingerprint 也不能证明 URL 服务的是该构建。

`outputs/performance/` 不进入 Git；`git push` 不会上传这些原始证据。将选定目录和匹配构建归档到自己的存储，再在项目文档保留版本、配置、摘要和归档地址 / 哈希。不要用新构建的 `.map` 解释旧 trace。

其它参考：[全页面流程图](./page-lifecycle.md) · [指标与工具边界](../../scripts/perf/README.md#读数的边界) · [开源工具与介入层次](./open-source-tools.md)。
