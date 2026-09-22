/* Same URL, same browser session: first visit then a normal cache-enabled revisit. */
// oxlint-disable-next-line typescript/no-require-imports -- Browsertime scenarios are CommonJS.
const { createCollector } = require('./scene-helpers.cjs');

module.exports = async function (context, commands) {
  const collector = await createCollector(context, commands);
  try {
    await collector.initial('initial-3d', {
      label: '新浏览器首次访问', cacheVisit: 'first',
      cacheCondition: 'New ChromeDriver session and temporary profile; browser cache enabled; no target warmup.',
    });
    await collector.initial('cache-revisit', {
      label: '同会话再次访问（允许缓存）', cacheVisit: 'revisit',
      cacheCondition: 'Normal navigation to the same URL in the same browser session; cache retained, without bypass or forced refresh. Cache reuse depends on response policy.',
    });
  } finally {
    collector.dispose();
  }
};

module.exports.expectedScenes = ['initial-3d', 'cache-revisit'];
