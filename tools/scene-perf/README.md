# Scene Perf · 可拆卸的浏览器 3D 性能工具

将整个 `tools/scene-perf/` 目录复制到另一个项目即可复用源码。这里不是已发布的 npm 包，也不要求宿主采用竹屋的页面结构、场景或全局变量。

浏览器核心使用标准 Performance API、RAF 和 DOM；React 面板可选；CLI 使用 sitespeed.io / Browsertime 与 Chrome。工具不接管 `renderer.render()`，不改写 `fetch`，不自动降低画质。

## 选择接入程度

| 需要什么 | 使用哪层 | 需要提供什么 |
| --- | --- | --- |
| 不修改目标页面，先收集导航、请求、缓存、RAF、长任务 | `cli/run.mjs` 默认 browser 适配器 | 页面 URL；这里只等文档加载完成，不代表 3D 就绪 |
| 准确等待 3D 就绪、关联场景和声音状态 | CLI `--adapter` | 真实就绪条件、可序列化状态与渲染器诊断 |
| 自动复现懒加载、视图切换、开声 | CLI `--scenario` | 真实控件操作及每段观察边界 |
| 自己展示运行时数据 | `core/runtime.ts` | 可选 `RuntimeAdapter`；自行管理 collector 生命周期 |
| 直接使用实时面板和加载时间线 | `react/use-performance-panel.tsx` | React、Base UI、稳定的 `PerformanceAdapter` |
| 命名模型解析、场景构建等内部阶段 | `core/timings.ts` | 在原有业务边界调用 recorder；不需要 React |

Three.js、React Three Fiber、其他浏览器 WebGL / WebGPU 项目都能复用浏览器指标。渲染器计数由宿主提供；本工具没有通用 GPU 计时或真实屏幕 FPS 探针。Blender 导出 GLB/glTF 后在网页中的加载、解析和渲染适用，Blender 桌面编辑器、烘焙和离线渲染不适用。

## 目录和依赖

```text
scene-perf/
  core/       runtime.ts、timings.ts、HTTP 缓存分类与类型
  react/      按需加载 hook、面板、运行时视图、局部 CSS
  cli/        运行器、探针、采集 helper、缓存采集、报告、load/cache 流程
  examples/   browser-adapter.cjs、three-adapter.cjs
  README.md
```

- 只用浏览器核心：宿主编译 TypeScript，使用 DOM 类型和现代浏览器 API；没有 React / Three.js 运行依赖。
- 使用面板：宿主需有 `react`、`react-dom`、`@base-ui/react`，并支持 TSX、动态 import 与 CSS import。本项目验证版本为 React 19.2.6、Base UI 1.7.0；沿用宿主兼容版本，不自动安装或升级。TypeScript 项目需要对应 React 类型。
- 使用 CLI：Node.js ≥22.13，`npx`，Chrome / Canary 及匹配的 ChromeDriver。首次运行通过 `npx` 获取固定的 sitespeed.io 42.7.0 / Browsertime 28.3.0。CLI 不依赖宿主 package.json 或 `src`。
- `react` 中的 CSS 使用 `perf-` 前缀；面板在启用时动态载入。卸载停止运行资源，不承诺把已下载的 JS/CSS 从浏览器缓存移除。

## React：用一个 hook 挂载

在宿主新增一个适配文件。下面的 `project` 是你的应用已有状态读取入口；不要把 Three.js 对象、DOM、函数或循环引用作为快照返回。

```tsx
// src/performance/project-adapter.ts
import type { PerformanceAdapter } from '../../tools/scene-perf/react/types';
import { project } from '../project'; // 换成宿主自己的状态读取入口
import { timings } from './timings';

// 模块级对象保持稳定；也可按稳定依赖使用 useMemo。
export const projectAdapter: PerformanceAdapter = {
  id: 'my-scene',
  readState: () => ({
    scene: project.sceneId ?? null,
    soundEnabled: project.soundEnabled ?? null,
  }),
  readRenderer: () => project.rendererSnapshot ?? null,
  readBusinessPhases: () => timings.read(),
  startupPhase: 'startup.scene',
  readyLabel: '场景可交互',
  phaseLabels: { 'model.load': '加载模型', 'startup.scene': '创建场景' },
  rendererDescription: '在宿主已有渲染提交后更新；计数范围由宿主定义。',
};
```

