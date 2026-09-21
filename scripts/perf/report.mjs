import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

function normalize(raw, file) {
  if (!raw || typeof raw.alias !== 'string' || !raw.alias.trim() || !Number.isInteger(raw.iteration) || raw.iteration < 1) throw new Error('场景必须声明非空 alias 和正整数 iteration');
  if (!finite(raw.start?.nowMs) || raw.start.nowMs < 0 || !finite(raw.observedAtMs) || raw.observedAtMs < raw.start.nowMs) throw new Error('场景缺少有效的 performance.now() 采集时间窗口');
  const windowMs = raw.summary?.windowObservedMs;
  if (!finite(windowMs) || windowMs < 0 || Math.abs(windowMs - (raw.observedAtMs - raw.start.nowMs)) > 1 ||
    ['conditionObservedMs', 'stableObservedMs'].some(key => !finite(raw.summary?.[key]) || raw.summary[key] < 0 || raw.summary[key] > windowMs + 1)) throw new Error('场景 summary 缺少有效观察 / 就绪 / 稳定时长，或与采集窗口不一致');
  const initial = raw.alias === 'initial-3d';
  const frameWindowValid = raw.frameWindowValid !== false;
  const retainedFrames = raw.probe?.retention?.frames;
  const browserFrameWindowValid = !(retainedFrames?.dropped > 0 && raw.probe?.startMs < retainedFrames.oldestStartMs);
  const stableRetention = raw.probeStable?.retention?.frames;
  const stableProbeValid = !(stableRetention?.dropped > 0 && raw.probeStable?.startMs < stableRetention.oldestStartMs);
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
    stableMs: raw.summary?.stableObservedMs ?? null, startupMs: initial ? raw.summary?.startupMs ?? null : null,
    p95Ms: appFrames?.p95Ms ?? null, stableP95Ms: stableFrames?.p95Ms ?? null,
    probeP95Ms: browserFrames?.p95Ms ?? null, over33msPercent: appFrames?.over33msPercent ?? null,
    maxRafMs: browserFrames?.maxMs ?? null,
    probeOver33msPercent: browserFrames?.over33msPercent ?? null,
    stableMeanHz: stableProbeValid && raw.probeStable?.frameSummary?.meanMs > 0 ? 1000 / raw.probeStable.frameSummary.meanMs : null,
    stableTypicalHz: stableFrames?.medianMs > 0 ? 1000 / stableFrames.medianMs : null,
  };
  const sample = { alias: raw.alias ?? path.basename(file), label: raw.label ?? null, iteration: raw.iteration, initial, file, metrics, appFrames, stableFrames, browserFrames,
    startMs: raw.start?.nowMs, endMs: raw.observedAtMs, timeOrigin: raw.timeOrigin, completionRule: raw.completionRule, limitation: raw.limitation,
    frameWindowValid, frameDataAvailable: raw.frameDataAvailable !== false, browserFrameWindowValid, frameSamplesTruncated: !!raw.frameSamplesTruncated,
    adapter: raw.adapter ?? null,
    diagnostics: raw.diagnostics ?? {}, browserViewport: raw.browserViewport ?? null, startState: raw.startState ?? null, state: raw.endState ?? raw.state ?? null,
    workload: raw.workload ?? null, preparations: asArray(raw.preparations),
    businessPhases: raw.businessPhases ? { enabled: raw.businessPhases.enabled, version: raw.businessPhases.version, droppedPhases: raw.businessPhases.droppedPhases } : null,
    measures, resources: asArray(raw.resources), probe: raw.probe ?? null, probeStable: raw.probeStable ?? null,
    navigation: initial ? asArray(raw.navigation) : [], visibility: raw.visibility,
  };
  sample.stutters = locateStutters(sample);
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
  return samples.some(candidate => candidate.iteration === sample.iteration && candidate.timeOrigin === sample.timeOrigin && candidate.initial && candidate.measures.some(entry => String(entry.name).startsWith('bamboo:')));
}

