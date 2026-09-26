/** Bamboo-specific readers and wording. The portable toolkit never imports this file. */
import type { PerformanceAdapter } from '../../tools/scene-perf/react/types';
import type { RendererSnapshot, RuntimeCollector, RuntimeState } from '../../tools/scene-perf/core/runtime';
import type { ActivePhase, Phase } from '../../tools/scene-perf/core/timings';
import { bambooTimings } from '../lib/performance';

declare global { interface Window { __BAMBOO_RUNTIME__?: RuntimeCollector; } }

const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

const phaseLabels: Record<string, string> = {
 'startup.experience': '进入 3D 体验', 'startup.scene-import': '加载 3D 模块',
 'startup.create-scene': '创建场景', 'startup.controls-ready': '控件已就绪',
 'startup.webgl-renderer': '创建 WebGL 渲染器', 'startup.prewarm': '准备首次渲染',
 'startup.shader-compile': '编译场景着色器', 'startup.scene-warmup-submit': '场景预热提交',
 'startup.interior-warmup-submit': '室内预热提交', 'startup.initial-frame-submit': '首帧渲染提交',
 'model.download': '下载模型', 'model.buffer-assembly': '拼接模型缓冲', 'model.parse': '解析模型与纹理',
 'scene.environment-build': '生成环境', 'scene.house-surfaces': '整理房屋表面',
 'scene.house-and-vegetation-build': '装配老屋与竹林', 'scene.forest-floor-build': '构建林下地表',
 'scene.weather-build': '构建风雨与雨水遮挡', 'scene.falling-leaves-build': '构建落叶',
 'scene.render-setup': '准备场景渲染', 'interior.pipeline-build': '创建室内后处理',
 'interior.render-targets-prepare': '准备室内渲染目标', 'interior.shader-compile': '编译室内着色器',
 'interior.contact-warmup-submit': '接触阴影预热提交', 'interior.first-frame-submit': '室内首次渲染提交',
 'view.snapshot-allocation': '分配转场快照', 'view.snapshot-prepare': '准备转场效果',
 'view.snapshot-shader-compile': '编译转场着色器', 'view.snapshot-warmup-submit': '转场预热提交',
 'view.request-to-commit': '提交视图切换', 'view.capture': '捕获上一视图',
 'view.target-frame-submitted': '目标视图已提交', 'view.reveal': '展示目标视图',
 'audio.download': '下载录音', 'audio.decode': '解码录音', 'audio.group-ready': '连接音频节点',
 'audio.context-create': '创建音频上下文', 'audio.resume': '恢复音频上下文',
 'audio.enable': '准备开启声音', 'audio.disable': '安排声音淡出', 'audio.weather-ready': '准备天气声音',
};
const VIEW_LABELS: Record<string, string> = {
 moon: '竹林望月', breeze: '林间的风', well: '井边', 'well-rain': '井旁听雨', porch: '木廊',
 walk: '步行', free: '自由看看', outdoor: '院坝', interior: '楼上',
 courtyard: '屋前空地', 'yard-edge': '院边竹荫', upstairs: '二层厅堂', store: '仓库',
 'room-one': '住屋一', 'room-two': '住屋二', hall: '一楼堂屋', kitchen: '一楼厨房',
};

function readState(): RuntimeState {
 const scene = window.__BAMBOO__;
 const root = document.querySelector('.experience');
 const classes = root?.classList;
 const view = classes ? [...classes].find(name => name.startsWith('is-') && !['is-static', 'is-listening', 'is-panorama'].includes(name))?.slice(3) : undefined;
 const sound = document.querySelector('.sound-toggle');
 const pause = document.querySelector('.control-button[aria-label="静止观看"], .control-button[aria-label="让风继续"], .control-button[aria-label="已减少动态"]');
 return {
  // DOM state reflects the user's requested view sooner than the renderer's
  // diagnostic snapshot, which refreshes only every 15 application frames.
  view: view ?? scene?.viewMode ?? null,
  place: scene?.place ?? null,
  timeOfDay: root?.getAttribute('data-time') ?? scene?.timeOfDay ?? null,
  weatherPreset: document.querySelector('.weather-toggle span')?.textContent?.trim() || null,
  resolution: root?.getAttribute('data-resolution') ?? scene?.renderSettings?.resolution ?? null,
  shadows: root?.getAttribute('data-shadows') ?? scene?.renderSettings?.shadows ?? null,
  soundEnabled: sound?.hasAttribute('aria-pressed') ? sound.getAttribute('aria-pressed') === 'true' : null,
  paused: pause?.hasAttribute('aria-pressed') ? pause.getAttribute('aria-pressed') === 'true' : scene?.paused ?? null,
  panorama: root ? classes?.contains('is-panorama') ?? null : scene?.panorama ?? null,
 };
}

function readRenderer(): RendererSnapshot | null {
 const scene = window.__BAMBOO__;
 if (!scene) return null;
 return {
  drawCalls: numberOrNull(scene.drawCalls), triangles: numberOrNull(scene.triangles),
  textures: numberOrNull(scene.textures), geometries: numberOrNull(scene.geometries),
  pixelRatio: numberOrNull(scene.pixelRatio), drawSize: [...scene.drawSize],
  quality: scene.quality ? `${scene.quality}/${scene.renderSettings?.resolution??'full'}/${scene.renderSettings?.shadows??'full'}` : null, gpu: scene.gpu || null,
 };
}

function filename(value: string) {
 try { return decodeURIComponent(new URL(value, location.href).pathname.split('/').filter(Boolean).at(-1) ?? value); }
 catch { return value; }
}
function detail(phase: ActivePhase | Phase) {
 const fields = phase.detail;
 return [fields.model || fields.file, fields.view, fields.place, fields.group, fields.nightMix === undefined ? undefined : `nightMix=${fields.nightMix}`]
  .filter(value => value !== undefined && value !== '').map(value => String(value).includes('/') ? filename(String(value)) : String(value)).join(' · ');
}
function stateDescription(state: RuntimeState) {
 const view = state.view ? VIEW_LABELS[String(state.view)] ?? state.view : '视图未知';
 const place = state.place ? VIEW_LABELS[String(state.place)] ?? state.place : '位置未知';
 const sound = state.soundEnabled === true ? '声音开' : state.soundEnabled === false ? '声音关' : '声音未知';
 return [view, place !== view ? place : null, sound, state.weatherPreset ?? '天气未知',
  state.resolution==='reduced'?'画面稍柔和':state.resolution==='full'?'完整清晰':null,
  state.shadows==='alternate'?'阴影隔帧':state.shadows==='full'?'阴影每帧':null,
  state.paused ? '动态暂停' : null].filter(Boolean).join(' · ');
}

export const bambooPerformanceAdapter: PerformanceAdapter = {
 id: 'bamboo',
 readState,
 readRenderer,
 readBusinessPhases: () => bambooTimings.read(),
 phaseLabels,
 startupPhase: 'startup.experience',
 readyLabel: '首屏控件已就绪',
 formatPhaseDetail: detail,
 describeState: stateDescription,
 rendererDescription: '来自应用已有诊断，每 15 个应用帧更新。纹理与几何体是数量，不是显存字节。',
 onCollector(collector) {
  // Compatibility for local inspection; ownership and disposal stay in the panel.
  window.__BAMBOO_RUNTIME__ = collector;
  return () => { if (window.__BAMBOO_RUNTIME__ === collector) delete window.__BAMBOO_RUNTIME__; };
 },
};
