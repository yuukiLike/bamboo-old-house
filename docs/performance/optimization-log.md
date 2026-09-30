# 性能记录

每轮采集追加一行，记录提交、设备/浏览器、视角/天气、画质/声音、时长、读数及截图。原图与数据保存在 `optimizations/evidence/`，缺失项写“未记录”；前后对比固定上述条件。采集方法见[指南](./pipeline.md)。

## 截图与数据

| 日期 / 轮次 | 条件 | 读数 | 图与原始记录 |
| --- | --- | --- | --- |
| 2026-09-26 / 02 | 用户雨景；`0be5bec`；设备未记录 | RAF 26.7 Hz；p95 50 ms | [截图](./optimizations/evidence/tidewater-02-user-feedback.png) · [记录](./optimizations/002-rain-index.md) |
| 2026-09-26 / 03 | 用户夜晚、大风、林间视角；版本与设备未记录 | RAF 8.3 Hz；p95 134 ms | [截图](./optimizations/evidence/tidewater-03-night-wind-user-feedback.png) · [记录](./optimizations/003-global-rendering.md) |
| 2026-09-26 / 04 | Canary 移动视口；一楼堂屋；停止检测功能验收 | 停止前 RAF 60.0 Hz；p95 19 ms | [截图](./optimizations/evidence/tidewater-04-stopped-mobile.png) · [构建与条件](./optimizations/evidence/tidewater-04-manifest.json) |
| 2026-09-26 / 05 | Canary 移动视口；一楼堂屋；清空重启功能验收 | RAF 60.0 Hz；p95 未显示 | [截图](./optimizations/evidence/tidewater-05-restarted-mobile.png) · [构建与条件](./optimizations/evidence/tidewater-05-manifest.json) |
| 2026-09-26 / 06-fence | iPhone 16 Pro；同轮初期 → 退化后 | RAF 32.66 → 11.43 Hz；fence 观察延迟中位数 35 → 85 ms | [曲线](./optimizations/evidence/tidewater-06-fence-timeline.png) · [数据](./optimizations/evidence/tidewater-06-iphone-probes.json) |
| 2026-09-26 / 06-native | iPhone 16 Pro；同轮三个窗口 | RAF 25.87 → 11.63 → 11.62 Hz；进程内存未持续增长 | [曲线](./optimizations/evidence/tidewater-06-native-process-timeline.png) · [数据](./optimizations/evidence/tidewater-06-iphone-probes.json) |

RAF 是浏览器回调频率；fence 观察延迟包含排队与调度。旧截图条件不全，04/05 为桌面功能验收，均不能据此计算真机优化收益。

截至 2026-09-26，iPhone 16 Pro 持续播放约 20–30 秒后降至 10–13 Hz 的问题仍未解决，见[调查结论](./iphone-investigation-status.md)。

## 资产检测 · 2026-09-30

静态盘点：[architecture.glb](../../public/models/architecture.glb)，SHA-256 前缀 `009a3e159d5a`。文件 25.46 MB，其中 116 张 PNG/JPEG 占 17.37 MB；111 个网格、104 个材质，几何已用 meshopt 压缩。MB 按十进制计。

粗糙度贴图已使用 metallicRoughness 通道，暂无独立 AO 贴图；ORM 打包不列为新增任务。本轮未采集运行数据或截图。

## 可行方向 · 尚未实施

| 顺序 | 方向与依据 | 画质与验收 |
| --- | --- | --- |
| 1 | 贴图去重：9 组内容完全相同，16 张冗余图片，编码载荷可减少约 3.30 MB | 可无损；保留像素、采样与材质参数，确认运行时共享纹理。 |
| 2 | [KTX2](https://gltf-transform.dev/modules/extensions/classes/KHRTextureBasisu)：法线先试 UASTC，颜色先做 ETC1S 小样；需接入 KTX2Loader | 有损；近景核对木纹、墙面、春联和法线，再实测下载量、纹理内存及加载耗时。 |
| 3 | 局部同材质合批：7 组各含两个基元，理论上限减少 7 个基元 | 条件满足可保留画质；需重验名称依赖、雨效和 LOD，按实际 draw calls 决定是否采用。 |

下一步先验证贴图去重；同条件真机前后采集保留截图与数据，检查近景、雨效和 LOD。涉及画质取舍时保留完整效果，提供可选配置。

历次实现：[01](./optimizations/001-tidewater-transfer.md) · [02](./optimizations/002-rain-index.md) · [03](./optimizations/003-global-rendering.md) · [04](./optimizations/004-mobile-runtime.md) · [05](./optimizations/005-mobile-load.md) · [06](./optimizations/006-mobile-gpu-residency.md) · [07](./optimizations/007-rain-bake-memory.md) · [08](./optimizations/008-idle-rendering.md)。
