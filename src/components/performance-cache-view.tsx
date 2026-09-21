import { CACHE_LABELS, summarizeResourceCache } from '../../scripts/perf/resource-cache.mjs';

type CacheSummary = ReturnType<typeof summarizeResourceCache>;

export function formatCacheBytes(value: number | null | undefined) {
 if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
 if (value < 1024) return `${value} B`;
 if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
 return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function percent(value: number | null) {
 return value === null ? 'N/A' : `${value.toFixed(1)}%`;
}

export function PerformanceCacheView({ summary, dropped, observerSupported, compact = false }: {
 summary: CacheSummary;
 dropped: number;
 observerSupported: boolean;
 compact?: boolean;
}) {
 const categories = [['local', '本地复用'], ['revalidated', '重新验证'], ['network', '网络传输'], ['unknown', '未知']] as const;
 return <section className={`perf-cache ${compact ? 'perf-cache-compact' : ''}`} aria-label="HTTP 缓存概况" data-perf-cache-summary>
  <div className="perf-cache-heading"><span>HTTP 缓存</span><span title="仅统计保留的 Resource Timing；包含面板自身资源，导航文档单列。">保留 {summary.total} 条资源</span></div>
  <dl className="perf-cache-counts">{categories.map(([status, label]) => <div key={status} data-cache-kind={status} title={CACHE_LABELS[status]}><dt>{label}</dt><dd>{summary.total ? summary.counts[status] : 'N/A'}</dd></div>)}</dl>
  {summary.counts['service-worker'] > 0 && <p className="perf-explanation">另有 {summary.counts['service-worker']} 条由 Service Worker 处理，不计入 HTTP 复用比例。</p>}
  <p className="perf-cache-rate"><span title={`本地复用 / ${summary.httpClassified} 条可判定 HTTP 资源`}>本地复用率 <strong>{percent(summary.localHitRatePercent)}</strong></span><span title={`（本地复用 + 重新验证）/ ${summary.httpClassified} 条可判定 HTTP 资源`}>含协商复用 <strong>{percent(summary.reuseRatePercent)}</strong></span></p>
  {!compact && <>
   <p className="perf-explanation">可见传输 {formatCacheBytes(summary.transferBytes)}（{summary.transferKnownCount} 条） · 编码体积 {formatCacheBytes(summary.encodedBodyBytes)}（{summary.encodedKnownCount} 条）</p>
   <p className="perf-explanation">可判定覆盖 {percent(summary.coveragePercent)}；比例分母为 {summary.httpClassified} 条 HTTP 资源，未知不参与。本地复用不直接证明 Cache-Control 强缓存策略；重新验证由资源计时推断，响应头和 304 可由外部采集核实。</p>
  </>}
  {compact && <p className="perf-explanation">分母 {summary.httpClassified} 条可判定 HTTP；缓存策略未由响应头验证。详见加载时间线。</p>}
  {(dropped > 0 || !observerSupported) && <p className="perf-warning">{dropped > 0 && `已淘汰 ${dropped} 条资源；当前比例只覆盖保留记录。`}{!observerSupported && '资源观察器不可用，只回填面板启动时浏览器保留的记录。'}</p>}
 </section>;
}
