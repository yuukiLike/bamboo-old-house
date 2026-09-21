/* Example only: no second application has been validated with this contract.
 * The application owns when ready becomes true. Missing state stays unknown. */

function readDiagnostics() {
  return window.__SCENE_PERF__?.diagnostics ?? null;
}

function readBusinessPhases() {
  return window.__SCENE_PERF__?.businessPhases ?? null;
}

function readState() {
  const state = window.__SCENE_PERF__?.state;
  return {
    scene: state?.scene ?? null,
    camera: state?.camera ?? null,
    animation: state?.animation ?? null,
    soundEnabled: state?.soundEnabled ?? null,
  };
}

function isReady() {
  return window.__SCENE_PERF__?.ready === true;
}

module.exports = {
  version: 1,
  id: 'three-example',
  readDiagnostics,
  readBusinessPhases,
  readState,
  isReady,
  readyDescription: 'Application-owned window.__SCENE_PERF__.ready is explicitly true; then fixed observation',
  frameCapacity: null,
  frameLimitation: 'This example does not supply application frame history. Application frame metrics are unavailable; the independent browser RAF probe may still provide frame intervals.',
  stateFields: ['scene', 'camera', 'animation', 'soundEnabled'],
  optionalStateFields: [],
};