```tsx
'use client';
import { usePerformancePanel } from '../tools/scene-perf/react/use-performance-panel';
import { projectAdapter } from './performance/project-adapter';

export function App() {
  // 默认只在页面启动地址同时有 perf=1 和 perfUI=1 时启用。
  const panel = usePerformancePanel(projectAdapter);
  return <>{/* 宿主原有页面 */}{panel}</>;
}
```

宿主已有设置开关时可以传 `{ enabled: diagnosticsOpen }`。从 `false` 变为 `true` 挂载新面板；变回 `false` 卸载。卸载清理 RAF、PerformanceObserver、监听器、刷新定时器和下载对象 URL；重新打开的运行时窗口从挂载时开始，不能补录关闭期间的帧。折叠面板仍继续采集。

**这个开关只控制面板及其采集资源，不控制独立的业务 recorder。** 如果要从导航开始记录完整加载过程，仍推荐通过诊断 URL 重新加载；中途开启无法恢复此前没有记录的业务阶段或 RAF。

面板另提供「停止检测」按钮，停止面板所有采集、定时刷新并收起，保留最终数据可导出。宿主通过 `stopCollection()` 一并停止独立 recorder、诊断计数等，例如调用 `timings.stop()`；停止后 `timings.read()` 返回冻结的数据，`enabled` 为 `false`，迟到的异步完成回调不会再写入。宿主接入 `restartCollection()` 后，停止按钮变为“清空并重启”：调用 `timings.restart()`，重置宿主诊断计数和全局桥接，再创建新的运行时采集器。旧完成回调按会话隔离，不会写回；只有 `dispose()` 是不可重开的终态。新一轮资源按开始时间过滤，导出的 `collectionStartedAt` 标注边界，不重新导出早期导航。纯浏览器适配器无需业务回调即可重启；有业务读取器却未接入重启回调时，重启按钮不可用，需刷新页面。宿主仍在采集业务阶段但没有接入此回调时，面板会明确提示业务采集未关闭。

`PerformanceAdapter` 的变化点：

| 属性 | 职责 |
| --- | --- |
| `id` | 稳定项目标识，作为导出文件名前缀 |
| `readState()` | 返回 `Record<string, string \| number \| boolean \| null>`；未知用 `null` |
| `readRenderer()` | 返回 `RendererSnapshot` 或 `null`，不返回 renderer 实例 |
| `readBusinessPhases()` | 返回 recorder 的 `Diagnostics` 或 `null` |
| `describeAction(event)` | 可选，替换通用 DOM 操作描述；`null` 表示忽略该事件 |
| `phaseLabels` / `formatPhaseDetail()` | 业务阶段中文名与详情格式；缺省保留原始字段 |
| `startupPhase` / `readyLabel` | 初始化失败判定所用父阶段与就绪说明；就绪时间来自 recorder 的 `readyPhase` |
| `describeState()` / `rendererDescription` | 状态与渲染器计数口径的展示 |
| `onCollector(collector)` | 可选宿主绑定，返回自己的清理函数；不需要额外创建 collector |
| `stopCollection()` | 停止宿主拥有的业务计时与诊断；必须为启用业务 recorder 的项目接入，已有记录可保留供导出 |
| `restartCollection()` | 清空宿主业务 recorder、诊断计数和桥接并重开；配合 `timings.restart()`，不得重载产品场景 |

`onCollector` 若在部分完成宿主绑定后抛错，宿主需自行回滚；工具会销毁 collector，但无法取得尚未返回的清理函数。

读取器应轻量、同步且无业务副作用。不要每次 React render 新建 adapter，否则会卸载重建面板。读取失败显示上下文异常，仍保留浏览器 RAF 采样；恢复后可继续读取。未知 renderer 字段使用 `null`，不要填零冒充已观测。

## 非 React：直接管理运行时采集