async function loadRun(runDir) {
  const files = await filesBelow(runDir);
  const warnings = [];
  let manifest = {};
  try { manifest = await json(path.join(runDir, 'manifest.json')); }
  catch (error) { warnings.push(`manifest.json 不可读取，无法确认采集条件与完成状态：${error.message}`); }
  const samples = [];
  for (const file of files.filter(name => /^scene-\d+-.+\.json$/.test(path.basename(name)))) {
    try { samples.push(normalize(await json(path.join(runDir, file)), file)); }
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
    if (!sample.browserFrameWindowValid) warnings.push(`${sample.alias} 第 ${sample.iteration} 轮：浏览器 RAF 缓冲覆盖了窗口前段，统计已排除，不参与中位数`);
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
    return { alias, label: rows[0].label ?? sceneLabels[alias] ?? alias, initial: rows[0].initial, samples: rows, medians, metricSampleCounts };
  });
  const sceneOrder = expectedAliases.length ? expectedAliases : Object.keys(sceneLabels);
  groups.sort((a, b) => Number(b.initial) - Number(a.initial) || sceneOrder.indexOf(a.alias) - sceneOrder.indexOf(b.alias));
  const complete = samples.length > 0 && manifest.status === 'completed' && manifest.capture?.exitCode === 0 &&
    !warnings.some(warning => /：实际|无法解析|没有可用|缺少有效 probe/.test(warning));
  return { runDir, manifest, warnings, status: complete ? 'completed' : 'incomplete', coverageDeclared, groups,
    artifacts: files.filter(file => file === 'index.html' || file === path.join('sitespeed', 'index.html') || /(?:trace|timeline|console|har)(?:[._-]|$)/i.test(path.basename(file))).slice(0, 100) };
}

