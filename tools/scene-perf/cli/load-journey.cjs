/* Generic navigation: the adapter defines readiness, then a fixed observation. */
// oxlint-disable-next-line typescript/no-require-imports -- Browsertime scenarios are CommonJS.
const { createCollector } = require('./scene-helpers.cjs');

module.exports = async function (context, commands) {
  const collector = await createCollector(context, commands);
  try {
    await collector.initial();
  } finally {
    collector.dispose();
  }
};

module.exports.expectedScenes = ['initial-3d'];