```ts
import { createRuntimeCollector } from './tools/scene-perf/core/runtime';

const collector = createRuntimeCollector({
  readState: () => ({ scene: currentSceneId, soundEnabled }),
  readRenderer: () => latestRendererSnapshot,
});
const timer = setInterval(() => {
  renderYourOwnMetrics(collector.snapshot());
}, 1000);

// 临时停止／继续；clear 不会清 HTTP 缓存或业务阶段。
collector.pause();
collector.resume();
collector.clear();

// 宿主卸载时：宿主创建的 timer 由宿主清理。
function disposeDiagnostics() {
  clearInterval(timer);
  collector.dispose();
}
```

没有适配器时也可以 `createRuntimeCollector()`，仍可采 RAF 和支持的主线程长任务。每个实例由创建者负责销毁；核心不会写 `window` 全局，也不会偷偷销毁另一个实例。

保持 5 秒读数窗口、30 秒帧历史和有界事件。RAF Hz 不是屏幕 FPS；主线程阻塞会同时阻塞面板，完整间隔在恢复回调后才出现。页面隐藏／暂停的边界不拼成假卡顿。

## 业务计时：独立 recorder

```ts
// src/performance/timings.ts
import { createPhaseRecorder } from '../../tools/scene-perf/core/timings';

export const timings = createPhaseRecorder({
  namespace: 'my-scene',
  enabled: () => typeof window !== 'undefined'
    && new URLSearchParams(location.search).get('perf') === '1',
  readyPhase: 'startup.ready',
});
```

同步工作可用 `timings.measurePhase('scene.build', () => buildScene())`。它保留返回值与原有异常，**不会等待 Promise**。异步工作必须显式结束：

```ts
const finish = timings.beginPhase('model.load', { asset: 'room.glb' });
try {
  const gltf = await loader.loadAsync('/models/room.glb');
  finish('success');
  // 继续原有业务逻辑，不为了计时改变加载顺序。
} catch (error) {
  finish(error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'error');
  throw error;
}

// 放在宿主真实的可交互边界，不能用任意定时器代替。
timings.beginPhase('startup.ready')();
```

`read()` 在启用时返回 recorder 拥有的实时记录对象，禁用或销毁后返回 `null`。供读取和可选浏览器桥接使用，不要修改它的数组。最多保留 500 条完成阶段和 100 条进行中阶段，截断计数随数据导出。名称唯一，父子和并行阶段不能相加当成总耗时。

`timings.dispose()` 幂等，只清理该实例的原生 measures 与记录；尚未结束的 finish 此后不会写回。它是终止操作，需要重新启用时创建新实例。单纯让 `enabled()` 返回 `false` 会阻止新阶段；此前已经开始的阶段仍可完成，若需中断和清空请调用 `dispose()`。宿主创建的全局桥接由宿主解除。

## CLI：不安装页面 SDK 也能开始

从复制后的工具所在项目运行；目标页面须已启动：

```sh
export PERF_CHROME='/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
export PERF_DRIVER='/absolute/path/to/matching/chromedriver'

# 默认仅等文档完成，采浏览器层信息。
node tools/scene-perf/cli/run.mjs \
  --url http://127.0.0.1:5173/ --flow load \
  --iterations 1 --out outputs/performance/browser-first

# 同会话首访／复访，不查询 CDN 后台。
node tools/scene-perf/cli/run.mjs \
  --url http://127.0.0.1:5173/ --flow cache \
  --iterations 1 --out outputs/performance/browser-cache
```

默认 `instrumentation off`，移除工具管理的 `perf` 参数；已有原生 User Timing 仍可被观察。browser 适配器只认 `document.readyState === 'complete'`，不能将它命名为「3D 已就绪」。缺少实际画布、GPU、画质和业务状态时仍会出报告，但无法确认优化收益。

要等待真正 3D 就绪，可复制 `examples/three-adapter.cjs` 并在宿主入口提供：

```js
window.__SCENE_PERF__ = {
  ready: false,
  diagnostics: null,
  businessPhases: timings.read(), // 可选，启用 recorder 时为 live store
  state: { scene: null, camera: null, animation: null, soundEnabled: null },
};
// 在现有业务中更新真实状态、renderer 诊断和 ready。
// 卸载时解除这个宿主创建的桥接；不要在入口末尾假设 ready=true。
```

```sh
node tools/scene-perf/cli/run.mjs \
  --url http://127.0.0.1:5173/ \
  --adapter tools/scene-perf/examples/three-adapter.cjs \
  --flow load --mode baseline --iterations 3 \
  --instrumentation on \
  --instrumentation-source src/performance/timings.ts \
  --instrumentation-source tools/scene-perf/core/timings.ts \
  --out outputs/performance/project-before
```

