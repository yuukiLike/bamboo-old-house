import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CACHE_LABELS, CACHE_COLORS, classifyResourceCache, summarizeResourceCache } from '../core/resource-cache.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const median = values => {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : null;
};
const quantile = (sorted, fraction) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const md = value => String(value ?? '').replace(/[|`\r\n]/g, ' ');
const fmt = (value, unit = ' ms') => finite(value) ? `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit}` : 'N/A';
const relativeLink = value => value.split(path.sep).map(encodeURIComponent).join('/');
const get = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
const asArray = value => Array.isArray(value) ? value : [];
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const sceneLabels = { 'initial-3d': '初次进入页面', 'free-outdoor': '首次自由视角', 'interior-first': '首次进入室内', 'outdoor-return': '返回室外', 'interior-repeat': '再次进入室内' };
const metricLabels = { readyMs: '近似就绪', windowMs: '采集窗口', stableMs: '稳定观察窗口', startupMs: '场景内部 startup', p95Ms: '应用帧间隔 p95', stableP95Ms: '稳定段帧间隔 p95', probeP95Ms: '浏览器 RAF p95', maxRafMs: '逐轮完整 RAF 最大间隔的中位数', stableMeanHz: '稳定段平均 RAF 回调率', stableTypicalHz: '稳定段典型应用回调率', over33msPercent: '应用帧 >33.33ms', probeOver33msPercent: '浏览器 RAF >33.33ms' };

async function filesBelow(directory, prefix = '', depth = 0) {
  if (depth > 10) return [];
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(directory, name, depth + 1));
    else if (entry.isFile()) result.push(name);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

function frames(values, summary) {
  const sorted = asArray(values).map(value => typeof value === 'number' ? value : value?.duration).filter(finite).sort((a, b) => a - b);
  if (summary && finite(summary.count)) return { ...summary };
  return { count: sorted.length, medianMs: median(sorted), p95Ms: quantile(sorted, .95), p99Ms: quantile(sorted, .99), maxMs: sorted.at(-1) ?? null,
    over33msPercent: sorted.length ? 100 * sorted.filter(value => value > 33.33).length / sorted.length : null };
}

function normalize(raw, file, pageUrl) {
  if (!raw || typeof raw.alias !== 'string' || !raw.alias.trim() || !Number.isInteger(raw.iteration) || raw.iteration < 1) throw new Error('场景必须声明非空 alias 和正整数 iteration');
  if (!finite(raw.start?.nowMs) || raw.start.nowMs < 0 || !finite(raw.observedAtMs) || raw.observedAtMs < raw.start.nowMs) throw new Error('场景缺少有效的 performance.now() 采集时间窗口');
  const windowMs = raw.summary?.windowObservedMs;
  if (!finite(windowMs) || windowMs < 0 || Math.abs(windowMs - (raw.observedAtMs - raw.start.nowMs)) > 1 ||
    ['conditionObservedMs', 'stableObservedMs'].some(key => !finite(raw.summary?.[key]) || raw.summary[key] < 0 || raw.summary[key] > windowMs + 1)) throw new Error('场景 summary 缺少有效观察 / 就绪 / 稳定时长，或与采集窗口不一致');
  const initial = raw.alias === 'initial-3d';
  const navigationLoad = initial || raw.alias === 'cache-revisit';
  const finalPageUrl = raw.url ?? pageUrl;
  const frameWindowValid = raw.frameWindowValid !== false;
  const retainedFrames = raw.probe?.retention?.frames;
  const missingBrowserSummary = raw.probe?.frameSamplesTruncated && !finite(raw.probe?.frameSummary?.count);
  const browserFrameWindowValid = !missingBrowserSummary && !(retainedFrames?.dropped > 0 && raw.probe?.startMs < retainedFrames.oldestStartMs);
  const stableRetention = raw.probeStable?.retention?.frames;
  const missingStableSummary = raw.probeStable?.frameSamplesTruncated && !finite(raw.probeStable?.frameSummary?.count);
  const stableProbeValid = !missingStableSummary && !(stableRetention?.dropped > 0 && raw.probeStable?.startMs < stableRetention.oldestStartMs);
  const appFrames = frameWindowValid ? frames(raw.frames, raw.summary?.frames) : null;
  const stableFrames = frameWindowValid ? frames(raw.stableFrames, raw.summary?.stableFrames) : null;
  const browserFrames = raw.probe && browserFrameWindowValid ? frames(raw.probe.frames, raw.probe.frameSummary) : null;
  const sourceMeasures = [...asArray(raw.probe?.measures), ...asArray(raw.measures)];
  const uniqueMeasures = [...new Map(sourceMeasures.map(entry => [`${entry.name}|${entry.startTime}|${entry.duration}`, entry])).values()];
  const measures = uniqueMeasures.filter(entry => finite(entry.startTime) && finite(entry.duration)).map(entry => ({
    name: entry.name, phase: entry.detail?.phase ?? entry.name, startTime: entry.startTime, duration: entry.duration, detail: entry.detail ?? null,
  }));
  const metrics = {
    readyMs: raw.summary?.conditionObservedMs ?? null, windowMs: raw.summary?.windowObservedMs ?? null,
    stableMs: raw.summary?.stableObservedMs ?? null, startupMs: navigationLoad ? raw.summary?.startupMs ?? null : null,
    p95Ms: appFrames?.p95Ms ?? null, stableP95Ms: stableFrames?.p95Ms ?? null,
    probeP95Ms: browserFrames?.p95Ms ?? null, over33msPercent: appFrames?.over33msPercent ?? null,
    maxRafMs: browserFrames?.maxMs ?? null,
    probeOver33msPercent: browserFrames?.over33msPercent ?? null,
    stableMeanHz: stableProbeValid && raw.probeStable?.frameSummary?.meanMs > 0 ? 1000 / raw.probeStable.frameSummary.meanMs : null,
    stableTypicalHz: stableFrames?.medianMs > 0 ? 1000 / stableFrames.medianMs : null,
  };
  const sample = { alias: raw.alias ?? path.basename(file), label: raw.label ?? null, iteration: raw.iteration, initial, navigationLoad, file, metrics, appFrames, stableFrames, browserFrames,
    cacheVisit: raw.cacheVisit ?? null, cacheCondition: raw.cacheCondition ?? null, url: finalPageUrl ?? null,
    startMs: raw.start?.nowMs, endMs: raw.observedAtMs, timeOrigin: raw.timeOrigin, completionRule: raw.completionRule, limitation: raw.limitation,
    frameWindowValid, frameDataAvailable: raw.frameDataAvailable !== false, browserFrameWindowValid, frameSamplesTruncated: !!raw.frameSamplesTruncated,
    adapter: raw.adapter ?? null,
    diagnostics: raw.diagnostics ?? {}, browserViewport: raw.browserViewport ?? null, startState: raw.startState ?? null, state: raw.endState ?? raw.state ?? null,
    workload: raw.workload ?? null, preparations: asArray(raw.preparations),
    businessPhases: raw.businessPhases ? { enabled: raw.businessPhases.enabled, version: raw.businessPhases.version, droppedPhases: raw.businessPhases.droppedPhases } : null,
    measures, resources: asArray(raw.resources).map(entry => ({ ...entry, cache: classifyResourceCache(entry, { pageUrl: finalPageUrl }) })), probe: raw.probe ?? null, probeStable: raw.probeStable ?? null,
    navigation: navigationLoad ? asArray(raw.navigation).map(entry => ({ ...entry, cache: classifyResourceCache(entry, { pageUrl: finalPageUrl }) })) : [], visibility: raw.visibility,
    networkCapture: raw.networkCapture ?? null,
  };
  sample.stutters = locateStutters(sample);
  sample.resourceCache = summarizeResourceCache(sample.resources);
  return sample;
}

function locateStutters(sample) {
  const start = sample.startMs ?? 0, end = sample.endMs ?? 0;
  const overlaps = (entry, begin, finish) => entry.startTime < finish && entry.startTime + entry.duration > begin;
  const rawGaps = sample.probe?.slowFrames ?? sample.probe?.frames;
  const gaps = asArray(rawGaps).filter(entry => finite(entry.startTime) && entry.duration >= 50 && overlaps(entry, start, end)).map(entry => ({
    start: Math.max(start, entry.overlapStartMs ?? entry.startTime), end: Math.min(end, entry.startTime + entry.duration), duration: entry.duration,
    crossesStart: !!entry.crossesStart || entry.startTime < start,
  })).sort((a, b) => a.start - b.start);
  const episodes = [];
  for (const gap of gaps) {
    const previous = episodes.at(-1);
    if (previous && gap.start - previous.end <= 20) { previous.end = Math.max(previous.end, gap.end); previous.gaps.push(gap); }
    else episodes.push({ start: gap.start, end: gap.end, gaps: [gap] });
  }
  const evidence = (begin, finish) => sample.measures.filter(entry => overlaps(entry, begin, finish)).sort((a, b) =>
    (Math.min(finish, b.startTime + b.duration) - Math.max(begin, b.startTime)) - (Math.min(finish, a.startTime + a.duration) - Math.max(begin, a.startTime)) || a.duration - b.duration);
  for (const episode of episodes) {
    episode.relativeStartMs = episode.start - start; episode.relativeEndMs = episode.end - start;
    episode.maxGapMs = Math.max(...episode.gaps.map(gap => gap.duration));
    episode.maxOverlapMs = Math.max(...episode.gaps.map(gap => gap.end - gap.start));
    episode.crossesStart = episode.gaps.some(gap => gap.crossesStart);
    episode.phases = evidence(episode.start, episode.end);
    episode.longTasks = asArray(sample.probe?.longTasks).filter(entry => overlaps(entry, episode.start, episode.end));
    episode.longAnimationFrames = asArray(sample.probe?.longAnimationFrames).filter(entry => overlaps(entry, episode.start, episode.end));
  }
  const risks = asArray(sample.probe?.longTasks).filter(entry => finite(entry.startTime) && entry.duration >= 50 && overlaps(entry, start, end) && !episodes.some(episode => overlaps(entry, episode.start, episode.end))).map(entry => ({
    relativeStartMs: Math.max(start, entry.startTime) - start, relativeEndMs: Math.min(end, entry.startTime + entry.duration) - start, duration: entry.duration,
    phases: evidence(Math.max(start, entry.startTime), Math.min(end, entry.startTime + entry.duration)),
  }));
  return { thresholdMs: 50, mergeGapMs: 20, source: sample.probe?.slowFrames ? 'slowFrames' : 'retained frames', available: !!sample.probe,
    partial: !!sample.probe?.slowFramesTruncated || !sample.browserFrameWindowValid || (!sample.probe?.slowFrames && !!sample.probe?.frameSamplesTruncated), episodes, risks };
}

function instrumentationKnown(samples, sample) {
  if (typeof sample.businessPhases?.enabled === 'boolean') return sample.businessPhases.enabled;
  return samples.some(candidate => candidate.iteration === sample.iteration && candidate.timeOrigin === sample.timeOrigin && candidate.initial && candidate.measures.some(entry => candidate.adapter?.measurePrefix && String(entry.name).startsWith(candidate.adapter.measurePrefix)));
}

async function loadRun(runDir) {
  const files = await filesBelow(runDir);
  const warnings = [];
  let manifest = {};
  try { manifest = await json(path.join(runDir, 'manifest.json')); }
  catch (error) { warnings.push(`manifest.json 不可读取，无法确认采集条件与完成状态：${error.message}`); }
  const samples = [];
  for (const file of files.filter(name => /^scene-\d+-.+\.json$/.test(path.basename(name)))) {
    try { samples.push(normalize(await json(path.join(runDir, file)), file, manifest.config?.url)); }
    catch (error) { warnings.push(`原始记录无法解析 ${file}：${error.message}`); }
  }
  samples.sort((a, b) => (Number(a.iteration) - Number(b.iteration)) || a.file.localeCompare(b.file));
  const expected = manifest.config?.iterations;
  const expectedAliases = asArray(manifest.config?.expectedScenes).filter(alias => typeof alias === 'string');
  const coverageDeclared = expectedAliases.length > 0 && finite(expected);
  if (!coverageDeclared) warnings.push('未声明 expectedScenes 与重复轮数；只报告实际采集场景，不能证明完整覆盖');
  for (const alias of expectedAliases) {
    const count = new Set(samples.filter(sample => sample.alias === alias).map(sample => sample.iteration)).size;
    if (finite(expected) && count !== expected) warnings.push(`${sceneLabels[alias] ?? alias}：实际 ${count} 轮，预期 ${expected} 轮`);
  }
  for (const sample of samples) {
    if (!sample.frameWindowValid) warnings.push(`${sample.alias} 第 ${sample.iteration} 轮：${sample.frameDataAvailable ? '应用帧缓冲已滚动' : '适配器未提供应用帧数据'}，该窗口及稳定段应用帧统计已排除，不参与中位数；浏览器 RAF 独立统计`);
    if (!sample.browserFrameWindowValid) warnings.push(`${sample.alias} 第 ${sample.iteration} 轮：${sample.probe?.frameSamplesTruncated && !finite(sample.probe?.frameSummary?.count) ? '浏览器 RAF 输出已截断且缺少完整汇总' : '浏览器 RAF 缓冲覆盖了窗口前段'}，该窗口帧统计为 N/A，不从保留片段推算完整峰值`);
    if (sample.probeStable?.frameSamplesTruncated && !finite(sample.probeStable?.frameSummary?.count)) warnings.push(`${sample.alias} 第 ${sample.iteration} 轮：稳定段 RAF 输出已截断且缺少完整汇总，平均回调率为 N/A`);
    if (manifest.config?.probe && (!sample.probe || !finite(sample.probe.startMs) || !finite(sample.probe.endMs) || sample.probe.endMs < sample.probe.startMs)) warnings.push(`${sample.alias} 第 ${sample.iteration} 轮：已配置浏览器探针，但原始记录缺少有效 probe 时间窗口`);
    if (manifest.config?.instrumentation === 'on' && !instrumentationKnown(samples, sample)) warnings.push(`${sample.alias} 第 ${sample.iteration} 轮：已配置业务埋点，但无开关状态或同页首屏业务记录，不能确认实际已启用`);
    if (sample.visibility && sample.visibility !== 'visible') warnings.push(`${sample.alias} 第 ${sample.iteration} 轮：窗口结束时页面不可见`);
    if (sample.probe?.truncated) warnings.push(`${sample.alias} 第 ${sample.iteration} 轮：浏览器原始样本输出截断或采集缓冲覆盖，参见 frameSamplesTruncated 与 retention；完整汇总是否可用取决于缓冲保留范围`);
    if (sample.probe?.hiddenDurationMs > 0) warnings.push(`${sample.alias} 第 ${sample.iteration} 轮：窗口含 ${fmt(sample.probe.hiddenDurationMs)} 后台时间；保留原始观察，整轮不用于基线比较`);
  }
  if (!samples.length) warnings.push('没有可用 scene 原始记录，采集未得到可报告的场景数据');
  if (manifest.status !== 'completed') warnings.push(`采集状态：${manifest.status ?? '未知'}，当前报告只包含已落盘数据`);
  if (manifest.capture && manifest.capture.exitCode !== 0) warnings.push(`浏览器采集退出码：${manifest.capture.exitCode ?? '未结束'}；信号：${manifest.capture.signal ?? '无'}`);
  if (manifest.capture?.error) warnings.push(`采集错误：${manifest.capture.error}`);
  if (manifest.capture?.observationError) warnings.push(`实际运行条件检查失败：${manifest.capture.observationError}`);
  if (manifest.config?.instrumentationNote) warnings.push(manifest.config.instrumentationNote);
  const groups = [...new Set(samples.map(sample => sample.alias))].map(alias => {
    const rows = samples.filter(sample => sample.alias === alias);
    const medians = Object.fromEntries(Object.keys(metricLabels).map(key => [key, median(rows.map(row => row.metrics[key]))]));
    const metricSampleCounts = Object.fromEntries(Object.keys(metricLabels).map(key => [key, rows.filter(row => finite(row.metrics[key])).length]));
    return { alias, label: rows[0].label ?? sceneLabels[alias] ?? alias, initial: rows[0].initial, navigationLoad: rows[0].navigationLoad, samples: rows, medians, metricSampleCounts, resourceCache: summarizeResourceCache(rows.flatMap(sample => sample.resources)) };
  });
  const sceneOrder = expectedAliases.length ? expectedAliases : Object.keys(sceneLabels);
  groups.sort((a, b) => Number(b.initial) - Number(a.initial) || sceneOrder.indexOf(a.alias) - sceneOrder.indexOf(b.alias));
  const complete = samples.length > 0 && manifest.status === 'completed' && manifest.capture?.exitCode === 0 &&
    !warnings.some(warning => /：实际|无法解析|没有可用|缺少有效 probe/.test(warning));
  return { runDir, manifest, warnings, status: complete ? 'completed' : 'incomplete', coverageDeclared, groups,
    resourceCache: summarizeResourceCache(samples.flatMap(sample => sample.resources)),
    artifacts: files.filter(file => file === 'index.html' || file === path.join('sitespeed', 'index.html') || /(?:trace|timeline|console|har)(?:[._-]|$)/i.test(path.basename(file))).slice(0, 100) };
}

function nullableStateFields(adapter) {
  if (adapter?.nullableStateFields !== undefined) return asArray(adapter.nullableStateFields);
  // Only legacy Bamboo captures assigned a meaningful closed state to null.
  // New adapters always record this policy, including an explicit empty array.
  return !adapter || adapter.id === 'bamboo' ? ['settingsPanel'] : [];
}

const nullableStateSignature = adapter => canonical([...nullableStateFields(adapter)].sort((a, b) => a.localeCompare(b)));

function compareSceneStates(current, baseline, adapter) {
  const reasons = [], notes = [], checkedFields = [];
  const requiredFields = adapter ? asArray(adapter.stateFields) : ['view', 'place', 'timeOfDay', 'soundEnabled', 'paused', 'panorama', 'settingsPanel', 'weather.preset'];
  const optionalFields = adapter ? asArray(adapter.optionalStateFields) : ['volume'];
  const nullableFields = nullableStateFields(adapter);
  const fields = [...new Set([...requiredFields, ...optionalFields])].filter(field => typeof field === 'string');
  if (!adapter) notes.push('旧采集未记录适配器，沿用原竹屋状态字段；无法核对适配器版本与哈希');
  if (!fields.length) reasons.push('适配器未声明可核对的状态字段，无法确认操作条件一致');
  for (const [key, label] of [['startState', '操作前'], ['state', '操作后']]) {
    const now = current.samples.map(sample => sample[key]), before = baseline.samples.map(sample => sample[key]);
    if (key === 'startState' && current.navigationLoad && now.every(state => state == null) && before.every(state => state == null)) { notes.push(current.initial ? '首屏操作前尚无页面状态，记为未知且不参与状态比较' : '复访导航前尚无页面状态，记为未知且不参与状态比较'); continue; }
    if ([...now, ...before].some(state => state == null)) { reasons.push(`${label}状态快照缺失，无法核对声音等可控条件`); continue; }
    for (const field of fields) {
      const a = now.map(state => get(state, field)), b = before.map(state => get(state, field));
      if (optionalFields.includes(field) && !nullableFields.includes(field) && [...a, ...b].every(value => value == null)) { notes.push(`${label}.${field} 均不可观测，未核对此可选字段`); continue; }
      if ([...a, ...b].some(value => value === undefined || value === null && !nullableFields.includes(field))) { reasons.push(`${label}.${field} 存在未知值，不能确认条件相同`); continue; }
      const valuesA = [...new Set(a.map(canonical))], valuesB = [...new Set(b.map(canonical))];
      if (valuesA.length !== 1) reasons.push(`当前采集同场景 ${label}.${field} 存在混合状态：${valuesA.join(' / ')}`);
      if (valuesB.length !== 1) reasons.push(`基线同场景 ${label}.${field} 存在混合状态：${valuesB.join(' / ')}`);
      if (valuesA.length === 1 && valuesB.length === 1) {
        if (valuesA[0] !== valuesB[0]) reasons.push(`${label}.${field} 不一致：当前 ${valuesA[0]}，基线 ${valuesB[0]}`);
        else checkedFields.push(`${label}.${field}`);
      }
    }
  }
  return { reasons, notes, checkedFields };
}

function performancePanel(manifest) {
  if (typeof manifest.config?.performancePanel === 'boolean') return manifest.config.performancePanel;
  try { const url = new URL(manifest.config?.url); return url.searchParams.get('perf') === '1' && url.searchParams.get('perfUI') === '1'; }
  catch { return null; }
}

function applicationScope(manifest) {
  const adapter = manifest.config?.adapter;
  return `startup 的起点由项目定义，仅在页面加载且实际提供时展示；缺少应用指标保留 N/A。${adapter?.frameLimitation ?? '适配器未声明应用帧采样与诊断刷新规则。'}`;
}

function comparison(current, baseline) {
  const reasons = [], notes = [];
  const required = ['config.profile', 'config.mode', 'config.viewport', 'config.requestedWindow', 'config.screenshots', 'config.screenshotLCP', 'config.screenshotLS', 'config.traceScreenshots', 'config.video', 'config.instrumentation', 'config.observeMs', 'config.flow',
    'config.network', 'config.cpuThrottling', 'config.headless', 'config.probe', 'config.har', 'config.disabledPlugins', 'config.scenarioSha256', 'config.probeSha256', 'versions.sitespeed', 'versions.browsertime',
    'versions.chrome', 'versions.driver', 'versions.node', 'environment.platform', 'environment.arch', 'environment.osRelease', 'environment.cpus'];
  if (current.manifest.config?.instrumentation === 'on' || baseline.manifest.config?.instrumentation === 'on') required.push('config.instrumentationSha256');
  if (current.manifest.config?.collectorSha256 || baseline.manifest.config?.collectorSha256) required.push('config.collectorSha256');
  if (current.manifest.config?.adapter || baseline.manifest.config?.adapter) required.push(...['id', 'version', 'sha256', 'stateFields', 'optionalStateFields'].map(key => `config.adapter.${key}`));
  if (nullableStateSignature(current.manifest.config?.adapter) !== nullableStateSignature(baseline.manifest.config?.adapter)) {
    reasons.push('适配器 nullableStateFields 的有效规则不一致');
  }
  if (current.manifest.config?.networkCache || baseline.manifest.config?.networkCache) required.push('config.networkCache');
  else notes.push('双方均为旧版采集，未声明 networkCache 采集器版本；原性能条件继续核对，缓存只按已保留 Resource Timing 解释，无法补证实际 304 或浏览器缓存层。');
  for (const key of required) {
    const a = get(current.manifest, key), b = get(baseline.manifest, key);
    if (a == null || b == null) reasons.push(`${key} 缺少记录`);
    else if (canonical(a) !== canonical(b)) reasons.push(`${key} 不一致`);
  }
  for (const key of ['gpu', 'viewport', 'drawSize', 'pixelRatio', 'quality']) {
    const observed = run => [...new Set(run.groups.flatMap(group => group.samples).map(sample => canonical(sample.diagnostics[key])))].sort((a, b) => String(a).localeCompare(String(b)));
    const now = observed(current), before = observed(baseline);
    if (!now.length || !before.length || [...now, ...before].some(value => value == null || value === 'null' || value === '"unavailable"')) reasons.push(`实际 ${key} 缺少记录`);
    else if (now.length !== 1 || before.length !== 1) reasons.push(`同一采集中实际 ${key} 不一致`);
    else if (canonical(now) !== canonical(before)) reasons.push(`实际 ${key} 不一致`);
  }
  const browserConditions = run => [...new Set(run.groups.flatMap(group => group.samples).map(sample => canonical(sample.browserViewport)))].sort((a, b) => String(a).localeCompare(String(b)));
  const nowViewport = browserConditions(current), previousViewport = browserConditions(baseline);
  if ([...nowViewport, ...previousViewport].some(value => value == null || value === 'null')) reasons.push('缺少即时 browserViewport，不能用请求尺寸替代实际浏览器尺寸');
  else if (nowViewport.length !== 1 || previousViewport.length !== 1 || canonical(nowViewport) !== canonical(previousViewport)) reasons.push('实际 browserViewport 不一致');
  if (current.status !== 'completed' || baseline.status !== 'completed') reasons.push('至少一份采集未完整完成');
  if (canonical(current.manifest.config?.expectedScenes) !== canonical(baseline.manifest.config?.expectedScenes)) reasons.push('声明的采集场景不一致');
  const allSamples = [...current.groups, ...baseline.groups].flatMap(group => group.samples);
  if (allSamples.some(sample => sample.probe?.hiddenDurationMs > 0 || sample.visibility && sample.visibility !== 'visible')) reasons.push('采集包含后台或不可见窗口，时长和帧统计不作为基线比较');
  if (allSamples.some(sample => !sample.browserFrameWindowValid)) reasons.push('至少一个浏览器 RAF 窗口缺少完整可信统计（缓冲覆盖，或输出截断且缺完整汇总），需补采后比较');
  for (const run of [current, baseline]) {
    const samples = run.groups.flatMap(group => group.samples);
    if (run.manifest.config?.probe && samples.some(sample => !sample.probe)) reasons.push('已配置浏览器探针，但部分原始窗口缺少 probe');
    if (run.manifest.config?.networkCache?.requested && samples.some(sample => sample.networkCapture?.available !== true)) reasons.push(`${run === current ? '当前' : '基线'}已要求 CDP 网络缓存采集，但部分窗口不可用或缺少实际采集状态；不能将失败降级与正常采集作为同条件比较`);
    if (run.manifest.config?.instrumentation === 'on' && samples.some(sample => !instrumentationKnown(samples, sample))) reasons.push('部分页面无法确认业务埋点已开启，无法确认采集开销条件一致');
    const adapter = run.manifest.config?.adapter;
    if (adapter && samples.some(sample => ['id', 'version', 'stateFields', 'optionalStateFields'].some(key => canonical(sample.adapter?.[key]) !== canonical(adapter[key])))) reasons.push('原始场景缺少匹配的适配器声明，不能确认自定义流程使用了指定适配器');
    if (adapter && samples.some(sample => nullableStateSignature(sample.adapter) !== nullableStateSignature(adapter))) reasons.push('原始场景与采集清单的 nullableStateFields 有效规则不一致');
  }
  const panelNow = performancePanel(current.manifest), panelBefore = performancePanel(baseline.manifest);
  if (panelNow === null || panelBefore === null) reasons.push('诊断面板显示状态未知，无法确认采集开销一致');
  else if (panelNow !== panelBefore) reasons.push(`诊断面板显示状态不一致：当前 ${panelNow ? '显示' : '隐藏'}，基线 ${panelBefore ? '显示' : '隐藏'}`);
  const currentUrl = current.manifest.config?.url, baselineUrl = baseline.manifest.config?.url;
  if (currentUrl && baselineUrl && currentUrl !== baselineUrl) notes.push('访问地址不同；部署与网络差异可能影响结果，统计差值不等于纯代码收益。');
  if (current.manifest.config?.iterations !== baseline.manifest.config?.iterations) notes.push(`重复轮数不同：当前 ${current.manifest.config?.iterations ?? '未知'}，基线 ${baseline.manifest.config?.iterations ?? '未知'}；逐轮值和样本数保留，差值仅为描述性对照，不代表相同重复强度。`);
  const scenes = current.groups.map(group => {
      const previous = baseline.groups.find(candidate => candidate.alias === group.alias);
      const stateComparison = previous ? compareSceneStates(group, previous, current.manifest.config?.adapter) : { reasons: ['基线缺少同名场景'], notes: [], checkedFields: [] };
      const comparable = !!previous && reasons.length === 0 && stateComparison.reasons.length === 0;
      const rounds = candidate => candidate.samples.map(sample => ({ iteration: sample.iteration, maxRafMs: sample.metrics.maxRafMs, stableMeanHz: sample.metrics.stableMeanHz }));
      return { alias: group.alias, label: group.label, present: !!previous, comparable, reasons: stateComparison.reasons, notes: stateComparison.notes, checkedStateFields: stateComparison.checkedFields,
        rounds: comparable ? { baseline: rounds(previous), current: rounds(group) } : null,
        metrics: comparable ? Object.fromEntries(Object.keys(metricLabels).map(key => {
        const now = group.medians[key], before = previous.medians[key];
        const complete = !['maxRafMs', 'stableMeanHz'].includes(key) || group.metricSampleCounts[key] === group.samples.length && previous.metricSampleCounts[key] === previous.samples.length;
        return [key, { current: now, baseline: before, currentSamples: group.metricSampleCounts[key], baselineSamples: previous.metricSampleCounts[key], complete,
          delta: complete && finite(now) && finite(before) ? now - before : null,
          percent: complete && finite(now) && finite(before) && before !== 0 ? 100 * (now - before) / before : null }];
      })) : null };
    });
  return { baselineDir: baseline.runDir, baselineGit: baseline.manifest.git, conditionsComparable: reasons.length === 0,
    comparable: scenes.some(scene => scene.comparable), allScenesComparable: scenes.length > 0 && scenes.every(scene => scene.comparable), reasons, notes, scenes };
}

function table(headers, rows, sceneKeys = []) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row, index) => `<tr${sceneKeys[index] === undefined ? '' : ` data-scene="${esc(sceneKeys[index])}"`}>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function waterfall(entries, label) {
  entries = entries.filter(entry => finite(entry.startTime) && finite(entry.duration));
  if (!entries.length) return '<p class="muted">N/A · 未采集到对应条目</p>';
  const shown = [...entries].sort((a, b) => a.startTime - b.startTime).slice(0, 120);
  const first = Math.min(...entries.map(entry => entry.startTime));
  const last = Math.max(...entries.map(entry => entry.startTime + entry.duration));
  const width = Math.max(1, last - first);
  return `<p class="muted">相对导航起点；起点 ${fmt(first)}，终点 ${fmt(last)}。重叠时段不可相加。${entries.length > 120 ? `显示前 120 / ${entries.length} 条，全部条目见原始 JSON。` : ''}</p>` +
    shown.map(entry => `<div class="waterfall${entry.cache ? ' resource-waterfall' : ''}">${entry.cache ? resourceName(entry) : `<span title="${esc(label(entry))}">${esc(label(entry))}</span>`}<div class="track"><i style="left:${100 * (entry.startTime - first) / width}%;width:${Math.max(.3, 100 * entry.duration / width)}%${entry.cache ? `;background:${cacheColor(entry.cache)}` : ''}"></i></div><span>${fmt(entry.duration)}</span></div>`).join('');
}
const resourceLabel = entry => { try { return new URL(entry.name).pathname; } catch { return String(entry.name ?? '未知资源'); } };

function cacheEnvironmentNote(manifest) {
  let url;
  try { url = new URL(manifest.config?.url); } catch { return '页面地址未记录，无法判断采集的是本地服务还是实际部署。'; }
  if (url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname.startsWith('127.')) return '当前目标是 localhost 本地预览：这里只证明浏览器与本地服务的 HTTP 缓存行为，不能外推到实际部署、CDN 或用户网络。';
  if (!['http:', 'https:'].includes(url.protocol)) return '当前目标不是 HTTP(S) 页面，原生或本地协议的资源不能视作 HTTP 缓存命中。';
  return '结果仅描述本次浏览器实际请求；不会额外请求资源，也不查询 CDN 平台。浏览器本地复用不代表本次访问经过 CDN。';
}

const cacheColor = cache => CACHE_COLORS[cache?.status] ?? CACHE_COLORS.unknown;
const cacheBadge = cache => `<span class="cache-badge" style="--cache-color:${cacheColor(cache)}" title="${esc(cache?.evidence)}">${esc(cache?.label ?? '未知')}</span>`;
const resourceName = entry => `<span class="resource-name" title="${esc(`${entry.name} · ${fmt(entry.startTime)} → ${fmt(entry.startTime + entry.duration)}`)}"><span>${esc(resourceLabel(entry))}</span>${cacheBadge(entry.cache)}</span>`;

function cacheEvidenceRows(resources) {
  return resources.map(entry => {
    const network = entry.network;
    const status = network ? `线端 ${fmt(network.wireStatus, '')} / 浏览器 ${fmt(network.responseStatus, '')}` : `Resource Timing ${fmt(entry.responseStatus > 0 ? entry.responseStatus : null, '')}`;
    const allowed = new Set(['cache-control', 'etag', 'last-modified', 'expires', 'age', 'vary', 'content-length', 'content-type', 'content-encoding', 'timing-allow-origin']);
    const headers = network ? Object.fromEntries(Object.entries({ ...network.responseHeaders, ...network.wireResponseHeaders }).filter(([name]) => allowed.has(name.toLowerCase()))) : null;
    return [resourceName(entry), `${fmt(entry.startTime)} / ${fmt(entry.duration)}`, esc(status),
      fmt(entry.cache?.transferBytes, ' B'), esc(entry.cache?.evidence || '没有可判定缓存的证据'),
      headers && Object.keys(headers).length ? `<code>${esc(JSON.stringify(headers))}</code>` : '<span class="muted">未采集响应头</span>'];
  });
}

function cacheEvidenceHtml(sample) {
  const resources = sample.resources;
  return `<details><summary>逐资源 HTTP 缓存证据 <span class="count">${resources.length} 条${resources.length > 200 ? ' · 显示前 200 条' : ''}</span></summary>
    <p class="muted">线端状态来自 CDP ExtraInfo；浏览器状态可能已经合并 304 响应。0 字节不单独证明命中。仅展示安全白名单响应头，未保留 Cookie 或 Authorization。</p>
    ${resources.length ? table(['资源 / 分类', '开始 / 耗时', 'HTTP 状态', '已知传输量', '判定依据', '安全响应头'], cacheEvidenceRows(resources.slice(0, 200))) : '<p class="empty">本窗口没有已记录资源，缓存复用比例与证据覆盖率均为 N/A。</p>'}
    <p class="muted">全量分类与证据保存在 summary.json；原始浏览器字段保存在 <a href="${relativeLink(sample.file)}">本轮 JSON</a>。资源列表只覆盖已保留的完成条目，未完成、缓冲溢出或窗口前请求不在分母中。</p></details>`;
}

function cacheSummaryHtml(summary) {
  const card = (label, value, note) => `<article class="metric-card"><span class="metric-label">${esc(label)}</span><strong>${value}</strong><span class="metric-note">${esc(note)}</span></article>`;
  const counts = Object.entries(CACHE_LABELS).map(([status, label]) => ({ status, label, count: summary.counts[status] ?? 0 }));
  return `<div class="metric-grid cache-metrics">
    ${card('浏览器本地复用', fmt(summary.localHitRatePercent, '%'), `${summary.counts.local} 条 / ${summary.httpClassified} 条可判定 HTTP 记录；不包含 304`)}
    ${card('协商复用', fmt(summary.revalidationRatePercent, '%'), `${summary.counts.revalidated} 条；含 Resource Timing 推断，实际 304 见 CDP`)}
    ${card('分类证据覆盖率', fmt(summary.coveragePercent, '%'), `${summary.classified} / ${summary.total} 条可分类；未知 ${summary.unknown} 条`)}
    ${card('已知传输体积', fmt(finite(summary.transferBytes) ? summary.transferBytes / 1024 : null, ' KiB'), `${summary.transferKnownCount} / ${summary.total} 条有可用字节证据；未知不计 0`)}
    </div>
    ${summary.total ? `<div class="cache-distribution" aria-label="资源记录缓存分类分布">${counts.filter(item => item.count).map(item => `<span style="width:${100 * item.count / summary.total}%;background:${CACHE_COLORS[item.status]}" title="${esc(item.label)}：${item.count} 条"></span>`).join('')}</div>` : '<p class="empty">没有已记录的资源；复用比例、证据覆盖率与传输量均为 N/A。</p>'}
    <div class="cache-legend">${counts.map(item => `<span>${cacheBadge({ status: item.status, label: item.label })}<strong>${item.count}</strong><small>${summary.total ? fmt(100 * item.count / summary.total, '%') : 'N/A'}</small></span>`).join('')}</div>`;
}

function cacheOverview(run) {
  const samples = run.groups.flatMap(group => group.samples);
  const cdpSamples = samples.filter(sample => sample.networkCapture?.available === true);
  const oldSamples = samples.filter(sample => !sample.networkCapture);
  const requested = run.manifest.config?.networkCache?.requested === true;
  const total = values => values.some(finite) ? values.filter(finite).reduce((sum, value) => sum + value, 0) : null;
  const matched = total(samples.map(sample => sample.networkCapture?.entries?.matched));
  const missing = total(samples.map(sample => sample.networkCapture?.missing));
  return `<section id="resource-cache"><div class="section-heading"><div><p class="eyebrow">HTTP 缓存</p><h2>哪些资源复用了缓存</h2></div><span class="tag">${samples.length} 个采集窗口 · 非唯一 URL 去重</span></div>
    <p class="boundary-note">${esc(cacheEnvironmentNote(run.manifest))}</p>
    <div class="metadata" aria-label="全采集 CDP 网络匹配状态"><span>全采集 CDP 可用 ${cdpSamples.length} / ${samples.length} 个窗口</span><span>匹配 ${fmt(matched, ' 条')}</span><span>缺失 / 歧义 ${fmt(missing, ' 条')}</span></div>
    ${requested && cdpSamples.length !== samples.length ? '<p class="warning">本次配置要求 CDP 网络采集，但部分窗口缺少可用网络证据。已保留的时序仍可阅读；基线比较会拒绝将本次降级采集与正常采集混比。</p>' : ''}
    <div data-kpi="all">${cacheSummaryHtml(run.resourceCache)}</div>${run.groups.map(group => `<div data-kpi="${esc(group.alias)}" hidden>${cacheSummaryHtml(group.resourceCache)}</div>`).join('')}
    <p class="muted">本地与协商复用比例的分母仅为“本地复用 + 协商复用 + 网络传输”；协商复用仍有网络往返，真实 304 与时序推断在逐资源证据中区分。Service Worker 和未知独立列出。分布条与证据覆盖率按全部已记录资源计数，多轮相同 URL 各算一条。无资源或无可判定 HTTP 记录时不显示 100%。</p>
    <p class="muted">${oldSamples.length ? `${oldSamples.length} 个窗口没有网络采集记录${requested ? '' : '（旧版或自定义采集）'}，仅按已有 Resource Timing 解释，不能事后补出实际 304、内存 / 磁盘缓存细分或完整响应头。` : ''}普通页面内观测受同源与 Timing-Allow-Origin 限制；0 字节、很快完成或缓存响应头单独出现均不足以证明缓存命中。</p>
    <details${run.manifest.config?.flow === 'cache' ? ' open' : ''}><summary>${run.manifest.config?.flow === 'cache' ? '首访与复访分别看 · 每轮缓存证据' : '每个窗口的缓存覆盖与采集状态'}</summary>${table(['场景 / 轮次', '资源数', '本地 / 协商 / 网络 / SW / 未知', '分类覆盖', '已知传输', '网络证据'], samples.map(sample => [esc(`${sample.label ?? sample.alias} / ${sample.iteration}`), String(sample.resourceCache.total), ['local', 'revalidated', 'network', 'service-worker', 'unknown'].map(status => sample.resourceCache.counts[status]).join(' / '), fmt(sample.resourceCache.coveragePercent, '%'), `${fmt(sample.resourceCache.transferBytes, ' B')} · ${sample.resourceCache.transferKnownCount} 条`, sample.networkCapture ? esc(`${sample.networkCapture.available ? 'CDP 已启用' : 'CDP 不可用'}${sample.networkCapture.reason ? ` · ${sample.networkCapture.reason}` : ''}${sample.networkCapture.truncated ? ' · 网络证据已截断' : ''}${sample.networkCapture.disconnected ? ' · 连接中断' : ''} · 匹配 ${sample.networkCapture.entries?.matched ?? 'N/A'} / 缺失 ${sample.networkCapture.missing ?? 'N/A'}`) : requested ? '缺少要求的 CDP 网络记录' : '旧 / 自定义记录 · 仅 Resource Timing']), samples.map(sample => sample.alias))}</details>
    <p class="muted">传输体积采用 Resource Timing 的浏览器估算值，不等于网卡实际字节。以上分布计数不含主 HTML 文档，CDP 匹配计数包含文档；文档缓存证据在各轮导航详情单独列出。逐资源标签位于加载时间轴和各轮资源瀑布；每轮详情可展开 HTTP 状态、判定依据与安全响应头。</p></section>`;
}
function phaseRows(sample) {
  return [...sample.measures].sort((a, b) => b.duration - a.duration).slice(0, 12).map(entry => [esc(entry.phase), fmt(entry.startTime), fmt(entry.duration), esc(entry.detail?.status ?? '未标记')]);
}
function frameRows(sample) {
  return [['应用窗口', sample.appFrames], ['应用稳定段', sample.stableFrames], ['浏览器 RAF 窗口', sample.browserFrames]].map(([label, stats]) =>
    [label, fmt(stats?.count, ''), fmt(stats?.medianMs), fmt(stats?.p95Ms), fmt(stats?.p99Ms), fmt(stats?.maxMs), fmt(stats?.over33msPercent, '%')]);
}

function stateRows(sample) {
  const flatten = (value, prefix = '') => Object.entries(value ?? {}).flatMap(([key, item]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return item && typeof item === 'object' && !Array.isArray(item) ? flatten(item, name) : [[name, item]];
  });
  const before = Object.fromEntries(flatten(sample.startState));
  const after = Object.fromEntries(flatten(sample.state));
  const labels = { soundEnabled: '声音开启', soundBusy: '声音加载中', soundError: '声音异常', weatherBusy: '天气声音加载中', weatherError: '天气声音异常', paused: '暂停动态', timeOfDay: '昼夜', view: '视图', viewMode: '视图', place: '地点', panorama: '环顾', settingsPanel: '设置面板', volume: '音量', 'weather.wind': '风强度', 'weather.rain': '雨强度', 'weather.autumn': '秋风', 'weather.wetness': '积湿', 'weather.mud': '泥泞', 'weather.preset': '天气预设' };
  const value = item => item == null ? 'N/A' : typeof item === 'boolean' ? item ? '是' : '否' : finite(item) ? fmt(item, '') : Array.isArray(item) ? item.join(', ') : String(item);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].map(key => [labels[key] ?? key, value(before[key]), value(after[key])]);
}

