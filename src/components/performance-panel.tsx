'use client';

import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Progress } from '@base-ui/react/progress';
import type { ActivePhase, Phase } from '@/lib/performance';
import { createRuntimeCollector, type RuntimeSnapshot } from '@/lib/performance-runtime';
import { classifyResourceCache, summarizeResourceCache } from '../../scripts/perf/resource-cache.mjs';
import { getRuntimeHealth, PerformanceRuntimeView } from './performance-runtime-view';
import { PerformanceCacheView, formatCacheBytes } from './performance-cache-view';
import './performance-panel.css';

const MAX_RESOURCES = 500;
const PAGE_SIZE = 30;
const LABELS: Record<string, string> = {
 'startup.experience': '进入 3D 体验', 'startup.scene-import': '加载 3D 模块',
 'startup.create-scene': '创建场景', 'startup.controls-ready': '控件已就绪',
 'startup.webgl-renderer': '创建 WebGL 渲染器', 'startup.prewarm': '准备首次渲染',
 'startup.shader-compile': '编译场景着色器', 'startup.scene-warmup-submit': '场景预热提交',
 'startup.interior-warmup-submit': '室内预热提交', 'startup.initial-frame-submit': '首帧渲染提交',
 'model.download': '下载模型', 'model.buffer-assembly': '拼接模型缓冲', 'model.parse': '解析模型与纹理',
 'scene.environment-build': '生成环境', 'scene.house-surfaces': '整理房屋表面',
 'scene.house-and-vegetation-build': '装配老屋与竹林', 'scene.forest-floor-build': '构建林下地表',
 'scene.weather-build': '构建风雨与雨水遮挡', 'scene.falling-leaves-build': '构建落叶',
 'scene.render-setup': '准备场景渲染', 'interior.pipeline-build': '创建室内后处理',
 'interior.render-targets-prepare': '准备室内渲染目标', 'interior.shader-compile': '编译室内着色器',
 'interior.contact-warmup-submit': '接触阴影预热提交', 'interior.first-frame-submit': '室内首次渲染提交',
 'view.snapshot-allocation': '分配转场快照', 'view.snapshot-prepare': '准备转场效果',
 'view.snapshot-shader-compile': '编译转场着色器', 'view.snapshot-warmup-submit': '转场预热提交',
 'view.request-to-commit': '提交视图切换', 'view.capture': '捕获上一视图',
 'view.target-frame-submitted': '目标视图已提交', 'view.reveal': '展示目标视图',
 'audio.download': '下载录音', 'audio.decode': '解码录音', 'audio.group-ready': '连接音频节点',
 'audio.context-create': '创建音频上下文', 'audio.resume': '恢复音频上下文',
 'audio.enable': '准备开启声音', 'audio.disable': '安排声音淡出', 'audio.weather-ready': '准备天气声音',
};
const STATUS: Record<string, string> = { success: '完成', error: '失败', cancelled: '取消', superseded: '已替换', skipped: '跳过', running: '进行中', recorded: '已记录' };

interface Row {
 id: string;
 name: string;
 label: string;
 startTime: number;
 duration: number;
 status: string;
 detail?: string;
 cache?: ReturnType<typeof classifyResourceCache>;
}
interface Resource {
 id: string;
 name: string;
 startTime: number;
 duration: number;
 initiatorType: string;
 cache: ReturnType<typeof classifyResourceCache>;
 timing: Record<string, unknown>;
}
interface Snapshot {
 now: number;
 phases: Phase[];
 active: ActivePhase[];
 readyAt?: number;
 dropped: number;
 droppedActive: number;
 resources: Resource[];
 droppedResources: number;
 resourceObserverSupported: boolean;
}

