# 性能记录

**2026-09-30 · 用户确认：当前性能已满足需要。** 本次复核已有 JSON 与原图，未新增真机采集。

## 已验证的增减 · 2026-09-26

CPU 为 Apple M4 / Node v24.18.0 / Three r185 的三轮中位数。01：`3f382ac → 83baa2e`（[前](./optimizations/evidence/tidewater-before.json) / [后](./optimizations/evidence/tidewater-after.json)）；02：`83baa2e → 0be5bec`（[前](./optimizations/evidence/tidewater-02-before.json) / [后](./optimizations/evidence/tidewater-02-after.json)）。

| 阶段 / 指标 | 前 | 后 | 增减 |
| --- | ---: | ---: | ---: |
| 01 · 建筑遮雨与湿润属性 CPU | 5,763.08 ms | 3,819.58 ms | −1,943.50 ms（−33.72%） |
| 01 · 其中：遮雨索引与体素构建 | 731.25 ms | 1,219.96 ms | +488.72 ms（+66.83%） |
| 01 · 植被 180 帧裁剪 CPU | 62.41 ms | 39.42 ms | −22.98 ms（−36.82%） |
| 01 · 植被空间结构初始化 | 2.90 ms | 5.41 ms | +2.50 ms（+86.23%） |
| 02 · 建筑遮雨与湿润属性 CPU | 3,757.77 ms | 2,949.59 ms | −808.18 ms（−21.51%） |
| 02 · 索引数组容量 | 84.01 MiB | 71.11 MiB | −12.89 MiB（−15.35%） |
| 02 · 索引候选引用 | 10,926,248 个 | 7,546,211 个 | −3,380,037 个（−30.94%） |

各阶段独立比较；差值按原始值计算，显示四舍五入。CPU 数据未包含下载、贴图解码或 GPU 渲染；数组容量未包含进程其他内存。前后被测雨水属性与植被输出哈希一致。

03 为每组 30 次场景提交的阴影刷新计数，覆盖全部视角、时段与天气（[前](./optimizations/evidence/tidewater-03-before.json) / [完整效果](./optimizations/evidence/tidewater-03-after-full.json) / [性能档](./optimizations/evidence/tidewater-03-after-combined.json)）：

| 条件 | 前 | 后 | 增减 |
| --- | ---: | ---: | ---: |
| 动态 · 完整效果 | 30 | 30 | 0（0%） |
| 静止 · 完整效果 | 30 | 1 | −29（−96.67%） |
| 动态 · 隔帧阴影，有画质取舍 | 30 | 15 | −15（−50.00%） |

刷新次数变化不等于整体帧率变化。

## 每轮截图 · 未配对

| 日期 / 轮次 | 条件 | 读数 | 图与原始记录 |
| --- | --- | --- | --- |
| 2026-09-26 / 02 | 用户雨景；`0be5bec`；设备未记录 | RAF 26.7 Hz；p95 50 ms | [截图](./optimizations/evidence/tidewater-02-user-feedback.png) · [记录](./optimizations/002-rain-index.md) |
| 2026-09-26 / 03 | 用户夜晚、大风、林间视角；版本与设备未记录 | RAF 8.3 Hz；p95 134 ms | [截图](./optimizations/evidence/tidewater-03-night-wind-user-feedback.png) · [记录](./optimizations/003-global-rendering.md) |
| 2026-09-26 / 04 | Canary 移动视口；一楼堂屋；停止检测功能验收 | 停止前 RAF 60.0 Hz；p95 19 ms | [截图](./optimizations/evidence/tidewater-04-stopped-mobile.png) · [构建与条件](./optimizations/evidence/tidewater-04-manifest.json) |
| 2026-09-26 / 05 | Canary 移动视口；一楼堂屋；清空重启功能验收 | RAF 60.0 Hz；p95 未显示 | [截图](./optimizations/evidence/tidewater-05-restarted-mobile.png) · [构建与条件](./optimizations/evidence/tidewater-05-manifest.json) |

RAF 为浏览器回调频率。02/03 场景不同；04/05 为桌面功能验收，截图不能计算真机前后收益。

<details>
<summary>2026-09-26 · 真机历史观察</summary>

iPhone 16 Pro 同轮初期与后期的变化，属于持续运行过程；本轮未验证动态掉帧恢复，详见[当时调查](./iphone-investigation-status.md)。

| 轮次 / 窗口 | 初期 | 后期 | 增减 |
| --- | ---: | ---: | ---: |
| fence 轮 RAF：10–20 s → 35–65 s | 32.66 Hz | 11.43 Hz | −21.22 Hz（−65.00%） |
| fence 观察延迟中位数：同上 | 35.00 ms | 85.00 ms | +50.00 ms（+142.86%） |
| native 轮 RAF：10–20 s → 80–100 s | 25.87 Hz | 11.62 Hz | −14.26 Hz（−55.10%） |

[RAF 与 fence 曲线](./optimizations/evidence/tidewater-06-fence-timeline.png) · [原生内存与 CPU 曲线](./optimizations/evidence/tidewater-06-native-process-timeline.png) · [原始数据](./optimizations/evidence/tidewater-06-iphone-probes.json)。fence 延迟包含排队与调度。

</details>

## 资产检测 · 2026-09-30

静态盘点：[architecture.glb](../../public/models/architecture.glb)，SHA-256 前缀 `009a3e159d5a`。文件 25.46 MB，其中 116 张 PNG/JPEG 占 17.37 MB；111 个网格、104 个材质，几何已用 meshopt 压缩。MB 按十进制计。

粗糙度贴图已使用 metallicRoughness 通道，暂无独立 AO 贴图；ORM 打包不列为新增任务。本轮为静态盘点。

## 可行方向 · 按需，尚未实施

| 顺序 | 方向与依据 | 画质与验收 |
| --- | --- | --- |
| 1 | 贴图去重：9 组内容完全相同，16 张冗余图片，编码载荷可减少约 3.30 MB | 可无损；保留像素、采样与材质参数，确认运行时共享纹理。 |
| 2 | [KTX2](https://gltf-transform.dev/modules/extensions/classes/KHRTextureBasisu)：法线先试 UASTC，颜色先做 ETC1S 小样；需接入 KTX2Loader | 有损；近景核对木纹、墙面、春联和法线，再实测下载量、纹理内存及加载耗时。 |
| 3 | 局部同材质合批：7 组各含两个基元，理论上限减少 7 个基元 | 条件满足可保留画质；需重验名称依赖、雨效和 LOD，按实际 draw calls 决定是否采用。 |

## 记录与画质约定

每轮追加前值、后值、绝对差及百分比；固定提交、设备/浏览器、视角/天气、画质/声音与时长，原图和数据存入 `optimizations/evidence/`，缺失项写“未记录”。方法见[采集指南](./pipeline.md)。

### 画质与配置约定

有画质取舍时保留完整效果并提供可选配置，不自动降档。

历次实现：[01](./optimizations/001-tidewater-transfer.md) · [02](./optimizations/002-rain-index.md) · [03](./optimizations/003-global-rendering.md) · [04](./optimizations/004-mobile-runtime.md) · [05](./optimizations/005-mobile-load.md) · [06](./optimizations/006-mobile-gpu-residency.md) · [07](./optimizations/007-rain-bake-memory.md) · [08](./optimizations/008-idle-rendering.md)。
