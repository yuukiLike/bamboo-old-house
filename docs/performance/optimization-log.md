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

四个节点统一使用完整的 Scene Perf 面板、采集器、交互脚本和可视化对比报告；旧版仅补检测接口。

| 节点 | preview 分支 | 场景基点 | 在线检测 |
| --- | --- | --- | --- |
| 原始基线 | [preview/001](https://github.com/yuukiLike/bamboo-old-house/tree/preview%2F001) | [3f382ac](https://github.com/yuukiLike/bamboo-old-house/commit/3f382ac0fb84e35ca52593e2630c660c078d723d) | [打开](https://46c4a2c6.page-bamboo-old-house.pages.dev/?perf=1&perfUI=1) |
| CPU 优化完成 | [preview/002](https://github.com/yuukiLike/bamboo-old-house/tree/preview%2F002) | [0be5bec](https://github.com/yuukiLike/bamboo-old-house/commit/0be5bec68d9e9ac505c9c15026802c6009670fe3) | [打开](https://45057930.page-bamboo-old-house.pages.dev/?perf=1&perfUI=1) |
| 渲染与闲置资源优化完成 | [preview/003](https://github.com/yuukiLike/bamboo-old-house/tree/preview%2F003) | [71917cc](https://github.com/yuukiLike/bamboo-old-house/commit/71917cc7ca68a7dcd57d044968cf153ddd0bf70c) | [打开](https://9ccde821.page-bamboo-old-house.pages.dev/?perf=1&perfUI=1) |
| 当前版本 | [preview/004](https://github.com/yuukiLike/bamboo-old-house/tree/preview%2F004) | [00e1cfb](https://github.com/yuukiLike/bamboo-old-house/commit/00e1cfbd1920261bb45297934bd4cc9dfbab4815) | [打开](https://dc3daa62.page-bamboo-old-house.pages.dev/cn?perf=1&perfUI=1) |

每个分支均有 `tools/scene-perf/`、`scripts/perf/`、检测接入与工具回归测试，统一为工具版本 [`355ecd1`](https://github.com/yuukiLike/bamboo-old-house/commit/355ecd1a2b550e79eb61169493bff4b69b6d2ad0)。使用 `pnpm perf` / `pnpm perf:report` 生成可视化报告。

2026-09-30：四个节点的项目检查、构建与 Cloudflare 部署均通过；在线版本标识、页面及主要静态资源已核对。性能数据待同条件复测。

各版默认画质不同；统一设备、浏览器、实际绘制尺寸、阴影、帧率、视角、天气、声音、面板状态、缓存与时长后比较。旧版未提供的诊断显示为未测量。

## 新测试记录

每组保存：日期、提交、设备/浏览器、场景/画质/声音、时长、前值、后值、绝对差与百分比；前后截图和原始数据存入 `optimizations/evidence/` 并在本页链接。固定条件比较，RAF Hz 与实际绘制次数分别记录。

## 按需优化

2026-09-30，资产盘点：[建筑模型](../../public/models/architecture.glb) 25.46 MB，116 张贴图共 17.37 MB，几何已有 meshopt；以下方向尚未实施。

- 贴图去重：编码载荷可减少约 3.30 MB，可无损；实际效果待测。
- KTX2：需接入加载器；有损，先核对近景画质。
- 局部同材质合批：需验证名称依赖、雨效与 LOD；收益待测。

### 画质与配置约定

保留完整效果，有取舍时提供可选配置，不自动降档。采集方法见[指南](./pipeline.md)。