function duration(value: number) {
 return value < 1000 ? `${value.toFixed(value < 10 ? 1 : 0)} ms` : `${(value / 1000).toFixed(2)} s`;
}
function filename(value: string) {
 try { return decodeURIComponent(new URL(value, location.href).pathname.split('/').filter(Boolean).at(-1) ?? value); }
 catch { return value; }
}
function detail(phase: ActivePhase | Phase) {
 const fields = phase.detail;
 return [fields.model || fields.file, fields.view, fields.place, fields.group, fields.nightMix === undefined ? undefined : `nightMix=${fields.nightMix}`]
  .filter(value => value !== undefined && value !== '').map(value => String(value).includes('/') ? filename(String(value)) : String(value)).join(' · ');
}
function readSnapshot(resources: Resource[] = [], droppedResources = 0, resourceObserverSupported = true): Snapshot {
 const data = window.__BAMBOO_PERF__;
 return {
  now: performance.now(), phases: data?.phases.slice() ?? [], active: data?.activePhases?.slice() ?? [],
  readyAt: data?.startupReadyAt, dropped: data?.droppedPhases ?? 0, droppedActive: data?.droppedActivePhases ?? 0,
  resources, droppedResources, resourceObserverSupported,
 };
}
function navigationRows(now: number): Row[] {
 const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
 if (!navigation) return [];
 const rows: Row[] = [];
 const add = (name: string, label: string, start: number, end: number, pending = false) => {
  if (!pending && (!end || end < start)) return;
  rows.push({ id: name, name, label, startTime: start, duration: Math.max(0, (end || now) - start), status: end ? 'success' : 'running' });
 };
 add('navigation.document', '文档请求与响应', 0, navigation.responseEnd, true);
 add('navigation.redirect', '重定向', navigation.redirectStart, navigation.redirectEnd);
 add('navigation.dns', 'DNS 查询', navigation.domainLookupStart, navigation.domainLookupEnd);
 add('navigation.connect', '建立连接', navigation.connectStart, navigation.connectEnd);
 if (navigation.secureConnectionStart) add('navigation.tls', 'TLS 握手', navigation.secureConnectionStart, navigation.connectEnd);
 add('navigation.response-wait', '请求至首字节', navigation.requestStart, navigation.responseStart);
 add('navigation.html', '接收 HTML', navigation.responseStart, navigation.responseEnd);
 if (navigation.responseEnd) add('navigation.dom-interactive', 'HTML 到 DOM 可交互', navigation.responseEnd, navigation.domInteractive, true);
 add('navigation.dom-content-loaded', 'DOMContentLoaded 事件', navigation.domContentLoadedEventStart, navigation.domContentLoadedEventEnd);
 add('navigation.load', 'load 事件', navigation.loadEventStart, navigation.loadEventEnd);
 return rows;
}

