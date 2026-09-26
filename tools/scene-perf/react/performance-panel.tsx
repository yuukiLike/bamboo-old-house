'use client';

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Progress } from '@base-ui/react/progress';
import type { ActivePhase, Phase } from '../core/timings';
import type { PerformanceAdapter } from './types';
import { createRuntimeCollector, type RuntimeSnapshot } from '../core/runtime';
import { classifyResourceCache, summarizeResourceCache } from '../core/resource-cache.mjs';
import { getRuntimeHealth, PerformanceRuntimeView } from './performance-runtime-view';
import { PerformanceCacheView, formatCacheBytes } from './performance-cache-view';
import './performance-panel.css';

const MAX_RESOURCES = 500;
const PAGE_SIZE = 30;
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
 resourceReadErrors: number;
 businessEnabled: boolean;
 businessFailed: boolean;
}

function duration(value: number) {
 return value < 1000 ? `${value.toFixed(value < 10 ? 1 : 0)} ms` : `${(value / 1000).toFixed(2)} s`;
}
function filename(value: string) {
 try { return decodeURIComponent(new URL(value, location.href).pathname.split('/').filter(Boolean).at(-1) ?? value); }
 catch { return value; }
}
function phaseDetail(adapter: PerformanceAdapter, phase: ActivePhase | Phase) {
 try { if (adapter.formatPhaseDetail) return adapter.formatPhaseDetail(phase); }
 catch { /* A project formatter must not interrupt browser diagnostics. */ }
 return Object.entries(phase.detail)
  .filter(([key, value]) => !['phase', 'operationId', 'status'].includes(key) && value !== undefined && value !== null && value !== '')
  .map(([key, value]) => `${key}=${String(value)}`).join(' · ');
}
function readSnapshot(adapter: PerformanceAdapter, resources: Resource[] = [], droppedResources = 0, resourceObserverSupported = true, resourceReadErrors = 0): Snapshot {
 const empty: Snapshot = {
  now: performance.now(), phases: [], active: [], dropped: 0, droppedActive: 0,
  resources, droppedResources, resourceObserverSupported, resourceReadErrors, businessEnabled: false, businessFailed: false,
 };
 try {
  const data = adapter.readBusinessPhases?.();
  return {
   ...empty, phases: data?.phases.slice() ?? [], active: data?.activePhases?.slice() ?? [],
   readyAt: data?.startupReadyAt, dropped: data?.droppedPhases ?? 0, droppedActive: data?.droppedActivePhases ?? 0,
   businessEnabled: Boolean(data?.enabled),
  };
 } catch { return { ...empty, businessFailed: true }; }
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

function Panel({ adapter }: { adapter: PerformanceAdapter }) {
 const [snapshot, setSnapshot] = useState<Snapshot>(() => readSnapshot(adapter));
 const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
 const [runtimeFailed, setRuntimeFailed] = useState(false);
 const [view, setView] = useState<'runtime' | 'timeline'>('runtime');
 const [collapsed, setCollapsed] = useState(() => typeof matchMedia !== 'undefined' && !matchMedia('(min-width: 901px)').matches);
 const [query, setQuery] = useState('');
 const [downloadError, setDownloadError] = useState(false);
 const [stopped, setStopped] = useState(false);
 const [stopFailed, setStopFailed] = useState(false);
 const stopCollection = useRef<() => void>(() => {});
 const resourceObserverSupported = useRef(true);
 const resourceReadErrors = useRef(0);
 const resources = useRef<Resource[]>([]);
 const resourceIds = useRef(new Set<string>());
 const droppedResources = useRef(0);
 const downloadUrl = useRef<string | undefined>(undefined);
 const revokeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
 const runtimeCollector = useRef<ReturnType<typeof createRuntimeCollector> | null>(null);

 useEffect(() => {
  if (stopped) return;
  let collectorFailed = false;
  let detached = false;
  let resourcesChanged = true;
  let retainedResources: Resource[] = [];
  let releaseHost: void | (() => void);
  try {
   const collector = createRuntimeCollector(adapter);
   runtimeCollector.current = collector;
   try { releaseHost = adapter.onCollector?.(collector); }
   catch {
    // A failed host binding must not leave a live collector behind.
    collector.dispose(); runtimeCollector.current = null; collectorFailed = true;
   }
  } catch { collectorFailed = true; }
  const append = (entries: PerformanceEntry[]) => {
   if (detached) return;
   for (const entry of entries) {
    try {
     if (entry.entryType !== 'resource') continue;
     const resource = entry as PerformanceResourceTiming;
     const id = `${resource.startTime}:${resource.name}:${resource.initiatorType}`;
     if (resourceIds.current.has(id)) continue;
     const timing = resource.toJSON() as Record<string, unknown>;
     const retained = { id, name: resource.name, startTime: resource.startTime, duration: resource.duration, initiatorType: resource.initiatorType, cache: classifyResourceCache(timing, { pageUrl: location.href }), timing };
     resources.current.push(retained);
     resourcesChanged = true;
     resourceIds.current.add(id);
     if (resources.current.length > MAX_RESOURCES) {
      const evicted = resources.current.shift();
      if (evicted) resourceIds.current.delete(evicted.id);
      droppedResources.current++;
     }
    } catch { resourceReadErrors.current++; }
   }
  };
  // Resource failures must leave setup able to return its disposer. Count them
  // explicitly: a partial cache sample must not masquerade as complete evidence.
  const readResources = (read: () => PerformanceEntry[]) => {
   try { append(read()); }
   catch { resourceReadErrors.current++; }
  };
  readResources(() => performance.getEntriesByType('resource'));
  let observer: PerformanceObserver | undefined;
  try {
   observer = new PerformanceObserver(list => readResources(() => list.getEntries()));
   observer.observe({ type: 'resource', buffered: true });
  } catch { observer?.disconnect(); resourceObserverSupported.current = false; }
  const refresh = () => {
   if (detached || document.hidden) return;
   try {
    setRuntime(runtimeCollector.current?.snapshot() ?? null);
    setRuntimeFailed(collectorFailed);
   }
   catch { setRuntimeFailed(true); }
   if (resourcesChanged) { retainedResources = resources.current.slice(); resourcesChanged = false; }
   setSnapshot(readSnapshot(adapter, retainedResources, droppedResources.current, resourceObserverSupported.current, resourceReadErrors.current));
  };
  const firstRefresh = setTimeout(refresh, 0);
  // RAF collection is unchanged; the diagnostic UI only needs one repaint
  // per second. Reuse the resource snapshot until real requests arrive.
  const timer = setInterval(refresh, 1000);
  document.addEventListener('visibilitychange', refresh);
  const detach = () => {
   if (detached) return;
   detached = true;
   clearInterval(timer); observer?.disconnect();
   clearTimeout(firstRefresh);
   document.removeEventListener('visibilitychange', refresh);
   runtimeCollector.current?.dispose();
  };
  stopCollection.current = () => {
   detach();
   try {
    if (adapter.stopCollection) adapter.stopCollection();
    else if (adapter.readBusinessPhases?.()?.enabled) setStopFailed(true);
   }
   catch { setStopFailed(true); }
   setRuntime(runtimeCollector.current?.snapshot() ?? null);
   setSnapshot(readSnapshot(adapter, resources.current.slice(), droppedResources.current, resourceObserverSupported.current, resourceReadErrors.current));
   setCollapsed(true);
   setStopped(true);
  };
  return () => {
   detach();
   stopCollection.current = () => {};
   try { releaseHost?.(); }
   catch { /* Host cleanup cannot prevent collector and browser cleanup. */ }
   finally { runtimeCollector.current?.dispose(); runtimeCollector.current = null; }
  };
 }, [adapter, stopped]);

 // Export remains available after collection stops, so its cleanup belongs
 // to the panel's lifetime rather than the shorter collection effect.
 useEffect(() => () => {
  clearTimeout(revokeTimer.current);
  if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
 }, []);

 const startup = snapshot.phases.filter(phase => phase.detail.phase === adapter.startupPhase).at(-1);
 const startupActive = snapshot.active.some(phase => phase.detail.phase === adapter.startupPhase);
 const failed = snapshot.readyAt === undefined && !startupActive && startup && startup.detail.status !== 'success';
 const startupEnd = snapshot.readyAt ?? (failed ? startup.startTime + startup.duration : snapshot.now);
 const timelineVisible = !collapsed && view === 'timeline';
 const completed = useMemo(() => timelineVisible ? snapshot.phases.map(phase => ({ id: phase.entryName, name: phase.detail.phase, label: adapter.phaseLabels?.[phase.detail.phase] ?? phase.detail.phase, startTime: phase.startTime, duration: phase.duration, status: phase.detail.status, detail: phaseDetail(adapter, phase) })).sort((a, b) => a.startTime - b.startTime) : [], [adapter, snapshot.phases, timelineVisible]);
 const network = useMemo(() => timelineVisible ? snapshot.resources.map(resource => ({ id: resource.id, name: resource.initiatorType || 'resource', label: filename(resource.name), startTime: resource.startTime, duration: resource.duration, status: 'recorded', detail: resource.name, cache: resource.cache })).sort((a, b) => a.startTime - b.startTime) : [], [snapshot.resources, timelineVisible]);
 const resourceCache = useMemo(() => summarizeResourceCache(snapshot.resources, { pageUrl: location.href }), [snapshot.resources]);
 const navigation = timelineVisible ? navigationRows(snapshot.now) : [];
 const scale = Math.max(1, startupEnd, ...completed.map(row => row.startTime + row.duration), ...network.map(row => row.startTime + row.duration), ...navigation.map(row => row.startTime + row.duration));
 const active = timelineVisible ? snapshot.active.filter(phase => `${phase.detail.phase} ${adapter.phaseLabels?.[phase.detail.phase] ?? ''} ${phaseDetail(adapter, phase)}`.toLowerCase().includes(query.trim().toLowerCase())) : [];

 const exportJson = () => {
  try {
   const latest = stopped ? snapshot : readSnapshot(adapter, resources.current.slice(), droppedResources.current, resourceObserverSupported.current, resourceReadErrors.current);
   const retainedResources = latest.resources.map(resource => ({ ...resource.timing, cache: resource.cache }));
   const content = JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), timeOrigin: performance.timeOrigin, url: location.href, startupReadyAt: latest.readyAt, now: latest.now, navigation: performance.getEntriesByType('navigation').map(entry => entry.toJSON()), resources: retainedResources, resourceCache: { ...summarizeResourceCache(retainedResources, { pageUrl: location.href }), scope: 'Retained Resource Timing entries only; initial navigation is separate.', droppedResources: latest.droppedResources, resourceObserverSupported: latest.resourceObserverSupported, resourceReadErrors: latest.resourceReadErrors }, businessPhases: { version: 1, enabled: latest.businessEnabled, phases: latest.phases, activePhases: latest.active, droppedPhases: latest.dropped, droppedActivePhases: latest.droppedActive }, runtime: runtimeCollector.current?.snapshot() ?? runtime, businessAdapterFailed: latest.businessFailed, droppedResources: droppedResources.current, limitations: ['CPU submission does not prove GPU completion or display presentation.', 'Concurrent and nested durations must not be added.', 'The UI cannot repaint during synchronous main-thread work.', 'Resource history starts from entries still retained by the browser when the panel loads.', 'Local resource reuse does not prove a Cache-Control freshness policy; Resource Timing revalidation is inference without wire-level 304 evidence.', 'Page Resource Timing cannot read arbitrary resource response headers; cache summaries cover retained resources only.', 'Runtime RAF rates are callback rates, not display FPS or GPU timings.', 'Runtime collection starts when this opt-in panel mounts; hidden and paused frame gaps are excluded.'] }, null, 2);
   clearTimeout(revokeTimer.current);
   if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
   const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
   downloadUrl.current = url;
   const link = document.createElement('a');
   link.href = url; link.download = `${adapter.id.replace(/[^a-zA-Z0-9_.-]/g, '-') || 'scene'}-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; link.click();
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
 const readyLabel = adapter.readyLabel ?? '首屏已就绪';
 const startupLabel = snapshot.businessFailed ? '业务阶段读取异常' : snapshot.readyAt !== undefined ? readyLabel : failed ? '初始化已中断' : adapter.startupPhase ? '首屏加载中' : '首屏就绪未标记';
 const runtimeStatus = runtime?.status ?? 'stopped';
 const runtimeHealth = getRuntimeHealth(runtime, runtimeFailed, snapshot.businessFailed);
 const headerValue = stopped ? '已停止' : view === 'timeline' ? duration(startupEnd) : runtimeStatus === 'collecting' && !runtimeFailed && runtime?.window.rafHz !== null && runtime?.window.rafHz !== undefined ? `${runtime.window.rafHz.toFixed(1)} Hz · ${runtimeHealth.label}` : runtimeHealth.label;
 const headerStatusClass = view === 'timeline' ? (failed ? 'perf-status-error' : snapshot.readyAt !== undefined ? 'perf-status-ready' : '') : '';

 return <aside className={`perf-panel ${collapsed ? 'perf-panel-collapsed' : ''}`} aria-label="页面性能诊断" data-scene-perf data-collection={stopped ? 'stopped' : 'running'}>
  <header className="perf-panel-header">
   <button type="button" className="perf-panel-title" aria-expanded={!collapsed} aria-controls="performance-panel-body" onClick={() => setCollapsed(!collapsed)}><span className={`perf-status-dot ${headerStatusClass}`} data-health={view === 'runtime' ? runtimeHealth.level : undefined} /><span>{view === 'runtime' ? '实时性能' : '加载时间线'}</span><span className="perf-header-time" data-health={view === 'runtime' ? runtimeHealth.level : undefined} title={view === 'runtime' ? runtimeHealth.reason : undefined}>{headerValue}</span><span aria-hidden="true">{collapsed ? '＋' : '−'}</span></button>
   <button type="button" className="perf-stop" aria-label="停止性能检测" disabled={stopped} onClick={() => stopCollection.current()}>{stopped ? '已停止' : '停止检测'}</button>
  </header>
  {!collapsed && <div id="performance-panel-body" className="perf-panel-body">
   <fieldset className="perf-tabs" aria-label="性能诊断视图"><button type="button" data-perf-tab="runtime" aria-pressed={view === 'runtime'} onClick={() => setView('runtime')}>实时运行</button><button type="button" data-perf-tab="timeline" aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>加载时间线</button></fieldset>
   {stopped && <output className="perf-explanation">{stopFailed ? '面板检测已停止，项目业务采集仍需关闭。' : '性能检测已停止：不再采集或自动刷新。'}保留最后记录供查看和导出，刷新页面可重新检测。</output>}
   {stopFailed && <p className="perf-warning">面板采集已停止，但项目业务采集停止失败。请去掉 perf 与 perfUI 参数后刷新页面。</p>}
   {view === 'runtime' ? <><PerformanceRuntimeView snapshot={runtime} health={runtimeHealth} describeState={adapter.describeState} rendererDescription={adapter.rendererDescription} startupLabel={startupLabel} startupTime={duration(startupEnd)} failed={runtimeFailed} onPause={() => changeRuntime('pause')} onResume={() => changeRuntime('resume')} onClear={() => changeRuntime('clear')} /><PerformanceCacheView summary={resourceCache} dropped={snapshot.droppedResources} observerSupported={snapshot.resourceObserverSupported} readErrors={snapshot.resourceReadErrors} compact /></> : <>
   <div className="perf-overview"><div><span>{snapshot.businessFailed ? '业务阶段读取异常' : snapshot.readyAt !== undefined ? readyLabel : failed ? '本次初始化已中断' : adapter.startupPhase ? '正在进入页面' : '导航后经过'}</span><strong>{duration(startupEnd)}</strong></div><p>从导航开始 · 就绪后冻结首屏时间</p>
    <Progress.Root value={snapshot.readyAt !== undefined ? 1 : null} max={1} aria-label="首屏就绪状态" aria-valuetext={snapshot.readyAt !== undefined ? readyLabel : failed ? '初始化已中断' : '尚未收到首屏就绪标记'} className={`perf-progress ${failed ? 'perf-progress-stopped' : ''}`}><Progress.Track className="perf-progress-track"><Progress.Indicator className="perf-progress-indicator" /></Progress.Track></Progress.Root>
   </div>
   <p className="perf-explanation">耗时条按真实开始时间排列，并行与父子阶段不能相加。未知完成比例时仅显示进行中。</p>
   <label className="perf-search-label"><span>查找阶段或资源</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="阶段名称、资源地址、.js…" /></label>
   <section className="perf-active" aria-label="正在执行的阶段"><div className="perf-section-heading"><span>正在执行</span><span className="perf-count">{active.length}</span></div>
    {!active.length && <p className="perf-empty">{query ? '没有匹配的执行中阶段。' : '当前没有未结束的业务阶段。'}</p>}
    <ul>{active.slice(0, 12).map(phase => <li key={phase.entryName}><div className="perf-row-heading"><span>{adapter.phaseLabels?.[phase.detail.phase] ?? phase.detail.phase}</span><strong>{duration(Math.max(0, snapshot.now - phase.startTime))}</strong></div><div className="perf-row-code">{phase.detail.phase}{phaseDetail(adapter, phase) && ` · ${phaseDetail(adapter, phase)}`}</div><Progress.Root value={null} aria-label={`${adapter.phaseLabels?.[phase.detail.phase] ?? phase.detail.phase}进行中`} className="perf-progress"><Progress.Track className="perf-progress-track"><Progress.Indicator className="perf-progress-indicator" /></Progress.Track></Progress.Root></li>)}</ul>
    {active.length > 12 && <p className="perf-empty">另有 {active.length - 12} 个进行中阶段，可通过查找定位；导出包含全部记录。</p>}
   </section>
   <TimelineGroup title="浏览器导航" rows={navigation} scale={scale} query={query} />
   <TimelineGroup title="业务阶段" rows={completed} scale={scale} query={query} initiallyOpen />
   <PerformanceCacheView summary={resourceCache} dropped={snapshot.droppedResources} observerSupported={snapshot.resourceObserverSupported} readErrors={snapshot.resourceReadErrors} />
   <TimelineGroup title="网络资源 · JS / CSS / 模型 / 音频" rows={network} scale={scale} query={query} />
   <p className="perf-explanation">资源条仅表示浏览器记录了请求耗时，不能单凭此判断 HTTP 或业务是否成功。</p>
   {!snapshot.resourceObserverSupported && <p className="perf-warning">此浏览器未启用资源观察器；列表只包含面板启动时浏览器仍保留的资源记录。</p>}
   {(snapshot.dropped + snapshot.droppedActive + snapshot.droppedResources > 0) && <p className="perf-warning">保留最近记录：已丢弃 {snapshot.dropped} 条完成阶段、{snapshot.droppedActive} 条活动记录、{snapshot.droppedResources} 条资源。</p>}
   </>}
   <footer className="perf-panel-footer"><button type="button" data-runtime-action="export" onClick={exportJson}>导出 JSON</button><span>加载与实时数据 · 仅本机</span></footer>
   {downloadError && <output className="perf-warning">导出未成功，请再试一次。</output>}
   {snapshot.businessFailed && <output className="perf-warning">项目业务阶段读取失败；浏览器导航、资源和 RAF 仍可独立采集。</output>}
   {runtimeFailed && runtime && <output className="perf-warning">实时采集遇到异常，当前读数可能未更新。</output>}
   <p className="perf-limitations">面板在 JavaScript 启动后显示，早期导航由浏览器回填；实时采集从面板挂载开始。长同步任务会阻塞面板刷新，结束后才显示耗时。渲染提交不等于 GPU 完成或画面呈现；声音准备不等于首次发声。检测期间每秒刷新，折叠仍采集；“停止检测”才会停止全部采集。正式对比请去掉 perfUI=1。</p>
  </div>}
 </aside>;
}

class PanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
 state = { failed: false };
 static getDerivedStateFromError() { return { failed: true }; }
 render() { return this.state.failed ? <aside className="perf-panel perf-panel-error" data-scene-perf>诊断面板已暂停，页面可继续使用。</aside> : this.props.children; }
}

export default function PerformancePanel({ adapter }: { adapter: PerformanceAdapter }) { return <PanelBoundary><Panel adapter={adapter} /></PanelBoundary>; }