const phaseLabel = entry => `${entry.phase}${entry.detail?.model || entry.detail?.file ? ` [${entry.detail.model || entry.detail.file}]` : ''}${entry.detail?.status ? ` (${entry.detail.status})` : ''}`;
function stutterItems(run) {
  return run.groups.flatMap(group => group.samples.flatMap(sample => sample.stutters.episodes.map(episode => ({ group, sample, episode }))));
}
function frameRateGuideHtml() {
  return `<details class="fps-guide" open><summary>帧率怎么看 <span class="count">新手参考</span></summary>
    <p><strong>Hz 是每秒发生的次数。</strong>本工具的 RAF Hz 表示浏览器每秒调用「准备下一帧」回调的次数，例如 60 Hz 约为每秒 60 次；实时面板用近 5 秒的平均值观察浏览器调度。它不是屏幕实际呈现的 FPS，也不是检测到的屏幕刷新率。</p>
    <p>FPS 是每秒画面更新的次数。下面的参考帮助理解时间尺度，也要看画面是否持续稳定。</p>
    <div class="fps-guide-grid">
      <div><strong>约 60 FPS</strong><span>16.7 ms / 帧</span><p>60 Hz 屏幕下，稳定接近此值是常见的流畅目标。</p></div>
      <div><strong>约 30 FPS</strong><span>33.3 ms / 帧</span><p>通常基本可用，但转动视角时，画面连续性较弱。</p></div>
      <div><strong>低于 30 FPS</strong><span>超过 33.3 ms / 帧</span><p>更容易感到不连贯，需结合具体操作观察。</p></div>
      <div><strong>约 120 FPS</strong><span>8.3 ms / 帧</span><p>120 Hz 等高刷新率屏幕，可参考相应的更高目标。</p></div>
    </div>
    <p class="muted">这些是理解体验的参考，不是统一合格线。实际目标取决于设备、屏幕刷新率、场景复杂度与节能设置。</p>
    <p><strong>平均值正常，也可能有瞬间卡顿。</strong>同时看 p95、最大间隔和停顿事件；p95 表示约 95% 的已记录间隔不超过该值。</p>
    <p><strong>实时读数的颜色怎么判断？</strong>以固定的 60 Hz 为参考，结合近 5 秒的回调频率、p95 和最大间隔，取最严重的一档；主数字与折叠标题显示相同的颜色和状态。</p>
    ${table(['实时状态', '判断条件'], [
      ['<span class="fps-guide-good">绿色 · 合适</span>', '显示频率 ≥55.0 Hz，且 p95 ≤25 ms，且最大间隔 &lt;50 ms。'],
      ['<span class="fps-guide-warning">黄色 · 中等</span>', '不满足绿色条件，也未达到红色条件；实时面板显示具体原因。'],
      ['<span class="fps-guide-danger">红色 · 卡顿</span>', '显示频率 &lt;30.0 Hz，或 p95 ≥50 ms，或最大间隔 ≥100 ms；实时面板显示具体原因。'],
    ])}
    <p class="muted">样本足够时，频率按显示的一位小数判断，间隔按原始值判断。该分级不检测屏幕刷新率，也不是统一的流畅合格线。未采集、暂停、页面隐藏、异常、当前连续采集不足 5 秒或有效间隔累计不足 1 秒时为灰色；重开与恢复后会等待新的完整 5 秒。但本次连续段一旦记录到完整的 ≥100 ms 间隔，会提前显示红色。主线程阻塞期间面板也无法刷新，会在恢复后显示。</p>
    <div class="fps-guide-markers"><span class="fps-guide-warning">单次间隔黄色 ≥50 ms</span><span class="fps-guide-danger">单次间隔红色 ≥100 ms</span><span class="muted">这是实时图表与事件中的停顿标记，区别于上面的实时综合状态；未触发标记，不代表每帧都达到 60 FPS。</span></div>
    <p class="boundary-note">RAF 间隔也不是 CPU 或 GPU 单帧耗时。上述 FPS 参考不改变报告指标的测量口径。</p>
  </details>`;
}
function stutterHtml(run) {
  const items = stutterItems(run), shown = items.slice(0, 160);
  const samples = run.groups.flatMap(group => group.samples);
  const risks = samples.flatMap(sample => sample.stutters.risks.map(risk => ({ sample, risk })));
  const interval = entry => `+${fmt(entry.relativeStartMs)} → +${fmt(entry.relativeEndMs)}`;
  const phaseEvidence = entries => entries.slice(0, 10).map(entry => esc(phaseLabel(entry))).join('<br>') + (entries.length > 10 ? `<br>另 ${entries.length - 10} 项见 summary.json` : '');
  const type = ({ sample, episode }) => sample.navigationLoad && episode.start < (sample.startMs ?? 0) + (sample.metrics.readyMs ?? 0) ? '加载阶段无响应风险' : '该操作期间帧调度停顿';
  const rows = shown.map(item => {
    const { group, sample, episode } = item;
    const taskSupported = sample.probe?.supported?.longtask === true;
    const loafSupported = sample.probe?.supported?.['long-animation-frame'] === true;
    const taskMax = taskSupported ? Math.max(...episode.longTasks.map(entry => entry.duration)) : null;
    const loafMax = loafSupported ? Math.max(...episode.longAnimationFrames.map(entry => entry.duration)) : null;
    const gap = `${fmt(episode.maxGapMs)} · ${episode.maxGapMs >= 300 ? '≥300ms' : episode.maxGapMs >= 100 ? '100–299ms' : '50–99ms'}${episode.crossesStart ? `<br>跨操作起点；窗口内最长重叠 ${fmt(episode.maxOverlapMs)}` : ''}`;
    const evidence = `${phaseEvidence(episode.phases) || '未收到重叠业务阶段'}<br>长任务 ${fmt(taskSupported ? episode.longTasks.length : null, ' 条')} / 最大 ${fmt(taskMax)}；LoAF ${fmt(loafSupported ? episode.longAnimationFrames.length : null, ' 条')} / 最大 ${fmt(loafMax)}`;
    return [esc(group.label), esc(sample.iteration), interval(episode), `${type(item)}<br>${episode.gaps.length} 个长间隔`, gap, evidence, `<a href="${relativeLink(sample.file)}">JSON</a>`];
  });
  const rateRows = samples.map(sample => [esc(sample.label ?? sceneLabels[sample.alias] ?? sample.alias), esc(sample.iteration), fmt(sample.browserFrames?.maxMs), fmt(sample.metrics.stableMeanHz, ' Hz'), fmt(sample.metrics.stableTypicalHz, ' Hz')]);
  const ranked = [...items].sort((a, b) => b.episode.maxGapMs - a.episode.maxGapMs);
  const cards = ranked.map(({ group, sample, episode }, index) => {
    const duringRun = finite(sample.metrics.readyMs) && episode.start >= (sample.startMs ?? 0) + sample.metrics.readyMs;
    const first = sample.stutters.episodes[0] === episode;
    return `<article class="stall-card" data-stutter-card data-scene="${esc(group.alias)}" data-gap="${episode.maxGapMs}" data-first="${first}" data-running="${duringRun}"${index >= 6 ? ' hidden' : ''}>
      <div class="stall-heading"><span>${esc(group.label)} <span class="muted">· 第 ${esc(sample.iteration)} 轮</span></span><strong>${fmt(episode.maxGapMs)}</strong></div>
      <div class="muted">${type({ sample, episode })} · ${interval(episode)}</div>
      <p>${episode.phases.length ? esc(phaseLabel(episode.phases[0])) : '未收到重叠业务阶段'}${episode.phases.length > 1 ? `<span class="muted"> · 另 ${episode.phases.length - 1} 项见完整表</span>` : ''}</p>
      <div class="stall-foot">${episode.crossesStart ? `<span class="caution">跨操作起点；窗口内最长重叠 ${fmt(episode.maxOverlapMs)}</span>` : '<span class="muted">重叠仅为线索，需调用栈核对</span>'}<a href="${relativeLink(sample.file)}">原始 JSON ↗</a></div>
    </article>`;
  }).join('');
  return `<section id="stutters"><div class="section-heading"><div><p class="eyebrow">停顿定位</p><h2>哪里打断了流畅感</h2></div><label class="control">查看 <select id="stutter-selector"><option value="worst">最严重的停顿</option><option value="first">各段首次停顿</option><option value="running">运行中 · 就绪后</option></select></label></div>
    ${frameRateGuideHtml()}
    <p class="muted">按最长间隔排序，最多显示 6 项。“各段首次”指每个场景、每轮观察窗口内的第一个片段；“运行中”指轮询近似就绪之后。均只基于已保留证据。</p>
    <div class="stall-grid">${cards}</div><p id="stutter-count" class="muted" aria-live="polite"></p>
    <p id="stutter-empty" class="empty"${items.length ? ' hidden' : ''}>${samples.some(sample => sample.stutters.available) ? '当前选择未发现已保留的 ≥50ms RAF 间隔；不代表没有屏幕卡顿。' : 'N/A · 缺少浏览器 RAF 记录，无法定位帧调度停顿。'}</p>
    <p class="boundary-note">${samples.some(sample => sample.stutters.partial) ? '部分窗口已截断或覆盖；这里只代表已保留片段，不能声称完整。' : '窗口结束时尚未完成的最后一个 RAF 间隔不可观测。'} RAF 是前台回调调度，不是实际屏幕 FPS 或 GPU 耗时。</p>
    <details><summary>完整卡顿证据表 <span class="count">${shown.length} / ${items.length} 个已保留片段</span></summary>
    <p class="muted">前台 RAF ≥50ms 是诊断候选，50 / 100 / 300ms 仅用于分级，不是浏览器卡顿标准。相隔 ≤20ms 合并为连续片段。区间相对操作采集起点，首屏相对导航。跨起点只展示窗口内交集，不能整段归因于当前操作。暂停动态不自动判卡顿；采集器自身也可能产生长任务。</p>
    ${rows.length ? table(['操作', '轮次', '相对操作起点', '观察类型', '最长 RAF 间隔', '重叠业务与主线程证据', '原始'], rows, shown.map(item => item.group.alias)) : '<p class="muted">N/A · 没有对应片段。</p>'}
    <p class="muted">全量已保留片段见 summary.json。表格最多展示前 160 项，不证明屏幕冻结或 GPU 阻塞。</p></details>
    <details><summary>每轮最大间隔与稳定调度率 <span class="count">${samples.length} 个窗口</span></summary>${table(['操作', '轮次', '窗口内完整 RAF 间隔最大值', '稳定段平均 RAF 回调率', '稳定段典型应用回调率'], rateRows, samples.map(sample => sample.alias))}
    <p class="muted">60Hz 大约表示每 16.7ms 有一次更新画面的机会；一次很长的间隔仍可能明显打断交互，不能只看平均值。平均回调率为 1000 / 前台 RAF 平均间隔；典型应用回调率为 1000 / 应用稳定段间隔中位数。二者不是屏幕 FPS 或 GPU 帧率；缺数据为 N/A。完整间隔最大值不包含跨操作起点的间隔，跨界证据见上表。</p>
    </details><details><summary>没有对应 RAF 证据的长任务风险 <span class="count">${risks.length} 条已保留记录</span></summary>${risks.length ? table(['操作 / 轮次', '窗口内区间', '完整任务耗时', '业务重叠', '原始'], risks.slice(0, 80).map(({ sample, risk }) => [esc(`${sample.label ?? sample.alias} / ${sample.iteration}`), interval(risk), fmt(risk.duration), phaseEvidence(risk.phases) || 'N/A', `<a href="${relativeLink(sample.file)}">JSON</a>`]), risks.slice(0, 80).map(item => item.sample.alias)) : `<p>${samples.length && samples.every(sample => sample.probe?.supported?.longtask === true) ? '保留记录中没有孤立长任务。' : 'N/A · 部分或全部窗口未采集长任务或 API 不支持，无法判断是否存在孤立长任务。'}</p>`}<p class="muted">该表只提示主线程风险，不推断画面停住；最多展示 80 条，全部保留在 summary.json。${samples.some(sample => sample.probe?.supported?.longtask !== true) ? '未采集或不支持长任务的窗口为未知，不计为零。' : ''}任务可跨越窗口边界，完整耗时不全属于当前操作。</p></details></section>`;
}

