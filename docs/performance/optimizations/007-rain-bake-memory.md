# 雨效烘焙数据：释放固定内存驻留，尚非移动端掉帧根因

本文是[第六阶段优化](006-mobile-gpu-residency.md)的雨效内存专题附录，不代表已发布的独立第七阶段。父版本为 `e23daec77945c4b70d07f0956a9bcdc12232fe45`。2026-09-26 先在 `3719ad4` 归档文档与证据，随后按用户指令随本次源码提交交付实现；真机持续掉帧仍未解决，状态见[调查检查点](../iphone-investigation-status.md)。

## 已确认的问题与修改范围

所有视角共用的天气初始化会先建立精确建筑遮雨索引，再遍历建筑表面，生成 `rainExposure` 和 `rainIngress` 顶点属性。后续雨量、风向、湿度、昼夜和相机变化使用已经烘焙的属性；雨滴碰撞使用独立的保守体素。精确三角形索引和曝光查询缓存此时已经完成用途，原实现仍让它们随整个天气实例驻留。

这是一项**固定的初始化后内存占用**，尚未证明会随视角切换持续增长，也没有证据证明释放它可以解决 iPhone 运行后降至约 10–13 Hz 的问题。该修改的结论限于：移除已无运行时用途的数据，同时保持雨效输出一致。它适用于共享天气系统的所有场景、移动端和桌面端。

具体实现位于：

- [`rain-shelter.ts`](../../../src/components/scene/rain-shelter.ts)：新增明确的 `releaseExposureData()` 生命周期操作，清空曝光查询 `Map`，释放精确索引，并移除对索引对象的引用；保留雨滴使用的 `solid()` / `clip()` 体素数据和数字型构建统计。重复释放与最终销毁均幂等。
- [`weather.ts`](../../../src/components/scene/weather.ts)：在 `weatherSurfaces()` 完成完整同步遍历、返回全部烘焙属性后立即释放索引，没有将释放提前至异步模型加载或表面初始化尚未结束的时刻。移除诊断对象中的 `ingressAt` 精确查询入口，保留运行时体素诊断。天气销毁后不再更新，重复销毁不再二次清理已经恢复的原始几何体。
- [`rain-occlusion.ts`](../../../src/components/scene/rain-occlusion.ts)：精确查询算法和直接使用该模块的 API 未变。单独调用 `createRainShelter()` 的离线基准与精确查询使用者仍可查询，直到主动调用释放操作。主动释放后再调用 `exposure()` 会抛出 `RAIN_EXPOSURE_DATA_RELEASED`，避免静默重建大缓存或返回失真的结果。

没有调整雨量、雨滴数量、建筑遮雨规则、材质、渲染尺寸或任何画质默认值，因此无需新增画质取舍配置。

## 释放范围与字节证据

对真实建筑模型运行现有离线基准，精确索引统计如下：

| 项目 | 数量 |
| --- | ---: |
| 输入建筑三角形 | 996,363 |
| 精确遮挡方向网格中的非空单元 | 78,102 |
| 三个方向网格的三角形引用 | 7,546,211 |
| 精确索引 TypedArray 总字节 | **74,565,832 字节，约 71.11 MiB** |
| 继续保留的粒子碰撞体素 | 759,460 字节 |
| 其中被建筑占用的体素 | 89,048 |

71.11 MiB 来自 `createRainOcclusion().stats.bufferBytes` 对实际 `TypedArray.byteLength` 的求和，包括三角形顶点 `Float32Array`、三角形高度范围 `minY` / `maxY`、三个方向网格的偏移和三角形引用 `Uint32Array`。释放操作同时清空曝光查询 `Map`；字符串键、数组值及 JavaScript 对象开销没有计入上述字节数。

该数字**不是 iPhone 进程 RSS 的实测下降，也不是 GPU 内存测量**。移除引用允许 JavaScript 垃圾回收器回收其存储，系统实际何时回收、进程内存何时下降仍由运行时决定。用于渲染的顶点属性、体素、材质、纹理和雨滴池继续保留。

## 等价性与生命周期验证

真实建筑基准中，修改前后的 `rainExposure` / `rainIngress` 属性 SHA-256 完全相同：

```text
e6ba8b5d34a2b118264bb8725b2ab7189100647e330bee155d7602623c7af212
```

对照文件为本地基准产物 `outputs/performance/mobile-runtime-05/rain-after.json` 与 `outputs/performance/mobile-runtime-06/rain-residency-after.json`。这些产物用于本次复核，不作为用户设备性能提升的证据。运行命令：

```sh
node scripts/perf/optimization-bench.mjs --iterations 1 --out outputs/performance/mobile-runtime-06/rain-residency-after.json
```

本地新增的 `tests/rain-shelter-lifecycle.test.ts` 使用真实 Three 几何体和生产天气实现，观察真实精确索引的查询与销毁次数。对照组仅在测试加载期间延迟释放索引，不在生产代码引入测试开关。

1. 对 160 组碰撞位置和雨滴线段，释放前后的 `solid()` / `clip()` 结果完全相同；释放前仍支持独立精确查询，释放后精确查询明确报错。重复释放和最终销毁只清理精确索引一次。
2. 分别对移动端、桌面端天气实例执行 **240 帧**。覆盖无雨、暴雨、停雨后的干燥、风力变化、昼夜变化、多个相机位置以及静态天气更新。释放组与保留索引的对照组初始几何属性和雨滴池哈希一致，运行中每 40 帧比较全部相关属性仍一致，建筑烘焙属性保持不变；初始化完成后没有新增精确遮雨查询。
3. 诊断对象不再暴露精确查询闭包；天气重复销毁只触发一次雨几何体销毁，销毁后的 `update()` 不再改变粒子数据。

验证结果：

| 检查 | 结果 |
| --- | --- |
| `node --experimental-strip-types --test tests/rain-shelter-lifecycle.test.ts tests/rain-occlusion.test.ts` | **5 / 5 通过**：2 个新增生命周期测试、3 个既有精确遮挡测试 |
| `pnpm exec tsc --noEmit --incremental false` | 通过 |
| 针对雨效修改文件和新测试的 `oxlint` | 通过 |
| 雨效修改的 `git diff --check` | 通过 |
| 真实建筑雨属性哈希对照 | 相同 |

这些验证证明释放时机和现有雨效数据的等价性；没有把离线一次性构建耗时、桌面帧率或未测量的手机内存下降写成此次收益。移动端持续掉帧的真机对照、已排除假设和未解决边界继续记录在[第六阶段报告](006-mobile-gpu-residency.md)。
