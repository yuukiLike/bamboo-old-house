# 性能记录

2026-09-30：用户确认当前性能满足需要。iOS 26 真机曾发热掉帧，用户判断大概率为热降频，旧测试日志已清理。

## 历史参考 · 待 preview 复测

2026-09-26，Apple M4，CPU 三轮中位数。01：`3f382ac → 83baa2e`；02：`83baa2e → 0be5bec`。各阶段独立比较，差值按原始值计算。

| 阶段 / 指标 | 前 | 后 | 增减 |
| --- | ---: | ---: | ---: |
| 01 · 建筑遮雨与湿润属性 CPU | 5,763.08 ms | 3,819.58 ms | −1,943.50 ms（−33.72%） |
| 01 · 其中索引与体素构建 CPU | 731.25 ms | 1,219.96 ms | +488.72 ms（+66.83%） |
| 01 · 植被 180 帧裁剪 CPU | 62.41 ms | 39.42 ms | −22.98 ms（−36.82%） |
| 01 · 植被初始化 CPU | 2.90 ms | 5.41 ms | +2.50 ms（+86.23%） |
| 02 · 建筑遮雨与湿润属性 CPU | 3,757.77 ms | 2,949.59 ms | −808.18 ms（−21.51%） |
| 02 · 索引数组容量 | 84.01 MiB | 71.11 MiB | −12.89 MiB（−15.35%） |

原始数据：[01 前](./optimizations/evidence/tidewater-before.json) / [后](./optimizations/evidence/tidewater-after.json) · [02 前](./optimizations/evidence/tidewater-02-before.json) / [后](./optimizations/evidence/tidewater-02-after.json)。这些是局部 CPU 耗时与数组容量。

## 在线复测节点

2026-09-30，九个节点均构建、部署成功，页面与主要资源返回 HTTP 200；保留各提交原样，本次未重新采集性能。链接固定到本次部署，并开启检测面板。

| 节点 | preview 分支 | 提交 | 在线检测 |
| --- | --- | --- | --- |
| 00 · 原始基线 | [preview/perf-00-baseline](https://github.com/yuukiLike/bamboo-old-house/tree/preview%2Fperf-00-baseline) | [3f382ac](https://github.com/yuukiLike/bamboo-old-house/commit/3f382ac0fb84e35ca52593e2630c660c078d723d) | [打开](https://42c0795f.page-bamboo-old-house.pages.dev/?perf=1&perfUI=1) |
| 01 · [空间索引与植被裁剪](./optimizations/001-tidewater-transfer.md) | [preview/perf-01-spatial](https://github.com/yuukiLike/bamboo-old-house/tree/preview%2Fperf-01-spatial) | [83baa2e](https://github.com/yuukiLike/bamboo-old-house/commit/83baa2e119b40d0c76a69da874d83f2088f4ff5f) | [打开](https://a0c33984.page-bamboo-old-house.pages.dev/?perf=1&perfUI=1) |
| 02 · [雨效索引容量](./optimizations/002-rain-index.md) | [preview/perf-02-rain](https://github.com/yuukiLike/bamboo-old-house/tree/preview%2Fperf-02-rain) | [0be5bec](https://github.com/yuukiLike/bamboo-old-house/commit/0be5bec68d9e9ac505c9c15026802c6009670fe3) | [打开](https://27dba498.page-bamboo-old-house.pages.dev/?perf=1&perfUI=1) |
| 03 · [共用渲染与阴影调度](./optimizations/003-global-rendering.md) | [preview/perf-03-render](https://github.com/yuukiLike/bamboo-old-house/tree/preview%2Fperf-03-render) | [8a9033d](https://github.com/yuukiLike/bamboo-old-house/commit/8a9033d5e2f704580e391840aed85bc65975bb62) | [打开](https://b3e2772b.page-bamboo-old-house.pages.dev/?perf=1&perfUI=1) |
| 04 · [检测生命周期与画质配置](./optimizations/004-mobile-runtime.md) | [preview/perf-04-runtime](https://github.com/yuukiLike/bamboo-old-house/tree/preview%2Fperf-04-runtime) | [c24ca12](https://github.com/yuukiLike/bamboo-old-house/commit/c24ca123b308a7e5f94db56a7af97f81638d3c3a) | [打开](https://f9311cb7.page-bamboo-old-house.pages.dev/?perf=1&perfUI=1) |
| 05 · [音频、竹叶缓存与 resize](./optimizations/005-mobile-load.md) | [preview/perf-05-audio](https://github.com/yuukiLike/bamboo-old-house/tree/preview%2Fperf-05-audio) | [e23daec](https://github.com/yuukiLike/bamboo-old-house/commit/e23daec77945c4b70d07f0956a9bcdc12232fe45) | [打开](https://dc885de0.page-bamboo-old-house.pages.dev/?perf=1&perfUI=1) |
| 06 · [闲置资源与静止绘制](./optimizations/006-mobile-gpu-residency.md) | [preview/perf-06-idle](https://github.com/yuukiLike/bamboo-old-house/tree/preview%2Fperf-06-idle) | [71917cc](https://github.com/yuukiLike/bamboo-old-house/commit/71917cc7ca68a7dcd57d044968cf153ddd0bf70c) | [打开](https://10e6f01f.page-bamboo-old-house.pages.dev/?perf=1&perfUI=1) |
| 07 · 远景 LOD 与移动游览 | [preview/perf-07-lod](https://github.com/yuukiLike/bamboo-old-house/tree/preview%2Fperf-07-lod) | [01b0727](https://github.com/yuukiLike/bamboo-old-house/commit/01b0727f92b0435686cfad059af794f4943af43a) | [打开](https://38b3022e.page-bamboo-old-house.pages.dev/?perf=1&perfUI=1) |
| 08 · 当前 main | [preview/perf-08-current](https://github.com/yuukiLike/bamboo-old-house/tree/preview%2Fperf-08-current) | [00e1cfb](https://github.com/yuukiLike/bamboo-old-house/commit/00e1cfbd1920261bb45297934bd4cc9dfbab4815) | [打开](https://c775d210.page-bamboo-old-house.pages.dev/cn?perf=1&perfUI=1) |

各版默认画质不同；统一设备、浏览器、实际绘制尺寸、阴影、帧率、视角、天气、声音、面板状态、缓存与时长后比较。

## 新测试记录

每组保存：日期、提交、设备/浏览器、场景/画质/声音、时长、前值、后值、绝对差与百分比；前后截图和原始数据存入 `optimizations/evidence/` 并在本页链接。固定条件比较，RAF Hz 与实际绘制次数分别记录。

## 按需优化

2026-09-30，资产盘点：[建筑模型](../../public/models/architecture.glb) 25.46 MB，116 张贴图共 17.37 MB，几何已有 meshopt；以下方向尚未实施。

- 贴图去重：编码载荷可减少约 3.30 MB，可无损；实际效果待测。
- KTX2：需接入加载器；有损，先核对近景画质。
- 局部同材质合批：需验证名称依赖、雨效与 LOD；收益待测。

### 画质与配置约定

保留完整效果，有取舍时提供可选配置，不自动降档。采集方法见[指南](./pipeline.md)。
