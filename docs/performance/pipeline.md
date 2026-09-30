# 竹屋性能采集与前后对比

本页说明怎样用 Scene Perf 记录竹屋的加载与操作、找到停顿发生的位置，以及比较一次代码或资产修改的效果。[Scene Perf 使用说明](../../tools/scene-perf/README.md)介绍工具的接入层次、实时面板和拆卸方式；这里使用仓库已有的竹屋适配器与操作脚本，从项目根目录运行命令。

一次采集会打开浏览器、按脚本操作页面，并把每段操作的数据保存为离线报告。它记录浏览器回调间隔、请求和竹屋的业务阶段；定位到可疑操作后，可以另录 trace 查看调用栈。已有优化结果见[优化记录](./optimization-log.md)，iPhone 持续掉帧的调查进度见[真机调查检查点](./iphone-investigation-status.md)。

## 先选择要测的操作

`--flow` 决定浏览器做什么。选择与你的问题对应的流程，前后复测保持相同选择：

| 想观察的问题 | `--flow` | 每轮执行的路径 |
| --- | --- | --- |
| 页面打开后，多久能操作 3D 场景？ | `load` | 首次导航 → 等待竹屋首屏就绪 |
| 首次进屋是否比再次进入更容易卡顿？ | `journey` | 首屏 → 自由模式院坝 → 首次上楼 → 返回院坝 → 再次上楼 |
| 望月、听风切换时在哪里停顿？ | `views` | 首屏 → 首次望月 → 首次听风并自动开声 → 开声返回望月 → 开声再次听风 |
| 天气、声音和其它控件的操作是否出现停顿？ | `system` | 按预设顺序操作声音、音量、天气、昼夜、视图、地点、环顾与暂停等控件 |
| 再次访问时哪些资源得到缓存复用？ | `cache` | 新浏览器会话首访 → 同一会话正常再次导航；详见[HTTP 缓存说明](./http-cache.md) |

