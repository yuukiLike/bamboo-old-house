/* A bounded system journey, not a Cartesian product of every control state.
 * Clicks and keyboard input use WebDriver; browser JavaScript only reads state.
 */
// oxlint-disable-next-line typescript/no-require-imports -- Browsertime loads navigation scripts as CommonJS.
const { createCollector, TIMEOUT_MS, SETTLE_MS } = require('../../tools/scene-perf/cli/scene-helpers.cjs');

const expectedScenes = [
  'initial-3d', 'sound-first-on', 'sound-off', 'sound-repeat-on',
  'volume-panel-first', 'volume-panel-repeat-adjust', 'weather-panel-first',
  'weather-panel-repeat-drizzle', 'weather-storm', 'weather-wind', 'weather-clear',
  'night-first', 'day-return', 'night-repeat', 'daylight-dawn', 'daylight-noon', 'daylight-dusk',
  'view-moon', 'view-breeze-auto-audio', 'view-well-auto-audio', 'view-porch', 'view-walk',
  'chapter-last', 'chapter-home', 'view-free',
  'place-yard-edge', 'place-upstairs', 'place-store', 'place-room-one', 'place-room-two',
  'place-hall', 'place-kitchen', 'place-courtyard',
  'panorama-off', 'panorama-on', 'panorama-reset', 'motion-pause', 'motion-resume',
];

