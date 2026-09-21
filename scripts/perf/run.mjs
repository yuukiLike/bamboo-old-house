#!/usr/bin/env node
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, lstat, mkdir, open, readFile, readdir, readlink, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { finished } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { generateReport } from './report.mjs';

const exec = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SITE_SPEED_VERSION = '42.7.0';
const BUNDLED_SCENARIOS = {
  load: 'scene-journey.cjs', journey: 'scene-journey.cjs',
  system: 'system-journey.cjs', views: 'view-journey.cjs',
  cache: 'cache-journey.cjs',
};
const HELP = `Usage: node scripts/perf/run.mjs [options]

  --url URL                 Default http://127.0.0.1:4175/
  --profile desktop|mobile  Default desktop; mobile emulates 402x874 at DPR 2
  --iterations N            Default 3; integer 1..30
  --mode baseline|diagnostic Default baseline; diagnostic adds Chrome trace
  --flow load|journey|system|views|cache Default journey; cache repeats navigation
  --observe-ms N            Default 5000; integer 1000..30000 per view
  --instrumentation on|off   Default on; controls perf=1 business markers
  --adapter FILE.cjs        Project data/ready adapter; default adapters/bamboo.cjs
  --scenario FILE.cjs       Custom Browsertime navigation script
  --out DIRECTORY           New output directory; existing directories rejected
  --compare BASELINE_DIR    Compare after capture; does not inherit baseline options
  --chrome BINARY           Chrome executable; also PERF_CHROME
  --driver BINARY           Matching ChromeDriver; also PERF_DRIVER
  --help                    Print this help

The page must already be served. Runs use a visible browser, native network and
CPU, no video, and a bounded document-start observer. Mobile is desktop device
emulation, not physical-phone performance. Raw sitespeed data stays in sitespeed/.
`;

function parse(argv) {
  const options = {
    url: 'http://127.0.0.1:4175/', profile: 'desktop', iterations: 3,
    mode: 'baseline', flow: 'journey', observeMs: 5000, instrumentation: 'on',
    scenario: path.join(directory, 'scene-journey.cjs'),
    adapter: path.join(directory, 'adapters/bamboo.cjs'),
    compare: null,
    chrome: process.env.PERF_CHROME || null, driver: process.env.PERF_DRIVER || null,
  };
  const names = {
    '--url': 'url', '--profile': 'profile', '--iterations': 'iterations',
    '--mode': 'mode', '--flow': 'flow', '--observe-ms': 'observeMs',
    '--out': 'out', '--scenario': 'scenario', '--chrome': 'chrome',
    '--driver': 'driver', '--instrumentation': 'instrumentation', '--compare': 'compare', '--adapter': 'adapter',
  };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const key = names[flag];
    if (!key) throw new Error(`Unknown argument ${flag}; use --help`);
    if (seen.has(flag)) throw new Error(`Repeated argument ${flag}`);
    seen.add(flag);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    options[key] = value;
  }
  for (const [key, choices] of Object.entries({
    profile: ['desktop', 'mobile'], mode: ['baseline', 'diagnostic'],
    flow: Object.keys(BUNDLED_SCENARIOS), instrumentation: ['on', 'off'],
  })) {
    if (!choices.includes(options[key])) throw new Error(`${key} must be ${choices.join(' or ')}`);
  }
  for (const [key, min, max] of [['iterations', 1, 30], ['observeMs', 1000, 30000]]) {
    if (!/^\d+$/.test(String(options[key]))) throw new Error(`${key} must be an integer`);
    options[key] = Number(options[key]);
    if (options[key] < min || options[key] > max) throw new Error(`${key} must be between ${min} and ${max}`);
  }
  const url = new URL(options.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('url must use http or https');
  options.requestedUrl = url.href;
  if (options.instrumentation === 'on') url.searchParams.set('perf', '1');
  else url.searchParams.delete('perf');
  options.url = url.href;
  if (!seen.has('--scenario')) options.scenario = path.join(directory, BUNDLED_SCENARIOS[options.flow]);
  options.scenario = path.resolve(options.scenario);
  options.adapter = path.resolve(options.adapter);
  if (!options.adapter.endsWith('.cjs')) throw new Error('adapter must be a .cjs module');
  if (!options.scenario.endsWith('.cjs')) throw new Error('scenario must be a .cjs Browsertime script');
  const bundled = Object.values(BUNDLED_SCENARIOS).some(file => options.scenario === path.join(directory, file));
  if (bundled && options.scenario !== path.join(directory, BUNDLED_SCENARIOS[options.flow])) {
    throw new Error('Bundled scenario and flow disagree; omit --scenario to select the matching bundled script');
  }
  options.out = path.resolve(options.out || path.join('outputs', 'performance',
    `${new Date().toISOString().replaceAll(':', '-')}-${options.profile}-${options.mode}-${randomUUID().slice(0, 8)}`));
  if (options.chrome) options.chrome = path.resolve(options.chrome);
  if (options.driver) options.driver = path.resolve(options.driver);
  if (options.compare) options.compare = path.resolve(options.compare);
  return options;
}

