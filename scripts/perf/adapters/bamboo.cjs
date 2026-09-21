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
  frameLimitation: 'With perf=1, successful view.reveal business measures record the actual transition completion; they do not change this polling condition. App frames omit its first 30 frames; diagnostics refresh every 15 frames.',
  stateFields: ['view', 'place', 'timeOfDay', 'soundEnabled', 'soundBusy', 'soundError', 'paused', 'panorama', 'settingsPanel', 'weather.preset'],
  optionalStateFields: ['volume', 'weatherBusy', 'weatherError'],
};
