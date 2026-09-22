/** Browser-safe interpretation shared by the live panel and offline reports.
 * Timing/headers describe this request, never a promise that a future one hits.
 * Resource Timing sizes are browser-reported estimates, not packet accounting. */
export const CACHE_LABELS = {
  local: '本地复用', revalidated: '协商复用', network: '网络传输',
  'service-worker': 'Service Worker', unknown: '未知',
};
export const CACHE_COLORS = {
  local: '#a4c99e', revalidated: '#9ac5cc', network: '#d6b379',
  'service-worker': '#b9a7d4', unknown: '#7f8d84',
};
const size = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const statusCode = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;

export function classifyResourceCache(entry, { pageUrl = '' } = {}) {
  const network = entry?.network?.source === 'cdp' ? entry.network : null;
  const transferBytes = size(entry?.transferSize);
  const encodedBodyBytes = size(entry?.encodedBodySize);
  const decodedBodyBytes = size(entry?.decodedBodySize);
  const wireStatus = statusCode(network?.wireStatus);
  const responseStatus = statusCode(network?.responseStatus) ?? statusCode(entry?.responseStatus);
  let sameOrigin = false;
  try { sameOrigin = new URL(entry?.name ?? network?.url, pageUrl || undefined).origin === new URL(pageUrl).origin; }
  catch { /* An absent page origin cannot prove byte visibility. */ }
  const allSizesZero = [transferBytes, encodedBodyBytes, decodedBodyBytes].every(value => value === 0);
  const restrictedBytes = allSizesZero && (!sameOrigin || network?.encodedDataLength > 0 || entry?.responseStatus === 0);
  // CDP response headers can be the stored response on a local hit. They state
  // the policy received earlier; they do not prove fresh contact with a CDN.
  const headers = { ...network?.responseHeaders, ...network?.wireResponseHeaders };
  const details = {
    version: 1, transferBytes, encodedBodyBytes, decodedBodyBytes,
    wireStatus, responseStatus,
    cacheControl: headers['cache-control'] ?? null,
    etag: headers.etag ?? null, lastModified: headers['last-modified'] ?? null,
  };
  const result = (status, source, evidence) => ({
    ...details,
    ...(restrictedBytes || status === 'unknown' && ![transferBytes, encodedBodyBytes, decodedBodyBytes].some(value => value > 0)
      ? { transferBytes: null, encodedBodyBytes: null, decodedBodyBytes: null } : {}),
    status, label: CACHE_LABELS[status], source, evidence,
  });
  let protocol;
  try { protocol = new URL(entry?.name ?? network?.url, pageUrl || undefined).protocol; }
  catch { return result('unknown', 'unavailable', '资源地址缺失或无效，无法确认 HTTP 缓存。'); }
  if (!['http:', 'https:'].includes(protocol)) return result('unknown', 'unavailable', '不是 HTTP(S) 请求，不计入 HTTP 缓存命中率。');

  if (network?.fromServiceWorker) return result('service-worker', 'cdp', 'CDP 标记响应由 Service Worker 提供；不能据此判断 HTTP 缓存或其内部网络请求。');
  if (wireStatus === 304) {
    const timingStatus = statusCode(entry?.responseStatus);
    const mergedSuccess = responseStatus >= 200 && responseStatus < 300 || timingStatus >= 200 && timingStatus < 300;
    if (!mergedSuccess && !(encodedBodyBytes > 0 || decodedBodyBytes > 0)) {
      return result('unknown', 'cdp', 'CDP 记录条件响应 304，但没有合并成功响应或已有响应体的证据，不能确认缓存体复用。');
    }
    return result('revalidated', 'cdp', 'CDP 记录本次网络响应为 304，并有浏览器合并响应或已有响应体证据，确认重新验证后复用。');
  }
  if (network?.fromDiskCache || network?.requestServedFromCache || network?.fromPrefetchCache) {
    const source = network.fromPrefetchCache ? '预取缓存' : network.fromDiskCache ? '磁盘缓存' : '浏览器缓存';
    return result('local', 'cdp', `CDP 标记使用${source}；未观测到本次 304。此标签不单独证明 Cache-Control 的强缓存策略。`);
  }
  if (wireStatus !== null) return result('network', 'cdp', `CDP 记录本次网络响应 ${wireStatus}，不是 304 复用；不代表请求到达源站。`);
  if ((size(entry?.workerStart) ?? 0) > 0) return result('service-worker', 'resource-timing', 'Resource Timing 记录 Service Worker 参与；HTTP 缓存及其内部请求不可确定。');
  // Cross-origin timing restrictions and empty/failed requests can also expose
  // zero bytes. A positive body size is required before calling zero a hit.
  if (transferBytes === 0 && (encodedBodyBytes > 0 || decodedBodyBytes > 0)) {
    return result('local', 'resource-timing', 'Resource Timing：transferSize = 0 且响应体大小 > 0，推断为本地复用；内存、磁盘及具体缓存策略不能由此区分。');
  }
  if (transferBytes === 300 && encodedBodyBytes > 0) {
    return result('revalidated', 'resource-timing', 'Resource Timing：transferSize = 300 且 encodedBodySize > 0，按规范推断为重新验证；真实 304 状态需外部 CDP 证据。');
  }
  if (transferBytes > 300 && encodedBodyBytes !== null && transferBytes === encodedBodyBytes + 300) {
    return result('network', 'resource-timing', 'Resource Timing 记录响应体加固定响应头估算的传输体积，推断为网络传输；可能由 CDN 提供，不代表源站请求。');
  }
  if (entry?.deliveryType === 'cache') return result('unknown', 'resource-timing', '浏览器标记 deliveryType=cache，但字节证据不足以区分本地复用与重新验证。');
  return result('unknown', 'unavailable', '缺少明确的缓存或传输证据；零值、跨域时序受限及缺失记录不能当作缓存命中。');
}

export function summarizeResourceCache(entries, options = {}) {
  const counts = Object.fromEntries(Object.keys(CACHE_LABELS).map(key => [key, 0]));
  let transferBytes = 0, transferKnownCount = 0, encodedBodyBytes = 0, encodedKnownCount = 0;
  for (const entry of entries) {
    const cache = entry.cache ?? classifyResourceCache(entry, options);
    counts[Object.hasOwn(counts, cache.status) ? cache.status : 'unknown']++;
    if (size(cache.transferBytes) !== null) { transferKnownCount++; transferBytes += cache.transferBytes; }
    if (size(cache.encodedBodyBytes) !== null) { encodedKnownCount++; encodedBodyBytes += cache.encodedBodyBytes; }
  }
  const total = entries.length;
  const classified = total - counts.unknown;
  const httpClassified = counts.local + counts.revalidated + counts.network;
  return {
    version: 1, total, counts, classified, unknown: counts.unknown,
    coveragePercent: total ? 100 * classified / total : null,
    httpClassified,
    localHitRatePercent: httpClassified ? 100 * counts.local / httpClassified : null,
    reuseRatePercent: httpClassified ? 100 * (counts.local + counts.revalidated) / httpClassified : null,
    revalidationRatePercent: httpClassified ? 100 * counts.revalidated / httpClassified : null,
    transferBytes: transferKnownCount ? transferBytes : null, transferKnownCount,
    encodedBodyBytes: encodedKnownCount ? encodedBodyBytes : null, encodedKnownCount,
  };
}
