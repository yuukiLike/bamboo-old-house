# 第一次真实采集与归因记录

日期：2026-09-21。分支：`preview/performance-baseline`。本次交付的是性能分析工具及实际证据，尚未修改雨遮挡算法、画质、加载顺序或预热策略。

[工具使用说明](../../scripts/perf/README.md) · [整体页面流程](./page-lifecycle.md) · [3D 专项开源工具](./open-source-tools.md)

## 采集环境与证据

本机为 Apple M4、16 GB、macOS；图形后端记录为 `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`。使用生产静态构建和本地 `127.0.0.1:4175`，网络及 CPU 不节流。采集端固定 sitespeed.io 42.7.0 / Browsertime 28.3.0。

前期兼容性摸底使用 Chrome 153.0.8010.52；用户要求避开日常 Chrome 后，后续改用 **Chrome Canary 156.0.8066.0** 和对应版本 ChromeDriver。不同浏览器版本的结果不能用来计算优化收益。

原始文件位于已忽略的 `outputs/performance/`。每次目录包含 manifest、日志、场景 JSON、报告，以及诊断模式的 trace。匹配的 JS / source maps、原有源文件 diff 与新埋点 helper 已归档到 `outputs/performance/build-v1/`；加入音频阶段后的构建另存 `build-v2/`，实时面板及最终基线使用 `build-v3/`。各自的 `assets.json` 记录文件 SHA-256。这些是本地证据，不会随 Git 推送上传。

| 采集目录 | 用途与状态 |
| --- | --- |
| `pilot-desktop-original` | 埋点前单轮摸底，定位 `load` 与三维就绪的差距；缺少新工具 manifest，不作为正式基线 |
| `pilot-mobile-original` | 旧窄外窗方案，且多段 HAR 报错；不作为移动基线 |
| `mobile-diagnostic-v1` | 复现 Chrome 共享对象导出失败；失败状态与错误报告保留 |
| `mobile-diagnostic-v2` | 五段录制完成，但实际尺寸 500×787 / 渲染 DPR 1，与请求配置不同；复核后标记失败，仅保留 CPU 阶段归因证据 |
| `canary-mobile-diagnostic` | 完整五段诊断，实际移动视口 402×874 / 浏览器 DPR 2，画布 502×1092 / 应用 pixelRatio 1.25；各段无后台时间 |
| `canary-mobile-baseline` | 三轮五段轻量采集验证；每段观察 5 秒。旧配置仍在区间结束后产生 LCP/CLS 截图，后续版本已单独关闭，不能与后续配置直接对比 |
| `canary-system-smoke` | 系统流程首次轻量摸底，保存 25 / 38 段后在地点菜单完成条件超时；整体失败，已保存阶段只作线索 |
| `canary-place-diagnostic` | 一次性真实 UI 诊断，证明选择已成功，但菜单隐藏后仍保留零尺寸 listbox；改用触发器 `aria-expanded=false` 与目标地点共同判定 |
| `canary-system-diagnostic` | 修正后完整 38 / 38 段，1 轮、每段观察 1 秒，trace 与音频阶段齐全；报告无完整性警告，各段后台时间为 0 |
| `canary-desktop-views-diagnostic` | PC 首屏及望月 / 听风双向首次、重复切换共 5 / 5 段，1 轮、每段观察 5 秒；报告无完整性警告 |
| `canary-panel-preview` | 页面内诊断面板的真实 UI 验收：展开、搜索 weather、折叠、再展开及导出；截图保留。导出 JSON 含 50 个完成阶段与 19 个资源。此轮显示面板，不作隐藏面板基线 |
| `canary-desktop-views-baseline` | 最终适配器版 PC 基线，3 轮 × 5 段全部完成，每段观察 5 秒，trace / 各类截图 / 面板全部关闭；报告无警告 |
| `canary-desktop-views-recheck` | 使用同一产品构建复采 1 轮 × 5 段，单条命令自动与上述三轮基线比较；5 / 5 场景通过已记录环境和必需离散状态检查，用于验收采集 → 报告 → 对比闭环 |

默认短窗口用于验证工具和寻找瓶颈，不等于完整的长期帧率基线。运行之间的浏览器、驱动、系统和 GPU shader 缓存可能影响首次编译；未声称彻底清除所有缓存。移动模拟也不代表真实手机表现。

## 已证实的第一个优化范围

