# 将采集流水线接入另一个 Three.js 项目

通用采集器负责浏览器配置、导航、RAF、资源、User Timing、trace、原始数据和报告。**适配器声明项目何时就绪、如何读取诊断和状态；场景脚本声明点击哪些真实控件。** 换项目不需要修改通用 helper，也不需要安装监控 SDK。

本仓库的 `bamboo.cjs` 用于竹屋，`three-example.cjs` 仅提供另一项目的接入契约。示例尚未在第二个真实项目完成端到端验证；不能把它的存在当成移植已经验证。采集步骤和前后对比见[流水线说明](pipeline.md)。

## 最小接入

在新项目的浏览器入口登记一个小对象，并在已有业务流程中更新它。所有值来自真实状态；不知道的值保留 `null`。

```js
window.__SCENE_PERF__ = {
  ready: false,
  diagnostics: null, // 可选：下文给出 renderer 信息接入
  businessPhases: null, // 可选：原生 User Timing 不需要这个对象
  state: {
    scene: 'courtyard', // 当前场景的稳定标识
    camera: 'orbit',    // 当前相机模式标识，不是会逐帧变化的坐标
    animation: true,   // 当前动画实际运行状态
    soundEnabled: false,
  },
};

// 放进应用已有的“首屏业务就绪”分支，条件由应用自己决定。
// 例如所需资产和场景构建已完成、首帧已提交、必要控件已可操作。
// window.__SCENE_PERF__.ready = true;
```

不要直接把最后一行移到入口末尾，也不要用任意定时器或一次 RAF 代替业务就绪。首帧 `renderer.render()` 返回只表示 CPU 提交结束，不证明 GPU 完成或屏幕呈现。若应用已有预编译或淡入，就绪条件可以包括它们；不要为了检测另外增加预热、编译或渲染。

从本工具仓库运行，只采首屏即可复用内置 `load` 流程；其他内置流程包含竹屋控件，不能直接用于新项目：

```sh
node scripts/perf/run.mjs \
  --url http://127.0.0.1:5173/ \
  --adapter scripts/perf/adapters/three-example.cjs \
  --flow load --profile desktop --mode baseline \
  --instrumentation off --iterations 3 --observe-ms 5000 \
  --out outputs/performance/new-project-before
```

这里的 `--instrumentation off` 只移除工具管理的 `perf=1` 参数，不禁止采集页面已有的原生 User Timing。默认竹屋 `on` 会记录竹屋 helper 的文件指纹；新项目尚未接入自己的埋点来源指纹时，选择 `on` 会被严格比较判为缺少来源依据。新项目若需要按查询参数启用自己的标记，可以使用自己的参数，例如 `?diagnostics=1`，在两次采集中保持一致，并归档对应构建源码。不要把新项目适配器冒充为 `id: 'bamboo'`。

页面没有应用帧数组时，应用帧统计显示 **N/A**；独立浏览器 RAF、导航、资源、长任务和 trace 仍可采集。RAF 间隔不是屏幕 FPS。缺少 renderer 诊断不妨碍生成采集报告，但缺少实际画布、画质、GPU 等比较条件时，报告会拒绝确认优化收益。

## 适配器契约 v1

适配器是本地 CommonJS 文件，通过 `--adapter FILE.cjs` 选择。runner 将路径转为绝对路径，再通过 `PERF_ADAPTER` 传给场景 helper；直接使用 helper 时，`PERF_ADAPTER` 必须为绝对路径。未指定时加载 `scripts/perf/adapters/bamboo.cjs`。

| 导出 | 约定 |
| --- | --- |
| `version` / `id` | `version: 1`；非空、稳定的项目适配器 ID |
| `isReady()` | 同步返回严格布尔值 `true` 才算就绪；错误可抛出，导致采集失败 |
| `readyDescription` | 写明真实就绪条件及等待范围，供原始数据解释 |
| `readDiagnostics()` | 返回可 JSON 序列化的诊断对象，或 `null` |
| `readBusinessPhases()` | 返回下文的有界业务记录对象，或 `null` |
| `readState()` | 返回当前业务状态；未知值为 `null`，不可凭默认值补成已知状态 |
| `stateFields` | 必需的离散状态字段路径，如 `scene`、`weather.preset`；两次采集逐场景核对 |
| `optionalStateFields` | 可选字段路径；两边都未观测到可省略，一边有值一边未知不能当成相同 |
| `frameCapacity` | 应用 `diagnostics.frames` 的实际最大容量；没有这份协议时为 `null` |
| `frameLimitation` | 写明应用帧起点、暖机省略、刷新频率或不可用等限制 |