function initialTimeline(sample) {
  if (!sample.navigationLoad) return '';
  const navigation = [], boundaries = [];
  for (const entry of sample.navigation.slice(0, 1)) {
    for (const [name, from, to] of [['DNS 查询', 'domainLookupStart', 'domainLookupEnd'], ['连接建立', 'connectStart', 'connectEnd'], ['TLS 握手', 'secureConnectionStart', 'connectEnd'], ['请求至首字节', 'requestStart', 'responseStart'], ['HTML 响应接收', 'responseStart', 'responseEnd'], ['响应结束至 DOM 可交互', 'responseEnd', 'domInteractive']]) {
      if (finite(entry[from]) && finite(entry[to]) && entry[to] > entry[from] && (from !== 'secureConnectionStart' || entry[from] > 0)) navigation.push({ name, startTime: entry[from], duration: entry[to] - entry[from] });
    }
    for (const [name, key] of [['DOM 可交互', 'domInteractive'], ['DOMContentLoaded 结束', 'domContentLoadedEventEnd'], ['页面 load 结束', 'loadEventEnd']]) if (entry[key] > 0 && finite(entry[key])) boundaries.push({ name, startTime: entry[key], duration: 0, boundary: true });
  }
  const phases = sample.measures.map(entry => ({ ...entry, name: phaseLabel(entry) }));
  const first = phases.find(entry => entry.detail?.phase === 'startup.initial-frame-submit');
  if (first) boundaries.push({ name: '首帧提交结束', startTime: first.startTime + first.duration, duration: 0, boundary: true });
  if (finite(sample.metrics.readyMs)) boundaries.push({ name: '轮询确认适配器就绪条件', startTime: (sample.startMs ?? 0) + sample.metrics.readyMs, duration: 0, boundary: true });
  const resources = sample.resources.map(entry => ({ ...entry, name: resourceLabel(entry) }));
  const stalls = sample.stutters.episodes.map(entry => ({ name: `RAF 调度停顿 · 最长间隔 ${fmt(entry.maxGapMs)}${entry.crossesStart ? ' · 跨起点' : ''}`, startTime: entry.start, duration: entry.end - entry.start }));
  const valid = entries => entries.filter(entry => finite(entry.startTime) && entry.startTime >= 0 && finite(entry.duration) && entry.duration >= 0 && finite(entry.startTime + entry.duration));
  const all = valid([...navigation, ...boundaries, ...phases, ...resources, ...stalls]);
  const end = finite(sample.endMs) && sample.endMs > 0 ? sample.endMs : Math.max(1, ...all.map(entry => entry.startTime + entry.duration));
  return unifiedTimelineLayers(sample, navigation, boundaries, phases, resources, stalls, valid, end);
}