原先只看页面导航指标会漏掉三维初始化：最早桌面摸底中 `loadEventEnd` 约 46 ms、LCP 约 528 ms，而 `createScene` 内部 startup 约 9.81 秒，外部观察到画布完全淡入约 10.97 秒。后三个数采用不同起止点，不能互相替换。

添加业务阶段后，`mobile-diagnostic-v2` 中：

| 指标 | 单轮读数 | 含义 |
| --- | ---: | --- |
| `startup.create-scene` | 8,440.9 ms | 场景创建墙钟时长 |
| `scene.weather-build` | 6,719.0 ms | 同步 `createWeather()` 区间 |
| 原有 `surfaceExposureBuildMs` | 6,026.9 ms | `weatherSurfaces()` 局部计时 |
| 原有 `triangleShelterBuildMs` | 526.9 ms | 三角形遮挡结构构建 |
| 原有 `voxelShelterBuildMs` | 139.6 ms | 体素遮挡结构构建 |
| 对应主线程大任务 | 6,759.6 ms wall / 6,647.4 ms thread duration | 还包含紧邻天气构建的少量工作，不能全计到同一函数 |

这轮视口不正确，所以不能作为目标 mobile 性能承诺；其业务阶段与 CPU 调用栈仍能说明执行了什么。后续正确尺寸的 Canary 诊断也记录到 `scene.weather-build` 6,326.2 ms，支持继续调查该同步构建路径。

使用匹配 source maps，热点映射到：

```text
createWeather
  → weatherSurfaces 的逐顶点处理
    → shelter.exposure
      → exact.blocked
        → entryDistance：包围盒遍历
        → Vector3.fromArray / Ray.intersectTriangle：叶节点三角形求交
```