`--profile desktop` 使用桌面浏览器；`mobile` 在电脑浏览器中模拟移动视口和 DPR，便于覆盖移动端加载与交互路径。真机的温度、功耗和持续帧率需要在手机上另行验证。`system` 的具体操作清单和全部参数见[项目采集说明](../../scripts/perf/README.md#配置与操作覆盖)。

## 运行一次采集

下面以桌面的 `views` 流程为例。需要项目要求的 Node.js、pnpm，以及版本匹配的 Chrome / ChromeDriver；浏览器与驱动准备方式见[开始使用](../../scripts/perf/README.md#开始使用)。固定同一台机器和这组浏览器二进制，采集期间让浏览器保持前台。

终端一：构建当前版本并启动生产预览。`PERF_SOURCEMAP=1` 让这份构建同时生成用于解释调用栈的 source maps。

```sh
PERF_SOURCEMAP=1 pnpm build
pnpm preview
```

终端二：填写本机浏览器和匹配驱动的实际路径，再运行采集。

```sh
export PERF_CHROME='/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
export PERF_DRIVER='/absolute/path/to/chromedriver'

pnpm perf --url http://127.0.0.1:4175/cn --flow views --profile desktop \
  --mode baseline --observe-ms 5000 --iterations 3 --instrumentation on \
  --out outputs/performance/desktop-views-before
```

`pnpm perf` 已配置竹屋适配器和业务计时源码，无需再传 `--adapter`。这里使用 `/cn` 页面，与操作脚本中的中文控件名称一致。输出目录必须尚不存在；再次采集时换一个目录名，例如加入日期或版本号。

这条命令的含义是：

1. 启动三轮独立浏览器会话，每轮从首屏开始，依次执行表中的五段 `views` 路径。
2. 在页面导航前注入浏览器探针。`--instrumentation on` 同时添加 `perf=1`，记录模型加载、场景构建、转场和音频准备等竹屋内部阶段。
3. 首屏等待控件可操作且画布淡入完成，确认后观察 5 秒。后续操作通过真实按钮触发，等待对应视图与声音状态，满足条件后再固定等待 500 ms、观察 5 秒；这些操作的完整采集窗口包含等待就绪、500 ms 等待和观察段。
4. 按操作与轮次保存原始数据，采集结束后生成报告。`baseline` 适合重复对比；需要 trace、CPU 栈采样和截图时使用后文的 `diagnostic` 模式。

5 秒是便于快速复测的观察窗口，500 ms 是脚本的固定等待，两者都不证明场景已经达到长期稳定状态。研究持续运行时，应延长观察，或用[自定义流程](../../scripts/perf/README.md#自定义流程契约)明确暖机与观测边界。

## 找到报告并读懂数据

先打开 `outputs/performance/desktop-views-before/report.html`。若本地文件的相对链接受浏览器限制，可以提供一个只读文件服务：

```sh
python3 -m http.server 4180 --bind 127.0.0.1 --directory outputs/performance
# 浏览器访问 http://127.0.0.1:4180/desktop-views-before/report.html
```

同一目录中的文件各有用途：

| 文件 | 用途 |
| --- | --- |
| `report.html` | 按场景和轮次查看总览、加载时间轴、停顿位置与基线比较 |
| `report.md` | 便于归档和引用的文字摘要 |
| `summary.json` | 机器可读的汇总、比较条件与逐指标差值 |
| `manifest.json` | 本次版本、采集配置、实际环境、预期场景和完成状态 |
| `capture.log`、`report.log` | 采集、报告生成和比较资格的日志 |
| `sitespeed/` | 原始场景 JSON 和原生工具报告；diagnostic 模式另有 trace 与截图 |

按以下顺序阅读 HTML 报告：

1. **完成状态与异常**：确认预期操作和三轮数据都已取得，查看后台时段、缓冲覆盖、截断或未知条件的提示。已有部分数据也能生成报告，先核对状态再判断变化。
2. **场景总览**：选择关心的操作，分别看就绪等待、最长回调间隔和稳定观察段的回调频率。平均频率较高时，首次操作仍可能有很长的单次停顿。
3. **首屏时间轴或停顿定位**：加载问题看导航、网络和业务阶段何时发生；操作问题看相对点击起点的停顿区间，以及重叠的业务阶段和主线程长任务。
4. **逐轮与阶段详情、原始证据**：核对单轮尖峰、状态、样本数和原始文件。时间上的重叠是定位线索；要判断具体原因，再用 diagnostic trace 核对调用栈。

主要读数的含义如下：

| 读数 | 实际测量的内容 | 判断时留意什么 |
| --- | --- | --- |
| 近似就绪 | 从导航或操作起点，到自动化脚本确认就绪条件的时间 | 包含轮询等待；业务转场回调另存，GPU 完成与屏幕呈现未被测量 |
| 完整 RAF 最大间隔 | 同一前台观察段中，两次浏览器动画回调之间的最长间隔 | 对比时先取每轮最大值，再取轮次中位数；同时看各轮最大值，避免隐藏尖峰 |
| 稳定段平均 RAF Hz | 固定观察段中，实际回调间隔数除以总间隔时间 | 比较表使用每轮平均频率的中位数；它反映调度频率，屏幕 FPS 未被测量 |
| 应用帧间隔 p95 | 竹屋自身记录的有效调度间隔中，第 95 百分位的值 | 与独立浏览器 RAF 分开；数据缺失或窗口无效时显示 N/A |
| 业务阶段耗时 | 埋点开始到结束的区间，例如模型解析、转场或音频准备 | 可能含异步等待、嵌套与并行工作；按时间轴阅读，不能相加为总加载耗时 |

例如，首次听风的停顿同时与 `audio.decode` 重叠，就去同一操作的 trace 核对音频解码调用栈。再次听风已经可以复用音频；两者负载不同，应分别与下一版本的同名操作比较，不能把本轮首次与重复的差值全部归为画面收益。

## 修改后如何比较

修改代码或资产后，重新构建并确认预览服务正在提供新构建。复用前面的浏览器、流程和采集参数，只换输出目录并增加 `--compare`：

```sh
pnpm perf --url http://127.0.0.1:4175/cn --flow views --profile desktop \
  --mode baseline --observe-ms 5000 --iterations 3 --instrumentation on \
  --out outputs/performance/desktop-views-after \
  --compare outputs/performance/desktop-views-before
```

`--compare` 读取原基线，**不会继承其参数**。上面的两条命令显式保留相同条件；换流程、观察时长、轮数或诊断开关后，需要按新条件重新建立基线。

在新报告的“基线比较”中，先看哪些操作可比较及其原因，再读差值。报告核对浏览器、驱动、实际视口与画布、DPR、GPU 后端、画质、采集脚本、适配器、业务埋点和面板开关；逐操作核对声音、视图、天气预设与暂停等状态。源码提交可以改变，测量条件应一致；某个操作状态不一致时，该操作不计算收益。

差值均为“当前减基线”：就绪时间、最大回调间隔和 p95 的负值表示缩短；稳定平均 RAF Hz 的正值表示回调更频繁。结合逐轮记录和有效样本数解读，三轮中位数不能证明统计显著性；波动较大时保持条件不变增加轮数。降低清晰度或阴影档位属于画质取舍，应另建对应配置的对照。

采集或报告失败返回非零；生成成功时，即使读数变慢或条件不可比较，退出码仍为 0。性能判断依据报告中的比较资格、差值和原始证据，当前工具没有自动退化门禁。

已有原始数据时，可以单独重生成报告：

```sh
pnpm perf:report outputs/performance/desktop-views-after \
  --compare outputs/performance/desktop-views-before
```

## 需要调用栈时另录诊断

对关心的同一流程运行 diagnostic 模式：

```sh
pnpm perf --url http://127.0.0.1:4175/cn --flow views --profile desktop \
  --mode diagnostic --observe-ms 5000 --iterations 1 --instrumentation on \
  --out outputs/performance/desktop-views-diagnostic
```

从报告的“原始证据”找到 trace，导入 Chrome DevTools Performance，按停顿时间区间查看调用栈，并用对应构建的 source maps 定位源码。诊断额外包含 trace、栈采样与截图的开销；用它定位，再回到同条件 baseline 复测改动。

浏览器驱动、轮询、RAF 探针和业务计时本身也有开销。评估计时或实时面板的开销时，分别记录 instrumentation on/off 或面板显示/隐藏的配置；这些配置之间的差异不能直接解释为产品优化。GPU 各 pass 的耗时需要另接专用计时，详见[读数的边界](../../scripts/perf/README.md#读数的边界)。

## 保存能复查的证据

`outputs/performance/` 被 Git 忽略。要保留某次结论，将整个采集目录与**当时实际服务的 JS、匹配 source maps、源码版本及必要的未提交 diff / untracked 文件**一起归档，在项目文档记录配置、摘要与归档位置或哈希。manifest 能区分本地工作区，但不能证明目标 URL 实际提供了哪份构建。

更换采集器、适配器或业务计时实现会改变工具指纹和观测开销，随后应重新建基线。接入其它项目时，从 [Scene Perf 使用说明](../../tools/scene-perf/README.md)选择需要的层次，再按[适配器契约](./adapter.md)提供真实就绪条件、状态和控件流程。