function unifiedTimelineLayers(sample, navigation, boundaries, phases, resources, stalls, valid, end) {
  const axis = `<div class='waterfall'><span>导航起点为 0ms</span><div style='position:relative;height:24px;font-variant-numeric:tabular-nums'>${[0, .25, .5, .75, 1].map(fraction => `<span style='position:absolute;left:${100 * fraction}%;transform:translateX(${fraction === 0 ? 0 : fraction === 1 ? -100 : -50}%);white-space:nowrap'>${fmt(end * fraction)}</span>`).join('')}</div><span>耗时</span></div>`;
  const layer = (title, entries, color, limit, open = true) => {
    const within = valid(entries).filter(entry => entry.startTime <= end).sort((a, b) => a.startTime - b.startTime);
    const bars = within.slice(0, limit).map(entry => {
      const start = Math.min(end, entry.startTime), finish = Math.min(end, entry.startTime + entry.duration), marker = entry.duration === 0;
      const label = `${entry.name} · ${fmt(entry.startTime)} → ${fmt(entry.startTime + entry.duration)}`;
      return `<div class='waterfall${entry.cache ? ' resource-waterfall' : ''}'>${entry.cache ? resourceName(entry) : `<span title='${esc(label)}'>${esc(entry.name)}</span>`}<div class='track timeline-track'><i style='left:${100 * start / end}%;width:${marker ? '2px' : `${100 * (finish - start) / end}%`};background:${entry.cache ? cacheColor(entry.cache) : color}${marker ? ';transform:translateX(-1px)' : ''}'></i></div><span>${entry.boundary ? '时间边界' : fmt(entry.duration)}</span></div>`;
    });
    return `<details${open ? ' open' : ''}><summary>${esc(title)} · ${within.length} 条${within.length > limit ? `，显示前 ${limit} 条` : ''}</summary>${axis}${bars.join('') || `<p class='muted'>N/A · 未采集到对应条目</p>`}${within.length > limit ? `<p class='muted'>显示数量有界，全部保留记录见 <a href='${relativeLink(sample.file)}'>原始 JSON</a>。</p>` : ''}</details>`;
  };
  return `<p class='muted'>统一尺度：导航 0ms → ${fmt(end)}。横条为真实区间，细线为时间边界；末尾固定观察时长不是加载耗时。各层可能重叠，禁止加总；CPU 首帧提交不等于 GPU 完成或屏幕呈现。悬停可看完整名称与原始边界。</p>${layer('浏览器导航与就绪边界', [...navigation, ...boundaries], '#9ac5cc', 20)}${layer('业务阶段 · 展开看并行关系', phases, '#a4c99e', 500, false)}${layer('资源请求', resources, '#d6b379', 200, false)}${layer('前台 RAF 停顿', stalls, '#dca69a', 160, false)}<p class='muted'>停顿只代表已保留的 RAF 证据；${sample.stutters.partial ? '该窗口存在截断或覆盖，不能认为图中片段完整。' : '尚未结束的最后一个间隔不可观测。'}</p>`;
}

