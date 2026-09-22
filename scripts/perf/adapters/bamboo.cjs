/* Project-specific reads. Keep these four functions self-contained: the
 * collector serializes them and executes their source in the browser. */

function readDiagnostics() {
  if (!window.__BAMBOO__) throw new Error('3D diagnostics disappeared during collection');
  return window.__BAMBOO__;
}

function readBusinessPhases() {
  return window.__BAMBOO_PERF__ ?? null;
}

function readState() {
  const d = window.__BAMBOO__;
  const root = document.querySelector('.experience');
  const sound = document.querySelector('.sound-toggle');
  const soundLabel = sound?.getAttribute('aria-label');
  const weatherPanel = document.querySelector('#weather-settings');
  const note = weatherPanel?.querySelector('.weather-listening-note')?.textContent || '';
  const volume = document.querySelector('#ambience-volume');
  const booleanAttribute = (element, name) => element?.hasAttribute(name) ? element.getAttribute(name) === 'true' : null;
  return {
    view: d?.viewMode ?? null, place: d?.place ?? null,
    timeOfDay: d?.timeOfDay ?? root?.getAttribute('data-time') ?? null,
    paused: d?.paused ?? null, panorama: d?.panorama ?? null,
    soundEnabled: booleanAttribute(sound, 'aria-pressed'),
    soundBusy: sound ? soundLabel === '取消载入自然声' : null,
    soundError: sound ? soundLabel === '重试环境声音' || note.includes('声音暂未载入') : null,
    weatherBusy: weatherPanel ? note.includes('自然声正在靠近') : null,
    weatherError: weatherPanel ? note.includes('雨声暂未载入') :
      document.querySelector('.weather-message') ? true : null,
    settingsPanel: weatherPanel ? 'weather' : document.querySelector('#sound-settings') ? 'sound' : null,
    volume: volume ? Number(volume.value) : null,
    weather: { ...d?.weather, preset: document.querySelector('.weather-toggle span')?.textContent ?? null },
  };
}

function isReady() {
  if (document.querySelector('.experience.is-static')) {
    throw new Error('Page entered static fallback; 3D capture is unavailable');
  }
  const mount = document.querySelector('.scene-mount.ready');
  const control = document.querySelector('.free-toggle');
  return Number(window.__BAMBOO__?.startupMs) > 0 && !!mount &&
    Number(getComputedStyle(mount).opacity) >= 0.999 &&
    !!control && !control.disabled;
}

module.exports = {
  version: 1,
  id: 'bamboo',
  readDiagnostics,
  readBusinessPhases,
  readState,
  isReady,
  readyDescription: 'startupMs > 0, .scene-mount.ready opacity >= 0.999, free-view control enabled; then fixed observation',
  frameCapacity: 15000,
  frameLimitation: 'startup 从 createScene 开始，不含先前导航与动态模块导入；应用帧跳过最初 30 帧，末端 renderer 计数约每 15 帧刷新。perf=1 下成功的 view.reveal 记录实际切换结束，不改变轮询就绪条件。',
  phaseLimitation: 'view.capture 包含等候场景帧，view.reveal 包含等候目标帧和淡入；view.request-to-commit 的结束是状态请求与场景设置完成，startup.controls-ready 才确认 React 提交后控件就绪。',
  measurePrefix: 'bamboo:',
  stateFields: ['view', 'place', 'timeOfDay', 'soundEnabled', 'soundBusy', 'soundError', 'paused', 'panorama', 'settingsPanel', 'weather.preset'],
  optionalStateFields: ['volume', 'weatherBusy', 'weatherError'],
  nullableStateFields: ['settingsPanel'],
};