function TimelineGroup({ title, rows, scale, query, initiallyOpen = false }: { title: string; rows: Row[]; scale: number; query: string; initiallyOpen?: boolean }) {
 const [open, setOpen] = useState(initiallyOpen);
 const [pagination, setPagination] = useState({ query, page: 0 });
 const needle = query.trim().toLowerCase();
 const filtered = rows.filter(row => `${row.name} ${row.label} ${row.detail ?? ''} ${STATUS[row.status]} ${row.cache?.status ?? ''} ${row.cache?.label ?? ''} ${row.cache?.evidence ?? ''}`.toLowerCase().includes(needle));
 const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
 const current = Math.min(pagination.query === query ? pagination.page : 0, pages - 1);
 return <details className="perf-group" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
  <summary><span>{title}</span><span className="perf-count">{filtered.length}</span></summary>
  {open && <>
   <div className="perf-axis"><span>导航开始 0 s</span><span>{duration(scale)}</span></div>
   <ol className="perf-timeline">
    {filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(row => <li key={row.id} data-status={row.status}>
     <div className="perf-row-heading"><span title={row.label}>{row.label}</span><strong>{duration(row.duration)}</strong></div>
     <div className="perf-row-code" title={`${row.name}${row.detail ? ` · ${row.detail}` : ''}`}>{row.name}{row.detail && <span> · {row.detail}</span>}</div>
     {row.cache && <div className="perf-resource-cache"><span className="perf-cache-badge" data-cache-kind={row.cache.status} title={`${row.cache.evidence} · 来源：${row.cache.source}`}>{row.cache.status === 'revalidated' && row.cache.source === 'resource-timing' ? '重新验证（推断）' : row.cache.label}</span><span>传输 {formatCacheBytes(row.cache.transferBytes)}</span><span>编码 {formatCacheBytes(row.cache.encodedBodyBytes)}</span></div>}
     <div className="perf-time-track" aria-hidden="true" title={`导航后 ${duration(row.startTime)} 开始，持续 ${duration(row.duration)}，${STATUS[row.status] ?? row.status}`}>
      <span style={{ left: `${Math.min(100, row.startTime / scale * 100)}%`, width: `${Math.min(100 - Math.min(100, row.startTime / scale * 100), row.duration / scale * 100)}%`, transform: row.duration < 1 ? 'translateX(-1px)' : undefined }} />
     </div>
     <div className="perf-row-meta"><span>+{duration(row.startTime)}</span><span>{STATUS[row.status] ?? row.status}</span></div>
    </li>)}
   </ol>
   {!filtered.length && <p className="perf-empty">{query ? '没有匹配的阶段。' : '尚无完成记录。'}</p>}
   {pages > 1 && <div className="perf-pagination"><button type="button" disabled={current === 0} onClick={() => setPagination({ query, page: current - 1 })}>上一页</button><span>{current + 1} / {pages}</span><button type="button" disabled={current === pages - 1} onClick={() => setPagination({ query, page: current + 1 })}>下一页</button></div>}
  </>}
 </details>;
}

