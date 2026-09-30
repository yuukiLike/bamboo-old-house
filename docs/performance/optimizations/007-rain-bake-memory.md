# 雨效烘焙数据释放

2026-09-26，父版本 `e23daec`，随 `71917cc` 交付；属于[闲置资源优化](./006-mobile-gpu-residency.md)。

## 改动与数据

建筑 `rainExposure` / `rainIngress` 烘焙完成后，释放不再使用的精确遮雨索引和曝光查询缓存；保留雨滴碰撞所需的体素。

| 项目 | 前 | 后 | 增减 |
| --- | ---: | ---: | ---: |
| 烘焙后的精确索引数组引用 | 74,565,832 字节 | 0 | −71.11 MiB |
| 粒子碰撞体素 | 759,460 字节 | 759,460 字节 | 0 |

71.11 MiB 是实际 `TypedArray.byteLength` 求和，不含查询 Map 与对象开销；解除引用后何时回收由运行时决定，未测得进程或 GPU 内存下降量。

## 验证

真实模型的雨水属性与父版 SHA-256 一致：

```text
e6ba8b5d34a2b118264bb8725b2ab7189100647e330bee155d7602623c7af212
```

生命周期回归：160 组碰撞查询一致；移动端与桌面端各 240 帧，覆盖雨量、风、湿度、昼夜和相机变化，属性与雨滴池一致；重复释放和销毁幂等。专注测试 5 / 5、类型与 lint 检查在当时通过。

本地对照：`outputs/performance/mobile-runtime-05/rain-after.json` 与 `outputs/performance/mobile-runtime-06/rain-residency-after.json`。这是数据等价性验证，整体帧率收益待复测。

复现命令：

```sh
node scripts/perf/optimization-bench.mjs --iterations 1 --out outputs/performance/mobile-runtime-06/rain-residency-after.json
```
