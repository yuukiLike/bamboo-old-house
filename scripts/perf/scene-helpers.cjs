/* Shared raw capture for Browsertime scenarios; application reads live in adapters. */

// oxlint-disable-next-line typescript/no-require-imports -- Browsertime loads navigation helpers as CommonJS.
const path = require('node:path');

const TIMEOUT_MS = 120000;
const SETTLE_MS = 500;
const RAW_FRAME_LIMIT = 2000;

function frameSummary(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0 };
  const percentile = fraction => sorted[Math.ceil(sorted.length * fraction) - 1];
  return {
    count: sorted.length,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted.at(-1),
    over33msPercent: 100 * sorted.filter(value => value > 33.33).length / sorted.length,
  };
}

// Read functions remain in the browser: only their JSON results cross WebDriver.
function readBoundary(source, frameCapacity) {
  const frames = Number.isInteger(frameCapacity) && Array.isArray(source?.frames) ? source.frames : null;
  return {
    nowMs: performance.now(),
    frameIndex: frames ? frames.length : null,
    firstFrameMs: frames?.[0] ?? null,
  };
}

function readSnapshot(start, stable, source, business, frameCapacity) {
  const diagnostics = source ? Object.fromEntries(Object.entries(source)
    .filter(([key, value]) => key !== 'frames' && typeof value !== 'function')) : null;
  // A full/rolled application array cannot reliably identify a window by its
  // first duration. An absent frame contract stays unavailable, never zero ms.
  const frameDataAvailable = Number.isInteger(frameCapacity) && Array.isArray(source?.frames);
  const frameWindowValid = frameDataAvailable && source.frames.length < frameCapacity &&
    Number.isInteger(start.frameIndex) && Number.isInteger(stable.frameIndex) &&
    source.frames.length >= stable.frameIndex && source.frames.length >= start.frameIndex &&
    (start.frameIndex === 0 || source.frames[0] === start.firstFrameMs);
  const observedAtMs = performance.now();
  const inWindow = entry => entry.startTime + entry.duration >= start.nowMs && entry.startTime + entry.duration <= observedAtMs;
  const businessPhases = business ? {
    version: business.version, enabled: business.enabled, droppedPhases: business.droppedPhases,
    phases: business.phases.filter(inWindow),
  } : null;
  const nativeMeasures = performance.getEntriesByType('measure').filter(inWindow).slice(-4000).map(entry => entry.toJSON());
  // The bounded app records also work when native performance.measure fails.
  // Preserve native entry names so the reporter can deduplicate observer data.
  const fallbackMeasures = (businessPhases?.phases || []).map(entry => ({
    ...entry, name: entry.entryName || entry.name, entryType: 'measure',
  }));
  const measures = [...new Map([...nativeMeasures, ...fallbackMeasures]
    .map(entry => [`${entry.name}|${entry.startTime}|${entry.duration}`, entry])).values()];
  return {
    observedAtMs,
    timeOrigin: performance.timeOrigin,
    url: location.href,
    visibility: document.visibilityState,
    userAgent: navigator.userAgent,
    browserViewport: {
      width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio,
      outerWidth, outerHeight,
    },
    diagnostics,
    frameDataAvailable,
    frameWindowValid,
    frames: frameWindowValid ? source.frames.slice(start.frameIndex) : [],
    stableFrames: frameWindowValid ? source.frames.slice(stable.frameIndex) : [],
    navigation: performance.getEntriesByType('navigation').map(entry => entry.toJSON()),
    resources: performance.getEntriesByType('resource')
      .filter(entry => entry.startTime >= start.nowMs)
      .map(entry => entry.toJSON()),
    measures,
    businessPhases,
    probe: window.__PERF_CAPTURE__?.snapshot(start.nowMs, observedAtMs) ?? null,
    probeStable: window.__PERF_CAPTURE__?.snapshot(stable.nowMs, observedAtMs) ?? null,
  };
}

