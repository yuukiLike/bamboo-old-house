// Injected by Browsertime at document_start. RAF intervals measure scheduling,
// not GPU execution or presentation. No renderer, fetch, or app state is patched.
(() => {
  if (window.top !== window || window.__PERF_CAPTURE__) return;
  const startedAtMs = performance.now();
  const OUTPUT_FRAME_LIMIT = 2000;

  function buffer(capacity) {
    const items = Array.from({ length: capacity });
    let cursor = 0, size = 0, dropped = 0;
    return {
      add(value) {
        items[cursor] = value;
        cursor = (cursor + 1) % capacity;
        if (size < capacity) size++;
        else dropped++;
      },
      values() {
        return Array.from({ length: size }, (_, i) => items[(cursor - size + i + capacity) % capacity]);
      },
      state() {
        return { capacity, dropped, oldestStartMs: size ? items[(cursor - size + capacity) % capacity].startTime : null };
      },
    };
  }

  const frames = buffer(12000);
  const longTasks = buffer(2000);
  const longAnimationFrames = buffer(2000);
  const measures = buffer(4000);
  const visibility = buffer(1000);
  visibility.add({ startTime: startedAtMs, state: document.visibilityState });
  let previousFrame = null;
  let interruptedFrames = 0;
  document.addEventListener('visibilitychange', () => {
    visibility.add({ startTime: performance.now(), state: document.visibilityState });
    // A frame straddling a hidden interval is invalid, even if RAF was suspended.
    previousFrame = null;
    interruptedFrames++;
  });
  function frame(now) {
    if (previousFrame !== null) {
      frames.add({ startTime: previousFrame, duration: now - previousFrame, visible: !document.hidden });
    }
    previousFrame = document.hidden ? null : now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const supportedTypes = globalThis.PerformanceObserver?.supportedEntryTypes || [];
  const supported = {};
  const observers = [];
  for (const [type, destination] of [
    ['longtask', longTasks], ['long-animation-frame', longAnimationFrames], ['measure', measures],
  ]) {
    supported[type] = supportedTypes.includes(type);
    if (!supported[type]) continue;
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) destination.add(entry.toJSON());
      });
      observer.observe({ type, buffered: true });
      observers.push({ observer, destination });
    } catch {
      supported[type] = false;
    }
  }

  function summarize(values) {
    const sorted = values.map(value => value.duration).sort((a, b) => a - b);
    if (!sorted.length) return { count: 0 };
    const percentile = n => sorted[Math.ceil(sorted.length * n) - 1];
    const totalDurationMs = sorted.reduce((sum, duration) => sum + duration, 0);
    return {
      count: sorted.length, medianMs: percentile(0.5), p95Ms: percentile(0.95),
      totalDurationMs, meanMs: totalDurationMs / sorted.length,
      p99Ms: percentile(0.99), maxMs: sorted.at(-1),
      over33msPercent: 100 * sorted.filter(value => value > 33.33).length / sorted.length,
    };
  }

  window.__PERF_CAPTURE__ = Object.freeze({
    snapshot(startMs = 0, endMs = performance.now()) {
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs < startMs) {
        throw new Error('Performance snapshot requires 0 <= startMs <= endMs');
      }
      for (const { observer, destination } of observers) {
        for (const entry of observer.takeRecords()) destination.add(entry.toJSON());
      }
      const history = visibility.values();
      const before = history.filter(event => event.startTime <= startMs).at(-1);
      const changes = history.filter(event => event.startTime > startMs && event.startTime < endMs);
      let state = before?.state ?? (startMs < startedAtMs ? history[0]?.state : 'unknown');
      let cursor = startMs;
      let hiddenDurationMs = 0;
      for (const event of [...changes, { startTime: endMs }]) {
        if (state !== 'visible') hiddenDurationMs += event.startTime - cursor;
        cursor = event.startTime;
        state = event.state;
      }
      const retainedFrames = frames.values();
      const selectedFrames = retainedFrames.filter(entry => entry.startTime >= startMs && entry.startTime + entry.duration <= endMs);
      const foregroundFrames = selectedFrames.filter(entry => entry.visible).map(({ startTime, duration }) => ({ startTime, duration }));
      // A click may land inside a RAF interval. Preserve any slow interval that
      // overlaps the window, while summary statistics only use full intervals.
      const slowFrames = retainedFrames.filter(entry => entry.visible && entry.duration >= 50 &&
        entry.startTime + entry.duration > startMs && entry.startTime < endMs)
        .map(({ startTime, duration }) => ({
          startTime, duration, crossesStart: startTime < startMs,
          overlapStartMs: Math.max(startTime, startMs),
          overlapDurationMs: Math.min(startTime + duration, endMs) - Math.max(startTime, startMs),
        }));
      // Keep measures that finish in the window, including an initialization
      // phase that started before the external collector began polling.
      const inWindow = entry => entry.startTime + entry.duration >= startMs && entry.startTime + entry.duration <= endMs;
      const retention = Object.fromEntries(Object.entries({ frames, longTasks, longAnimationFrames, measures, visibility })
        .map(([key, value]) => [key, value.state()]));
      const overwritten = Object.values(retention).some(value => value.dropped > 0 && startMs < value.oldestStartMs);
      return {
        startMs, endMs, startedAtMs, capturedAtMs: performance.now(), supported: { ...supported },
        frames: foregroundFrames.slice(0, OUTPUT_FRAME_LIMIT),
        frameSummary: summarize(foregroundFrames),
        frameSamplesTruncated: foregroundFrames.length > OUTPUT_FRAME_LIMIT,
        slowFrames: slowFrames.slice(0, OUTPUT_FRAME_LIMIT),
        slowFrameThresholdMs: 50, slowFrameTotalCount: slowFrames.length,
        slowFramesTruncated: slowFrames.length > OUTPUT_FRAME_LIMIT,
        longTasks: longTasks.values().filter(inWindow),
        longAnimationFrames: longAnimationFrames.values().filter(inWindow),
        measures: measures.values().filter(inWindow),
        visibility: [{ startTime: startMs, state: before?.state ?? history[0]?.state ?? 'unknown' }, ...changes],
        hiddenDurationMs, excludedFrames: selectedFrames.length - foregroundFrames.length,
        interruptedFrames, retention, truncated: overwritten || foregroundFrames.length > OUTPUT_FRAME_LIMIT,
        timingKind: 'Foreground RAF intervals; not GPU or presentation timing',
        boundaryNote: 'Only completed RAF intervals are observable. The last interval still in progress at snapshot is absent. Slow intervals may cross the operation start; overlap is not causal attribution.',
      };
    },
  });
})();
