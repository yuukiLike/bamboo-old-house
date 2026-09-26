/* Focused real-button moon <-> breeze capture. The first breeze action enables
 * audio; later transitions intentionally preserve it to expose the difference.
 */
// oxlint-disable-next-line typescript/no-require-imports -- Browsertime loads navigation scripts as CommonJS.
const { createCollector, TIMEOUT_MS, SETTLE_MS } = require('../../tools/scene-perf/cli/scene-helpers.cjs');

const expectedScenes = [
  'initial-3d', 'moon-first', 'breeze-first-auto-audio',
  'moon-return-with-audio', 'breeze-repeat-with-audio',
];

module.exports = async function (context, commands) {
  const collector = await createCollector(context, commands);
  try {
    const { boundary, state, finish, initial, observationMs } = collector;
    await initial();
    let cleanupError;
    try {
      const initialState = await state();
      if (initialState.soundEnabled !== false || initialState.soundBusy !== false) {
        throw new Error(`Focused views capture requires initially silent audio; observed ${JSON.stringify(initialState)}`);
      }
      for (const [alias, label, view, enabled, workload] of [
        ['moon-first', '首次竹林望月（声音关闭）', 'moon', false, 'render-and-ui'],
        ['breeze-first-auto-audio', '首次林间的风（按钮自动开启声音）', 'breeze', true, 'render-and-auto-audio'],
        ['moon-return-with-audio', '返回竹林望月（保持声音开启）', 'moon', true, 'render-with-active-audio'],
        ['breeze-repeat-with-audio', '再次林间的风（保持声音开启）', 'breeze', true, 'render-with-active-audio'],
      ]) {
        const selector = view === 'moon' ? '.moon-toggle' : '.breeze-toggle';
        const time = view === 'moon' ? 'night' : 'day';
        const soundLabel = enabled ? '关闭环境声音' : '开启环境声音';
        await commands.wait.bySelectorAndVisible(selector, TIMEOUT_MS);
        console.log(`[scene-perf] ${alias}: ${label}`);
        await commands.measure.start(alias);
        const start = await boundary();
        await commands.click.bySelector(selector);
        await commands.wait.byCondition(`(() => {
          if (document.querySelector('.experience.is-static')) throw new Error('Static fallback during moon/breeze capture');
          const sound = document.querySelector('.sound-toggle');
          if (sound?.getAttribute('aria-label') === '重试环境声音' || document.querySelector('.weather-message')) {
            throw new Error('Audio preparation failed during moon/breeze capture');
          }
          return window.__BAMBOO__?.viewMode === '${view}' && window.__BAMBOO__?.timeOfDay === '${time}' &&
            !!document.querySelector('.experience.is-${view}') &&
            sound?.getAttribute('aria-pressed') === '${enabled}' && sound?.getAttribute('aria-label') === '${soundLabel}';
        })()`, TIMEOUT_MS);
        const conditionObserved = await boundary();
        await commands.wait.byTime(SETTLE_MS);
        const stable = await boundary();
        await commands.wait.byTime(observationMs);
        await finish(alias, start, conditionObserved, stable,
          `diagnostics view=${view}, timeOfDay=${time}, matching view DOM, sound pressed=${enabled} and not busy; ${SETTLE_MS}ms settling then fixed observation`, {
            label, workload,
            readinessNote: 'Polling approximates view readiness. view.reveal and other business phases are retained separately for overlap analysis. Audio API readiness is not first audible sound. Daylight and weather may continue interpolating within the observation window.',
          });
      }
    } catch (error) {
      try {
        const observed = await state();
        await context.storageManager.writeJson(`failure-${context.index}-views.json`, { error: error.message, state: observed }, false);
        console.error(`[scene-perf] views capture failed; state=${JSON.stringify(observed)}`);
      } catch (captureError) {
        console.error(`[scene-perf] could not save failure state: ${captureError.message}`);
      }
      throw error;
    } finally {
      // Cleanup is outside measured windows and never silently changes a stage's
      // sound precondition. Keep its before/after evidence alongside raw scenes.
      try {
        const before = await state();
        if (before.soundEnabled || before.soundBusy) {
          await commands.click.bySelector('.sound-toggle');
          await commands.wait.byCondition("document.querySelector('.sound-toggle')?.getAttribute('aria-pressed') === 'false' && document.querySelector('.sound-toggle')?.getAttribute('aria-label') === '开启环境声音'", TIMEOUT_MS);
          await commands.wait.byTime(1500);
        }
        await context.storageManager.writeJson(`cleanup-${context.index}-views.json`, {
          measured: false, action: 'sound off via real UI, then 1500ms for delayed suspend',
          startState: before, endState: await state(),
        }, false);
      } catch (error) {
        cleanupError = error;
        console.error(`[scene-perf] sound cleanup failed: ${error.message}`);
      }
    }
    // If collection threw, its error has already propagated through finally.
    // Otherwise a failed cleanup also makes the run incomplete.
    if (cleanupError) throw cleanupError;
  } finally {
    collector.dispose();
  }
};

module.exports.expectedScenes = expectedScenes;