开启业务记录时，用可重复的 `--instrumentation-source` 列出真正的计时实现及项目配置，不只列重导出的薄文件。manifest 保存来源文件与内容指纹；比较不依赖它们的绝对路径。有记录但缺来源依据时不确认可比收益。工具改变后应重新建基线，不把不同采集开销算作产品收益。

适配器的 `isReady`、`readDiagnostics`、`readBusinessPhases`、`readState` 会序列化到浏览器执行，必须是独立同步 `function`，不能引用 Node 模块或外层闭包。状态字段、画布尺寸、DPR、GPU、画质等必须真实；缺失不是零。只有 `nullableStateFields` 明确声明的状态字段才能把 `null` 作为已知业务状态（如设置面板已关闭）；其余字段的 `null` 表示未知，`undefined` 始终表示缺失。Three.js 的 `renderer.info` 默认按 render 重置，多 pass 项目需说明是最后一次 pass 还是整帧计数。

交互流程用 `--flow custom --scenario /path/to/project-flow.cjs`，从自己的真实按钮开始，不直接改内部状态伪造路径。流程通过 `cli/scene-helpers.cjs` 的 `createCollector()` 生成统一数据，必须 `try/finally` 调用其 `dispose()`，并声明 `module.exports.expectedScenes`。参考同目录的 `load-journey.cjs`、`cache-journey.cjs`。未显式指定 flow 时，`--scenario` 自动选 custom；custom 不生成 HAR，保留 CDP 缓存证据。竹屋的 journey/system/views 位于宿主 `scripts/perf/`，不是通用默认流程。

采集结果包括 `report.html`、`report.md`、`summary.json`、`manifest.json` 与 `sitespeed/` 原始数据。优化后用相同参数、一个新输出目录并添加 `--compare outputs/performance/project-before`。已有数据可独立重生成：

```sh
node tools/scene-perf/cli/report.mjs outputs/performance/project-after \
  --compare outputs/performance/project-before
```

## 拆卸边界

1. **暂停观察**：collector.pause，或面板「暂停实时采样」；保留证据，业务 recorder 独立运行。
2. **移除实时工具**：卸载 hook 所在组件，或将 enabled 设为 false；普通 JS 调用 collector.dispose，并清理宿主自己的订阅和定时器。
3. **移除业务记录**：停止创建 recorder，或 dispose 并解除宿主全局桥接；可暂时保留禁用的计时调用。业务函数不会因禁用而跳过。
4. **完全删除源码**：移除 hook/import、宿主 adapter、业务计时调用、CLI npm scripts，再删除工具目录。对于竹屋，业务入口集中引用 `src/lib/performance.ts`，先搜索其调用点；不要直接删掉场景既有的 `__BAMBOO__`，它还承载原有诊断和业务更新。

只关闭面板不会撤销业务埋点，删除工具目录而不清理 imports 也不会自动编译成功。这些边界是显式的，便于按需只留下 CLI、只留下 recorder，或全部移除。

React 的 setup/cleanup 对称原则见 [useEffect 官方说明](https://react.dev/reference/react/useEffect)；观察器释放使用 [PerformanceObserver.disconnect](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver/disconnect)。本工具的复制与接入边界以实际导入关系为准，尚未在第二个完整生产 3D 项目验证全部交互路径。

## 当前验证范围

2026-09-22 在 Chrome Canary 156.0.8066.0、生产构建中验证了竹屋的加载、望月／听风与开声、暂停／清空／继续、导出及普通页面不载入面板。另将工具复制到一个独立的最小 Three.js 立方体页面，验证宿主开关启停、适配器替换、主动制造停顿后的记录、读取异常恢复和多次卸载；最终四个 collector 均为 stopped，场景渲染继续。该验证说明基础复制与生命周期可用，不代表已验证另一个完整生产项目的全部交互。

临时页面、采集 JSON 和截图保留在本仓库忽略的 `outputs/performance/portable-fixture*`；没有新增测试用例。完整项目接入仍需核对自己的就绪条件、渲染计数口径、真实交互流程和比较条件。