function Panel() {
 const [snapshot, setSnapshot] = useState<Snapshot>(readSnapshot);
 const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
 const [runtimeFailed, setRuntimeFailed] = useState(false);
 const [view, setView] = useState<'runtime' | 'timeline'>('runtime');
 const [collapsed, setCollapsed] = useState(() => !matchMedia('(min-width: 901px)').matches);
 const [query, setQuery] = useState('');
 const [downloadError, setDownloadError] = useState(false);
 const resourceObserverSupported = useRef(true);
 const resources = useRef<Resource[]>([]);
 const resourceIds = useRef(new Set<string>());
 const droppedResources = useRef(0);
 const downloadUrl = useRef<string | undefined>(undefined);
 const revokeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
 const runtimeCollector = useRef<ReturnType<typeof createRuntimeCollector> | null>(null);

 useEffect(() => {
  let collectorFailed = false;
  try { runtimeCollector.current = createRuntimeCollector(); }
  catch { collectorFailed = true; }
  const append = (entries: PerformanceEntry[]) => {
   for (const entry of entries) {
    if (entry.entryType !== 'resource') continue;
    const resource = entry as PerformanceResourceTiming;
    const id = `${resource.startTime}:${resource.name}:${resource.initiatorType}`;
    if (resourceIds.current.has(id)) continue;
    resourceIds.current.add(id);
    const timing = resource.toJSON() as Record<string, unknown>;
    resources.current.push({ id, name: resource.name, startTime: resource.startTime, duration: resource.duration, initiatorType: resource.initiatorType, cache: classifyResourceCache(timing, { pageUrl: location.href }), timing });
    if (resources.current.length > MAX_RESOURCES) {
     const evicted = resources.current.shift();
     if (evicted) resourceIds.current.delete(evicted.id);
     droppedResources.current++;
    }
   }
  };
  append(performance.getEntriesByType('resource'));
  let observer: PerformanceObserver | undefined;
  try {
   observer = new PerformanceObserver(list => append(list.getEntries()));
   observer.observe({ type: 'resource', buffered: true });
  } catch { resourceObserverSupported.current = false; }
  const refresh = () => {
   try {
    setRuntime(runtimeCollector.current?.snapshot() ?? null);
    setRuntimeFailed(collectorFailed);
   }
   catch { setRuntimeFailed(true); }
   if (!document.hidden) setSnapshot(readSnapshot(resources.current.slice(), droppedResources.current, resourceObserverSupported.current));
  };
  const firstRefresh = setTimeout(refresh, 0);
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 250);
  document.addEventListener('visibilitychange', refresh);
  return () => {
   clearInterval(timer); observer?.disconnect();
   clearTimeout(firstRefresh);
   document.removeEventListener('visibilitychange', refresh);
   runtimeCollector.current?.dispose(); runtimeCollector.current = null;
   clearTimeout(revokeTimer.current);
   if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
  };
 }, []);

 const startup = snapshot.phases.filter(phase => phase.detail.phase === 'startup.experience').at(-1);
 const startupActive = snapshot.active.some(phase => phase.detail.phase === 'startup.experience');
 const failed = snapshot.readyAt === undefined && !startupActive && startup && startup.detail.status !== 'success';
 const startupEnd = snapshot.readyAt ?? (failed ? startup.startTime + startup.duration : snapshot.now);
 const completed = snapshot.phases.map(phase => ({ id: phase.entryName, name: phase.detail.phase, label: LABELS[phase.detail.phase] ?? phase.detail.phase, startTime: phase.startTime, duration: phase.duration, status: phase.detail.status, detail: detail(phase) })).sort((a, b) => a.startTime - b.startTime);
 const network = snapshot.resources.map(resource => ({ id: resource.id, name: resource.initiatorType || 'resource', label: filename(resource.name), startTime: resource.startTime, duration: resource.duration, status: 'recorded', detail: resource.name, cache: resource.cache })).sort((a, b) => a.startTime - b.startTime);
 const resourceCache = summarizeResourceCache(snapshot.resources, { pageUrl: location.href });
 const navigation = navigationRows(snapshot.now);
 const scale = Math.max(1, startupEnd, ...completed.map(row => row.startTime + row.duration), ...network.map(row => row.startTime + row.duration), ...navigation.map(row => row.startTime + row.duration));
 const active = snapshot.active.filter(phase => `${phase.detail.phase} ${LABELS[phase.detail.phase] ?? ''} ${detail(phase)}`.toLowerCase().includes(query.trim().toLowerCase()));

 const exportJson = () => {
  try {
   const latest = readSnapshot(resources.current.slice(), droppedResources.current, resourceObserverSupported.current);
   const retainedResources = latest.resources.map(resource => ({ ...resource.timing, cache: resource.cache }));
   const content = JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), timeOrigin: performance.timeOrigin, url: location.href, startupReadyAt: latest.readyAt, now: latest.now, navigation: performance.getEntriesByType('navigation').map(entry => entry.toJSON()), resources: retainedResources, resourceCache: { ...summarizeResourceCache(retainedResources, { pageUrl: location.href }), scope: 'Retained Resource Timing entries only; initial navigation is separate.', droppedResources: latest.droppedResources, resourceObserverSupported: latest.resourceObserverSupported }, businessPhases: { version: 1, enabled: true, phases: latest.phases, activePhases: latest.active, droppedPhases: latest.dropped, droppedActivePhases: latest.droppedActive }, runtime: runtimeCollector.current?.snapshot() ?? null, droppedResources: droppedResources.current, limitations: ['CPU submission does not prove GPU completion or display presentation.', 'Concurrent and nested durations must not be added.', 'The UI cannot repaint during synchronous main-thread work.', 'Resource history starts from entries still retained by the browser when the panel loads.', 'Local resource reuse does not prove a Cache-Control freshness policy; Resource Timing revalidation is inference without wire-level 304 evidence.', 'Page Resource Timing cannot read arbitrary resource response headers; cache summaries cover retained resources only.', 'Runtime RAF rates are callback rates, not display FPS or GPU timings.', 'Runtime collection starts when this opt-in panel mounts; hidden and paused frame gaps are excluded.'] }, null, 2);
   clearTimeout(revokeTimer.current);
   if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
   const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
   downloadUrl.current = url;
   const link = document.createElement('a');
   link.href = url; link.download = `bamboo-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; link.click();
   revokeTimer.current = setTimeout(() => { URL.revokeObjectURL(url); downloadUrl.current = undefined; }, 1000);
   setDownloadError(false);
  } catch { setDownloadError(true); }
 };

 const changeRuntime = (action: 'pause' | 'resume' | 'clear') => {
  try {
   runtimeCollector.current?.[action]();
   setRuntime(runtimeCollector.current?.snapshot() ?? null);
  } catch { setRuntimeFailed(true); }
 };
 const startupLabel = snapshot.readyAt !== undefined ? '首屏已就绪' : failed ? '初始化已中断' : '首屏加载中';
 const runtimeStatus = runtime?.status ?? 'stopped';
 const runtimeHealth = getRuntimeHealth(runtime, runtimeFailed);
 const headerValue = view === 'timeline' ? duration(startupEnd) : runtimeStatus === 'collecting' && !runtimeFailed && runtime?.window.rafHz !== null && runtime?.window.rafHz !== undefined ? `${runtime.window.rafHz.toFixed(1)} Hz · ${runtimeHealth.label}` : runtimeHealth.label;
 const headerStatusClass = view === 'timeline' ? (failed ? 'perf-status-error' : snapshot.readyAt !== undefined ? 'perf-status-ready' : '') : '';

 return <aside className={`perf-panel ${collapsed ? 'perf-panel-collapsed' : ''}`} aria-label="页面性能诊断">
  <header className="perf-panel-header">
   <button type="button" className="perf-panel-title" aria-expanded={!collapsed} aria-controls="performance-panel-body" onClick={() => setCollapsed(!collapsed)}><span className={`perf-status-dot ${headerStatusClass}`} data-health={view === 'runtime' ? runtimeHealth.level : undefined} /><span>{view === 'runtime' ? '实时性能' : '加载时间线'}</span><span className="perf-header-time" data-health={view === 'runtime' ? runtimeHealth.level : undefined} title={view === 'runtime' ? runtimeHealth.reason : undefined}>{headerValue}</span><span aria-hidden="true">{collapsed ? '＋' : '−'}</span></button>
  </header>
  {!collapsed && <div id="performance-panel-body" className="perf-panel-body">
   <fieldset className="perf-tabs" aria-label="性能诊断视图"><button type="button" data-perf-tab="runtime" aria-pressed={view === 'runtime'} onClick={() => setView('runtime')}>实时运行</button><button type="button" data-perf-tab="timeline" aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>加载时间线</button></fieldset>
   {view === 'runtime' ? <><PerformanceRuntimeView snapshot={runtime} health={runtimeHealth} startupLabel={startupLabel} startupTime={duration(startupEnd)} failed={runtimeFailed} onPause={() => changeRuntime('pause')} onResume={() => changeRuntime('resume')} onClear={() => changeRuntime('clear')} /><PerformanceCacheView summary={resourceCache} dropped={snapshot.droppedResources} observerSupported={snapshot.resourceObserverSupported} compact /></> : <>
   <div className="perf-overview"><div><span>{snapshot.readyAt !== undefined ? '首屏控件已就绪' : failed ? '本次初始化已中断' : '正在进入页面'}</span><strong>{duration(startupEnd)}</strong></div><p>从导航开始 · 就绪后冻结首屏时间</p>
    <Progress.Root value={snapshot.readyAt !== undefined ? 1 : null} max={1} aria-label="首屏控件就绪状态" aria-valuetext={snapshot.readyAt !== undefined ? '首屏控件已就绪' : failed ? '初始化已中断' : '进行中，无法预估剩余时间'} className={`perf-progress ${failed ? 'perf-progress-stopped' : ''}`}><Progress.Track className="perf-progress-track"><Progress.Indicator className="perf-progress-indicator" /></Progress.Track></Progress.Root>
   </div>
   <p className="perf-explanation">耗时条按真实开始时间排列，并行与父子阶段不能相加。未知完成比例时仅显示进行中。</p>
   <label className="perf-search-label"><span>查找阶段或资源</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="模型、声音、weather、.js…" /></label>
   <section className="perf-active" aria-label="正在执行的阶段"><div className="perf-section-heading"><span>正在执行</span><span className="perf-count">{active.length}</span></div>
    {!active.length && <p className="perf-empty">{query ? '没有匹配的执行中阶段。' : '当前没有未结束的业务阶段。'}</p>}
    <ul>{active.slice(0, 12).map(phase => <li key={phase.entryName}><div className="perf-row-heading"><span>{LABELS[phase.detail.phase] ?? phase.detail.phase}</span><strong>{duration(Math.max(0, snapshot.now - phase.startTime))}</strong></div><div className="perf-row-code">{phase.detail.phase}{detail(phase) && ` · ${detail(phase)}`}</div><Progress.Root value={null} aria-label={`${LABELS[phase.detail.phase] ?? phase.detail.phase}进行中`} className="perf-progress"><Progress.Track className="perf-progress-track"><Progress.Indicator className="perf-progress-indicator" /></Progress.Track></Progress.Root></li>)}</ul>
    {active.length > 12 && <p className="perf-empty">另有 {active.length - 12} 个进行中阶段，可通过查找定位；导出包含全部记录。</p>}
   </section>
   <TimelineGroup title="浏览器导航" rows={navigation} scale={scale} query={query} />
   <TimelineGroup title="业务阶段" rows={completed} scale={scale} query={query} initiallyOpen />
   <PerformanceCacheView summary={resourceCache} dropped={snapshot.droppedResources} observerSupported={snapshot.resourceObserverSupported} />
   <TimelineGroup title="网络资源 · JS / CSS / 模型 / 音频" rows={network} scale={scale} query={query} />
   <p className="perf-explanation">资源条仅表示浏览器记录了请求耗时，不能单凭此判断 HTTP 或业务是否成功。</p>
   {!snapshot.resourceObserverSupported && <p className="perf-warning">此浏览器未启用资源观察器；列表只包含面板启动时浏览器仍保留的资源记录。</p>}
   {(snapshot.dropped + snapshot.droppedActive + snapshot.droppedResources > 0) && <p className="perf-warning">保留最近记录：已丢弃 {snapshot.dropped} 条完成阶段、{snapshot.droppedActive} 条活动记录、{snapshot.droppedResources} 条资源。</p>}
   </>}
   <footer className="perf-panel-footer"><button type="button" data-runtime-action="export" onClick={exportJson}>导出 JSON</button><span>加载与实时数据 · 仅本机</span></footer>
   {downloadError && <output className="perf-warning">导出未成功，请再试一次。</output>}
   {runtimeFailed && runtime && <output className="perf-warning">实时采集遇到异常，当前读数可能未更新。</output>}
   <p className="perf-limitations">面板在 JavaScript 启动后显示，早期导航由浏览器回填；实时采集从面板挂载开始。长同步任务会阻塞面板刷新，结束后才显示耗时。渲染提交不等于 GPU 完成或画面呈现；声音准备不等于首次发声。每 250 ms 刷新有开销，正式对比请去掉 perfUI=1。</p>
  </div>}
 </aside>;
}

class PanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
 state = { failed: false };
 static getDerivedStateFromError() { return { failed: true }; }
 render() { return this.state.failed ? <aside className="perf-panel perf-panel-error">诊断面板已暂停，页面可继续使用。</aside> : this.props.children; }
}

export default function PerformancePanel() { return <PanelBoundary><Panel /></PanelBoundary>; }