module.exports = async function (context, commands) {
  const collector = await createCollector(context, commands);
  try {
    const { boundary, state, finish, observationMs } = collector;
    const preparations = [];
    const soundReady = enabled => `document.querySelector('.sound-toggle')?.getAttribute('aria-pressed') === '${enabled}' && document.querySelector('.sound-toggle')?.getAttribute('aria-label') === '${enabled ? '关闭环境声音' : '开启环境声音'}'`;
    const viewReady = (view, place) => `window.__BAMBOO__?.viewMode === ${JSON.stringify(view)} && document.querySelector('.experience.is-${view}') ${place ? `&& window.__BAMBOO__?.place === ${JSON.stringify(place)}` : ''}`;

    async function waitFor(condition) {
      await commands.wait.byCondition(`(() => {
        if (document.querySelector('.experience.is-static')) throw new Error('Page entered static fallback during system capture');
        if (document.querySelector('.sound-toggle')?.getAttribute('aria-label') === '重试环境声音' || document.querySelector('.weather-listening-note')?.textContent.includes('暂未载入') || document.querySelector('.weather-message')) throw new Error('Audio preparation failed; refusing to measure an unavailable sound path');
        return Boolean(${condition});
      })()`, TIMEOUT_MS);
    }

    async function click(selector) {
      await commands.wait.bySelectorAndVisible(selector, TIMEOUT_MS);
      await commands.click.bySelector(selector);
    }

    async function clickText(xpath) {
      await commands.wait.byXpathAndVisible(xpath, TIMEOUT_MS);
      await commands.click.byXpath(xpath);
    }

    async function stage(alias, label, action, condition, rule, options = {}) {
      console.log(`[scene-perf] ${alias}: ${label}`);
      await commands.measure.start(alias);
      const start = await boundary();
      try {
        await action();
        await waitFor(condition);
      } catch (error) {
        // Persist evidence before Browsertime tears down the failed browser.
        try {
          const observed = JSON.parse(await commands.js.run(`return JSON.stringify({
            view: window.__BAMBOO__?.viewMode, place: window.__BAMBOO__?.place,
            timeOfDay: window.__BAMBOO__?.timeOfDay,
            trigger: document.querySelector('.room-selector')?.outerHTML,
            options: Array.from(document.querySelectorAll('[role="option"]')).map(element => ({
              text: element.textContent, selected: element.getAttribute('aria-selected'),
              visible: element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
            })),
            listboxes: Array.from(document.querySelectorAll('[role="listbox"]')).map(element => ({
              tag: element.tagName, id: element.id, attributes: Array.from(element.attributes).map(a => [a.name, a.value]),
              display: getComputedStyle(element).display, visibility: getComputedStyle(element).visibility,
              rect: element.getBoundingClientRect().toJSON()
            }))
          });`));
          const failure = { alias, condition, error: error.message, state: await state(), observed };
          await context.storageManager.writeJson(`failure-${context.index}-${alias}.json`, failure, false);
          console.error(`[scene-perf] ${alias} failed; observed=${JSON.stringify(observed)}`);
        } catch (captureError) {
          console.error(`[scene-perf] could not save failure state: ${captureError.message}`);
        }
        throw error;
      }
      const conditionObserved = await boundary();
      await commands.wait.byTime(options.settleMs ?? SETTLE_MS);
      const stable = await boundary();
      await commands.wait.byTime(observationMs);
      await finish(alias, start, conditionObserved, stable, rule, {
        label, workload: options.workload || 'render-and-ui',
        preparations: preparations.splice(0),
        readinessNote: 'UI / diagnostics readiness plus a fixed observation window; not GPU completion. Audio readiness means the Web Audio API is ready, not first audible sound. Weather preset selection does not mean wet surfaces have finished interpolating.',
      });
    }

    async function prepare(label, action) {
      const startState = await state();
      const startedAt = Date.now();
      await action();
      preparations.push({ label, measured: false, elapsedMs: Date.now() - startedAt, startState, endState: await state() });
      console.log(`[scene-perf] preparation: ${label}`);
    }

    async function closePanel() {
      const current = await state();
      if (!current.settingsPanel) return;
      const selector = current.settingsPanel === 'sound'
        ? '[aria-label="收起声音设置"]' : '[aria-label="收起天气设置"]';
      await prepare('关闭设置面板', async () => {
        await click(selector);
        await waitFor("!document.querySelector('#sound-settings, #weather-settings')");
      });
    }

    async function silence() {
      const current = await state();
      if (!current.soundEnabled && !current.soundBusy) return;
      await prepare('真实按钮关闭声音并等待 1500ms，隔离音频淡出与延迟 suspend', async () => {
        await click('.sound-toggle');
        await waitFor(soundReady(false));
        await commands.wait.byTime(1500);
      });
    }

    await collector.initial();
    try {
      await stage('sound-first-on', '声音：首次开启', () => click('.sound-toggle'), soundReady(true),
        'sound button pressed=true and label=关闭环境声音; playback Promise committed', { workload: 'render-and-audio' });
      await stage('sound-off', '声音：关闭并等待延迟挂起', () => click('.sound-toggle'), soundReady(false),
        'sound button pressed=false and not busy; 1500ms settling covers the scheduled 1100ms suspend', { workload: 'render-and-audio', settleMs: 1500 });
      await stage('sound-repeat-on', '声音：再次开启', () => click('.sound-toggle'), soundReady(true),
        'sound button pressed=true and not busy; cached audio groups can be reused', { workload: 'render-and-audio' });

      const volumePanelReady = "!!document.querySelector('#sound-settings #ambience-volume')";
      await stage('volume-panel-first', '音量面板：首次打开', () => click('.sound-settings-toggle'), volumePanelReady,
        'sound-settings dialog and volume range mounted', { workload: 'render-ui-and-audio' });
      await closePanel();
      await stage('volume-panel-repeat-adjust', '音量面板：再次打开并调整', async () => {
        await click('.sound-settings-toggle');
        await waitFor(volumePanelReady);
        const { By, Key } = context.selenium.webdriver;
        const slider = await context.selenium.driver.findElement(By.css('#ambience-volume'));
        await slider.sendKeys(Key.ARROW_RIGHT);
      }, "Number(document.querySelector('#ambience-volume')?.value) === 56",
      'volume panel reopened and native ArrowRight input changes default volume 55 to 56', { workload: 'render-ui-and-audio' });
      await closePanel();

      const weatherPanelReady = "!!document.querySelector('#weather-settings .weather-presets')";
      const weatherReady = label => `Array.from(document.querySelectorAll('.weather-presets button')).some(button => button.textContent.trim() === ${JSON.stringify(label)} && button.getAttribute('aria-pressed') === 'true') && !document.querySelector('.weather-listening-note')?.textContent.includes('自然声正在靠近')`;
      const weatherClick = label => clickText(`//fieldset[contains(@class,'weather-presets')]//button[normalize-space(.)='${label}']`);
      await stage('weather-panel-first', '天气面板：首次打开', () => click('.weather-toggle'), weatherPanelReady,
        'weather-settings dialog mounted', { workload: 'render-ui-and-audio' });
      await closePanel();
      await stage('weather-panel-repeat-drizzle', '天气面板：再次打开并切换细雨', async () => {
        await click('.weather-toggle');
        await waitFor(weatherPanelReady);
        await weatherClick('细雨');
      }, weatherReady('细雨'), 'drizzle preset selected; visible weather audio busy indicator cleared', { workload: 'render-ui-and-audio' });
      await stage('weather-storm', '天气：切换暴雨', () => weatherClick('暴雨'), weatherReady('暴雨'),
        'storm preset selected; visible weather audio busy indicator cleared', { workload: 'render-and-audio' });
      await stage('weather-wind', '天气：切换大风', () => weatherClick('大风'), weatherReady('大风'),
        'wind preset selected; visible weather audio busy indicator cleared', { workload: 'render-and-audio' });
      await stage('weather-clear', '天气：恢复晴风', () => weatherClick('晴风'), weatherReady('晴风'),
        'clear preset selected; visible weather audio busy indicator cleared', { workload: 'render-and-audio' });
      await closePanel();
      await silence();

      for (const [alias, label, time, mix] of [
        ['night-first', '首次夜晚', 'night', 'nightMix'], ['day-return', '返回白天', 'day', null],
        ['night-repeat', '再次夜晚', 'night', 'nightMix'], ['daylight-dawn', '切换清晨', 'dawn', 'dawnMix'],
        ['daylight-noon', '切换正午', 'noon', 'noonMix'], ['daylight-dusk', '切换傍晚', 'dusk', 'duskMix'],
      ]) {
        const buttonLabel = { night: '夜晚', day: '白天', dawn: '清晨', noon: '正午', dusk: '傍晚' }[time];
        const mixed = mix ? `window.__BAMBOO__?.${mix} >= 0.99` : "['nightMix','dawnMix','noonMix','duskMix'].every(key => window.__BAMBOO__?.[key] <= 0.01)";
        await stage(alias, `日照：${label}`, () => click(`.day-switch button[aria-label="${buttonLabel}"]`),
          `window.__BAMBOO__?.timeOfDay === '${time}' && ${mixed}`,
          `diagnostics timeOfDay=${time}; daylight blend within 1% of target`);
      }

      await stage('view-moon', '观看方式：竹林望月', () => click('.moon-toggle'), viewReady('moon'),
        'diagnostics viewMode=moon and moon page mounted; view.reveal measures remain separate evidence');
      await stage('view-breeze-auto-audio', '观看方式：林间的风（自动开启声音）', () => click('.breeze-toggle'),
        `${viewReady('breeze')} && ${soundReady(true)}`, 'breeze view committed and automatic audio enable finished', { workload: 'render-and-auto-audio' });
      await silence();
      await stage('view-well-auto-audio', '观看方式：井旁听雨（自动开启声音）', () => click('.well-toggle'),
        `${viewReady('well-rain')} && ${soundReady(true)}`, 'well-rain view committed and automatic audio enable finished', { workload: 'render-and-auto-audio' });
      await silence();
      await stage('view-porch', '观看方式：廊下望竹', () => clickText("//*[contains(@class,'view-switch')]//button[normalize-space(.)='廊下望竹']"),
        viewReady('porch'), 'diagnostics viewMode=porch and porch page mounted');
      await stage('view-walk', '观看方式：沿路走走', () => clickText("//*[contains(@class,'view-switch')]//button[normalize-space(.)='沿路走走']"),
        viewReady('walk'), 'diagnostics viewMode=walk and narrative page mounted');
      await stage('chapter-last', '探索章节：前往回望', () => click('.exploration-nav a[href="#return"]'),
        `${viewReady('walk')} && document.querySelector('.exploration-nav a[href="#return"]')?.getAttribute('aria-current') === 'step' && window.__BAMBOO__?.progress >= 0.99`,
        'last chapter selected and renderer scroll progress >= 0.99');
      await stage('chapter-home', '探索章节：回到竹林', () => click('#return .return-button'),
        `${viewReady('walk')} && document.querySelector('.exploration-nav a[href="#bamboo"]')?.getAttribute('aria-current') === 'step' && window.__BAMBOO__?.progress <= 0.01`,
        'return button used; first chapter selected and renderer scroll progress <= 0.01');
      await stage('view-free', '观看方式：自由看看', () => click('.free-toggle'), viewReady('free'),
        'diagnostics viewMode=free and free-view panel mounted');

      for (const [place, label] of [
        ['yard-edge', '院边竹荫'], ['upstairs', '二层厅堂'], ['store', '仓库'], ['room-one', '住屋一'],
        ['room-two', '住屋二'], ['hall', '一楼堂屋'], ['kitchen', '一楼厨房'], ['courtyard', '屋前空地'],
      ]) {
        await stage(`place-${place}`, `停留位置：${label}`, async () => {
          await click('.room-selector');
          await clickText(`//*[@role='option' and normalize-space(.)='${label}']`);
        }, `${viewReady('free', place)} && document.querySelector('.room-selector')?.getAttribute('aria-expanded') === 'false'`,
        `real location selector; diagnostics free/${place}; room combobox aria-expanded=false`);
      }

      for (const enabled of [false, true]) {
        await stage(enabled ? 'panorama-on' : 'panorama-off', enabled ? '环顾：开启' : '环顾：退出',
          () => click('.panorama-toggle'), `window.__BAMBOO__?.panorama === ${enabled}`,
          `diagnostics panorama=${enabled}`);
      }
      await prepare('真实鼠标拖动画布，确保复位不是空操作', async () => {
        const canvas = await context.selenium.driver.findElement(context.selenium.webdriver.By.css('.scene-mount canvas'));
        await context.selenium.driver.actions({ async: true })
          .move({ origin: canvas, x: 0, y: 0 }).press()
          .move({ origin: canvas, x: 65, y: 30, duration: 350 }).release().perform();
        await waitFor('Math.abs(window.__BAMBOO__?.yaw) >= 0.1 && Math.abs(window.__BAMBOO__?.pitch) >= 0.03');
      });
      await stage('panorama-reset', '环顾：复位视角', () => click('[aria-label="复位环顾视角"]'),
        'window.__BAMBOO__?.panorama === true && Math.abs(window.__BAMBOO__?.yaw) <= 0.001 && Math.abs(window.__BAMBOO__?.pitch) <= 0.001',
        'native reset button clicked after a real drag; diagnostics yaw and pitch return to zero');
      await stage('motion-pause', '动态：静止观看', () => click('[aria-label="静止观看"]'),
        'window.__BAMBOO__?.paused === true', 'diagnostics paused=true; the animation loop still renders');
      await stage('motion-resume', '动态：让风继续', () => click('[aria-label="让风继续"]'),
        'window.__BAMBOO__?.paused === false', 'diagnostics paused=false');
    } finally {
      // Also run after a failed stage; cleanup errors must not mask that failure.
      try { await silence(); } catch (error) { console.error(`[scene-perf] sound cleanup failed: ${error.message}`); }
    }
  } finally {
    collector.dispose();
  }
};

module.exports.expectedScenes = expectedScenes;
