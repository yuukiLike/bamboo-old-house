/* Project-specific lazy-interior journey. Interactions use real browser controls. */
// oxlint-disable-next-line typescript/no-require-imports -- Browsertime loads navigation scripts as CommonJS.
const { createCollector, TIMEOUT_MS, SETTLE_MS } = require('../../tools/scene-perf/cli/scene-helpers.cjs');
const expectedScenes = ['initial-3d', 'free-outdoor', 'interior-first', 'outdoor-return', 'interior-repeat'];

module.exports = async function (context, commands) {
  const collector = await createCollector(context, commands);
  try {
    const { boundary, finish, initial, observationMs } = collector;
    await initial();

    async function enter(alias, selector, place) {
      console.log(`[scene-perf] ${alias}: click ${selector}, await free/${place}`);
      await commands.wait.bySelectorAndVisible(selector, TIMEOUT_MS);
      await commands.measure.start(alias);
      const start = await boundary();
      await commands.click.bySelector(selector);
      await commands.wait.byCondition(`(() => {
        const diagnostics = window.__BAMBOO__;
        if (document.querySelector('.experience.is-static')) {
          throw new Error('Page entered static fallback during a view change');
        }
        return diagnostics?.viewMode === 'free' && diagnostics?.place === ${JSON.stringify(place)} &&
          !!document.querySelector('.experience.is-free #free-viewpoints');
      })()`, TIMEOUT_MS);
      const conditionObserved = await boundary();
      // Keep the same polling/settling policy with business markers on and off.
      // Exact reveal measures are separate evidence, not this completion condition.
      await commands.wait.byTime(SETTLE_MS);
      const stable = await boundary();
      await commands.wait.byTime(observationMs);
      await finish(alias, start, conditionObserved, stable,
        `diagnostics free/${place} + free-view panel mounted; ${SETTLE_MS}ms settling allowance; then fixed observation`);
    }

    await enter('free-outdoor', '.free-toggle', 'courtyard');
    await enter('interior-first', '#free-viewpoints .floor-link', 'upstairs');
    await enter('outdoor-return', '#free-viewpoints .floor-link', 'courtyard');
    await enter('interior-repeat', '#free-viewpoints .floor-link', 'upstairs');
  } finally {
    collector.dispose();
  }
};

module.exports.expectedScenes = expectedScenes;
