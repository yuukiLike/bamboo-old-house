import { useState } from 'react';
import type { RuntimeSnapshot, RuntimeState } from '@/lib/performance-runtime';

const VIEW_LABELS: Record<string, string> = {
 moon: '竹林望月', breeze: '林间的风', well: '井边', 'well-rain': '井旁听雨', porch: '木廊',
 walk: '步行', free: '自由看看', outdoor: '院坝', interior: '楼上',
 courtyard: '屋前空地', 'yard-edge': '院边竹荫', upstairs: '二层厅堂', store: '仓库',
 'room-one': '住屋一', 'room-two': '住屋二', hall: '一楼堂屋', kitchen: '一楼厨房',
};

function milliseconds(value: number | null | undefined) {
 if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
 return value < 1000 ? `${value.toFixed(value < 10 ? 1 : 0)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function severity(value: number | null | undefined) {
 return value !== null && value !== undefined && value >= 100 ? 'slow' : value !== null && value !== undefined && value >= 50 ? 'warning' : 'normal';
}

function stateDescription(state: RuntimeState) {
 const view = state.view ? VIEW_LABELS[state.view] ?? state.view : '视图未知';
 const place = state.place ? VIEW_LABELS[state.place] ?? state.place : '位置未知';
 const sound = state.soundEnabled === null ? '声音未知' : state.soundEnabled ? '声音开' : '声音关';
 return [view, place !== view ? place : null, sound, state.weatherPreset ?? '天气未知', state.paused ? '动态暂停' : null].filter(Boolean).join(' · ');
}

function FrameRateGuide() {
 return <details className="perf-group perf-fps-guide" open>
  <summary>帧率怎么看？<span>60 FPS 是常见流畅目标</span></summary>
  <p>FPS 表示每秒画面更新多少帧。先以常见的 60 Hz 屏幕为参考：</p>
  <dl className="perf-fps-reference">
   <div><dt>约 60 FPS<small>16.7 ms / 帧</small></dt><dd><strong>流畅目标</strong>转动视角、场景运动通常更连贯。</dd></div>
   <div><dt>约 30 FPS<small>33.3 ms / 帧</small></dt><dd><strong>基本可用</strong>移动或转动视角时，连续性较弱。</dd></div>
   <div><dt>低于 30 FPS<small>大于 33.3 ms / 帧</small></dt><dd><strong>需要关注</strong>运动画面更容易感觉不连贯。</dd></div>
  </dl>
  <p>高刷新率屏幕可有更高目标，例如 120 Hz 对应 120 FPS（约 8.3 ms / 帧）。设备、节能设置和场景不同，没有统一的合格线。</p>
  <p><strong>判断卡顿：</strong>平均值正常也可能有停顿。p95 表示约 95% 的已记录间隔不超过该值；结合最大间隔和下方「最近卡顿」一起看。</p>
  <p className="perf-fps-thresholds"><span className="perf-chart-warning">≥ 50 ms 标黄</span><span className="perf-chart-slow">≥ 100 ms 标红</span></p>
  <p>这是本工具的停顿提示线；未触发标记，也不代表每帧都达到 60 FPS 的目标。</p>
 </details>;
}

function RuntimeChart({ snapshot }: { snapshot: RuntimeSnapshot }) {
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
   <text className="perf-chart-label" x={left} y="109">−30 s</text><text className="perf-chart-label" x={left + plotWidth} y="109" textAnchor="end">{snapshot.status === 'collecting' ? '现在' : '暂停边界'}</text>
  </svg>
  <p className="perf-chart-legend"><span className="perf-chart-warning">≥ 50 ms 慢间隔</span><span className="perf-chart-slow">≥ 100 ms 明显停顿</span><span>{maximum > ceiling ? `柱高上限 ${ceiling} ms` : '空白为无样本'}</span></p>
 </figure>;
}

export function PerformanceRuntimeView({ snapshot, startupLabel, startupTime, failed, onPause, onResume, onClear }: {
 snapshot: RuntimeSnapshot | null;
 startupLabel: string;
 startupTime: string;
 failed: boolean;
 onPause: () => void;
 onResume: () => void;
 onClear: () => void;
}) {
 const [showAllStutters, setShowAllStutters] = useState(false);
 if (!snapshot) return <p className="perf-empty">{failed ? '实时采集未能启动；加载时间线仍可查看。' : '正在启动实时采集…'}</p>;
 const status = { collecting: '正在采集', paused: '已手动暂停', hidden: '页面隐藏 · 已停止采样', stopped: '采集已停止' }[snapshot.status];
 const recent = snapshot.stutters.slice().reverse();
 const visible = showAllStutters ? recent : recent.slice(0, 6);
 const renderer = snapshot.renderer;
 const number = (value: number | null | undefined) => value === null || value === undefined ? 'N/A' : value.toLocaleString('zh-CN');
 const stateChanged = (before: RuntimeState | null, after: RuntimeState) => before !== null && stateDescription(before) !== stateDescription(after);
 return <div className="perf-runtime-view">
  <div className="perf-runtime-status"><span><i aria-hidden="true" className={`perf-status-dot ${snapshot.status === 'collecting' ? 'perf-status-ready' : 'perf-status-idle'}`} />{status}</span><small>{startupLabel} · {startupTime}</small></div>
  <div className="perf-runtime-metrics">
   <div className="perf-runtime-metric"><span>浏览器回调频率</span><strong>{snapshot.window.rafHz === null ? 'N/A' : snapshot.window.rafHz.toFixed(1)}{snapshot.window.rafHz !== null && <small>Hz</small>}</strong><span>近 5 秒 · RAF</span></div>
   <div className="perf-runtime-metric" data-severity={severity(snapshot.window.p95Ms)}><span>帧间隔 p95</span><strong>{snapshot.window.p95Ms === null ? 'N/A' : snapshot.window.p95Ms.toFixed(0)}{snapshot.window.p95Ms !== null && <small>ms</small>}</strong></div>
   <div className="perf-runtime-metric" data-severity={severity(snapshot.window.maxMs)}><span>最大帧间隔</span><strong>{snapshot.window.maxMs === null ? 'N/A' : snapshot.window.maxMs.toFixed(0)}{snapshot.window.maxMs !== null && <small>ms</small>}</strong></div>
  </div>
  <aside className="perf-raf-guide" aria-label="浏览器回调频率说明">
   <strong>这个 Hz 是什么意思？</strong>
   <p>RAF 是浏览器安排页面准备下一帧的回调。这里显示近 5 秒的平均频率，例如 <strong>60 Hz ≈ 每秒 60 次回调</strong>。</p>
   <p>它反映更新节奏，<strong>不是实际画面 FPS</strong>，也不代表屏幕刷新率。判断流畅度，还要看帧间隔和具体停顿。</p>
  </aside>
  <p className="perf-explanation">{snapshot.window.count} 个前台样本 · 完整间隔合计 {(snapshot.window.observedMs / 1000).toFixed(2)} s · 慢间隔 {snapshot.window.slowCount} 次。按近 5 秒内结束的完整间隔统计，长间隔可跨窗口起点。RAF 回调率不是屏幕 FPS。</p>
  <FrameRateGuide />
  <RuntimeChart snapshot={snapshot} />
  <div className="perf-runtime-actions">
   <button type="button" data-runtime-action="pause" onClick={snapshot.status === 'paused' ? onResume : onPause} disabled={snapshot.status === 'stopped'}>{snapshot.status === 'paused' ? '继续采集' : '暂停采集'}</button>
   <button type="button" data-runtime-action="clear" title="清空实时记录，保留加载时间线" onClick={onClear}>清空窗口</button>
  </div>
  {snapshot.status !== 'collecting' && <p className="perf-explanation">读数与图表冻结在停止采样边界，恢复后继续记录；清空只影响实时窗口。</p>}
  <p className="perf-runtime-context">{snapshot.status === 'collecting' ? '当前' : '停止时'}：{stateDescription(snapshot.state)}</p>
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
   <summary>{snapshot.status === 'collecting' ? '当前渲染器快照' : '停止时渲染器快照'}</summary>
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
   <p className="perf-explanation">应用提供的最新计数，每 15 帧刷新；纹理和几何体是数量，不是显存。未测量 GPU 时间。</p>
  </details>
  <p className="perf-explanation">{snapshot.longTasks.supported ? `近 5 秒主线程长任务 ${snapshot.longTasks.recentCount ?? 0} 次，最长 ${milliseconds(snapshot.longTasks.recentMaxMs)}。` : '此浏览器未提供 Long Tasks 记录。'} {snapshot.interruptions > 0 ? `已排除 ${snapshot.interruptions} 次暂停或隐藏边界。` : '页面隐藏时停止采样，恢复后排除跨界间隔。'}</p>
  {(snapshot.dropped.frames + snapshot.dropped.stutters + snapshot.dropped.longTasks > 0) && <p className="perf-warning">有界保留已移除：{snapshot.dropped.frames} 个帧样本、{snapshot.dropped.stutters} 条卡顿、{snapshot.dropped.longTasks} 条长任务。导出包含当前保留窗口。</p>}
 </div>;
}