四个函数会通过 `Function.prototype.toString()` 序列化，在页面中执行，**必须使用独立、同步的 `function` 声明或 `function` 属性值**。不要使用对象方法简写、箭头、`async`、生成器、绑定函数，也不要引用 Node 模块、导入变量或外层闭包。函数内部可以读取 `window`、`document`，并定义自己的局部函数。语法和必要字段在运行前校验；工具无法静态证明函数没有自由变量，因此仍需首次实际采集验证。

```js
// 正确：浏览器所需逻辑全部包含在函数里。
function isReady() {
  return window.__SCENE_PERF__?.ready === true;
}
module.exports = { /* 其他必需字段 */, isReady };

// 不符合契约：isReady() {} 是对象方法简写，不能直接当函数表达式执行。
// module.exports = { isReady() { return application.ready; } };
```

只返回简单对象、数组和基本值，不返回 Three.js 场景、渲染器、循环引用、DOM 节点或 `BigInt`。helper 在浏览器中先 `JSON.stringify()`，再跨 WebDriver 传输，避免复杂对象共享引用导致序列化失败。应用诊断顶层的函数和 `frames` 会单独处理；这不代表任意复杂对象都能被自动清洗。

竹屋默认适配器保留原先的 `.scene-mount.ready`、淡入 opacity、`startupMs` 与“自由看看”控件条件，仍在静态降级时失败。必需状态为 `view/place/timeOfDay/soundEnabled/soundBusy/soundError/paused/panorama/settingsPanel/weather.preset`；`settingsPanel: null` 在这里明确表示面板关闭。可选状态为 `volume/weatherBusy/weatherError`。示例适配器要求 `scene/camera/animation/soundEnabled`，其中任何 `null` 都属于未知，不能确认可比。

## 可选的 Three.js 诊断

在已有渲染循环的实际提交之后采样即可，不另起渲染循环。下面只展示接入点；`THREE`、`renderer` 和 `activeQualityId` 使用项目已有对象。`activeQualityId` 应描述实际生效的画质组合，例如包含阴影与后处理开关的稳定 ID。

```js
const logicalSize = new THREE.Vector2();
const drawingSize = new THREE.Vector2();
const gl = renderer.getContext();
const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
const gpu = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null;
let sampledFrames = 0;

function updatePerformanceDiagnostics() {
  if (++sampledFrames % 15 !== 0) return;
  renderer.getSize(logicalSize);
  renderer.getDrawingBufferSize(drawingSize);
  window.__SCENE_PERF__.diagnostics = {
    viewport: [logicalSize.x, logicalSize.y],
    drawSize: [drawingSize.x, drawingSize.y],
    pixelRatio: renderer.getPixelRatio(),
    quality: activeQualityId,
    gpu,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    textures: renderer.info.memory.textures,
    geometries: renderer.info.memory.geometries,
  };
}

// 项目已有的 render / composer.render 调用之后：
// updatePerformanceDiagnostics();
```

