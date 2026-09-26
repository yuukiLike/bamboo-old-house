/* No application integration. DOM readiness never implies 3D readiness. */
function readDiagnostics() {
  return null;
}

function readBusinessPhases() {
  return null;
}

function readState() {
  return { scene: null };
}

function isReady() {
  return document.readyState === 'complete';
}

module.exports = {
  version: 1,
  id: 'browser',
  readDiagnostics,
  readBusinessPhases,
  readState,
  isReady,
  readyDescription: '文档 load 完成（document.readyState === complete）；不代表 3D 场景就绪；随后进行固定时长观察。',
  frameCapacity: null,
  frameLimitation: 'No application frames, renderer metrics, scene state or 3D readiness are available. Browser RAF and resource timing are observed independently. Scene comparison stays ineligible until an application adapter supplies the required conditions.',
  stateFields: ['scene'],
  optionalStateFields: [],
};