源码：[weatherSurfaces](../../src/components/scene/weather.ts#L485)、[逐顶点查询](../../src/components/scene/weather.ts#L506)、[exposure](../../src/components/scene/rain-shelter.ts#L58)、[blocked](../../src/components/scene/rain-shelter.ts#L134)。

CPU 样本按重建后的时间轴加权并裁切到该阶段，完整父栈上的 `weatherSurfaces` inclusive 权重约 5,753 ms，`exposure` 约 5,393 ms，`blocked` 约 4,971 ms。**三者相互包含，不能相加；这是采样估计，不是精确函数 CPU 时钟。** trace 中存在负 timeDelta，复算先恢复绝对时间并排序，没有用 hit count 乘平均间隔。部分样本缺少父栈，未强行归入天气函数。

复算产物保留在 `mobile-diagnostic-v2/weather-cpu-analysis.json` 与同目录 `analyze-weather-cpu.py`。时间轴处理参考 [Chrome DevTools CPUProfileDataModel](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/cpu_profile/CPUProfileDataModel.ts)。

**第一项值得尝试的优化：验证能否在构建期预计算固定资产的 `rainIngress` / `rainExposure`，避免每次进入页面同步重算。** 要先确认资产、变换、细分规则和雨向保持一致。当前尚未实施，也没有声称能直接省去上述全部时长。现有证据不足以断言 BVH 分割有问题、缓存命中率低，或 GPU 是启动慢的主要原因。

## 首次与重复进入不能合并

三轮轻量采集里，用户最需要关注的位置是：

| 位置 | 相对操作开始 | 三轮最长前台 RAF 间隔 | 同时发生的业务阶段 |
| --- | --- | --- | --- |
| 首次页面加载、画布就绪之前 | 约 0.52–0.96 秒开始 | 5,949.7 / 5,283.3 / 5,300.0 ms | `scene.weather-build`，CPU 栈指向静态雨水表面查询 |
| 第一次点击进入室内 | 约 0.39–0.40 秒开始 | 650.0 / 466.9 / 483.4 ms | `interior.first-frame-submit` 分别约 631.1 / 445.6 / 462.9 ms，并延长 `view.reveal` |
| 同轮再次进入室内 | 对应操作窗口 | 该三轮未记录 ≥50 ms 的完整前台 RAF 间隔 | 室内管线与首次渲染资源已准备 |

这些是**前台帧调度停顿证据**，没有声称逐帧测到了屏幕实际呈现。首次加载行属于加载阶段无响应风险；首次进屋行直接对应用户操作中的卡顿风险。RAF 50 ms 只作为本工具的诊断阈值。三轮稳定段应用帧 p95 中位数约 17.6 ms，仍不能掩盖上述首次操作尖峰。

五段外部近似就绪中位数分别为：首屏 8,743.8 ms、自由视角 708.4 ms、首次室内 1,059.6 ms、回室外 780.5 ms、再次室内 578.4 ms。这包含浏览器驱动轮询延迟，不是业务函数 CPU 时长；帧调度片段和精确业务事件应一起查看。

正确移动配置的 Canary 单轮诊断，首次进入室内外部近似就绪约 10,935.5 ms，再次进入约 660.8 ms。该轮包含重型 trace 且是新 Canary 环境，数字不能当作日常稳定体验，但证明采集流程必须保留首次管线建立与重复进入两个阶段。实际业务 `interior.pipeline-build`、`interior.first-frame-submit`、`view.reveal` 可在报告中继续拆分。

页面声音和天气同样依赖操作历史：开启声音才会下载、解码环境音；雨声还可能由天气按需触发。林间与井边按钮有自动启声行为。系统操作流程必须记录每段操作前后状态，不能把静音、已解码、正在下雨等不同条件当作相同场景。

## 声音、昼夜与设置面板的线索

`canary-system-smoke` 是一轮、每段观察 1 秒的短采集，且整条流程未完成。下列数字只是已保存窗口的实测线索，不是完整系统基线：

| 操作 | 记录到的最长前台 RAF 间隔 | 需要继续核对的证据 |
| --- | ---: | --- |
| 首次开启声音 | 116.9 ms，约在操作后 328.9 ms 开始 | `audio.context-create` 126.5 ms；`audio.enable` 330.4 ms。下载、解码和恢复分别保留，不能把异步 wall 时间全解释为 CPU |
| 再次开启声音 | 未记录 ≥50 ms 完整间隔 | `audio.enable` 16.3 ms；未重复下载和解码已准备的录音 |
| 首次打开音量面板 | 282.4 ms，约在操作后 390.4 ms 开始 | 没有对应音频加载阶段；不能因为开着声音就归因到音频 |
| 首次切换夜晚 | 14,383.3 ms，约在操作后 335.8 ms 开始 | 这是一次严重的首次停顿，尚不能断言具体 GPU 或 shader 原因；需要 trace 与重复录制 |
| 再次夜晚 | 最大约 100 ms，稳定窗口平均 RAF 约 18.2 Hz | 说明还存在持续低回调率，不只是首次初始化问题 |

首次细雨会按需准备四个雨声录音，随后细雨蛙声按需加载；API 就绪约 846.5 ms 的墙钟时间内，该窗口未记录 ≥50 ms 完整 RAF 间隔。这说明“某段等待很久”和“主线程长时间没有更新机会”必须分开呈现。

用户指出 PC 的“竹林望月 → 林海听风”也卡顿。代码中的实际按钮文案为“林间的风”，为此增加独立 `--flow views --profile desktop`：首次望月、首次听风自动开声、保持声音返回望月、保持声音再次听风。首次和重复结果分别保存，不能把音频前提不同的两段直接称为纯画面优化收益。

修正后的完整系统诊断中，首次夜晚最长间隔约 **900.1 ms**，再次夜晚约 **83.3 ms**，稳定 RAF 回调率分别约 **17.4 / 15.8 Hz**。此前 14.38 秒的极端首次尖峰在本轮没有重现，不能当作每次夜晚切换的固定成本。首次开声仍有约 133.9 ms 的长间隔；首次音量面板的 282.4 ms 尖峰没有再次出现。这些波动是保留多轮和首次/重复条件的理由，不代表已经优化。

## PC 望月与听风切换

`canary-desktop-views-diagnostic` 使用实际 1440×813 viewport、DPR 1，与移动路径分开记录。单轮重型诊断读数如下，后续轻量记录另列，不计算两者的“优化收益”：

| 操作 | 最长完整前台 RAF 间隔 | 稳定段平均 RAF 回调率 | 业务证据 |
| --- | ---: | ---: | --- |
| 首次进入竹林望月，声音关闭 | 99.2 ms | 18.7 Hz | `view.reveal` 252.7 ms |
| 望月 → 首次林间的风，自动开启声音 | 183.4 ms | 17.0 Hz | `audio.context-create` 149.2 ms；`audio.enable` 366.4 ms；`view.capture` 159.9 ms |
| 听风 → 返回望月，保持声音开启 | 83.3 ms | 18.3 Hz | `view.reveal` 262.6 ms |
| 望月 → 再次听风，保持声音开启 | 116.7 ms | 16.4 Hz | `view.reveal` 355.2 ms，没有重新下载解码录音 |

首次听风的长间隔从操作约 399.3 ms 后开始。`view.capture`、音频创建和视图请求区间相互重叠；capture 包含等待下一帧，**159.9 ms 不能解释为 GPU 拷贝自身耗时**。重复切换仍慢，说明“只是首次加载音频”不能解释全部现象。高成本切换之后的持续低回调率也必须单独保留。

该 PC 单轮的外部首屏就绪约 18.75 秒，`scene.weather-build` 约 5.65 秒；`startup.prewarm` 约 11.06 秒，其中两次室内预热提交约 1.98 / 4.92 秒。预热包括编译与渲染调用等待，父子相互包含。这些成本发生在进入页面期间，新增实时面板和报告的统一时间线会分别展示。

### 调用栈核对

使用同名 User Timing 对齐 raw 与 trace，再用原生 longtask 独立核对任务起点；时间偏移的锚点残差约 1 µs，任务起点误差小于 0.05 ms。源映射使用 `build-v2`，没有使用后来的面板构建替代旧 maps。一次性复算脚本与完整结果在 `outputs/performance/pilot-source/trace-attribution.mjs`、`trace-attribution-notes.md` 和各录制目录的 `analysis/`。

- 系统首次夜晚的 900.1 ms 间隔，覆盖一个约 **894.2 ms wall / 127.1 ms thread duration** 的产品 RAF 任务。主栈为 `tick → renderFrame → Three setProgram → getUniforms → onFirstUse → getProgramInfoLog`。该调用位置约占 766 ms 采样墙钟，支持首次程序使用中同步 WebGL 查询等待的定位，不能定义为 766 ms GPU 执行，也不能用它解释此前未重现的全部 14 秒。
- PC 首次听风的 `audio.context-create` 对应真实按钮调用 `new AudioContextClass(...)`。所在点击任务约 **157.0 ms wall / 13.5 ms thread duration**，支持音频 API 初始化等待的归因，不能说成 149 ms 解码 CPU。
- PC 首次听风最大的 183.4 ms 间隔内，最长主线程任务约 10.8 ms，采样约 143 ms 为 idle，LoAF `blockingDuration=0`。后续稳定窗口也以 idle 为主。因此现有证据不支持“每个慢帧都有一个持续计算 50–100 ms 的 JS 函数”。图形后端、合成呈现调度和 trace 开销需另行区分；idle 本身不能证明 GPU 耗时。

这些分析用于给下一次优化提供定位和复测入口，本次没有实施性能修复。

### 最终 PC 轻量基线

在 `build-v3` 与最终适配器 / 流程脚本上采集 `canary-desktop-views-baseline`。三轮实际 viewport 1440×813、浏览器和渲染 DPR 1、同一 Apple M4 图形后端，所有窗口后台时间为 0。下表保留逐轮尖峰，不能用中位数隐藏某一轮的停顿：

| 操作 | 各轮最大完整前台 RAF 间隔，ms | 稳定平均 RAF Hz 的三轮中位数 |
| --- | --- | ---: |
| PC 首屏加载 | 5,466.7 / 5,415.3 / 5,648.7 | 26.6 |
| 首次望月，声音关闭 | 84.4 / 99.3 / 99.9 | 17.8 |
| 望月 → 首次听风，自动开声 | 166.7 / 167.3 / 133.8 | 16.7 |
| 听风 → 望月，保持开声 | 100.3 / 81.7 / 101.6 | 17.7 |
| 望月 → 再次听风，保持开声 | 147.9 / 116.3 / 118.4 | 15.4 |

首屏最长间隔从导航约 765–783 ms 后开始；首次听风的各轮最大间隔分别从操作后约 137 / 461 / 425 ms 开始。重复听风第二轮的最大间隔出现在操作后约 1.78 秒，说明只监控点击后的最初几百毫秒会漏掉后续卡顿。

这证明 PC 低回调率并不只出现在重型 trace 中。首屏近似就绪三轮中位数约 9,189.1 ms；不要把它与旧单轮 diagnostic 的 18.75 秒差值称为优化收益，两轮采集模式、首次缓存状态和工具构建不同。这里的“稳定段”仍按固定 500 ms 等待后观察 5 秒，视图的日照 / 天气插值可能尚在完成，不是长时间暖机后稳定吞吐。

本基线可作为今后同条件优化复测入口，使用 [流水线命令](./pipeline.md) 的 `--compare outputs/performance/canary-desktop-views-baseline`。原始 JSON、逐轮详情和报告顶部的卡顿位置一起保留。

### 自动复采与对比验收

`canary-desktop-views-recheck` 通过 runner 的 `--compare` 自动生成报告，进程退出码为 0，`conditionsComparable` 和 `allScenesComparable` 均为 `true`，五个场景均可比较。报告保留每轮最大完整前台 RAF 间隔、稳定平均回调率、样本数和中位数差值，并明确显示“当前 1 轮，基线 3 轮”。

这次使用相同产品构建，目的是验证闭环，没有性能优化。单轮波动不能宣称收益或回归；正式优化后应按基线相同轮数和配置复采。已记录环境一致也不代表控制了系统负载、温度或驱动 shader 缓存等全部变量。

本地预览服务存续时可直接打开：

- [PC 三轮基线报告](http://127.0.0.1:4180/canary-desktop-views-baseline/report.html)
- [复采与自动对比报告](http://127.0.0.1:4180/canary-desktop-views-recheck/report.html)
- [页面内实时诊断](http://127.0.0.1:4175/?perf=1&perfUI=1)

服务停止后，报告仍保留在各目录的 `report.html`；在仓库根目录执行 `python3 -m http.server 4180 --bind 127.0.0.1 --directory outputs/performance` 可重新查看。产品预览按 [流水线文档](./pipeline.md) 重新构建并启动。

最终验收包括：`pnpm typecheck`、`pnpm lint`、生产构建 `PERF_SOURCEMAP=1 pnpm build`、现有 24 项测试和 `node scripts/generate-bamboo-lod.mjs --check` 均通过。**没有编写或修改测试用例。** 实际浏览器采集完成 PC 三轮 15 段、独立复采 5 段、系统诊断 38 段；页面内面板的搜索、折叠和 JSON 导出已实际操作。另在 Canary 打开完整 HTML 对比报告，查看卡顿表、展开首屏详情并核对统一时间轴与阶段耗时条。Mermaid 提供源文件与文档嵌入，未进行渲染器截图验收。

以下校验值用于辨认本地归档；并不意味着这些大文件已经上传。最终基线采集时工作区尚未提交，manifest 保留当时的 Git 状态及源文件指纹，构建清单另存匹配资产哈希。

| 归档文件，相对 `outputs/performance/` | SHA-256 |
| --- | --- |
| `canary-desktop-views-baseline/manifest.json` | `0e9e0a492ba254b95a559848e56cdfec7cce6c72bf01e5176c1951b358d41f9b` |
| `canary-desktop-views-recheck/manifest.json` | `fdeb4212cbd01fc32e496d43a119e16d2b6f1fdde3d564fd3af7efaf7a071a57` |
| `build-v3/assets.json` | `079ca27fe71ad850a93a1f869d2c8bb12d001c6120a94851217c02bb8a48dd15` |

## 实跑修正的采集问题

- Chrome / ChromeDriver 主版本不匹配：改为显式同版本二进制，并记录真实 Selenium capabilities。
- 多段 WebGL 交互没有导航，sitespeed HAR 页面索引报错：journey 关闭 HAR，保留 Resource Timing 和 trace；load 专项仍保留 HAR。
- WebDriver 共享引用导出错误：快照通过显式 JSON 字符串边界传输，不吞掉非零退出。
- 移动模拟平铺参数只缩小外窗：改为 ChromeDriver `mobileEmulation.deviceMetrics`，并在每段验证实际尺寸与 DPR。
- `screenshot=false` 没有关闭 LCP/CLS 独立截图：后续配置显式管理全部截图开关，记录分项，避免把错误配置标作无截图。
- 原有应用帧数组跳过最初 30 帧：导航前注入的有界 RAF 与长任务观察补充启动期证据，不修改原诊断数组。
- Base UI 选择菜单在关闭后仍可能保留隐藏 DOM：以实际选中地点和触发器关闭状态确认，不要求所有 listbox 节点被移除；失败仍保存实际状态并非零退出。

失败与配置不符的记录保留，但不进入可比基线。没有把这些兼容性失败变成产品缺陷，也没有为了跑通改变三维加载顺序或分辨率。