async function validateBaseline(directoryPath) {
  try {
    if (!(await stat(directoryPath)).isDirectory()) throw new Error('not a directory');
    const manifest = JSON.parse(await readFile(path.join(directoryPath, 'manifest.json'), 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest must be a JSON object');
  } catch (error) { throw new Error(`Cannot read comparison baseline ${directoryPath}: ${error.message}`); }
}

function comparisonMessages(comparison, reportPath) {
  if (!comparison) return [];
  const matched = comparison.scenes.filter(scene => scene.comparable).length;
  const status = comparison.allScenesComparable ? 'comparable' : matched ? 'partially comparable' : 'not comparable';
  return [`[scene-perf] comparison ${status}: ${matched}/${comparison.scenes.length} scene(s); report=${reportPath}`,
    ...comparison.reasons.map(reason => `[scene-perf] comparison condition: ${reason}`),
    ...comparison.scenes.filter(scene => !scene.comparable && scene.reasons.length).map(scene => `[scene-perf] ${scene.alias}: ${scene.reasons.join('; ')}`),
    ...(comparison.notes || []).map(note => `[scene-perf] comparison note: ${note}`),
    '[scene-perf] Comparison eligibility and measured changes do not change the capture exit status.'];
}

async function commandOutput(command, args) {
  try {
    const { stdout } = await exec(command, args, { timeout: 10000, maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function gitState() {
  const [sha, branch, status] = await Promise.all([
    commandOutput('git', ['rev-parse', 'HEAD']),
    commandOutput('git', ['branch', '--show-current']),
    commandOutput('git', ['status', '--porcelain']),
  ]);
  const state = { sha, branch, dirty: status === null ? null : status.length > 0, status };
  if (!sha) return state;
  try {
    const [{ stdout: difference }, { stdout: paths }, root] = await Promise.all([
      exec('git', ['diff', '--binary', 'HEAD', '--'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }),
      exec('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }),
      commandOutput('git', ['rev-parse', '--show-toplevel']),
    ]);
    const untrackedFiles = [];
    for (const filename of paths.split('\0').filter(Boolean).sort((a, b) => a.localeCompare(b))) {
      const absolute = path.resolve(root, filename);
      const metadata = await lstat(absolute);
      const hash = createHash('sha256');
      if (metadata.isSymbolicLink()) hash.update(await readlink(absolute));
      else if (metadata.isFile()) for await (const chunk of createReadStream(absolute)) hash.update(chunk);
      else continue;
      untrackedFiles.push({ path: filename, sha256: hash.digest('hex'), bytes: metadata.size, type: metadata.isSymbolicLink() ? 'symlink' : 'file' });
    }
    const trackedDiffSha256 = createHash('sha256').update(difference).digest('hex');
    state.provenance = {
      trackedDiffSha256, untrackedFiles,
      worktreeSha256: createHash('sha256').update(JSON.stringify({ sha, trackedDiffSha256, untrackedFiles })).digest('hex'),
      note: 'Fingerprint of the local checkout at collection start; it does not prove which build is served at the target URL. Ignored files are excluded.',
    };
  } catch (error) {
    state.provenanceError = error.message;
  }
  return state;
}

async function observedRuns(root) {
  const observations = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name);
    if (entry.isDirectory()) observations.push(...await observedRuns(filename));
    else if (entry.isFile() && /^scene-.*\.json$/.test(entry.name)) {
      const raw = JSON.parse(await readFile(filename, 'utf8'));
      observations.push({
        alias: raw.alias, iteration: raw.iteration, userAgent: raw.userAgent, browser: raw.browser,
        browserViewport: raw.browserViewport,
        viewport: raw.diagnostics?.viewport, drawSize: raw.diagnostics?.drawSize,
        pixelRatio: raw.diagnostics?.pixelRatio, quality: raw.diagnostics?.quality,
        gpu: raw.diagnostics?.gpu,
      });
    }
  }
  return observations;
}

async function runChild(command, args, environment, logPath) {
  // Open before spawning: a log path failure must not leave an unmanaged child.
  const log = (await open(logPath, 'wx')).createWriteStream();
  let logError;
  log.on('error', error => { logError = error; });
  let tail = '';
  const result = await new Promise(resolve => {
    const child = spawn(command, args, { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const [input, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      input.on('data', chunk => {
        output.write(chunk);
        log.write(chunk);
        tail = (tail + chunk.toString()).slice(-16000);
      });
    }
    let error;
    child.on('error', value => { error = value.message; });
    const interrupt = signal => child.kill(signal);
    const onInterrupt = () => interrupt('SIGINT');
    const onTerminate = () => interrupt('SIGTERM');
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    child.on('close', (exitCode, signal) => {
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
      resolve({ exitCode: exitCode ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1), signal, ...(error ? { error } : {}) });
    });
  });
  log.end();
  await finished(log);
  if (logError) throw logError;
  return { ...result, tail };
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log(HELP);
    return;
  }
  const options = parse(process.argv.slice(2));
  if (options.compare) await validateBaseline(options.compare);
  if (!(await stat(options.scenario)).isFile()) throw new Error('scenario is not a file');
  const { loadAdapter } = require('./scene-helpers.cjs');
  const loadedAdapter = loadAdapter(options.adapter);
  const adapter = { ...loadedAdapter.metadata, path: loadedAdapter.path,
    sha256: createHash('sha256').update(await readFile(loadedAdapter.path)).digest('hex') };
  const bundled = Object.values(BUNDLED_SCENARIOS).some(file => options.scenario === path.join(directory, file));
  if (bundled && !['load', 'cache'].includes(options.flow) && adapter.id !== 'bamboo') {
    throw new Error(`The bundled ${options.flow} flow uses Bamboo controls. Adapter ${adapter.id} requires --scenario with your project's UI actions; --flow load or cache can use any adapter.`);
  }
  const declaredScenes = bundled && options.flow === 'load' ? ['initial-3d'] : require(options.scenario).expectedScenes;
  if (declaredScenes !== undefined && (!Array.isArray(declaredScenes) || !declaredScenes.length ||
    declaredScenes.some(alias => typeof alias !== 'string' || !alias.trim()) || new Set(declaredScenes).size !== declaredScenes.length)) {
    throw new Error('scenario.expectedScenes must be a nonempty array of unique scene alias strings, or omitted when coverage is undeclared');
  }
  const expectedScenes = declaredScenes ?? null;
  for (const binary of [options.chrome, options.driver].filter(Boolean)) await access(binary, constants.X_OK);
  // Record Git state before creating an output folder that may be untracked.
  const git = await gitState();
  await mkdir(path.dirname(options.out), { recursive: true });
  try {
    await mkdir(options.out);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Output already exists; choose a new --out directory: ${options.out}`);
    throw error;
  }

  const viewport = options.profile === 'mobile'
    ? { width: 402, height: 874, pixelRatio: 2, kind: 'emulated-viewport' }
    : { width: 1440, height: 900, pixelRatio: 1, kind: 'requested-browser-window' };
  const urlParameters = new URL(options.url).searchParams;
  const captureHar = options.flow === 'load';
  const manifest = {
    schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(),
    cli: process.argv.slice(2), git,
    versions: { node: process.version, sitespeed: SITE_SPEED_VERSION, browsertime: '28.3.0', chrome: null, driver: null },
    environment: { platform: platform(), arch: arch(), osRelease: release(), cpus: cpus().map(cpu => cpu.model), memoryBytes: totalmem() },
    config: {
      ...options, adapter, viewport, requestedWindow: { width: 1440, height: 900 },
      headless: false, video: false, network: 'native',
      cpuThrottling: 1, probe: true, screenshots: options.mode === 'diagnostic',
      screenshotLCP: options.mode === 'diagnostic', screenshotLS: options.mode === 'diagnostic',
      traceScreenshots: options.mode === 'diagnostic', expectedScenes,
      performancePanel: urlParameters.get('perf') === '1' && urlParameters.get('perfUI') === '1',
      har: captureHar, disabledPlugins: ['coach'],
      networkCache: {
        version: 1, requested: true, source: 'browsertime-shared-cdp',
        availability: 'See each scene.networkCapture; custom scenarios must use createCollector.',
        session: 'new-ChromeDriver-session-and-temporary-profile-per-iteration',
        browserCache: 'enabled', explicitClearCache: false, targetWarmup: false,
        navigation: 'normal-navigation-without-cache-bypass',
        withinIteration: options.flow === 'cache'
          ? 'same URL revisited by normal navigation in the same profile; browser cache retained, document state recreated'
          : 'same-page resources and application state retained',
        network: 'native',
        limitation: 'Browsertime starts a new ChromeDriver session per iteration; no user-data-dir is supplied. Operating-system and server caches are not cleared. Custom scenarios may change cache state.',
      },
      harNote: captureHar ? 'HAR collected for each measured navigation' : options.flow === 'cache'
        ? 'HAR disabled for cache flow; CDP captures whitelisted cache headers and flags from existing requests without storing all request/response headers.'
        : 'HAR disabled: this sitespeed version requires a HAR page for every measurement, while same-page WebGL view changes do not navigate. Resource Timing and diagnostic trace network events remain available.',
    },
    capture: { command: 'npx', args: [], exitCode: null, signal: null },
  };
  const manifestPath = path.join(options.out, 'manifest.json');
  const saveManifest = () => writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await saveManifest();

  try {
    if (options.chrome) manifest.versions.chrome = await commandOutput(options.chrome, ['--version']);
    if (options.driver) manifest.versions.driver = await commandOutput(options.driver, ['--version']);
    const browserMajor = manifest.versions.chrome?.match(/\b(\d+)\./)?.[1];
    const driverMajor = manifest.versions.driver?.match(/\b(\d+)\./)?.[1];
    if (browserMajor && driverMajor && browserMajor !== driverMajor) {
      throw new Error(`Chrome ${browserMajor} and ChromeDriver ${driverMajor} are incompatible. Pass matching --chrome and --driver binaries (or PERF_DRIVER).`);
    }
    const probeSource = await readFile(path.join(directory, 'observe.js'), 'utf8');
    manifest.config.probeSha256 = createHash('sha256').update(probeSource).digest('hex');
    manifest.config.scenarioSha256 = createHash('sha256').update(await readFile(options.scenario)).digest('hex');
    manifest.config.collectorSha256 = createHash('sha256').update(await readFile(path.join(directory, 'scene-helpers.cjs'))).digest('hex');
    manifest.config.networkCache.sha256 = createHash('sha256').update(await readFile(path.join(directory, 'network-cache.cjs'))).digest('hex');
    manifest.config.networkCache.classifierSha256 = createHash('sha256').update(await readFile(path.join(directory, 'resource-cache.mjs'))).digest('hex');
    manifest.config.instrumentationSha256 = options.instrumentation === 'on' && adapter.id === 'bamboo'
      ? createHash('sha256').update(await readFile(path.resolve(directory, '../../src/lib/performance.ts'))).digest('hex') : null;
    if (options.instrumentation === 'on' && adapter.id !== 'bamboo') {
      manifest.config.instrumentationNote = 'Business instrumentation source hash is unavailable for this adapter; reports remain available, but baseline comparison cannot verify instrumentation overhead. Use --instrumentation off when collecting a generic browser-probe baseline.';
      console.warn(`[scene-perf] ${manifest.config.instrumentationNote}`);
    }
    const args = [
      '--yes', `--package=sitespeed.io@${SITE_SPEED_VERSION}`, 'sitespeed.io', options.scenario,
      '-b', 'chrome', '-n', String(options.iterations),
      '--browsertime.headless', 'false',
      '--browsertime.viewPort', '1440x900',
      '--browsertime.chrome.args', 'force-device-scale-factor=1',
      '--browsertime.chrome.timeline', String(options.mode === 'diagnostic'),
      '--browsertime.chrome.enableTraceScreenshots', String(options.mode === 'diagnostic'),
      '--browsertime.screenshot', String(options.mode === 'diagnostic'),
      '--browsertime.screenshotLCP', String(options.mode === 'diagnostic'),
      '--browsertime.screenshotLS', String(options.mode === 'diagnostic'),
      '--browsertime.injectJs', probeSource,
      '--browsertime.pageCompleteCheck', 'return document.readyState === "complete"',
      '--browsertime.pageCompleteCheckStartWait', '100',
      '--browsertime.pageCompleteCheckPollTimeout', '200',
      '--video', 'false', '--visualMetrics', 'false',
      '--plugins.remove', 'coach',
      '--browsertime.skipHar', String(!captureHar),
      '--connectivity.profile', 'native',
      '--outputFolder', path.join(options.out, 'sitespeed'),
    ];
    if (options.mode === 'diagnostic') {
      args.push('--browsertime.chrome.traceCategory', 'disabled-by-default-v8.cpu_profiler');
    }
    if (options.profile === 'mobile') {
      // Browsertime forwards mobileEmulation directly to Selenium. ChromeDriver
      // requires deviceMetrics nesting; its documented flat CLI fields only
      // resize the outer window in this pinned version, without emulation.
      args.push('--browsertime.chrome.mobileEmulation.deviceMetrics.width', String(viewport.width),
        '--browsertime.chrome.mobileEmulation.deviceMetrics.height', String(viewport.height),
        '--browsertime.chrome.mobileEmulation.deviceMetrics.pixelRatio', String(viewport.pixelRatio));
    }
    if (options.chrome) args.push('--browsertime.chrome.binaryPath', options.chrome);
    if (options.driver) args.push('--browsertime.chrome.chromedriverPath', options.driver);
    manifest.capture.args = args;
    await saveManifest();
    console.log(`[scene-perf] ${options.profile} ${options.mode}; ${options.iterations} iteration(s); ${options.out}`);
    const { tail, ...capture } = await runChild('npx', args, {
      ...process.env, PERF_URL: options.url, PERF_FLOW: options.flow,
      PERF_OBSERVE_MS: String(options.observeMs), PERF_INSTRUMENTATION: options.instrumentation,
      PERF_ADAPTER: loadedAdapter.path,
    }, path.join(options.out, 'capture.log'));
    Object.assign(manifest.capture, capture);
    if (capture.exitCode !== 0 && /session not created|only supports Chrome version|ChromeDriver.*version/i.test(tail)) {
      manifest.capture.hint = 'Chrome and ChromeDriver must match. Pass --chrome and --driver (or PERF_DRIVER) using compatible binaries; the pinned sitespeed package may ship an older driver.';
      console.error(`[scene-perf] ${manifest.capture.hint}`);
    }
    manifest.status = capture.exitCode === 0 ? 'completed' : 'failed';
  } catch (error) {
    manifest.status = 'failed';
    manifest.capture.exitCode = 1;
    manifest.capture.error = error.message;
    console.error(`[scene-perf] ${error.message}`);
  }
  try {
    manifest.observed = await observedRuns(options.out);
    const actualBrowser = manifest.observed.find(run => run.browser?.version)?.browser;
    if (actualBrowser) {
      manifest.versions.chrome = actualBrowser.version;
      manifest.versions.driver = actualBrowser.driverVersion;
    }
    const viewportErrors = manifest.observed.flatMap(run => {
      const actual = run.browserViewport;
      const matches = actual && actual.width === viewport.width &&
        (options.profile !== 'mobile' || actual.height === viewport.height) &&
        Math.abs(actual.pixelRatio - viewport.pixelRatio) < 0.001;
      return matches ? [] : [`${run.alias} iteration ${run.iteration}: requested ${options.profile} width=${viewport.width}, ${options.profile === 'mobile' ? `height=${viewport.height}, ` : ''}DPR=${viewport.pixelRatio}; actual browser viewport=${JSON.stringify(actual ?? null)}`];
    });
    if (viewportErrors.length) throw new Error(`Browser configuration mismatch. ${viewportErrors.join('; ')}`);
  } catch (error) {
    manifest.capture.observationError = error.message;
    manifest.capture.processExitCode = manifest.capture.exitCode;
    manifest.capture.exitCode ||= 1;
    manifest.status = 'failed';
    console.error(`[scene-perf] ${error.message}`);
  }
  manifest.finishedAt = new Date().toISOString();
  await saveManifest();

  // Report partial data after a capture failure as well. The reporter reads the
  // finalized capture status and must not turn an incomplete run into success.
  try {
    const result = await generateReport(options.out, { compare: options.compare });
    const messages = [`[scene-perf] report=${result.paths.html}`, ...comparisonMessages(result.summary.comparison, result.paths.html)];
    for (const message of messages) console.log(message);
    await writeFile(path.join(options.out, 'report.log'), `${messages.join('\n')}\n`, { flag: 'wx' });
    manifest.report = { exitCode: result.summary.status === 'completed' ? 0 : 1, signal: null, path: result.paths.html };
    if (result.summary.comparison) manifest.comparison = {
      baselineDir: options.compare, conditionsComparable: result.summary.comparison.conditionsComparable,
      comparable: result.summary.comparison.comparable, allScenesComparable: result.summary.comparison.allScenesComparable,
      reasons: result.summary.comparison.reasons, scenes: result.summary.comparison.scenes.map(({ alias, comparable, reasons }) => ({ alias, comparable, reasons })),
    };
  } catch (error) {
    manifest.report = { exitCode: 1, error: error.message };
    console.error(`[scene-perf] report failed: ${error.message}`);
    try { await writeFile(path.join(options.out, 'report.log'), `${error.message}\n`, { flag: 'wx' }); } catch { /* Preserve an existing report log. */ }
  }
  if (manifest.report.exitCode !== 0) manifest.status = 'failed';
  await saveManifest();
  process.exitCode = manifest.capture.exitCode || manifest.report.exitCode || 0;
  console.log(`[scene-perf] ${manifest.status}; manifest=${manifestPath}`);
}

main().catch(error => {
  console.error(`[scene-perf] ${error.message}`);
  process.exitCode = 1;
});
