import { useState } from 'react';
import type { RuntimeSnapshot, RuntimeState } from '../core/runtime';

function milliseconds(value: number | null | undefined) {
 if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
 return value < 1000 ? `${value.toFixed(value < 10 ? 1 : 0)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function severity(value: number | null | undefined) {
 return value !== null && value !== undefined && value >= 100 ? 'slow' : value !== null && value !== undefined && value >= 50 ? 'warning' : 'normal';
}

interface RuntimeHealth {
 level: 'good' | 'warning' | 'slow' | 'unknown';
 label: string;
 reason: string;
}

// Presentation guidance for a 60 Hz reference, not measured display FPS.
// Keep the raw collector values and the original stutter thresholds unchanged.
export function getRuntimeHealth(snapshot: RuntimeSnapshot | null, failed = false, businessFailed = false): RuntimeHealth {
 if (failed) return { level: 'unknown', label: '采集异常', reason: '读数可能已停止更新，暂不判断。' };
 if (!snapshot) return { level: 'unknown', label: '采样中', reason: '等待浏览器提供帧间隔。' };
 if (businessFailed || snapshot.adapterErrors.length) return { level: 'unknown', label: '上下文异常', reason: '项目上下文读取失败；RAF 读数仍可用，暂不作完整状态判断。' };
 if (snapshot.status !== 'collecting') return { level: 'unknown', label: { paused: '已暂停', hidden: '页面隐藏', stopped: '已停止' }[snapshot.status], reason: '保留停止时的读数，暂不判断当前状态。' };
 const { rafHz, p95Ms, maxMs, count, observedMs } = snapshot.window;
 if (rafHz === null || p95Ms === null || maxMs === null || ![rafHz, p95Ms, maxMs, observedMs].every(Number.isFinite) || count < 1 || observedMs <= 0) {
  return { level: 'unknown', label: '采样中', reason: '等待有效的前台帧间隔。' };
 }
 if (snapshot.now - snapshot.segmentStartedAt < snapshot.windowMs) {
  // A short pause can leave old samples in the five-second window. Only a
  // completed long gap from this new segment may bypass the warmup state.
  const currentStall = snapshot.history.some(frame => frame.startTime >= snapshot.segmentStartedAt && frame.duration >= 100);
  return currentStall
   ? { level: 'slow', label: '卡顿', reason: '本次连续采样已出现 ≥ 100 ms 的停顿。' }
   : { level: 'unknown', label: '采样中', reason: '积累约 5 秒连续前台样本后判断；明显停顿会提前提示。' };
 }
 // Compare the same precision the reader sees, so 29.97 displayed as 30.0
 // does not turn red solely because of its hidden fractional digits.
 const displayedHz = Number(rafHz.toFixed(1));
 if (maxMs >= 100) return { level: 'slow', label: '卡顿', reason: `近 5 秒最大间隔 ${milliseconds(maxMs)}，已出现明显停顿。` };
 if (observedMs < 1000) return { level: 'unknown', label: '采样中', reason: '有效帧间隔累计不足 1 秒，继续采样后判断。' };
 if (p95Ms >= 50) return { level: 'slow', label: '卡顿', reason: `近 5 秒 p95 为 ${milliseconds(p95Ms)}，慢间隔较多。` };
 if (displayedHz < 30) return { level: 'slow', label: '卡顿', reason: '近 5 秒回调频率低于 30 Hz，更新节奏偏慢。' };
 if (maxMs >= 50) return { level: 'warning', label: '中等', reason: `近 5 秒最大间隔 ${milliseconds(maxMs)}，有短暂波动。` };
 if (p95Ms > 25) return { level: 'warning', label: '中等', reason: `近 5 秒 p95 为 ${milliseconds(p95Ms)}，部分间隔偏长。` };
 if (displayedHz < 55) return { level: 'warning', label: '中等', reason: '近 5 秒回调频率不足 55 Hz，未接近 60 Hz 参考目标。' };
 return { level: 'good', label: '合适', reason: '近 5 秒更新节奏较稳定，未记录到 ≥ 50 ms 的慢间隔。' };
}

function defaultStateDescription(state: RuntimeState) {
 return Object.entries(state).map(([key, value]) => `${key}=${value === null ? '未知' : String(value)}`).join(' · ') || '未提供项目状态';
}

function FrameRateGuide() {
 return <details className="perf-group perf-fps-guide" open>
  <summary>帧率怎么看？<span>60 FPS 是常见流畅目标</span></summary>
  <p><strong>Hz 是什么？</strong>Hz 表示每秒多少次。上方读数是近 5 秒浏览器 RAF 回调的平均频率，<strong>60 Hz ≈ 每秒 60 次回调</strong>。每次回调都是一次准备下一帧的机会。</p>
  <p>RAF 回调频率反映更新节奏，<strong>不是实际画面 FPS</strong>，也不代表检测到了屏幕刷新率。</p>
  <p>设置画面更新上限后，场景可以跳过部分 RAF 回调；例如选择 30 帧时，面板仍可能读到 60 Hz。</p>
  <p>FPS 表示每秒画面更新多少帧。先以常见的 60 Hz 屏幕为参考：</p>
  <dl className="perf-fps-reference">
   <div><dt>约 60 FPS<small>16.7 ms / 帧</small></dt><dd><strong>流畅目标</strong>转动视角、场景运动通常更连贯。</dd></div>
   <div><dt>约 30 FPS<small>33.3 ms / 帧</small></dt><dd><strong>基本可用</strong>移动或转动视角时，连续性较弱。</dd></div>
   <div><dt>低于 30 FPS<small>大于 33.3 ms / 帧</small></dt><dd><strong>需要关注</strong>运动画面更容易感觉不连贯。</dd></div>
  </dl>
  <p>高刷新率屏幕可有更高目标，例如 120 Hz 对应 120 FPS（约 8.3 ms / 帧）。设备、节能设置和场景不同，没有统一的合格线。</p>
  <div className="perf-health-rules">
   <p><strong>数字颜色 · 以 60 Hz 为参考</strong></p>
   <p><span data-health="good">绿色 · 合适</span> ≥ 55 Hz，且 p95 ≤ 25 ms、最大间隔 &lt; 50 ms。</p>
   <p><span data-health="warning">黄色 · 中等</span> 介于绿色与红色条件之间。</p>
   <p><span data-health="slow">红色 · 卡顿</span> &lt; 30 Hz，或 p95 ≥ 50 ms，或最大间隔 ≥ 100 ms。</p>
   <p>样本足够时，任一红色条件优先；频率按显示的一位小数判断。暂停、隐藏、异常、连续采样不足 5 秒或有效间隔累计不足 1 秒时显示灰色；本段已完成的 ≥ 100 ms 停顿会提前标红。</p>
  </div>
  <p><strong>判断卡顿：</strong>平均值正常也可能有停顿。p95 表示约 95% 的已记录间隔不超过该值；结合最大间隔和下方「最近卡顿」一起看。</p>
  <p className="perf-fps-thresholds"><span className="perf-chart-warning">≥ 50 ms 标黄</span><span className="perf-chart-slow">≥ 100 ms 标红</span></p>
  <p>图表按单个间隔提示停顿；上方数字综合近 5 秒判断。它们是本工具的参考规则。主线程卡住时面板也会停住，恢复后才会更新颜色。</p>
 </details>;
}

function RuntimeChart({ snapshot, collecting }: { snapshot: RuntimeSnapshot; collecting: boolean }) {
 const bucketCount = 150;
 const plotWidth = 330;
 const plotHeight = 88;
 const left = 34;
 const top = 7;
 const chartStart = snapshot.chartEnd - snapshot.historyMs;
 const buckets = Array.from({ length: bucketCount }, () => null as number | null);
 for (const frame of snapshot.history) {
  const end = frame.startTime + frame.duration;
  const index = Math.min(bucketCount - 1, Math.floor((end - chartStart) / snapshot.historyMs * bucketCount));
  if (end < chartStart || end > snapshot.chartEnd || index < 0) continue;
  buckets[index] = Math.max(buckets[index] ?? 0, frame.duration);
 }
 // Keep diagnostic thresholds legible. Taller spikes are capped visually;
 // their full duration remains in the metric cards, titles and event list.
 const maximum = Math.max(0, ...buckets.map(value => value ?? 0));
 const ceiling = Math.max(120, Math.min(500, Math.ceil(maximum / 50) * 50));
 const y = (value: number) => top + plotHeight * (1 - Math.min(ceiling, value) / ceiling);
 return <figure className="perf-runtime-chart">
  <figcaption>最近 30 秒<span>按结束时刻 · 每 200 ms 取最大值</span></figcaption>
  <svg viewBox="0 0 370 114" aria-label={`最近30秒前台RAF间隔，最大${milliseconds(maximum || null)}，黄色50毫秒、红色100毫秒诊断阈值`}>
   <title>最近 30 秒前台 RAF 回调间隔</title>
   {[50, 100].map(value => <g key={value}><line className={`perf-chart-threshold ${value === 100 ? 'perf-chart-threshold-slow' : ''}`} x1={left} x2={left + plotWidth} y1={y(value)} y2={y(value)} /><text className="perf-chart-label" x={left - 5} y={y(value) + 3} textAnchor="end">{value}</text></g>)}
   <line className="perf-chart-grid" x1={left} x2={left + plotWidth} y1={y(0)} y2={y(0)} />
   <text className="perf-chart-label" x="5" y="10">ms</text>
   {buckets.map((value, index) => value === null ? null : <rect key={index} className="perf-chart-bar" data-severity={severity(value)} x={left + index / bucketCount * plotWidth} y={y(value)} width={Math.max(1, plotWidth / bucketCount - .65)} height={Math.max(1, plotHeight + top - y(value))} rx=".5"><title>{`导航后 ${((chartStart + (index + 1) / bucketCount * snapshot.historyMs) / 1000).toFixed(1)} s 附近：${milliseconds(value)}${value > ceiling ? '（柱高已截顶）' : ''}`}</title></rect>)}
   <text className="perf-chart-label" x={left} y="109">−30 s</text><text className="perf-chart-label" x={left + plotWidth} y="109" textAnchor="end">{collecting ? '现在' : '最后采样'}</text>
  </svg>
  <p className="perf-chart-legend"><span className="perf-chart-warning">≥ 50 ms 慢间隔</span><span className="perf-chart-slow">≥ 100 ms 明显停顿</span><span>{maximum > ceiling ? `柱高上限 ${ceiling} ms` : '空白为无样本'}</span></p>
 </figure>;
}

export function PerformanceRuntimeView({ snapshot, health, startupLabel, startupTime, failed, describeState, rendererDescription, onPause, onResume, onClear }: {
 snapshot: RuntimeSnapshot | null;
 health: RuntimeHealth;
 startupLabel: string;
 startupTime: string;
 failed: boolean;
 describeState?: (state: RuntimeState) => string;
 rendererDescription?: string;
 onPause: () => void;
 onResume: () => void;
 onClear: () => void;
}) {
 const [showAllStutters, setShowAllStutters] = useState(false);
 if (!snapshot) return <p className="perf-empty">{failed ? '实时采集未能启动；加载时间线仍可查看。' : '正在启动实时采集…'}</p>;
 const collecting = !failed && snapshot.status === 'collecting';
 const status = failed ? '采集异常 · 读数可能未更新' : { collecting: '正在采集', paused: '已手动暂停', hidden: '页面隐藏 · 已停止采样', stopped: '采集已停止' }[snapshot.status];
 const recent = snapshot.stutters.slice().reverse();
 const visible = showAllStutters ? recent : recent.slice(0, 6);
 const renderer = snapshot.renderer;
 const number = (value: number | null | undefined) => value === null || value === undefined ? 'N/A' : value.toLocaleString('zh-CN');
 const stateDescription = (state: RuntimeState) => {
  try { return describeState?.(state) ?? defaultStateDescription(state); }
  catch { return defaultStateDescription(state); }
 };
 const stateChanged = (before: RuntimeState | null, after: RuntimeState) => before !== null && stateDescription(before) !== stateDescription(after);
 return <div className="perf-runtime-view">
  <div className="perf-runtime-status"><span><i aria-hidden="true" className={`perf-status-dot ${collecting ? 'perf-status-ready' : 'perf-status-idle'}`} />{status}</span><small>{startupLabel} · {startupTime}</small></div>
  {snapshot.adapterErrors.length > 0 && <p className="perf-warning">项目上下文读取失败：{snapshot.adapterErrors.join('、')}。RAF 仍在独立采样，相关状态与归因暂不可用。</p>}
  <div className="perf-runtime-metrics">
   <div className="perf-runtime-metric" data-health={health.level} title={health.reason}><span>浏览器回调频率</span><strong>{snapshot.window.rafHz === null ? 'N/A' : snapshot.window.rafHz.toFixed(1)}{snapshot.window.rafHz !== null && <small>Hz</small>}</strong><span className="perf-health-label">{health.label}</span><span>近 5 秒 · RAF</span></div>
   <div className="perf-runtime-metric" data-severity={severity(snapshot.window.p95Ms)}><span>帧间隔 p95</span><strong>{snapshot.window.p95Ms === null ? 'N/A' : snapshot.window.p95Ms.toFixed(0)}{snapshot.window.p95Ms !== null && <small>ms</small>}</strong></div>
   <div className="perf-runtime-metric" data-severity={severity(snapshot.window.maxMs)}><span>最大帧间隔</span><strong>{snapshot.window.maxMs === null ? 'N/A' : snapshot.window.maxMs.toFixed(0)}{snapshot.window.maxMs !== null && <small>ms</small>}</strong></div>
  </div>
  <p className="perf-health-description" data-health={health.level}><strong>{health.label}</strong> · {health.reason}</p>
  <p className="perf-explanation">{snapshot.window.count} 个前台样本 · 完整间隔合计 {(snapshot.window.observedMs / 1000).toFixed(2)} s · 慢间隔 {snapshot.window.slowCount} 次。按近 5 秒内结束的完整间隔统计，长间隔可跨窗口起点。</p>
  <FrameRateGuide />
  <RuntimeChart snapshot={snapshot} collecting={collecting} />
  <div className="perf-runtime-actions">
   <button type="button" data-runtime-action="pause" onClick={snapshot.status === 'paused' ? onResume : onPause} disabled={snapshot.status === 'stopped'}>{snapshot.status === 'paused' ? '继续实时采样' : '暂停实时采样'}</button>
   <button type="button" data-runtime-action="clear" title="清空实时记录，保留加载时间线" onClick={onClear} disabled={snapshot.status === 'stopped'}>清空窗口</button>
  </div>
  {!collecting && <p className="perf-explanation">{snapshot.status === 'stopped' ? '读数与图表已冻结，刷新页面可重新检测。' : '读数与图表保留最后一次采样，恢复后继续记录；清空只影响实时窗口。'}</p>}
  <p className="perf-runtime-context">{collecting ? '当前' : '最后采样时'}：{stateDescription(snapshot.state)}</p>
  <details className="perf-group" open>
   <summary><span>最近卡顿</span><span className="perf-count">{recent.length}</span></summary>
   {!recent.length ? <p className="perf-empty">保留窗口内尚无 ≥ 50 ms 的前台 RAF 间隔。</p> : <ol className="perf-runtime-list">{visible.map(event => <li key={event.id} data-severity={severity(event.duration)}>
    <div className="perf-row-heading"><span>导航后 +{(event.startTime / 1000).toFixed(2)} s</span><strong>{milliseconds(event.duration)}</strong></div>
    <p>{stateChanged(event.stateBefore, event.state) ? `${stateDescription(event.stateBefore!)} → ${stateDescription(event.state)}` : stateDescription(event.state)}</p>
    {event.actions.length > 0 && <p>期间操作：{event.actions.map(action => action.label).join(' · ')}</p>}
    {event.recentAction && <p>此前操作：{event.recentAction.label} · 约 {milliseconds(event.startTime - event.recentAction.startTime)} 前</p>}
    <p className="perf-runtime-phases">{event.phases.length ? `重叠阶段：${event.phases.map(phase => phase.replace('(running)', '（当时进行中）')).join(' · ')}` : '没有已记录的重叠业务阶段'}</p>
   </li>)}</ol>}
   {recent.length > 6 && <div className="perf-pagination"><button type="button" onClick={() => setShowAllStutters(!showAllStutters)}>{showAllStutters ? '只看最近 6 条' : `查看保留的 ${recent.length} 条`}</button></div>}
   <p className="perf-explanation">状态取间隔边界附近的快照，操作与业务重叠只提供线索，不证明因果。折叠面板仍继续采集。</p>
  </details>
  <details className="perf-group" open>
   <summary>{collecting ? '当前渲染器快照' : '最后采样时渲染器快照'}</summary>
   {renderer ? <dl className="perf-runtime-diagnostics">
    <div><dt>Draw calls</dt><dd>{number(renderer.drawCalls)}</dd></div>
    <div><dt>Triangles</dt><dd>{number(renderer.triangles)}</dd></div>
    <div><dt>纹理数量</dt><dd>{number(renderer.textures)}</dd></div>
    <div><dt>几何体数量</dt><dd>{number(renderer.geometries)}</dd></div>
    <div><dt>Pixel ratio</dt><dd>{number(renderer.pixelRatio)}</dd></div>
    <div><dt>绘图尺寸</dt><dd>{renderer.drawSize.length ? renderer.drawSize.join(' × ') : 'N/A'}</dd></div>
    <div className="perf-runtime-diagnostic-wide"><dt>画质模式</dt><dd>{renderer.quality ?? 'N/A'}</dd></div>
    <div className="perf-runtime-diagnostic-wide"><dt>图形后端</dt><dd>{renderer.gpu ?? 'N/A'}</dd></div>
   </dl> : <p className="perf-empty">渲染器尚未提供诊断信息。</p>}
   <p className="perf-explanation">{rendererDescription ?? '应用提供的最新计数；更新频率由宿主决定。纹理和几何体是数量，不是显存。未测量 GPU 时间。'}</p>
  </details>
  <p className="perf-explanation">{snapshot.longTasks.supported ? `近 5 秒主线程长任务 ${snapshot.longTasks.recentCount ?? 0} 次，最长 ${milliseconds(snapshot.longTasks.recentMaxMs)}。` : '此浏览器未提供 Long Tasks 记录。'} {snapshot.interruptions > 0 ? `已排除 ${snapshot.interruptions} 次暂停或隐藏边界。` : '页面隐藏时停止采样，恢复后排除跨界间隔。'}</p>
  {(snapshot.dropped.frames + snapshot.dropped.stutters + snapshot.dropped.longTasks > 0) && <p className="perf-warning">有界保留已移除：{snapshot.dropped.frames} 个帧样本、{snapshot.dropped.stutters} 条卡顿、{snapshot.dropped.longTasks} 条长任务。导出包含当前保留窗口。</p>}
 </div>;
}