function sampleHtml(sample) {
  const diagnostic = sample.diagnostics;
  const resources = sample.resources.filter(entry => finite(entry.startTime) && finite(entry.duration));
  const tasks = sample.probe?.longTasks, loaf = sample.probe?.longAnimationFrames;
  const taskCount = sample.probe?.supported?.longtask ? asArray(tasks).length : null;
  const loafCount = sample.probe?.supported?.['long-animation-frame'] ? asArray(loaf).length : null;
  const largest = [...resources].sort((a, b) => (b.encodedBodySize || 0) - (a.encodedBodySize || 0)).slice(0, 12);
  return `<details><summary>第 ${esc(sample.iteration)} 轮 · ${fmt(sample.metrics.readyMs)} 近似就绪 · ${fmt(sample.metrics.p95Ms)} 应用 p95</summary>
    <p><a href="${relativeLink(sample.file)}">原始场景 JSON</a> · 窗口 ${fmt(sample.startMs)} → ${fmt(sample.endMs)} · 末端可见性 ${esc(sample.visibility ?? 'N/A')}</p>
    <p class="muted">完成条件：${esc(sample.completionRule ?? 'N/A')}</p>
    ${sample.navigationLoad ? `<p><a href="#timeline" data-jump-timeline data-timeline-scene="${esc(sample.alias)}" data-timeline-iteration="${esc(sample.iteration)}">查看本轮${sample.initial ? '首次加载' : '缓存复访'}统一时间轴 ↑</a></p>` : ''}
    ${sample.cacheCondition ? `<p class="muted">访问条件：${esc(sample.cacheCondition)}</p>` : ''}
    ${sample.preparations.length ? `<p class="muted">窗口前准备（不计入本段性能）：${sample.preparations.map(preparation => `${esc(preparation.label)} / ${fmt(preparation.elapsedMs)}`).join('；')}。准备前后状态保留在 summary.json 与原始记录。</p>` : ''}
    <h4>操作前后状态</h4>${sample.state || sample.startState ? table(['状态', '操作前', '观察窗口结束'], stateRows(sample).map(row => row.map(esc))) : '<p class="muted">N/A · 此采集未记录按钮状态快照，不从帧率推断声音是否开启。</p>'}
    ${table(['帧来源', '样本数', '中位数', 'p95', 'p99', '最大值', '>33.33ms'], frameRows(sample))}
    <p class="muted">${esc(sample.adapter?.frameLimitation ?? '适配器未声明应用帧采样规则。')} 浏览器 RAF 从注入后开始，不能代替实际呈现帧。原始应用样本${sample.frameSamplesTruncated ? '已截断，统计使用采集端完整汇总' : '未标记截断'}。浏览器原始样本${sample.probe?.frameSamplesTruncated ? finite(sample.probe?.frameSummary?.count) ? '已截断，统计使用采集端完整汇总' : '已截断且缺少完整汇总，浏览器帧指标为 N/A' : '未标记截断'}，排除帧 ${fmt(sample.probe?.excludedFrames, '')}，后台时间 ${fmt(sample.probe?.hiddenDurationMs)}。</p>
    ${table(['末端快照', '值'], [['设备模式', esc(diagnostic.quality ?? 'N/A')], ['GPU', esc(diagnostic.gpu ?? 'N/A')], ['即时浏览器 viewport / DPR', sample.browserViewport ? `${fmt(sample.browserViewport.width, '')} × ${fmt(sample.browserViewport.height, '')} / ${fmt(sample.browserViewport.pixelRatio, '')}` : 'N/A'], ['即时浏览器 outer size', sample.browserViewport ? `${fmt(sample.browserViewport.outerWidth, '')} × ${fmt(sample.browserViewport.outerHeight, '')}` : 'N/A'], ['诊断 viewport', esc(diagnostic.viewport?.join(' × ') ?? 'N/A')], ['实际 drawSize', esc(diagnostic.drawSize?.join(' × ') ?? 'N/A')], ['渲染 pixelRatio', fmt(diagnostic.pixelRatio, '')], ['draw calls', fmt(diagnostic.drawCalls, '')], ['triangles', fmt(diagnostic.triangles, '')], ['纹理 / 几何体数量', `${fmt(diagnostic.textures, '')} / ${fmt(diagnostic.geometries, '')}`]])}
    <p class="muted">浏览器尺寸在窗口结束时即时读取；场景诊断的刷新规则由适配器声明，缺少记录为未知。renderer 计数不是窗口平均值或显存字节。</p>
    <h4>浏览器长任务与长动画帧</h4><p>保留的长任务 ${fmt(taskCount, ' 条')}，长动画帧 ${fmt(loafCount, ' 条')}；不支持或未注入时为 N/A，缓冲覆盖时不代表窗口总数。二者可能重叠，不相加。条目可能包含轮询、截图、trace 采样等采集开销，不能仅凭数量归因于产品代码或宣称优化收益；须回到调用栈核对。</p>
    ${waterfall([...asArray(tasks).map(entry => ({ ...entry, name: '长任务' })), ...asArray(loaf).map(entry => ({ ...entry, name: '长动画帧' }))], entry => entry.name)}
    <h4>业务阶段</h4><p class="muted">阶段均为墙钟时间，不能解释为纯 CPU/GPU 耗时。${esc(sample.adapter?.phaseLimitation ?? '业务阶段的具体开始和完成语义由应用埋点定义。')}</p>${waterfall(sample.measures, entry => entry.phase)}
    ${sample.measures.length ? table(['耗时较长的阶段', '开始', '耗时', '状态'], phaseRows(sample)) : `<p class="muted">${sample.businessPhases?.enabled ? '业务埋点已开启，本操作未产生业务阶段；面板或音量操作可以只有浏览器帧与主线程证据。' : '未收到业务阶段，不能将调用栈自动归因到模型解析或室内管线。'}</p>`}
    <h4>资源瀑布</h4>${waterfall(resources, resourceLabel)}
    <h4>较大资源</h4>${table(['资源 / 缓存', '请求耗时', '编码体积', '已知传输体积'], largest.map(entry => [resourceName(entry), fmt(entry.duration), finite(entry.cache.encodedBodyBytes) ? fmt(entry.cache.encodedBodyBytes / 1024, ' KiB') : 'N/A', finite(entry.cache.transferBytes) ? fmt(entry.cache.transferBytes / 1024, ' KiB') : 'N/A']))}
    <p class="muted">资源条目只覆盖采集脚本保留的窗口，不代表所有启动依赖。本轮分类 ${sample.resourceCache.classified} / ${sample.resourceCache.total} 条；已知传输 ${fmt(sample.resourceCache.transferBytes, ' B')}。未知体积不计 0。</p>
    ${cacheEvidenceHtml(sample)}
    ${sample.navigationLoad ? `<h4>${sample.initial ? '首次' : '复访'}页面导航</h4>${table(['DOMContentLoaded', 'loadEventEnd', 'responseStart'], sample.navigation.map(entry => [fmt(entry.domContentLoadedEventEnd), fmt(entry.loadEventEnd), fmt(entry.responseStart)]))}<h4>主 HTML 文档缓存（不计入资源分布）</h4>${table(['文档 / 分类', '开始 / 耗时', 'HTTP 状态', '已知传输量', '判定依据', '安全响应头'], cacheEvidenceRows(sample.navigation))}` : '<p class="muted">本段为同页交互，未重复展示初始 Navigation Timing。</p>'}
  </details>`;
}

function nextSteps(run) {
  const ranked = run.groups.filter(group => finite(group.medians.readyMs)).sort((a, b) => b.medians.readyMs - a.medians.readyMs);
  const initial = ranked.find(group => group.initial), interaction = ranked.find(group => !group.navigationLoad);
  const notes = [];
  if (initial) notes.push(`首屏近似就绪中位数 ${fmt(initial.medians.readyMs)}。用 initial-3d 的 trace 检查导航、下载、主线程和业务阶段的重叠与关键路径。`);
  if (interaction) notes.push(`交互中近似就绪最长的是「${interaction.label}」：${fmt(interaction.medians.readyMs)}。先核对轮询与固定等待，再检查该视图 trace 中的长任务、绘制和管线准备。`);
  const worst = [...run.groups].filter(group => finite(group.medians.stableP95Ms)).sort((a, b) => b.medians.stableP95Ms - a.medians.stableP95Ms)[0];
  if (worst) notes.push(`稳定观察段应用帧 p95 最高的是「${worst.label}」：${fmt(worst.medians.stableP95Ms)}。在对应 trace 分离每帧更新与提交开销，需要 GPU 归因时另行抓帧。`);
  notes.push('这些排序指出优先查看的证据，不证明慢在 CPU、GPU、网络或某个具体函数。');
  return notes;
}

function comparisonHtml(compare) {
  if (!compare) return '<p>未指定基线；本报告可单独阅读。</p>';
  const condition = compare.conditionsComparable ? '<p>已记录的环境配置一致；按适配器声明逐场景核对操作前后离散状态，只有可比场景展示中位数差值。耗时差值正值表示更慢，RAF Hz 差值正值表示回调更频繁。连续天气插值不参与相等判断。</p>' : `<p>当前与基线环境条件不可直接比较，未计算差值。</p><ul>${compare.reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>`;
  const movement = (metric, unit) => metric ? `${fmt(metric.baseline, unit)} → ${fmt(metric.current, unit)}<br>差值 ${fmt(metric.delta, unit)}${metric.complete === false ? '<br>部分轮次无效，不计算差值' : ''}` : 'N/A';
  const rounds = values => values.map(value => `第 ${esc(value.iteration)} 轮：${fmt(value.maxRafMs)} / ${fmt(value.stableMeanHz, ' Hz')}`).join('<br>');
  const validScenes = compare.scenes.filter(scene => scene.comparable);
  return condition + asArray(compare.notes).map(note => `<p class='muted'>${esc(note)}</p>`).join('') + table(['场景', '状态检查', '近似就绪差值', '应用 p95 差值', '完整 RAF 最大间隔的逐轮中位数', '稳定平均 RAF Hz 的逐轮中位数', '原因与未核对项'], compare.scenes.map(scene => [esc(scene.label ?? scene.alias), scene.comparable ? '可比较' : '不可比较', fmt(scene.metrics?.readyMs?.delta), fmt(scene.metrics?.p95Ms?.delta), movement(scene.metrics?.maxRafMs, ' ms'), movement(scene.metrics?.stableMeanHz, ' Hz'), [...scene.reasons, ...scene.notes].map(esc).join('<br>') || (compare.comparable ? '已记录的离散状态一致' : '见环境条件原因')]), compare.scenes.map(scene => scene.alias)) +
    `<p class='muted'>间隔差值为负表示该统计量下降；Hz 差值为正表示平均调度频率增加。二者不是实际屏幕帧率或优化的因果证明。最大间隔只取完全在窗口内的前台 RAF 间隔，跨边界证据另见卡顿表。缺少任何一轮有效峰值或平均频率时，对应差值为 N/A。</p>` +
    (validScenes.length ? `<h4>逐轮卡顿峰值与稳定平均调度率</h4>${table(['场景', '基线各轮：最大间隔 / 平均 RAF Hz', '当前各轮：最大间隔 / 平均 RAF Hz'], validScenes.map(scene => [esc(scene.label ?? scene.alias), rounds(scene.rounds.baseline), rounds(scene.rounds.current)]), validScenes.map(scene => scene.alias))}<p class='muted'>中位数不能掩盖单轮尖峰；请逐轮查看原始峰值、停顿区间及调用栈。三轮差值没有自动统计显著性结论。</p>` : '');
}

