export type CacheStatus = 'local' | 'revalidated' | 'network' | 'service-worker' | 'unknown';
export interface ResourceCache {
  version: 1;
  status: CacheStatus;
  label: string;
  source: 'cdp' | 'resource-timing' | 'unavailable';
  evidence: string;
  transferBytes: number | null;
  encodedBodyBytes: number | null;
  decodedBodyBytes: number | null;
  wireStatus: number | null;
  responseStatus: number | null;
  cacheControl: string | null;
  etag: string | null;
  lastModified: string | null;
}
export interface ResourceCacheSummary {
  version: 1;
  total: number;
  counts: Record<CacheStatus, number>;
  classified: number;
  unknown: number;
  coveragePercent: number | null;
  httpClassified: number;
  localHitRatePercent: number | null;
  reuseRatePercent: number | null;
  revalidationRatePercent: number | null;
  transferBytes: number | null;
  transferKnownCount: number;
  encodedBodyBytes: number | null;
  encodedKnownCount: number;
}
export const CACHE_LABELS: Record<CacheStatus, string>;
export const CACHE_COLORS: Record<CacheStatus, string>;
export function classifyResourceCache(entry: object, options?: { pageUrl?: string }): ResourceCache;
export function summarizeResourceCache(entries: ReadonlyArray<object & { cache?: ResourceCache }>, options?: { pageUrl?: string }): ResourceCacheSummary;