这里的纹理、几何体是数量，不是显存字节；尺寸也不是 GPU 耗时。多 pass 项目要说明计数范围：Three.js 默认每次 render 重置 `renderer.info`，若项目已用 `autoReset=false` 汇总整帧，应在最终 pass 完成且已有 `info.reset()` 之前采样。不要无说明地把最后一次 pass 的计数叫整帧计数。[Three.js WebGLRenderer 官方文档](https://threejs.org/docs/pages/WebGLRenderer.html)说明了计数重置和逻辑尺寸、绘图缓冲尺寸的区别。

`startupMs` 可选，若提供，必须另行写清起点；示例没有假造该数值。需要应用帧统计时，自行提供有界 `diagnostics.frames: number[]`，每项为同一主文档时钟下的相邻帧间隔毫秒，并把 `frameCapacity` 改成实际容量。helper 只对尚未填满、未覆盖的数组按索引切窗；无法证明窗口有效时标记不可用。更复杂的环形缓冲协议不属于当前 v1，不要只返回最近一帧或数组长度充当历史。

## GLTF / Blender 资产的业务阶段

从 Blender 导出的 GLB / glTF 进入 Three.js 后，沿用同一套浏览器采集。应按项目真实边界记录：资产请求、解析、场景构建、已有 shader 编译、初始帧提交、首次懒加载视图和重复进入。浏览器工具不测量 Blender 软件中的建模、烘焙或导出耗时；资产版本和构建文件要随采集归档。

最低侵入方式是在原有调用前后使用数字时间戳。以下是一个有限次数的资产加载示例，放在项目已有加载代码旁；`loader.loadAsync()` 覆盖整段加载过程，因此命名为 `model.load`，不能称为纯下载或纯解析。[GLTFLoader 官方文档](https://threejs.org/docs/pages/GLTFLoader.html)提供加载和单独解析 API。

```js
const collectPhases = new URLSearchParams(location.search).get('diagnostics') === '1';
let phaseId = 0;

function beginPhase(phase, detail = {}) {
  if (!collectPhases) return () => {};
  const start = performance.now();
  const name = `project:${phase}#${++phaseId}`;
  let closed = false;
  return (status = 'success') => {
    if (closed) return;
    closed = true;
    try {
      performance.measure(name, {
        start, end: performance.now(), detail: { ...detail, phase, status },
      });
    } catch { /* 诊断故障不应阻止业务 */ }
  };
}

const finish = beginPhase('model.load', { asset: 'house.glb' });
try {
  const gltf = await loader.loadAsync('/models/house.glb');
  finish('success');
  // 后续既有 scene.add / 场景构建逻辑保持原来的位置和顺序。
} catch (error) {
  finish(error?.name === 'AbortError' ? 'cancelled' : 'error');
  throw error;
}
```

不必为了拆分阶段重写加载器。只有原项目已经分别执行 fetch、缓冲拼接与 `parseAsync()` 时，才分别包住真实边界；阶段可能嵌套和并行，不能相加成总耗时。同步 render 的计时是 CPU 调用范围，音频恢复结束也不是扬声器首次发声。不要每帧写 User Timing；这个最小示例没有长期保留策略，交互频繁的产品应像竹屋 helper 一样使用有界记录与明确截断计数。

原生 measures 会直接被采集。如果希望同时提供应用侧回退记录，`readBusinessPhases()` 应返回 `{version: 1, enabled: true, droppedPhases: 0, phases: [...]}`，每项至少有 `name`、`startTime`、`duration`、`detail: {phase, status}`；可用 `entryName` 保留与原生 measure 相同的名字供去重。所有时间均为同一页面 `performance.now()`，不使用 Node 时钟或 Unix 时间戳。

## 加入懒加载与交互流程

首屏之外使用 `--scenario /absolute/path/project-flow.cjs`。可以复制内置场景脚本的结构，替换真实控件、业务条件、别名和预期场景集合；复用 `createCollector(context, commands)`、`boundary()`、`state()`、`finish()`。先记录操作前边界，再执行真实操作和等待，不直接篡改页面状态来跳过用户路径。每次捕获须保留真实的首次或重复进入、声音状态和画质条件。

`module.exports.expectedScenes = ['initial-3d', ...]` 用于完整性核对。所有场景都应通过同一个 helper 写出 `scene-<iteration>-<alias>.json`，其中包含适配器元数据；仅调用 Browsertime 而未生成约定 raw 文件的脚本，不代表自定义报告已接通。`loadAdapter()` 会供 runner 和 helper 共用校验，避免命令接受一个协议而页面实际读取另一个协议。

首次移植先检查 raw 中的就绪条件、`startState/endState`、尺寸和适配器声明，再做重复采集。manifest 记录适配器版本、ID、文件哈希与状态字段；两次比较会核对这些条件，路径不同本身不影响比较。缺失状态、被改过的适配器、不同脚本或不同渲染条件必须先解释，不能靠相同场景别名生成一个看似可信的收益百分比。