function dashboardCards(run, selected) {
  const groups = selected ? [selected] : run.groups;
  const samples = groups.flatMap(group => group.samples);
  const initial = run.groups.find(group => group.initial);
  const slowest = [...run.groups].filter(group => !group.navigationLoad && finite(group.medians.readyMs)).sort((a, b) => b.medians.readyMs - a.medians.readyMs)[0];
  const longest = [...samples].filter(sample => finite(sample.browserFrames?.maxMs)).sort((a, b) => b.browserFrames.maxMs - a.browserFrames.maxMs)[0];
  const readyCount = groups.reduce((count, group) => count + group.metricSampleCounts.readyMs, 0);
  const card = (label, value, note, tone = '') => `<article class="metric-card ${tone}"><span class="metric-label">${esc(label)}</span><strong>${value}</strong><span class="metric-note">${esc(note)}</span></article>`;
  return `<div class="metric-grid" data-kpi="${esc(selected?.alias ?? 'all')}"${selected ? ' hidden' : ''}>
    ${card(selected ? '近似就绪 · 逐轮中位数' : '首屏近似就绪 · 中位数', fmt((selected ?? initial)?.medians.readyMs), selected?.label ?? `${initial?.samples.length ?? 0} 轮首屏；外部轮询确认，非 GPU 完成`)}
    ${selected ? card('稳定段平均 RAF 回调率', fmt(selected.medians.stableMeanHz, ' Hz'), '逐轮平均频率的中位数；不是屏幕 FPS') : card('最慢交互 · 就绪中位数', fmt(slowest?.medians.readyMs), slowest?.label ?? 'N/A · 没有同页交互数据')}
    ${card('最长完整 RAF 间隔', fmt(longest?.browserFrames.maxMs), longest ? `${longest.label ?? longest.alias} · 第 ${longest.iteration} 轮；跨起点间隔另见停顿定位` : 'N/A · 没有有效完整前台 RAF 间隔', 'metric-caution')}
    ${card('有效就绪样本', `${readyCount}<small> / ${samples.length}</small>`, `${new Set(samples.map(sample => sample.iteration)).size} 个已记录轮次 · ${groups.length} 个场景；帧数据有效性另列`)}
  </div>`;
}

function sceneOverview(run) {
  const metrics = [['readyMs', '近似就绪', ' ms'], ['maxRafMs', '逐轮最大 RAF 间隔 · 中位数', ' ms'], ['stableMeanHz', '稳定平均 RAF 回调率', ' Hz']];
  const scales = Object.fromEntries(metrics.map(([key]) => [key, Math.max(1, ...run.groups.map(group => group.medians[key]).filter(finite), ...asArray(run.comparison?.scenes).map(scene => scene.metrics?.[key]?.baseline).filter(finite))]));
  const bar = (value, scale, unit, baseline = false) => `<div class="bar-line"><span class="bar-track">${finite(value) ? `<i class="${baseline ? 'baseline-bar' : ''}" style="width:${Math.max(0, Math.min(100, value / scale * 100))}%"></i>` : ''}</span><span>${fmt(value, unit)}</span></div>`;
  return `<section id="overview"><div class="section-heading"><div><p class="eyebrow">场景总览</p><h2>先看哪一个操作更慢</h2></div><div class="legend"><span><i></i> 当前</span>${run.comparison ? '<span><i class="baseline-bar"></i> 可比基线</span>' : ''}</div></div>
    <p class="muted">同一指标的横条使用统一尺度。每个数字都是逐轮指标的中位数；下方停顿定位保留单次尖峰。首屏与交互分别命名，不重复使用导航指标。</p>
    <div class="scene-overview">${run.groups.map(group => {
      const compared = run.comparison?.scenes.find(scene => scene.alias === group.alias);
      return `<article class="scene-card" data-scene="${esc(group.alias)}"><div class="scene-name"><span class="tag">${group.initial ? '初次加载' : group.navigationLoad ? '页面复访' : '同页交互'}</span><h3>${esc(group.label)}</h3><p class="muted">${group.samples.length} 轮 · 就绪有效 n=${group.metricSampleCounts.readyMs}</p><a href="#details" data-pick-scene="${esc(group.alias)}">查看逐轮证据 →</a></div>
      ${metrics.map(([key, label, unit]) => `<div class="scene-metric"><span class="metric-label">${esc(label)}</span>${bar(group.medians[key], scales[key], unit)}${compared?.comparable ? bar(compared.metrics[key].baseline, scales[key], unit, true) : ''}<small>${compared ? compared.comparable ? `差值 ${fmt(compared.metrics[key].delta, unit)}${compared.metrics[key].complete === false ? ' · 部分轮次无效' : ''}` : '基线不可比 · 原因见比较区' : `有效 n=${group.metricSampleCounts[key]}`}</small></div>`).join('')}</article>`;
    }).join('') || '<p class="empty">N/A · 未取得可展示的场景。</p>'}</div>
    <p class="boundary-note">间隔下降与回调频率上升是观察结果，不自动证明优化收益。N/A 不绘制横条；后台、截断和比较资格见下方证据。</p></section>`;
}

function timelineOverview(run) {
  const navigationGroups = run.groups.filter(group => group.navigationLoad);
  return `<section id="timeline">${navigationGroups.map((group, groupIndex) => `<div data-scene="${esc(group.alias)}"><div class="section-heading"><div><p class="eyebrow">${group.initial ? '首次页面加载' : '同会话缓存复访'}</p><h2>${group.initial ? '从进入页面到近似就绪' : '再次导航的完整加载时间轴'}</h2></div><label class="control">轮次 <select id="${groupIndex ? `timeline-selector-${groupIndex}` : 'timeline-selector'}" data-timeline-selector data-group="${groupIndex}" data-scene-alias="${esc(group.alias)}">${group.samples.map((sample, index) => `<option value="${index}" data-iteration="${esc(sample.iteration)}">第 ${esc(sample.iteration)} 轮 · ${fmt(sample.metrics.readyMs)}</option>`).join('')}</select></label></div>
    ${group.samples.map((sample, index) => `<div data-timeline-group="${groupIndex}" data-timeline-round="${index}"${index ? ' hidden' : ''}><div class="timeline-caption"><strong>${fmt(sample.metrics.readyMs)} <span class="muted">近似就绪</span></strong><a href="${relativeLink(sample.file)}">本轮原始 JSON ↗</a></div>${initialTimeline(sample)}</div>`).join('')}</div>`).join('') || '<p class="empty">N/A · 未记录页面导航数据。</p>'}</section>`;
}

const reportStyles = `
:root{color-scheme:dark;--bg:#0c1915;--panel:#13231f;--panel-raised:#192c25;--border:#30463a;--text:#dce8df;--muted:#a4b8aa;--accent:#b0d5ad;--amber:#e1bc86;--danger:#e0a197}
*{box-sizing:border-box}[hidden]{display:none!important}html{scroll-behavior:smooth;scroll-padding-top:95px}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.65 system-ui,-apple-system,'PingFang SC',sans-serif;font-variant-numeric:tabular-nums}main{max-width:1420px;margin:auto;padding:36px 40px 80px}h1,h2,h3,h4,p{margin-top:0}h1{font-size:30px;letter-spacing:.04em;line-height:1.3;margin-bottom:10px}h2{font-size:23px;line-height:1.35;margin-bottom:8px}h3{font-size:16px;margin:8px 0}h4{font-size:15px;margin-top:22px}a{color:var(--accent);text-underline-offset:4px}a:hover{color:#e4f0db}button,select{font:inherit}select{background:#0d1e17;color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 30px 8px 10px;max-width:100%}select:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:4px}section{margin-top:42px;scroll-margin-top:95px}.muted{color:var(--muted);font-size:12px}.caution{color:var(--amber)}.eyebrow{color:var(--accent);font-size:11px;letter-spacing:.16em;margin-bottom:8px}.report-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.header-aside{text-align:right;max-width:380px}.status{display:inline-flex;gap:7px;align-items:center;border:1px solid var(--border);background:var(--panel);border-radius:24px;padding:5px 12px;font-size:12px}.status:before{content:'';width:6px;height:6px;border-radius:50%;background:var(--accent)}.status.incomplete{color:var(--amber)}.status.incomplete:before{background:var(--amber)}.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;gap:18px;align-items:center;padding:14px 0;margin:24px 0;background:#0c1915f5;backdrop-filter:blur(12px);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.toolbar nav{display:flex;gap:20px;flex-wrap:wrap}.toolbar a{text-decoration:none;font-size:13px}.control{display:flex;gap:10px;align-items:center;color:var(--muted);font-size:12px}.control select{max-width:340px}.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.metric-card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:20px;display:flex;flex-direction:column;gap:12px;min-height:160px}.metric-label{font-size:12px;color:var(--muted)}.metric-card strong{font-size:29px;font-weight:550;line-height:1.2;color:#e6efdf;white-space:nowrap}.metric-card small{font-size:17px;font-weight:400;color:var(--muted)}.metric-caution strong{color:var(--amber)}.metric-note{font-size:11px;color:var(--muted);line-height:1.5}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:12px}.legend{display:flex;gap:18px;font-size:12px;color:var(--muted)}.legend span{display:flex;gap:7px;align-items:center}.legend i{display:inline-block;width:18px;height:6px;background:var(--accent);border-radius:2px}.legend .baseline-bar,.bar-track .baseline-bar{background:#6d8c7b}.scene-overview{display:grid;gap:10px}.scene-card{display:grid;grid-template-columns:1.2fr repeat(3,1fr);gap:26px;align-items:center;background:var(--panel);border:1px solid var(--border);border-radius:9px;padding:18px 20px}.scene-name p{margin:0 0 5px}.scene-name a{font-size:11px;text-decoration:none}.tag,.count{font-size:10px;font-weight:400;background:#accab014;color:var(--muted);padding:3px 7px;border-radius:4px}.scene-metric small{display:block;font-size:10px;color:var(--muted);margin-top:6px}.bar-line{display:grid;grid-template-columns:1fr 82px;gap:10px;align-items:center;font-size:12px;margin-top:10px}.bar-track{position:relative;display:block;height:7px;background:#a8c3ae12;border-radius:2px;overflow:hidden}.bar-track i{display:block;height:100%;background:var(--accent)}.boundary-note{border-left:2px solid #587362;color:var(--muted);font-size:12px;padding:2px 0 2px 12px;margin:18px 0}.warning{border:1px solid #795f3e;background:#302a1c;border-radius:8px;padding:14px 18px;margin:18px 0;color:#e6c99f}.warning ul{margin-bottom:0}.warning details{background:transparent;border-color:#79644455;margin-bottom:0}.stall-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.stall-card{background:var(--panel);border:1px solid var(--border);border-left:3px solid #b68b61;border-radius:8px;padding:18px}.stall-heading{display:flex;justify-content:space-between;gap:18px;margin-bottom:6px;font-size:13px}.stall-heading strong{color:var(--amber);white-space:nowrap;font-size:19px;font-weight:550}.stall-card p{font-size:12px;margin:14px 0 12px;overflow-wrap:anywhere}.stall-foot{display:flex;justify-content:space-between;gap:12px;font-size:11px}.stall-foot a{white-space:nowrap}.empty{background:var(--panel);border:1px dashed var(--border);border-radius:8px;padding:24px;color:var(--muted)}details{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:15px 18px;margin:12px 0}summary{cursor:pointer;font-size:13px;font-weight:550;color:var(--text)}summary::marker{color:var(--accent)}details[open]>summary{margin-bottom:18px}summary .count{margin-left:8px}table{width:100%;border-collapse:collapse;background:var(--panel);font-size:12px}th,td{text-align:left;padding:11px 12px;border-bottom:1px solid #b9d1bd20;vertical-align:top}th{font-size:11px;color:var(--muted);font-weight:500}td{overflow-wrap:anywhere}tr:last-child td{border-bottom:0}.table-wrap{overflow-x:auto;margin:12px 0}.waterfall{display:grid;grid-template-columns:minmax(160px,34%) 1fr 105px;gap:14px;font-size:11px;align-items:center;margin:9px 0}.waterfall>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.track{height:11px;position:relative;background:#b1c7b913;overflow:hidden;border-radius:2px}.track i{position:absolute;height:100%;background:#8db298;min-width:1px}.timeline-track{background:repeating-linear-gradient(to right,#b1c7b910 0,#b1c7b910 calc(25% - 1px),#8eaf9735 calc(25% - 1px),#8eaf9735 25%)}.timeline-caption{display:flex;justify-content:space-between;gap:20px;align-items:center;background:var(--panel-raised);padding:15px 18px;border:1px solid var(--border);border-radius:8px;margin-bottom:16px}.timeline-caption strong{font-size:22px;font-weight:500}.timeline-caption a{font-size:12px}.metadata{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.metadata span{background:var(--panel-raised);border:1px solid var(--border);padding:5px 9px;border-radius:4px;font-size:11px}code{overflow-wrap:anywhere;font-size:12px}.detail-scene{margin-top:18px}.footer-note{margin-top:34px;color:var(--muted);font-size:11px}.view-label{margin:12px 0;color:var(--muted);font-size:12px}
@media(max-width:1050px){main{padding:26px 24px 60px}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.scene-card{grid-template-columns:repeat(3,1fr);gap:16px}.scene-name{grid-column:1/-1;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.scene-name h3,.scene-name p{margin:0}.scene-name a{margin-left:auto}.toolbar{align-items:flex-start;flex-direction:column;gap:10px}.toolbar nav{gap:16px}html{scroll-padding-top:130px}section{scroll-margin-top:130px}}
@media(max-width:650px){main{padding:20px 14px 45px}h1{font-size:25px}h2{font-size:20px}.report-header{display:block}.header-aside{text-align:left;margin-top:14px}.metric-card{padding:15px;min-height:155px}.metric-card strong{font-size:22px}.metric-grid{gap:10px}.section-heading{align-items:flex-start;flex-direction:column;gap:10px}.scene-card{grid-template-columns:1fr;padding:16px}.scene-name{display:block}.scene-name h3{margin:8px 0}.scene-name p{margin-bottom:5px}.scene-metric{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;align-items:center}.scene-metric small{grid-column:2}.bar-line{margin-top:0;grid-template-columns:1fr 75px}.stall-grid{grid-template-columns:1fr}.stall-heading{gap:10px}.stall-foot{flex-direction:column;gap:6px}.waterfall{grid-template-columns:115px minmax(90px,1fr) 78px;gap:8px;font-size:10px}.control select{max-width:calc(100vw - 110px)}.toolbar nav{gap:14px;font-size:12px}.timeline-caption{padding:12px}.timeline-caption strong{font-size:19px}.timeline-caption a{max-width:100px}details{padding:13px 12px}}
.cache-badge{display:inline-flex;align-items:center;gap:5px;color:var(--cache-color,#89988e);font-size:10px;line-height:1.6;white-space:nowrap}.cache-badge:before{content:'';width:6px;height:6px;background:currentColor;border-radius:50%;flex-shrink:0}.resource-name{display:flex;align-items:center;gap:10px;min-width:0}.resource-name>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.resource-name>.cache-badge{flex-shrink:0}.resource-waterfall{grid-template-columns:minmax(235px,40%) 1fr 105px}.cache-distribution{display:flex;height:12px;border-radius:3px;overflow:hidden;background:#89988e22;margin:20px 0 14px}.cache-distribution span{height:100%;min-width:1px}.cache-legend{display:flex;gap:18px;flex-wrap:wrap}.cache-legend>span{display:flex;align-items:center;gap:7px}.cache-legend strong{font-size:12px;font-weight:500}.cache-legend small{font-size:10px;color:var(--muted)}.cache-metrics .metric-card{min-height:148px}
@media(max-width:650px){.resource-waterfall{grid-template-columns:minmax(125px,1fr) minmax(65px,1fr) 68px}.resource-waterfall .resource-name{align-items:flex-start;flex-direction:column;gap:1px}.resource-waterfall .resource-name>span:first-child{max-width:100%}.cache-legend{gap:10px 18px}.cache-metrics .metric-card{min-height:148px}}
.fps-guide{margin-bottom:20px}.fps-guide p{font-size:12px;margin-bottom:12px}.fps-guide-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}.fps-guide-grid>div{background:var(--panel-raised);border:1px solid var(--border);border-radius:6px;padding:14px}.fps-guide-grid strong{display:block;font-size:18px;font-weight:550}.fps-guide-grid span{display:block;color:var(--accent);font-size:11px;margin:3px 0 9px}.fps-guide-grid p{color:var(--muted);margin:0}.fps-guide-markers{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;font-size:11px}.fps-guide-good{color:var(--accent)}.fps-guide-warning{color:var(--amber)}.fps-guide-danger{color:var(--danger)}.fps-guide-warning:before,.fps-guide-danger:before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;margin-right:6px}.fps-guide .boundary-note{margin-bottom:0}
@media(max-width:850px){.fps-guide-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:420px){.fps-guide-grid{grid-template-columns:1fr}.fps-guide-grid>div{padding:12px}.fps-guide-grid strong{font-size:16px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`;