function loadAdapter(adapterPath = process.env.PERF_ADAPTER) {
  const resolved = adapterPath || path.join(__dirname, 'adapters/bamboo.cjs');
  if (!path.isAbsolute(resolved)) throw new Error('PERF_ADAPTER must be an absolute path to a CommonJS adapter');
  // oxlint-disable-next-line typescript/no-require-imports -- Adapters use the same CommonJS runtime as Browsertime scenarios.
  const definition = require(resolved);
  if (!definition || definition.version !== 1 || typeof definition.id !== 'string' || !definition.id.trim()) {
    throw new Error('Performance adapter requires version: 1 and a nonempty id');
  }
  for (const field of ['readyDescription', 'frameLimitation']) {
    if (typeof definition[field] !== 'string' || !definition[field].trim()) throw new Error(`Performance adapter requires ${field}`);
  }
  if (definition.frameCapacity !== null && (!Number.isInteger(definition.frameCapacity) || definition.frameCapacity <= 0)) {
    throw new Error('Performance adapter frameCapacity must be a positive integer, or null when application frames are unavailable');
  }
  for (const field of ['stateFields', 'optionalStateFields']) {
    if (!Array.isArray(definition[field]) || definition[field].some(value => typeof value !== 'string' || !/^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*$/.test(value))) {
      throw new Error(`Performance adapter ${field} must be an array of state field paths`);
    }
  }
  if (!definition.stateFields.length) throw new Error('Performance adapter must declare at least one required state field');
  const fields = [...definition.stateFields, ...definition.optionalStateFields];
  if (new Set(fields).size !== fields.length) throw new Error('Performance adapter state fields must be unique');
  const browser = {};
  for (const field of ['readDiagnostics', 'readBusinessPhases', 'readState', 'isReady']) {
    if (typeof definition[field] !== 'function') throw new Error(`Performance adapter requires ${field}()`);
    const source = Function.prototype.toString.call(definition[field]);
    // Method shorthand, async functions, generators and bound/native functions
    // cannot satisfy this synchronous, standalone browser expression contract.
    if (!/^function(?:\s+[\w$]+)?\s*\(/.test(source) || source.includes('[native code]')) {
      throw new Error(`Adapter ${field} must be a self-contained synchronous function declaration, not method shorthand or an async/bound function`);
    }
    browser[field] = source;
  }
  const metadata = Object.fromEntries(['version', 'id', 'readyDescription', 'frameCapacity', 'frameLimitation', 'stateFields', 'optionalStateFields'].map(field => [field, definition[field]]));
  return { path: resolved, definition, browser, metadata };
}

async function createCollector(context, commands) {
  const observationMs = Number(process.env.PERF_OBSERVE_MS || 5000);
  if (!Number.isFinite(observationMs) || observationMs < 1000 || observationMs > 30000) {
    throw new Error('PERF_OBSERVE_MS must be between 1000 and 30000');
  }
  const url = process.env.PERF_URL || 'http://127.0.0.1:4175/';
  const adapter = loadAdapter();
  const readDiagnostics = `(${adapter.browser.readDiagnostics})()`;
  const readBusinessPhases = `(${adapter.browser.readBusinessPhases})()`;
  const readState = `(${adapter.browser.readState})()`;
  const frameCapacity = JSON.stringify(adapter.metadata.frameCapacity);
  const capabilities = await context.selenium.driver.getCapabilities();
  const browser = {
    name: capabilities.get('browserName'),
    version: capabilities.get('browserVersion'),
    driverVersion: capabilities.get('chrome')?.chromedriverVersion ?? null,
    platform: capabilities.get('platformName'),
  };
  const boundary = async () => JSON.parse(await commands.js.run(`return JSON.stringify({...(${readBoundary.toString()})(${readDiagnostics}, ${frameCapacity}), state: ${readState}});`));
  const state = async () => JSON.parse(await commands.js.run(`return JSON.stringify(${readState});`));

  async function finish(alias, start, conditionObserved, stable, completionRule, details = {}) {
    // Cross the WebDriver boundary as JSON: native timing/detail objects can
    // share references, which some Chrome BiDi serializers cannot deserialize.
    const snapshot = JSON.parse(await commands.js.run(
      `const result = (${readSnapshot.toString()})(${JSON.stringify(start)}, ${JSON.stringify(stable)}, ${readDiagnostics}, ${readBusinessPhases}, ${frameCapacity}); result.endState = ${readState}; return JSON.stringify(result);`,
    ));
    const summary = {
      windowObservedMs: snapshot.observedAtMs - start.nowMs,
      conditionObservedMs: conditionObserved.nowMs - start.nowMs,
      stableObservedMs: snapshot.observedAtMs - stable.nowMs,
      startupMs: snapshot.diagnostics?.startupMs ?? null,
      frames: snapshot.frameWindowValid ? frameSummary(snapshot.frames) : { count: 0, available: false },
      stableFrames: snapshot.frameWindowValid ? frameSummary(snapshot.stableFrames) : { count: 0, available: false },
    };
    const raw = {
      alias,
      ...details,
      adapter: adapter.metadata,
      startState: start.state ?? null,
      iteration: context.index,
      browser,
      completionRule,
      limitation: `External polling approximates readiness and does not measure GPU completion. ${adapter.metadata.frameLimitation} Navigation entries still describe initial navigation in later interaction windows.`,
      start,
      conditionObserved,
      stable,
      summary,
      ...snapshot,
      frameSamplesTruncated: snapshot.frames.length > RAW_FRAME_LIMIT,
      stableFrameSamplesTruncated: snapshot.stableFrames.length > RAW_FRAME_LIMIT,
      frames: snapshot.frames.slice(0, RAW_FRAME_LIMIT),
      stableFrames: snapshot.stableFrames.slice(0, RAW_FRAME_LIMIT),
    };
    await commands.measure.stop();
    // extras receives only compact numeric summaries: Browsertime recursively
    // aggregates extras, which is unsuitable for raw resource/frame arrays.
    commands.measure.add('scene', summary);
    const filename = `scene-${context.index}-${alias}.json`;
    await context.storageManager.writeJson(filename, raw, false);
    console.log(`[scene-perf] ${alias}: ${Math.round(summary.windowObservedMs)}ms observation window; raw=${filename}`);
  }

  async function initial() {
    const initialAlias = 'initial-3d';
    console.log(`[scene-perf] ${initialAlias}: navigate ${url}`);
    await commands.measure.start(initialAlias);
    await commands.navigate(url);
    await commands.wait.byCondition(`(${adapter.browser.isReady})() === true`, TIMEOUT_MS);
    const initialReady = await boundary();
    await commands.wait.byTime(observationMs);
    await finish(initialAlias, { nowMs: 0, frameIndex: 0, firstFrameMs: null },
      initialReady, initialReady,
      adapter.metadata.readyDescription);
  }

  return { boundary, state, finish, initial, observationMs };
}

module.exports = { createCollector, loadAdapter, TIMEOUT_MS, SETTLE_MS };
