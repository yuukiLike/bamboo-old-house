/* Observe the requests the browser already makes; never fetch resources again. */
const VERSION = 1;
const MAX_REQUESTS = 5000;
const MAX_CHAIN_EVENTS = 20;
const MATCH_TOLERANCE_MS = 75;
const RESPONSE_HEADERS = new Set([
  'cf-cache-status', 'age', 'cache-control', 'etag', 'last-modified', 'expires',
  'cdn-cache-control', 'cloudflare-cdn-cache-control',
]);
const REQUEST_HEADERS = new Set(['if-none-match', 'if-modified-since', 'cache-control', 'pragma']);

function pickHeaders(headers, allowlist, onTruncated) {
  const result = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const normalized = name.toLowerCase();
    if (allowlist.has(normalized)) {
      const text = String(value);
      if (text.length > 4096) onTruncated();
      result[normalized] = text.slice(0, 4096);
    }
  }
  return result;
}

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch {
    return value;
  }
}

function createNetworkCapture(commands) {
  const buckets = new Map();
  const ignoredRequestIds = new Set();
  const records = [];
  const listeners = [];
  let client;
  let available = false;
  let reason = null;
  let droppedEvents = 0;
  let droppedRequests = 0;
  let truncatedHeaderValues = 0;
  let ignoredNonHttpRequests = 0;
  let disconnected = false;
  const headers = (values, allowlist) => pickHeaders(values, allowlist, () => truncatedHeaderValues++);

  function bucketFor(requestId) {
    let bucket = buckets.get(requestId);
    if (!bucket) {
      if (buckets.size >= MAX_REQUESTS) {
        droppedEvents++;
        return null;
      }
      bucket = { records: [], requestExtra: [], responseExtra: [] };
      buckets.set(requestId, bucket);
    }
    return bucket;
  }

  function addExtra(requestId, key, value) {
    if (ignoredRequestIds.has(requestId)) return;
    const bucket = bucketFor(requestId);
    if (!bucket) return;
    if (bucket[key].length >= MAX_CHAIN_EVENTS) {
      droppedEvents++;
      return;
    }
    // Only whitelisted values reach the buffer, even if ExtraInfo precedes its request.
    bucket[key].push(value);
  }

  function current(requestId) {
    return buckets.get(requestId)?.records.at(-1);
  }

  function dispose() {
    for (const [event, listener] of listeners) client?.removeListener(event, listener);
    listeners.length = 0;
  }

  function listen(event, callback) {
    client.on(event, callback);
    listeners.push([event, callback]);
  }

  try {
    client = commands.cdp?.getRawClient();
    if (!client?.on || !client?.removeListener || !client.Network) throw new Error('Browsertime CDP client unavailable');
    // Browsertime enables Network on this client before invoking the scenario.
    // Reuse that session without changing cache, headers, interception or tracing.
    listen('Network.requestWillBeSent', event => {
      // Embedded GLTF images may use very large data URLs. They cannot provide
      // HTTP cache evidence: reject before normalization or allocation.
      if (!/^https?:\/\//i.test(event.request.url)) {
        ignoredNonHttpRequests++;
        const previous = current(event.requestId);
        if (previous) previous.redirect = true;
        else buckets.delete(event.requestId); // Discard any early ExtraInfo.
        if (ignoredRequestIds.size < MAX_REQUESTS) ignoredRequestIds.add(event.requestId);
        return;
      }
      ignoredRequestIds.delete(event.requestId);
      const bucket = bucketFor(event.requestId);
      if (!bucket) return;
      if (records.length >= MAX_REQUESTS || bucket.records.length >= MAX_CHAIN_EVENTS) {
        droppedRequests++;
        return;
      }
      const previous = bucket.records.at(-1);
      if (event.redirectResponse && previous) previous.redirect = true;
      const record = {
        requestId: event.requestId,
        url: normalizedUrl(event.request.url),
        type: event.type,
        wallTimeMs: Number.isFinite(event.wallTime) ? event.wallTime * 1000 : null,
        requestHeaders: headers(event.request.headers, REQUEST_HEADERS),
        responseStatus: null,
        responseHeaders: {},
        fromDiskCache: null,
        fromServiceWorker: null,
        fromPrefetchCache: null,
        requestServedFromCache: false,
        complete: false,
        failed: false,
        encodedDataLength: null,
        redirect: Boolean(event.redirectResponse),
      };
      bucket.records.push(record);
      records.push(record);
    });
    listen('Network.requestWillBeSentExtraInfo', event => addExtra(event.requestId, 'requestExtra', {
      headers: headers(event.headers, REQUEST_HEADERS),
    }));
    listen('Network.responseReceivedExtraInfo', event => addExtra(event.requestId, 'responseExtra', {
      status: Number.isFinite(event.statusCode) ? event.statusCode : null,
      headers: headers(event.headers, RESPONSE_HEADERS),
    }));
    listen('Network.requestServedFromCache', event => {
      const record = current(event.requestId);
      if (record) record.requestServedFromCache = true;
    });
    listen('Network.responseReceived', event => {
      const record = current(event.requestId);
      if (!record) return;
      const response = event.response;
      record.responseStatus = Number.isFinite(response.status) ? response.status : null;
      record.responseHeaders = headers(response.headers, RESPONSE_HEADERS);
      for (const field of ['fromDiskCache', 'fromServiceWorker', 'fromPrefetchCache']) {
        record[field] = typeof response[field] === 'boolean' ? response[field] : null;
      }
    });
    listen('Network.loadingFinished', event => {
      const record = current(event.requestId);
      if (!record) return;
      record.complete = true;
      record.encodedDataLength = Number.isFinite(event.encodedDataLength) ? event.encodedDataLength : null;
    });
    listen('Network.loadingFailed', event => {
      const record = current(event.requestId);
      if (record) record.failed = true;
    });
    listen('disconnect', () => {
      disconnected = true;
      dispose();
    });
    available = true;
  } catch (error) {
    reason = error.message;
    dispose();
  }

  function attach(snapshot) {
    const counts = { matched: 0, unmatched: 0, ambiguous: 0, redirects: 0, unavailable: 0 };
    let missingWireStatus = 0;
    let incompleteEntries = 0;
    const used = new Set();
    function match(entry, navigation) {
      const base = { ...entry, network: null };
      if (!available || !Number.isFinite(snapshot.timeOrigin)) {
        counts.unavailable++;
        return { ...base, networkMatch: 'capture-unavailable' };
      }
      const url = normalizedUrl(entry.name);
      const candidates = records.filter(record => record.url === url &&
        (!navigation || record.type === 'Document') && record.wallTimeMs !== null &&
        Math.abs(record.wallTimeMs - snapshot.timeOrigin - entry.startTime) <= MATCH_TOLERANCE_MS);
      if (candidates.length !== 1 || used.has(candidates[0])) {
        const ambiguous = candidates.length > 0;
        counts[ambiguous ? 'ambiguous' : 'unmatched']++;
        return { ...base, networkMatch: ambiguous ? 'ambiguous' : 'unmatched' };
      }
      const record = candidates[0];
      const bucket = buckets.get(record.requestId);
      if (record.redirect || bucket.records.length !== 1) {
        counts.redirects++;
        return { ...base, networkMatch: 'redirect-unsupported' };
      }
      used.add(record);
      counts.matched++;
      // A 304 can be merged into responseReceived as 200. Only ExtraInfo supplies
      // wireStatus. Missing/multiple ExtraInfo stays unknown, never inferred 200.
      const responseExtra = bucket.responseExtra.length === 1 ? bucket.responseExtra[0] : null;
      const requestExtra = bucket.requestExtra.length === 1 ? bucket.requestExtra[0] : null;
      if (responseExtra?.status == null) missingWireStatus++;
      if (!record.complete) incompleteEntries++;
      return {
        ...base,
        networkMatch: 'matched',
        network: {
          source: 'cdp', version: VERSION, match: 'url-and-start-time',
          requestId: record.requestId, url: record.url,
          startTime: record.wallTimeMs - snapshot.timeOrigin,
          matchDeltaMs: record.wallTimeMs - snapshot.timeOrigin - entry.startTime,
          responseStatus: record.responseStatus,
          wireStatus: responseExtra?.status ?? null,
          fromDiskCache: record.fromDiskCache,
          fromServiceWorker: record.fromServiceWorker,
          fromPrefetchCache: record.fromPrefetchCache,
          requestServedFromCache: record.requestServedFromCache,
          responseHeaders: record.responseHeaders,
          wireResponseHeaders: responseExtra?.headers ?? {},
          requestHeaders: { ...record.requestHeaders, ...requestExtra?.headers },
          complete: record.complete, failed: record.failed,
          encodedDataLength: record.encodedDataLength,
        },
      };
    }
    snapshot.navigation = (snapshot.navigation || []).map(entry => match(entry, true));
    snapshot.resources = (snapshot.resources || []).map(entry => match(entry, false));
    snapshot.networkCapture = {
      version: VERSION, source: 'cdp', available, reason, disconnected,
      requestsObserved: records.length, requestLimit: MAX_REQUESTS,
      ignoredNonHttpRequests,
      droppedRequests, droppedEvents, truncatedHeaderValues, headerValueLimit: 4096,
      truncated: droppedRequests > 0 || droppedEvents > 0 || truncatedHeaderValues > 0,
      entries: counts, missing: counts.unmatched + counts.ambiguous + counts.redirects + counts.unavailable,
      missingWireStatus, incompleteEntries,
      matchToleranceMs: MATCH_TOLERANCE_MS,
      clock: 'requestWillBeSent.wallTime * 1000 - performance.timeOrigin',
      limitation: 'CDP observes existing requests only. Reused request IDs (redirect chains) and ambiguous URL/time matches are left unknown. wireStatus and wireResponseHeaders require unique responseReceivedExtraInfo. Cached response headers do not prove a current CDN request. Browser cache policy is unchanged.',
    };
    return snapshot;
  }

  return { attach, dispose };
}

module.exports = { createNetworkCapture, VERSION };