function htmlReport(run) {
  const manifest = run.manifest;
  const groupTable = groups => table(['场景', '轮数', '近似就绪中位数', '应用 p95 中位数', '稳定段 p95 中位数'], groups.map(group =>
    [esc(group.label), String(group.samples.length), `${fmt(group.medians.readyMs)} · n=${group.metricSampleCounts.readyMs}`, `${fmt(group.medians.p95Ms)} · n=${group.metricSampleCounts.p95Ms}`, `${fmt(group.medians.stableP95Ms)} · n=${group.metricSampleCounts.stableP95Ms}`]), groups.map(group => group.alias));
  const data = JSON.stringify({ status: run.status, comparison: run.comparison }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const initial = run.groups.find(group => group.initial);
  const anyRaf = run.groups.some(group => group.samples.some(sample => sample.stutters.available));
  const compareCount = run.comparison?.scenes.filter(scene => scene.comparable).length ?? 0;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页面性能记录 · ${esc(path.basename(run.runDir))}</title><style>${reportStyles}</style></head><body><main>
  <header class="report-header"><div><p class="eyebrow">性能诊断 / 离线采集报告</p><h1>页面性能记录</h1><p class="muted">${esc(path.basename(run.runDir))} · ${esc(manifest.config?.profile ?? '设备未知')} / ${esc(manifest.config?.mode ?? '模式未知')} · 每段观察 ${fmt(manifest.config?.observeMs)}</p></div>
  <div class="header-aside"><span class="status${run.status === 'completed' ? '' : ' incomplete'}">${run.status === 'completed' ? run.coverageDeclared ? '已完成声明场景' : '已结束 · 覆盖未声明' : '未完整完成 · 仅显示已有数据'}</span><p class="muted">报告生成于 ${esc(run.generatedAt)}<br>前台 RAF 调度证据 · 非 GPU 计时</p></div></header>
  <div class="toolbar"><nav aria-label="报告章节"><a href="#overview">场景总览</a><a href="#timeline" data-jump-timeline>首屏时间轴</a><a href="#resource-cache">HTTP 缓存</a><a href="#stutters">停顿定位</a><a href="#comparison">基线比较</a><a href="#evidence">原始证据</a></nav>
  <label class="control">场景 <select id="scene-selector" data-initial="${esc(initial?.alias ?? '')}"><option value="all" data-raf="${anyRaf}">全部场景</option>${run.groups.map(group => `<option value="${esc(group.alias)}" data-raf="${group.samples.some(sample => sample.stutters.available)}">${esc(group.label)}</option>`).join('')}</select></label></div>
  <noscript><p class="warning">浏览器未启用 JavaScript：仍可展开原始表与时间轴，场景筛选和轮次切换不可用。</p></noscript>
  <p class="boundary-note"><strong>适配器加载就绪口径：</strong>${esc(manifest.config?.adapter?.readyDescription ?? initial?.samples[0]?.completionRule ?? '未声明；不能推断 3D 场景已经就绪。')}</p>
  ${run.warnings.length ? `<aside class="warning"><strong>${run.warnings.length} 项数据边界与异常</strong><ul>${run.warnings.slice(0, 2).map(warning => `<li>${esc(warning)}</li>`).join('')}</ul>${run.warnings.length > 2 ? `<details><summary>展开全部说明</summary><ul>${run.warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul></details>` : ''}</aside>` : ''}
  <p id="view-label" class="view-label" aria-live="polite">当前范围：全部场景。近似就绪和帧调度分别观察。</p>
  ${dashboardCards(run)}${run.groups.map(group => dashboardCards(run, group)).join('')}
  ${sceneOverview(run)}
  ${timelineOverview(run)}
  ${cacheOverview(run)}
  ${stutterHtml(run)}
  <section id="comparison"><div class="section-heading"><div><p class="eyebrow">同条件复测</p><h2>和基线相比，变化在哪里</h2></div>${run.comparison ? `<span class="status${run.comparison.allScenesComparable ? '' : ' incomplete'}">${compareCount} / ${run.comparison.scenes.length} 个场景可比较</span>` : ''}</div>
  ${run.comparison ? '<p class="muted">场景总览已绘制可比基线横条；下表保留条件核对、差值和逐轮尖峰。配置或状态不同的场景不计算收益。</p><details><summary>查看比较资格、完整差值与逐轮记录</summary>' + comparisonHtml(run.comparison) + '</details>' : '<p class="empty">本报告未指定基线。下一次同条件采集时添加 --compare BASELINE_DIR，即可显示前后横条与差值。</p>'}</section>
  <section id="details"><div class="section-heading"><div><p class="eyebrow">完整记录</p><h2>逐轮与阶段详情</h2></div></div>
  <details><summary>展开原始指标总表</summary><h3>页面加载（首次 / 复访）</h3>${groupTable(run.groups.filter(group => group.navigationLoad))}<h3>同页交互</h3>${groupTable(run.groups.filter(group => !group.navigationLoad))}<p class="muted">p95 中位数是各轮 p95 的中位数，不是合并帧后的 p95。缺失不计 0，观察窗口不是纯加载耗时。</p></details>
  ${run.groups.map(group => `<details class="detail-scene" data-scene="${esc(group.alias)}"><summary>${esc(group.label)} <span class="count">${group.samples.length} 轮 · ${esc(group.alias)}</span></summary>${table(['轮次', '采集窗口', '近似就绪', '稳定观察', 'startup 仅页面加载'], group.samples.map(sample => [esc(sample.iteration), fmt(sample.metrics.windowMs), fmt(sample.metrics.readyMs), fmt(sample.metrics.stableMs), fmt(sample.metrics.startupMs)]))}${group.samples.map(sampleHtml).join('')}</details>`).join('')}
  <details><summary>下一步查看哪些证据</summary><ul>${nextSteps(run).map(note => `<li>${esc(note)}</li>`).join('')}</ul></details></section>
  <section id="evidence"><div class="section-heading"><div><p class="eyebrow">可追溯证据</p><h2>原始文件与采集条件</h2></div></div><p><a href="summary.json">汇总 JSON ↗</a> · <a href="report.md">Markdown 报告 ↗</a> · <a href="manifest.json">采集清单 ↗</a></p>
  <details><summary>原始工具报告、trace 与日志 <span class="count">${run.artifacts.length} 个链接</span></summary><ul>${run.artifacts.map(file => `<li><a href="${relativeLink(file)}">${esc(file)}</a></li>`).join('')}</ul></details>
  <details><summary>版本、环境与适配器</summary><div class="metadata"><span>profile ${esc(manifest.config?.profile ?? 'N/A')}</span><span>mode ${esc(manifest.config?.mode ?? 'N/A')}</span><span>业务埋点 ${esc(manifest.config?.instrumentation ?? 'N/A')}</span><span>观察 ${fmt(manifest.config?.observeMs)}</span></div>
  <p class="muted">诊断面板：${performancePanel(manifest) === null ? '未知' : performancePanel(manifest) ? '显示' : '隐藏'}。显示与隐藏会改变页面工作量，不能混作同条件收益对比。</p>
  <p class='muted'>适配器 ${esc(manifest.config?.adapter?.id ?? '未记录')} · 版本 ${esc(manifest.config?.adapter?.version ?? 'N/A')}；状态字段 ${esc(manifest.config?.adapter?.stateFields?.join(', ') ?? '旧版竹屋固定字段')}；可选字段 ${esc(manifest.config?.adapter?.optionalStateFields?.join(', ') ?? 'volume')}。就绪规则：${esc(manifest.config?.adapter?.readyDescription ?? '参见原始场景 completionRule')}。</p>
  <p>Git <code>${esc(manifest.git?.sha ?? 'N/A')}</code> · 工作区 ${manifest.git?.dirty === true ? '有未提交修改' : manifest.git?.dirty === false ? '干净' : '未知'}<br>地址 <code>${esc(manifest.config?.url ?? 'N/A')}</code><br>视口 ${esc(JSON.stringify(manifest.config?.viewport ?? null))} · Chrome ${esc(manifest.versions?.chrome ?? 'N/A')} · sitespeed ${esc(manifest.versions?.sitespeed ?? 'N/A')} · Browsertime ${esc(manifest.versions?.browsertime ?? 'N/A')}</p>
  <p class="muted">HAR ${manifest.config?.har === true ? '开启' : manifest.config?.har === false ? '关闭' : 'N/A'}；停用插件 ${esc(manifest.config?.disabledPlugins?.join(', ') ?? 'N/A')}。${esc(manifest.config?.harNote ?? '')}</p></details>
  <details><summary>HTTP 缓存采集与解释配置</summary><p>采集时配置：<code>${esc(JSON.stringify(manifest.config?.networkCache ?? null))}</code></p><p>本次报告解释规则：<code>${esc(JSON.stringify(run.cacheInterpretation))}</code></p><p class="muted">缺少配置的历史采集仅按已有时序解释；新采集的版本、源码指纹和缓存策略均参加基线比较资格检查。报告按当前解释规则重算原始证据，解释指纹与采集时指纹分别保留。缓存分类仅描述已保留记录。</p></details>
  <details><summary>指标口径与工具开销</summary><p>${esc(applicationScope(manifest))}帧间隔和长任务描述浏览器观察，不等于 GPU 耗时或屏幕呈现。业务 measure 可嵌套、并行或跨窗口，保留完整区间，不累计成总加载耗时。</p><p>浏览器驱动、轮询、RAF 观察器，以及所选模式的 trace/JS 采样、截图和业务埋点都会引入开销。不同 mode 或 instrumentation 的数字不可直接解释为优化收益；先用同条件重复采集，再用诊断 trace 归因。</p></details></section>
  <p class="footer-note">单文件离线报告 · 所有数字来自本次采集文件 · 无外部字体、脚本或统计服务</p></main>
  <script id="report-data" type="application/json">${data}</script><script>
  const sceneSelect=document.getElementById('scene-selector'),stutterSelect=document.getElementById('stutter-selector');
  function filterStutters(){const scene=sceneSelect.value,mode=stutterSelect.value;let count=0;for(const card of document.querySelectorAll('[data-stutter-card]')){const matches=(scene==='all'||card.dataset.scene===scene)&&(mode!=='first'||card.dataset.first==='true')&&(mode!=='running'||card.dataset.running==='true');card.hidden=!matches||count>=6;if(matches)count++;}document.getElementById('stutter-count').textContent='当前筛选显示 '+Math.min(count,6)+' / '+count+' 个已保留片段；完整证据表按场景筛选，不受此预览模式限制。';const empty=document.getElementById('stutter-empty');empty.hidden=count>0;empty.textContent=sceneSelect.selectedOptions[0].dataset.raf==='true'?'当前选择未发现已保留的匹配 RAF 片段；不代表没有屏幕卡顿。':'N/A · 当前范围缺少浏览器 RAF 记录，无法定位帧调度停顿。';}
  function filterScene(){const scene=sceneSelect.value;for(const node of document.querySelectorAll('[data-scene]'))if(!node.hasAttribute('data-stutter-card'))node.hidden=scene!=='all'&&node.dataset.scene!==scene;for(const node of document.querySelectorAll('[data-kpi]'))node.hidden=node.dataset.kpi!==scene;document.getElementById('view-label').textContent='当前范围：'+sceneSelect.selectedOptions[0].textContent+'。总览、缓存、停顿和逐轮详情同步筛选。';filterStutters();}
  sceneSelect.addEventListener('change',filterScene);stutterSelect.addEventListener('change',filterStutters);
  document.querySelectorAll('[data-pick-scene]').forEach(link=>link.addEventListener('click',()=>{sceneSelect.value=link.dataset.pickScene;filterScene();for(const node of document.querySelectorAll('.detail-scene'))if(!node.hidden)node.open=true;}));
  const timelineSelects=Array.from(document.querySelectorAll('[data-timeline-selector]'));
  function filterTimeline(select){for(const node of document.querySelectorAll('[data-timeline-round]'))if(node.dataset.timelineGroup===select.dataset.group)node.hidden=node.dataset.timelineRound!==select.value;}
  document.querySelectorAll('[data-jump-timeline]').forEach(link=>link.addEventListener('click',()=>{sceneSelect.value=link.dataset.timelineScene||sceneSelect.dataset.initial||'all';filterScene();const select=timelineSelects.find(item=>item.dataset.sceneAlias===sceneSelect.value);if(select&&link.dataset.timelineIteration){const option=Array.from(select.options).find(item=>item.dataset.iteration===link.dataset.timelineIteration);if(option)select.value=option.value;filterTimeline(select);}}));
  timelineSelects.forEach(select=>select.addEventListener('change',()=>filterTimeline(select)));filterScene();
  </script></body></html>`;
}

function cacheMarkdown(run) {
  const cache = run.resourceCache;
  const lines = ['## HTTP 缓存', '', cacheEnvironmentNote(run.manifest), '',
    `当前报告缓存解释规则：v${run.cacheInterpretation.version}；SHA-256 \`${run.cacheInterpretation.classifierSha256}\`。采集时网络配置另见 manifest.config.networkCache；报告重生成不会改写原始采集规则。`, '',
    `资源 ${cache.total} 条；分类覆盖率 ${fmt(cache.coveragePercent, '%')}（${cache.classified} 条已分类，${cache.unknown} 条未知）。已知传输 ${fmt(cache.transferBytes, ' B')}，有字节证据 ${cache.transferKnownCount} / ${cache.total} 条。`, '',
    `本地复用 ${fmt(cache.localHitRatePercent, '%')}；协商复用 ${fmt(cache.revalidationRatePercent, '%')}。分母为 ${cache.httpClassified} 条可判定 HTTP 记录，不含 Service Worker / 未知。协商仍有网络往返；Resource Timing 推断不等于已取得线端 304。`, '',
    '计数按各轮已保留资源记录累加，不按唯一 URL 去重；不含主 HTML 文档。无资源、无可判定 HTTP 记录或无已知字节时为 N/A。传输体积为 Resource Timing 浏览器估算，不是网卡字节。旧采集只有 Resource Timing，不能事后补出 CDP 状态或响应头。页面内观测受同源与 Timing-Allow-Origin 限制，0 字节不能单独证明命中。', '',
    '| 场景 / 轮次 | 本地复用 | 协商复用 | 网络 | Service Worker | 未知 | 分类覆盖 | 已知传输 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const group of run.groups) for (const sample of group.samples) {
    const item = sample.resourceCache;
    lines.push(`| [${md(group.label)} / ${sample.iteration}](${relativeLink(sample.file)}) | ${item.counts.local} | ${item.counts.revalidated} | ${item.counts.network} | ${item.counts['service-worker']} | ${item.counts.unknown} | ${fmt(item.coveragePercent, '%')} | ${fmt(item.transferBytes, ' B')}（${item.transferKnownCount} 条） |`);
  }
  const resources = run.groups.flatMap(group => group.samples.flatMap(sample => [...sample.resources.map(entry => ({ group, sample, entry, document: false })), ...sample.navigation.map(entry => ({ group, sample, entry, document: true }))]));
  lines.push('', '### 逐资源证据', '', '| 场景 / 轮次 | 资源 | 分类 / 来源 | 线端 / 浏览器状态 | 已知传输 | 判定依据 | Cache-Control / ETag / Last-Modified |', '| --- | --- | --- | --- | ---: | --- | --- |');
  for (const { group, sample, entry, document } of resources.slice(0, 300)) lines.push(`| ${md(group.label)} / ${sample.iteration} | ${document ? '主文档：' : ''}${md(resourceLabel(entry))} | ${md(entry.cache.label)} / ${md(entry.cache.source)} | ${fmt(entry.cache.wireStatus, '')} / ${fmt(entry.cache.responseStatus, '')} | ${fmt(entry.cache.transferBytes, ' B')} | ${md(entry.cache.evidence)} | ${md([entry.cache.cacheControl, entry.cache.etag, entry.cache.lastModified].filter(Boolean).join(' / ') || '未采集')} |`);
  lines.push('', `显示 ${Math.min(300, resources.length)} / ${resources.length} 条资源及主文档证据，全部保留在 summary.json。首次与复访各自为完整导航，HTML 报告提供各自时间轴。`, '');
  return lines;
}

function markdownReport(run) {
  const lines = ['# 页面性能采集报告', '', `状态：**${run.status === 'completed' ? run.coverageDeclared ? '已完成声明场景' : '采集已结束 · 覆盖范围未声明' : '未完整完成'}**。生成于 ${run.generatedAt}。`, '',
    `profile：${md(run.manifest.config?.profile ?? 'N/A')}；mode：${md(run.manifest.config?.mode ?? 'N/A')}；埋点：${md(run.manifest.config?.instrumentation ?? 'N/A')}；观察：${fmt(run.manifest.config?.observeMs)}。`, '',
    `适配器加载就绪口径：${md(run.manifest.config?.adapter?.readyDescription ?? run.groups.find(group => group.initial)?.samples[0]?.completionRule ?? '未声明；不能推断 3D 场景已经就绪。')}`, '',
    `Git：\`${md(run.manifest.git?.sha ?? 'N/A')}\`。工作区 dirty：${md(run.manifest.git?.dirty ?? '未知')}。`, '',
    `HAR：${run.manifest.config?.har === true ? '开启' : run.manifest.config?.har === false ? '关闭' : 'N/A'}。停用插件：${md(run.manifest.config?.disabledPlugins?.join(', ') ?? 'N/A')}。${md(run.manifest.config?.harNote ?? '')}`, '',
    '[交互式 HTML 报告](./report.html) · [汇总 JSON](./summary.json) · [采集清单](./manifest.json)', ''];
  if (run.warnings.length) lines.push('## 数据边界与异常', '', ...run.warnings.map(warning => `- ${md(warning)}`), '');
  lines.push(...cacheMarkdown(run));
  lines.push('## 卡顿位置', '', '前台 RAF 间隔 ≥50ms 是诊断候选，50 / 100 / 300ms 为诊断分级；相隔 ≤20ms 合并。区间相对操作采集起点，首屏相对导航。跨起点只列窗口内重叠，完整间隔不能全归因当前操作。暂停动态不自动判为卡顿。', '', '| 操作 / 轮次 | 相对区间 | 最长间隔 | 重叠业务阶段 | 主线程证据 |', '| --- | --- | ---: | --- | --- |');
  const stalls = stutterItems(run);
  for (const { group, sample, episode } of stalls.slice(0, 160)) lines.push(`| [${md(group.label)} / ${md(sample.iteration)}](${relativeLink(sample.file)}) | +${fmt(episode.relativeStartMs)} → +${fmt(episode.relativeEndMs)} | ${fmt(episode.maxGapMs)}${episode.crossesStart ? ` 跨起点，窗口内最长重叠 ${fmt(episode.maxOverlapMs)}` : ''} | ${episode.phases.slice(0, 10).map(entry => md(phaseLabel(entry))).join('；') || 'N/A'} | 长任务 ${fmt(sample.probe?.supported?.longtask === true ? episode.longTasks.length : null, ' 条')}，LoAF ${fmt(sample.probe?.supported?.['long-animation-frame'] === true ? episode.longAnimationFrames.length : null, ' 条')} |`);
  lines.push('', `保留记录识别 ${stalls.length} 个片段。这里只报告已保留片段；样本截断、缓冲覆盖或窗口结束时仍未完成的间隔可能漏掉停顿，不证明屏幕冻结。孤立长任务、各操作最大间隔和稳定平均/典型回调率见 HTML 报告。`, '');
  for (const initial of [true, false]) {
    lines.push(initial ? '## 页面加载（首次 / 复访）' : '## 同页交互', '', '| 场景 | 轮数 | 近似就绪中位数 | 应用 p95 中位数 | 稳定段 p95 中位数 |', '| --- | ---: | ---: | ---: | ---: |');
    for (const group of run.groups.filter(group => group.navigationLoad === initial)) lines.push(`| ${md(group.label)} | ${group.samples.length} | ${fmt(group.medians.readyMs)} (n=${group.metricSampleCounts.readyMs}) | ${fmt(group.medians.p95Ms)} (n=${group.metricSampleCounts.p95Ms}) | ${fmt(group.medians.stableP95Ms)} (n=${group.metricSampleCounts.stableP95Ms}) |`);
    lines.push('');
  }
  lines.push('## 基线比较', '');
  if (!run.comparison) lines.push('未指定基线。');
  else {
    if (!run.comparison.conditionsComparable) lines.push('当前与基线环境条件不可直接比较，未计算差值。', '', ...run.comparison.reasons.map(reason => `- ${md(reason)}`));
    lines.push(...asArray(run.comparison.notes).map(note => `- ${md(note)}`));
    for (const scene of run.comparison.scenes) {
      lines.push(`- ${md(scene.label ?? scene.alias)}：${scene.comparable ? `近似就绪差值 ${fmt(scene.metrics.readyMs.delta)}，应用 p95 差值 ${fmt(scene.metrics.p95Ms.delta)}；完整 RAF 最大间隔的逐轮中位数差值 ${fmt(scene.metrics.maxRafMs.delta)}；稳定平均 RAF Hz 的逐轮中位数差值 ${fmt(scene.metrics.stableMeanHz.delta, ' Hz')}。` : `不可比较；${scene.reasons.map(md).join('；') || '见环境条件原因'}。`}${scene.notes.length ? `未核对项：${scene.notes.map(md).join('；')}。` : ''}`);
      if (scene.comparable) for (const [name, values] of [['基线', scene.rounds.baseline], ['当前', scene.rounds.current]]) lines.push(`  ${name}各轮最大间隔 / 稳定平均 RAF Hz：${values.map(value => `第 ${md(value.iteration)} 轮 ${fmt(value.maxRafMs)} / ${fmt(value.stableMeanHz, ' Hz')}`).join('；')}。`);
    }
    lines.push('', '峰值与频率有任一轮缺失时不计算对应差值。不要只看峰值中位数；逐轮尖峰仍须核对。间隔下降与回调频率上升不自动证明代码优化或统计显著性。');
  }
  lines.push('', '## 逐轮记录', '');
  for (const group of run.groups) {
    lines.push(`### ${md(group.label)}`, '', '| 轮次 | 采集窗口 | 近似就绪 | 稳定观察 | startup 仅页面加载 | 帧数 | p95 | >33.33ms |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const sample of group.samples) lines.push(`| [${md(sample.iteration)}](${relativeLink(sample.file)}) | ${fmt(sample.metrics.windowMs)} | ${fmt(sample.metrics.readyMs)} | ${fmt(sample.metrics.stableMs)} | ${fmt(sample.metrics.startupMs)} | ${fmt(sample.appFrames?.count, '')} | ${fmt(sample.appFrames?.p95Ms)} | ${fmt(sample.appFrames?.over33msPercent, '%')} |`);
    lines.push('');
    for (const sample of group.samples) if (sample.state || sample.startState) lines.push(`- 第 ${md(sample.iteration)} 轮状态：${stateRows(sample).map(([key, before, after]) => `${md(key)} ${md(before)} → ${md(after)}`).join('；')}。`);
    lines.push('');
  }
  lines.push('## 下一步查看的证据', '', ...nextSteps(run).map(note => `- ${md(note)}`), '', '## 口径与工具开销', '',
    '- 外部轮询只给出近似就绪；采集窗口包含固定观察时长。交互段的 Navigation Timing 仍属于初始导航，因此未重复使用。',
    `- ${md(applicationScope(run.manifest))}它们不是逐阶段 GPU 或显存测量。`,
    '- 多轮结果采用逐轮指标的中位数，缺失为 N/A，不混合成一次加载。阶段可能并行、嵌套或跨窗口，不相加。',
    '- trace、JS 采样、轮询、截图、RAF 观察器和业务埋点都有开销。长任务可包含工具自己的工作，数量不能直接归因产品代码；须核对调用栈。只在记录的设备、模式和观察条件一致时比较。',
    '- HTML 报告包含资源瀑布、业务阶段、长任务、长动画帧、每轮分位数与末端快照；原始 JSON 保留更完整数据。', '', '## 原始工具证据', '',
    ...run.artifacts.map(file => `- [${md(file)}](${relativeLink(file)})`), '');
  return lines.join('\n');
}

export async function generateReport(runDir, { compare } = {}) {
  const directory = path.resolve(runDir);
  const run = await loadRun(directory);
  run.generatedAt = new Date().toISOString();
  run.cacheInterpretation = { version: 1, classifierSha256: createHash('sha256').update(await readFile(new URL('../core/resource-cache.mjs', import.meta.url))).digest('hex') };
  if (compare) {
    try { run.comparison = comparison(run, await loadRun(path.resolve(compare))); }
    catch (error) { run.comparison = { conditionsComparable: false, comparable: false, allScenesComparable: false, baselineDir: path.resolve(compare), reasons: [`基线不可读取：${error.message}`], notes: [], scenes: [] }; }
  }
  const summary = { schemaVersion: 1, ...run };
  const paths = { summary: path.join(directory, 'summary.json'), markdown: path.join(directory, 'report.md'), html: path.join(directory, 'report.html') };
  await Promise.all([writeFile(paths.summary, `${JSON.stringify(summary, null, 2)}\n`), writeFile(paths.markdown, markdownReport(run)), writeFile(paths.html, htmlReport(run))]);
  if (!run.groups.length) throw new Error(`没有 scene 数据；错误报告已写入 ${paths.html}`);
  return { summary, paths };
}

export async function runReport(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Usage: node tools/scene-perf/cli/report.mjs <run-dir> [--compare <baseline-dir>]');
    return;
  }
  const [runDir, flag, compare, ...extra] = argv;
  if (!runDir || (flag && flag !== '--compare') || (flag && !compare) || extra.length) {
    throw new Error('Usage: node tools/scene-perf/cli/report.mjs <run-dir> [--compare <baseline-dir>]');
  }
  const result = await generateReport(runDir, { compare });
  console.log(result.paths.html);
  if (result.summary.status !== 'completed') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runReport().catch(error => { console.error(error.message); process.exitCode = 1; });
}