function compareSceneStates(current, baseline, adapter) {
  const reasons = [], notes = [], checkedFields = [];
  const requiredFields = adapter ? asArray(adapter.stateFields) : ['view', 'place', 'timeOfDay', 'soundEnabled', 'paused', 'panorama', 'settingsPanel', 'weather.preset'];
  const optionalFields = adapter ? asArray(adapter.optionalStateFields) : ['volume'];
  const fields = [...new Set([...requiredFields, ...optionalFields])].filter(field => typeof field === 'string');
  if (!adapter) notes.push('旧采集未记录适配器，沿用原竹屋状态字段；无法核对适配器版本与哈希');
  if (!fields.length) reasons.push('适配器未声明可核对的状态字段，无法确认操作条件一致');
  for (const [key, label] of [['startState', '操作前'], ['state', '操作后']]) {
    const now = current.samples.map(sample => sample[key]), before = baseline.samples.map(sample => sample[key]);
    if (key === 'startState' && current.initial && now.every(state => state == null) && before.every(state => state == null)) { notes.push('首屏操作前尚无页面状态，记为未知且不参与状态比较'); continue; }
    if ([...now, ...before].some(state => state == null)) { reasons.push(`${label}状态快照缺失，无法核对声音等可控条件`); continue; }
    for (const field of fields) {
      const a = now.map(state => get(state, field)), b = before.map(state => get(state, field));
      if (optionalFields.includes(field) && [...a, ...b].every(value => value == null)) { notes.push(`${label}.${field} 均不可观测，未核对此可选字段`); continue; }
      const knownClosedPanel = field === 'settingsPanel' && (!adapter || adapter.id === 'bamboo');
      if ([...a, ...b].some(value => value === undefined || value === null && !knownClosedPanel)) { reasons.push(`${label}.${field} 存在未知值，不能确认条件相同`); continue; }
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
  return !adapter || adapter.id === 'bamboo'
    ? 'startup 从 createScene 开始，不含先前导航与动态模块导入；应用帧跳过最初 30 帧，末端 renderer 计数约每 15 帧刷新。'
    : `startup 的起点由项目适配器声明，仅在首屏提供时展示；缺少应用指标保留 N/A。${adapter.frameLimitation ?? '应用诊断的采样与刷新规则未声明。'}`;
}

function comparison(current, baseline) {
  const reasons = [], notes = [];
  const required = ['config.profile', 'config.mode', 'config.viewport', 'config.requestedWindow', 'config.screenshots', 'config.screenshotLCP', 'config.screenshotLS', 'config.traceScreenshots', 'config.video', 'config.instrumentation', 'config.observeMs', 'config.flow',
    'config.network', 'config.cpuThrottling', 'config.headless', 'config.probe', 'config.har', 'config.disabledPlugins', 'config.scenarioSha256', 'config.probeSha256', 'versions.sitespeed', 'versions.browsertime',
    'versions.chrome', 'versions.driver', 'versions.node', 'environment.platform', 'environment.arch', 'environment.osRelease', 'environment.cpus'];
  if (current.manifest.config?.instrumentation === 'on' || baseline.manifest.config?.instrumentation === 'on') required.push('config.instrumentationSha256');
  if (current.manifest.config?.collectorSha256 || baseline.manifest.config?.collectorSha256) required.push('config.collectorSha256');
  if (current.manifest.config?.adapter || baseline.manifest.config?.adapter) required.push(...['id', 'version', 'sha256', 'stateFields', 'optionalStateFields'].map(key => `config.adapter.${key}`));
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
  if (allSamples.some(sample => !sample.browserFrameWindowValid)) reasons.push('至少一个浏览器 RAF 窗口已被缓冲覆盖，需补采后比较');
  for (const run of [current, baseline]) {
    const samples = run.groups.flatMap(group => group.samples);
    if (run.manifest.config?.probe && samples.some(sample => !sample.probe)) reasons.push('已配置浏览器探针，但部分原始窗口缺少 probe');
    if (run.manifest.config?.instrumentation === 'on' && samples.some(sample => !instrumentationKnown(samples, sample))) reasons.push('部分页面无法确认业务埋点已开启，无法确认采集开销条件一致');
    const adapter = run.manifest.config?.adapter;
    if (adapter && samples.some(sample => ['id', 'version', 'stateFields', 'optionalStateFields'].some(key => canonical(sample.adapter?.[key]) !== canonical(adapter[key])))) reasons.push('原始场景缺少匹配的适配器声明，不能确认自定义流程使用了指定适配器');
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

function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function waterfall(entries, label) {
  entries = entries.filter(entry => finite(entry.startTime) && finite(entry.duration));
  if (!entries.length) return '<p class="muted">N/A · 未采集到对应条目</p>';
  const shown = [...entries].sort((a, b) => a.startTime - b.startTime).slice(0, 120);
  const first = Math.min(...entries.map(entry => entry.startTime));
  const last = Math.max(...entries.map(entry => entry.startTime + entry.duration));
  const width = Math.max(1, last - first);
  return `<p class="muted">相对导航起点；起点 ${fmt(first)}，终点 ${fmt(last)}。重叠时段不可相加。${entries.length > 120 ? `显示前 120 / ${entries.length} 条，全部条目见原始 JSON。` : ''}</p>` +
    shown.map(entry => `<div class="waterfall"><span title="${esc(label(entry))}">${esc(label(entry))}</span><div class="track"><i style="left:${100 * (entry.startTime - first) / width}%;width:${Math.max(.3, 100 * entry.duration / width)}%"></i></div><span>${fmt(entry.duration)}</span></div>`).join('');
}
const resourceLabel = entry => { try { return new URL(entry.name).pathname; } catch { return String(entry.name ?? '未知资源'); } };
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
function stutterHtml(run) {
  const items = stutterItems(run), shown = items.slice(0, 160);
  const samples = run.groups.flatMap(group => group.samples);
  const risks = samples.flatMap(sample => sample.stutters.risks.map(risk => ({ sample, risk })));
  const interval = entry => `+${fmt(entry.relativeStartMs)} → +${fmt(entry.relativeEndMs)}`;
  const phaseEvidence = entries => entries.slice(0, 10).map(entry => esc(phaseLabel(entry))).join('<br>') + (entries.length > 10 ? `<br>另 ${entries.length - 10} 项见 summary.json` : '');
  const type = ({ sample, episode }) => sample.initial && episode.start < (sample.startMs ?? 0) + (sample.metrics.readyMs ?? 0) ? '加载阶段无响应风险' : '该操作期间帧调度停顿';
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
  return `<h2>卡顿位置</h2><p>前台 RAF 间隔 ≥50ms 记为诊断候选，50 / 100 / 300ms 仅用于分级，不是浏览器卡顿标准。相隔 ≤20ms 的候选合并为连续片段。时间区间相对该操作采集起点；首屏相对导航起点。跨起点只列窗口内重叠区间，完整间隔不能全部归因于当前操作。</p>
    <p class="muted">以下只定位调度停顿及重叠证据，不证明屏幕冻结或 GPU 阻塞。暂停动态仍可正常运行 RAF，不因 paused=true 判定卡顿。轮询、截图、trace 与业务埋点也可能造成长任务，需结合调用栈核对。</p>
    ${rows.length ? table(['操作', '轮次', '相对操作起点', '观察类型', '最长 RAF 间隔', '重叠业务与主线程证据', '原始'], rows) : `<p>${samples.some(sample => sample.stutters.available) ? '保留的 RAF 记录中未发现 ≥50ms 间隔。' : 'N/A · 缺少浏览器 RAF 记录，无法定位帧调度停顿。'}</p>`}
    <p class="muted">保留记录识别 ${items.length} 个片段${items.length > shown.length ? `，表中显示前 ${shown.length} 个，全部见 summary.json` : ''}。${samples.some(sample => sample.stutters.partial) ? '部分窗口的样本已截断或覆盖，只代表已保留片段，不能声称完整。' : '尚未结束的最后一个 RAF 间隔无法在窗口结束时观测。'}</p>
    <h3>各操作最长间隔与稳定调度率</h3>${table(['操作', '轮次', '窗口内完整 RAF 间隔最大值', '稳定段平均 RAF 回调率', '稳定段典型应用回调率'], rateRows)}
    <p class="muted">60Hz 大约表示每 16.7ms 有一次更新画面的机会；一次很长的间隔仍可能明显打断交互，不能只看平均值。平均回调率为 1000 / 前台 RAF 平均间隔；典型应用回调率为 1000 / 应用稳定段间隔中位数。二者不是屏幕 FPS 或 GPU 帧率；缺数据为 N/A。完整间隔最大值不包含跨操作起点的间隔，跨界证据见上表。</p>
    <h3>没有对应 RAF 证据的长任务风险</h3>${risks.length ? table(['操作 / 轮次', '窗口内区间', '完整任务耗时', '业务重叠', '原始'], risks.slice(0, 80).map(({ sample, risk }) => [esc(`${sample.label ?? sample.alias} / ${sample.iteration}`), interval(risk), fmt(risk.duration), phaseEvidence(risk.phases) || 'N/A', `<a href="${relativeLink(sample.file)}">JSON</a>`])) : `<p>${samples.length && samples.every(sample => sample.probe?.supported?.longtask === true) ? '保留记录中没有孤立长任务。' : 'N/A · 部分或全部窗口未采集长任务或 API 不支持，无法判断是否存在孤立长任务。'}</p>`}<p class="muted">该表只提示主线程风险，不推断画面停住；最多展示 80 条，全部保留在 summary.json。${samples.some(sample => sample.probe?.supported?.longtask !== true) ? '未采集或不支持长任务的窗口为未知，不计为零。' : ''}任务可跨越窗口边界，完整耗时不全属于当前操作。</p>`;
}

function initialTimeline(sample) {
  if (!sample.initial) return '';
  const navigation = [], boundaries = [];
  for (const entry of sample.navigation.slice(0, 1)) {
    for (const [name, from, to] of [['DNS 查询', 'domainLookupStart', 'domainLookupEnd'], ['连接建立', 'connectStart', 'connectEnd'], ['TLS 握手', 'secureConnectionStart', 'connectEnd'], ['请求至首字节', 'requestStart', 'responseStart'], ['HTML 响应接收', 'responseStart', 'responseEnd'], ['响应结束至 DOM 可交互', 'responseEnd', 'domInteractive']]) {
      if (finite(entry[from]) && finite(entry[to]) && entry[to] > entry[from] && (from !== 'secureConnectionStart' || entry[from] > 0)) navigation.push({ name, startTime: entry[from], duration: entry[to] - entry[from] });
    }
    for (const [name, key] of [['DOM 可交互', 'domInteractive'], ['DOMContentLoaded 结束', 'domContentLoadedEventEnd'], ['页面 load 结束', 'loadEventEnd']]) if (entry[key] > 0 && finite(entry[key])) boundaries.push({ name, startTime: entry[key], duration: 0 });
  }
  const phases = sample.measures.filter(entry => String(entry.name).startsWith('bamboo:') || entry.detail?.phase).map(entry => ({ ...entry, name: phaseLabel(entry) }));
  const first = phases.find(entry => entry.detail?.phase === 'startup.initial-frame-submit');
  if (first) boundaries.push({ name: '首帧提交结束', startTime: first.startTime + first.duration, duration: 0 });
  if (finite(sample.metrics.readyMs)) boundaries.push({ name: '轮询确认画布及控件就绪', startTime: (sample.startMs ?? 0) + sample.metrics.readyMs, duration: 0 });
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
      return `<div class='waterfall'><span title='${esc(label)}'>${esc(entry.name)}</span><div class='track' style='background:repeating-linear-gradient(to right,#edf2ef 0,#edf2ef calc(25% - 1px),#c6d6cd calc(25% - 1px),#c6d6cd 25%)'><i style='left:${100 * start / end}%;width:${marker ? '2px' : `${100 * (finish - start) / end}%`};background:${color}${marker ? ';transform:translateX(-1px)' : ''}'></i></div><span>${marker ? '时间边界' : fmt(entry.duration)}</span></div>`;
    });
    return `<details${open ? ' open' : ''}><summary>${esc(title)} · ${within.length} 条${within.length > limit ? `，显示前 ${limit} 条` : ''}</summary>${axis}${bars.join('') || `<p class='muted'>N/A · 未采集到对应条目</p>`}${within.length > limit ? `<p class='muted'>显示数量有界，全部保留记录见 <a href='${relativeLink(sample.file)}'>原始 JSON</a>。</p>` : ''}</details>`;
  };
  return `<h4>首屏统一时间轴</h4><p class='muted'>所有层共用导航起点 0ms → ${fmt(end)} 的尺度；细线表示时间边界，横条表示实际区间。右侧包含固定观察窗口，不代表加载一直持续。导航、业务和资源可能重叠、包含彼此，禁止加总；首帧提交与 GPU 完成、屏幕呈现不同。层内仅绘制采集窗口的交集，悬停查看原始边界；业务与资源可折叠，未显示条目仍保留在 JSON。</p>${layer('浏览器导航与就绪边界', [...navigation, ...boundaries], '#477ca5', 20)}${layer('业务阶段', phases, '#45816a', 500)}${layer('资源请求', resources, '#ae842a', 200, false)}${layer('前台 RAF 停顿', stalls, '#b44545', 160)}<p class='muted'>停顿只代表已保留的 RAF 证据；${sample.stutters.partial ? '该窗口存在截断或覆盖，不能认为图中片段完整。' : '尚未结束的最后一个间隔不可观测。'}</p>`;
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
    ${initialTimeline(sample)}
    ${sample.preparations.length ? `<p class="muted">窗口前准备（不计入本段性能）：${sample.preparations.map(preparation => `${esc(preparation.label)} / ${fmt(preparation.elapsedMs)}`).join('；')}。准备前后状态保留在 summary.json 与原始记录。</p>` : ''}
    <h4>操作前后状态</h4>${sample.state || sample.startState ? table(['状态', '操作前', '观察窗口结束'], stateRows(sample).map(row => row.map(esc))) : '<p class="muted">N/A · 此采集未记录按钮状态快照，不从帧率推断声音是否开启。</p>'}
    ${table(['帧来源', '样本数', '中位数', 'p95', 'p99', '最大值', '>33.33ms'], frameRows(sample))}
    <p class="muted">应用帧统计跳过场景最初 30 帧；浏览器 RAF 从注入后开始，不能代替实际呈现帧。原始应用样本${sample.frameSamplesTruncated ? '已截断，统计使用采集端完整汇总' : '未标记截断'}。浏览器原始样本${sample.probe?.frameSamplesTruncated ? '已截断，统计使用采集端完整汇总' : '未标记截断'}，排除帧 ${fmt(sample.probe?.excludedFrames, '')}，后台时间 ${fmt(sample.probe?.hiddenDurationMs)}。</p>
    ${table(['末端快照', '值'], [['设备模式', esc(diagnostic.quality ?? 'N/A')], ['GPU', esc(diagnostic.gpu ?? 'N/A')], ['即时浏览器 viewport / DPR', sample.browserViewport ? `${fmt(sample.browserViewport.width, '')} × ${fmt(sample.browserViewport.height, '')} / ${fmt(sample.browserViewport.pixelRatio, '')}` : 'N/A'], ['即时浏览器 outer size', sample.browserViewport ? `${fmt(sample.browserViewport.outerWidth, '')} × ${fmt(sample.browserViewport.outerHeight, '')}` : 'N/A'], ['诊断 viewport', esc(diagnostic.viewport?.join(' × ') ?? 'N/A')], ['实际 drawSize', esc(diagnostic.drawSize?.join(' × ') ?? 'N/A')], ['渲染 pixelRatio', fmt(diagnostic.pixelRatio, '')], ['draw calls', fmt(diagnostic.drawCalls, '')], ['triangles', fmt(diagnostic.triangles, '')], ['纹理 / 几何体数量', `${fmt(diagnostic.textures, '')} / ${fmt(diagnostic.geometries, '')}`]])}
    <p class="muted">浏览器尺寸在窗口结束时即时读取；其余场景诊断每 15 帧刷新。renderer 计数不是窗口平均值或显存字节。</p>
    <h4>浏览器长任务与长动画帧</h4><p>保留的长任务 ${fmt(taskCount, ' 条')}，长动画帧 ${fmt(loafCount, ' 条')}；不支持或未注入时为 N/A，缓冲覆盖时不代表窗口总数。二者可能重叠，不相加。条目可能包含轮询、截图、trace 采样等采集开销，不能仅凭数量归因于产品代码或宣称优化收益；须回到调用栈核对。</p>
    ${waterfall([...asArray(tasks).map(entry => ({ ...entry, name: '长任务' })), ...asArray(loaf).map(entry => ({ ...entry, name: '长动画帧' }))], entry => entry.name)}
    <h4>业务阶段</h4><p class="muted">阶段均为墙钟时间，不能解释为纯 CPU/GPU 耗时。view.capture 包含等候场景帧，view.reveal 包含等候目标帧和淡入；view.request-to-commit 的结束是状态请求与场景设置完成，startup.controls-ready 才确认 React 提交后控件就绪。</p>${waterfall(sample.measures, entry => entry.phase)}
    ${sample.measures.length ? table(['耗时较长的阶段', '开始', '耗时', '状态'], phaseRows(sample)) : `<p class="muted">${sample.businessPhases?.enabled ? '业务埋点已开启，本操作未产生业务阶段；面板或音量操作可以只有浏览器帧与主线程证据。' : '未收到业务阶段，不能将调用栈自动归因到模型解析或室内管线。'}</p>`}
    <h4>资源瀑布</h4>${waterfall(resources, resourceLabel)}
    <h4>较大资源</h4>${table(['资源', '下载耗时', '编码体积', '传输体积'], largest.map(entry => [esc(resourceLabel(entry)), fmt(entry.duration), finite(entry.encodedBodySize) ? fmt(entry.encodedBodySize / 1024, ' KiB') : 'N/A', finite(entry.transferSize) ? fmt(entry.transferSize / 1024, ' KiB') : 'N/A']))}
    <p class="muted">资源体积为浏览器记录；0 可能表示缓存、未传输或跨域信息不可见。资源条目只覆盖采集脚本保留的窗口，不代表所有启动依赖。</p>
    ${sample.initial ? `<h4>初始导航</h4>${table(['DOMContentLoaded', 'loadEventEnd', 'responseStart'], sample.navigation.map(entry => [fmt(entry.domContentLoadedEventEnd), fmt(entry.loadEventEnd), fmt(entry.responseStart)]))}` : '<p class="muted">本段为同页交互，未重复展示初始 Navigation Timing。</p>'}
  </details>`;
}

function nextSteps(run) {
  const ranked = run.groups.filter(group => finite(group.medians.readyMs)).sort((a, b) => b.medians.readyMs - a.medians.readyMs);
  const initial = ranked.find(group => group.initial), interaction = ranked.find(group => !group.initial);
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
  return condition + asArray(compare.notes).map(note => `<p class='muted'>${esc(note)}</p>`).join('') + table(['场景', '状态检查', '近似就绪差值', '应用 p95 差值', '完整 RAF 最大间隔的逐轮中位数', '稳定平均 RAF Hz 的逐轮中位数', '原因与未核对项'], compare.scenes.map(scene => [esc(scene.label ?? scene.alias), scene.comparable ? '可比较' : '不可比较', fmt(scene.metrics?.readyMs?.delta), fmt(scene.metrics?.p95Ms?.delta), movement(scene.metrics?.maxRafMs, ' ms'), movement(scene.metrics?.stableMeanHz, ' Hz'), [...scene.reasons, ...scene.notes].map(esc).join('<br>') || (compare.comparable ? '已记录的离散状态一致' : '见环境条件原因')])) +
    `<p class='muted'>间隔差值为负表示该统计量下降；Hz 差值为正表示平均调度频率增加。二者不是实际屏幕帧率或优化的因果证明。最大间隔只取完全在窗口内的前台 RAF 间隔，跨边界证据另见卡顿表。缺少任何一轮有效峰值或平均频率时，对应差值为 N/A。</p>` +
    (validScenes.length ? `<h4>逐轮卡顿峰值与稳定平均调度率</h4>${table(['场景', '基线各轮：最大间隔 / 平均 RAF Hz', '当前各轮：最大间隔 / 平均 RAF Hz'], validScenes.map(scene => [esc(scene.label ?? scene.alias), rounds(scene.rounds.baseline), rounds(scene.rounds.current)]))}<p class='muted'>中位数不能掩盖单轮尖峰；请逐轮查看原始峰值、停顿区间及调用栈。三轮差值没有自动统计显著性结论。</p>` : '');
}

function htmlReport(run) {
  const manifest = run.manifest;
  const groupTable = groups => table(['场景', '轮数', '近似就绪中位数', '应用 p95 中位数', '稳定段 p95 中位数'], groups.map(group =>
    [esc(group.label), String(group.samples.length), `${fmt(group.medians.readyMs)} · n=${group.metricSampleCounts.readyMs}`, `${fmt(group.medians.p95Ms)} · n=${group.metricSampleCounts.p95Ms}`, `${fmt(group.medians.stableP95Ms)} · n=${group.metricSampleCounts.stableP95Ms}`]));
  const data = JSON.stringify({ status: run.status, comparison: run.comparison }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页面性能采集报告</title>
  <style>body{max-width:1240px;margin:32px auto;padding:0 24px;font:15px/1.6 system-ui,sans-serif;color:#17252a;background:#f8faf9}h1,h2,h3,h4{line-height:1.3}h2{margin-top:36px}a{color:#126b55}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #dce5df;vertical-align:top}th{font-size:13px;color:#455b52}td:first-child{overflow-wrap:anywhere}.table-wrap{overflow-x:auto}.muted{color:#586860;font-size:13px}.warning{background:#fff3da;border-left:4px solid #b66c12;padding:12px 18px}details{background:white;border:1px solid #dce5df;border-radius:6px;padding:16px;margin:14px 0}summary{cursor:pointer;font-weight:600}.waterfall{display:grid;grid-template-columns:minmax(150px,32%) 1fr 110px;gap:12px;font-size:12px;align-items:center;margin:5px 0}.waterfall>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.track{height:16px;position:relative;background:#edf2ef}.track i{position:absolute;height:16px;background:#45816a}select{font:inherit;padding:6px;max-width:100%}code{overflow-wrap:anywhere}.metadata{display:flex;gap:12px;flex-wrap:wrap}.metadata span{background:#e8efeb;padding:6px 10px;border-radius:4px}@media(max-width:700px){body{padding:0 12px}.waterfall{grid-template-columns:110px 1fr 85px;gap:6px}}</style>
  <h1>页面性能采集报告</h1><p>状态：<strong>${run.status === 'completed' ? run.coverageDeclared ? '已完成声明场景' : '采集已结束 · 覆盖范围未声明' : '未完整完成'}</strong> · ${esc(run.generatedAt)}</p>
  <p class='muted'>诊断面板：${performancePanel(manifest) === null ? '未知' : performancePanel(manifest) ? '显示' : '隐藏'}。显示与隐藏会改变页面工作量，不能混作同条件收益对比。</p>
  <div class="metadata"><span>profile ${esc(manifest.config?.profile ?? 'N/A')}</span><span>mode ${esc(manifest.config?.mode ?? 'N/A')}</span><span>业务埋点 ${esc(manifest.config?.instrumentation ?? 'N/A')}</span><span>观察 ${fmt(manifest.config?.observeMs)}</span></div>
  <p class='muted'>适配器 ${esc(manifest.config?.adapter?.id ?? '未记录')} · 版本 ${esc(manifest.config?.adapter?.version ?? 'N/A')}；状态字段 ${esc(manifest.config?.adapter?.stateFields?.join(', ') ?? '旧版竹屋固定字段')}；可选字段 ${esc(manifest.config?.adapter?.optionalStateFields?.join(', ') ?? 'volume')}。就绪规则：${esc(manifest.config?.adapter?.readyDescription ?? '参见原始场景 completionRule')}。</p>
  <p>Git <code>${esc(manifest.git?.sha ?? 'N/A')}</code> · 工作区 ${manifest.git?.dirty === true ? '有未提交修改' : manifest.git?.dirty === false ? '干净' : '未知'}<br>地址 <code>${esc(manifest.config?.url ?? 'N/A')}</code><br>视口 ${esc(JSON.stringify(manifest.config?.viewport ?? null))} · Chrome ${esc(manifest.versions?.chrome ?? 'N/A')} · sitespeed ${esc(manifest.versions?.sitespeed ?? 'N/A')} · Browsertime ${esc(manifest.versions?.browsertime ?? 'N/A')}</p>
  <p class="muted">HAR ${manifest.config?.har === true ? '开启' : manifest.config?.har === false ? '关闭' : 'N/A'}；停用插件 ${esc(manifest.config?.disabledPlugins?.join(', ') ?? 'N/A')}。${esc(manifest.config?.harNote ?? '')}</p>
  ${run.warnings.length ? `<div class="warning"><strong>数据边界与异常</strong><ul>${run.warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul></div>` : ''}
  ${stutterHtml(run)}
  <h2>初次加载</h2>${groupTable(run.groups.filter(group => group.initial))}
  <h2>同页交互</h2>${groupTable(run.groups.filter(group => !group.initial))}
  <p class="muted">表中 p95 中位数是各轮 p95 的中位数，不是合并全部帧后的 p95。缺失数据不记为 0。近似就绪来自浏览器外部轮询；采集窗口包含等待及固定观察时长，不是纯加载耗时。</p>
  <h2>基线比较</h2>${comparisonHtml(run.comparison)}
  <h2>下一步查看哪些证据</h2><ul>${nextSteps(run).map(note => `<li>${esc(note)}</li>`).join('')}</ul>
  <h2>逐轮与阶段详情</h2><label>场景 <select id="scene-selector"><option value="all">全部场景</option>${run.groups.map((group, index) => `<option value="${index}">${esc(group.label)}</option>`).join('')}</select></label>
  ${run.groups.map((group, index) => `<section data-scene="${index}"><h3>${esc(group.label)} · ${esc(group.alias)}</h3>${table(['轮次', '采集窗口', '近似就绪', '稳定观察', 'startup 仅首屏'], group.samples.map(sample => [esc(sample.iteration), fmt(sample.metrics.windowMs), fmt(sample.metrics.readyMs), fmt(sample.metrics.stableMs), fmt(sample.metrics.startupMs)]))}${group.samples.map(sampleHtml).join('')}</section>`).join('')}
  <h2>原始工具报告与证据</h2><ul><li><a href="summary.json">汇总 JSON</a> · <a href="report.md">Markdown 报告</a> · <a href="manifest.json">采集清单</a></li>${run.artifacts.map(file => `<li><a href="${relativeLink(file)}">${esc(file)}</a></li>`).join('')}</ul>
  <h2>指标口径</h2><p>${esc(applicationScope(manifest))}帧间隔和长任务描述浏览器观察，不等于 GPU 耗时或屏幕呈现。业务 measure 可嵌套、并行或跨窗口，保留完整区间，不累计成总加载耗时。</p><p>本次工具会引入开销：浏览器驱动、轮询、RAF 观察器，以及所选模式的 trace/JS 采样和业务埋点。不同 mode 或 instrumentation 的数字不可直接解释为优化收益；先用同条件重复采集，再用诊断 trace 归因。</p>
  <script id="report-data" type="application/json">${data}</script><script>document.getElementById('scene-selector').addEventListener('change',function(){for(const section of document.querySelectorAll('[data-scene]'))section.hidden=this.value!=='all'&&section.dataset.scene!==this.value;});</script></html>`;
}

function markdownReport(run) {
  const lines = ['# 页面性能采集报告', '', `状态：**${run.status === 'completed' ? run.coverageDeclared ? '已完成声明场景' : '采集已结束 · 覆盖范围未声明' : '未完整完成'}**。生成于 ${run.generatedAt}。`, '',
    `profile：${md(run.manifest.config?.profile ?? 'N/A')}；mode：${md(run.manifest.config?.mode ?? 'N/A')}；埋点：${md(run.manifest.config?.instrumentation ?? 'N/A')}；观察：${fmt(run.manifest.config?.observeMs)}。`, '',
    `Git：\`${md(run.manifest.git?.sha ?? 'N/A')}\`。工作区 dirty：${md(run.manifest.git?.dirty ?? '未知')}。`, '',
    `HAR：${run.manifest.config?.har === true ? '开启' : run.manifest.config?.har === false ? '关闭' : 'N/A'}。停用插件：${md(run.manifest.config?.disabledPlugins?.join(', ') ?? 'N/A')}。${md(run.manifest.config?.harNote ?? '')}`, '',
    '[交互式 HTML 报告](./report.html) · [汇总 JSON](./summary.json) · [采集清单](./manifest.json)', ''];
  if (run.warnings.length) lines.push('## 数据边界与异常', '', ...run.warnings.map(warning => `- ${md(warning)}`), '');
  lines.push('## 卡顿位置', '', '前台 RAF 间隔 ≥50ms 是诊断候选，50 / 100 / 300ms 为诊断分级；相隔 ≤20ms 合并。区间相对操作采集起点，首屏相对导航。跨起点只列窗口内重叠，完整间隔不能全归因当前操作。暂停动态不自动判为卡顿。', '', '| 操作 / 轮次 | 相对区间 | 最长间隔 | 重叠业务阶段 | 主线程证据 |', '| --- | --- | ---: | --- | --- |');
  const stalls = stutterItems(run);
  for (const { group, sample, episode } of stalls.slice(0, 160)) lines.push(`| [${md(group.label)} / ${md(sample.iteration)}](${relativeLink(sample.file)}) | +${fmt(episode.relativeStartMs)} → +${fmt(episode.relativeEndMs)} | ${fmt(episode.maxGapMs)}${episode.crossesStart ? ` 跨起点，窗口内最长重叠 ${fmt(episode.maxOverlapMs)}` : ''} | ${episode.phases.slice(0, 10).map(entry => md(phaseLabel(entry))).join('；') || 'N/A'} | 长任务 ${fmt(sample.probe?.supported?.longtask === true ? episode.longTasks.length : null, ' 条')}，LoAF ${fmt(sample.probe?.supported?.['long-animation-frame'] === true ? episode.longAnimationFrames.length : null, ' 条')} |`);
  lines.push('', `保留记录识别 ${stalls.length} 个片段。这里只报告已保留片段；样本截断、缓冲覆盖或窗口结束时仍未完成的间隔可能漏掉停顿，不证明屏幕冻结。孤立长任务、各操作最大间隔和稳定平均/典型回调率见 HTML 报告。`, '');
  for (const initial of [true, false]) {
    lines.push(initial ? '## 初次加载' : '## 同页交互', '', '| 场景 | 轮数 | 近似就绪中位数 | 应用 p95 中位数 | 稳定段 p95 中位数 |', '| --- | ---: | ---: | ---: | ---: |');
    for (const group of run.groups.filter(group => group.initial === initial)) lines.push(`| ${md(group.label)} | ${group.samples.length} | ${fmt(group.medians.readyMs)} (n=${group.metricSampleCounts.readyMs}) | ${fmt(group.medians.p95Ms)} (n=${group.metricSampleCounts.p95Ms}) | ${fmt(group.medians.stableP95Ms)} (n=${group.metricSampleCounts.stableP95Ms}) |`);
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
    lines.push(`### ${md(group.label)}`, '', '| 轮次 | 采集窗口 | 近似就绪 | 稳定观察 | startup 仅首屏 | 帧数 | p95 | >33.33ms |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [runDir, flag, compare, ...extra] = process.argv.slice(2);
  if (!runDir || (flag && flag !== '--compare') || (flag && !compare) || extra.length) {
    console.error('Usage: node scripts/perf/report.mjs <run-dir> [--compare <baseline-dir>]');
    process.exitCode = 1;
  } else {
    try { const result = await generateReport(runDir, { compare }); console.log(result.paths.html); if (result.summary.status !== 'completed') process.exitCode = 1; }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
