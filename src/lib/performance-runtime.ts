/** Local, opt-in runtime observation. RAF gaps measure callback scheduling,
 * never display FPS or GPU execution. No scene function is replaced. */
export interface RuntimeState {
 view: string | null;
 place: string | null;
 timeOfDay: string | null;
 weatherPreset: string | null;
 soundEnabled: boolean | null;
 paused: boolean | null;
 panorama: boolean | null;
}

interface Interval { startTime: number; duration: number; }
interface Action { startTime: number; label: string; }
export interface RuntimeStutter extends Interval {
 id: number;
 state: RuntimeState;
 stateBefore: RuntimeState | null;
 actions: Action[];
 /** Most recent control action within two seconds before the gap; not causation. */
 recentAction: Action | null;
 phases: string[];
}
interface RendererSnapshot {
 drawCalls: number | null;
 triangles: number | null;
 textures: number | null;
 geometries: number | null;
 pixelRatio: number | null;
 drawSize: number[];
 quality: string | null;
 gpu: string | null;
}
export interface RuntimeSnapshot {
 version: 1;
 now: number;
 chartEnd: number;
 startedAt: number;
 lastResetAt: number;
 /** Start of the uninterrupted foreground segment; used for display warmup. */
 segmentStartedAt: number;
 status: 'collecting' | 'paused' | 'hidden' | 'stopped';
 windowMs: number;
 historyMs: number;
 window: { count: number; rafHz: number | null; p95Ms: number | null; maxMs: number | null; observedMs: number; slowCount: number; };
 history: Interval[];
 stutters: RuntimeStutter[];
 state: RuntimeState;
 renderer: RendererSnapshot | null;
 longTasks: { supported: boolean; recentCount: number | null; recentMaxMs: number | null; events: Interval[]; };
 dropped: { frames: number; stutters: number; longTasks: number; };
 interruptions: number;
}
export interface RuntimeCollector {
 snapshot(): RuntimeSnapshot;
 pause(): void;
 resume(): void;
 clear(): void;
 dispose(): void;
}
declare global { interface Window { __BAMBOO_RUNTIME__?: RuntimeCollector; } }

const WINDOW_MS = 5000;
const HISTORY_MS = 30000;
const FRAME_LIMIT = 12000;
const EVENT_LIMIT = 120;
const STUTTER_MS = 50;
const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

function readState(): RuntimeState {
 const scene = window.__BAMBOO__;
 const root = document.querySelector('.experience');
 const classes = root?.classList;
 const view = classes ? [...classes].find(name => name.startsWith('is-') && !['is-static', 'is-listening', 'is-panorama'].includes(name))?.slice(3) : undefined;
 const sound = document.querySelector('.sound-toggle');
 const pause = document.querySelector('.control-button[aria-label="静止观看"], .control-button[aria-label="让风继续"], .control-button[aria-label="已减少动态"]');
 return {
  // DOM state reflects the user's requested view sooner than the renderer's
  // diagnostic snapshot, which refreshes only every 15 application frames.
  view: view ?? scene?.viewMode ?? null,
  place: scene?.place ?? null,
  timeOfDay: root?.getAttribute('data-time') ?? scene?.timeOfDay ?? null,
  weatherPreset: document.querySelector('.weather-toggle span')?.textContent?.trim() || null,
  soundEnabled: sound?.hasAttribute('aria-pressed') ? sound.getAttribute('aria-pressed') === 'true' : null,
  paused: pause?.hasAttribute('aria-pressed') ? pause.getAttribute('aria-pressed') === 'true' : scene?.paused ?? null,
  panorama: root ? classes?.contains('is-panorama') ?? null : scene?.panorama ?? null,
 };
}

function readRenderer(): RendererSnapshot | null {
 const scene = window.__BAMBOO__;
 if (!scene) return null;
 return {
  drawCalls: numberOrNull(scene.drawCalls), triangles: numberOrNull(scene.triangles),
  textures: numberOrNull(scene.textures), geometries: numberOrNull(scene.geometries),
  pixelRatio: numberOrNull(scene.pixelRatio), drawSize: [...scene.drawSize],
  quality: scene.quality || null, gpu: scene.gpu || null,
 };
}

function overlappingPhases(start: number, end: number): string[] {
 const data = window.__BAMBOO_PERF__;
 if (!data) return [];
 const complete = data.phases.filter(phase => phase.startTime < end && phase.startTime + phase.duration > start)
  .map(phase => `${phase.detail.phase} (${phase.detail.status})`);
 const active = (data.activePhases ?? []).filter(phase => phase.startTime < end)
  .map(phase => `${phase.detail.phase} (running)`);
 return [...new Set([...complete, ...active])].slice(0, 12);
}

export function createRuntimeCollector(): RuntimeCollector {
 const startedAt = performance.now();
 let lastResetAt = startedAt;
 let segmentStart = startedAt;
 let frozenAt = startedAt;
 let paused = false;
 let hidden = document.hidden;
 let disposed = false;
 let previousFrame: number | null = null;
 let previousState: RuntimeState | null = null;
 let cachedState = readState();
 let cachedRenderer = readRenderer();
 let stateReadAt = startedAt;
 let frameHandle = 0;
 let interruptions = 0;
 let eventId = 0;
 const frames: Interval[] = [];
 const stutters: RuntimeStutter[] = [];
 const tasks: Interval[] = [];
 const actions: Action[] = [];
 const dropped = { frames: 0, stutters: 0, longTasks: 0 };
 let observer: PerformanceObserver | undefined;
 let longTaskSupported = false;

 function collecting() { return !disposed && !paused && !hidden; }
 function recordTasks(entries: PerformanceEntry[]) {
  if (!collecting()) return;
  for (const entry of entries) {
   // Reject tasks crossing any paused/hidden boundary. They cannot be assigned
   // wholly to an observed foreground segment.
   if (entry.startTime < segmentStart) continue;
   tasks.push({ startTime: entry.startTime, duration: entry.duration });
   if (tasks.length > EVENT_LIMIT) { tasks.shift(); dropped.longTasks++; }
  }
 }
 try {
  if (globalThis.PerformanceObserver?.supportedEntryTypes.includes('longtask')) {
   observer = new PerformanceObserver(list => recordTasks(list.getEntries()));
   observer.observe({ type: 'longtask', buffered: false });
   longTaskSupported = true;
  }
 } catch { observer?.disconnect(); observer = undefined; }

 function frame(now: number) {
  if (!collecting()) { frameHandle = 0; return; }
  if (now - stateReadAt >= 250) { cachedState = readState(); stateReadAt = now; }
  if (previousFrame !== null && now > previousFrame) {
   const interval = { startTime: previousFrame, duration: now - previousFrame };
   frames.push(interval);
   // Retire expired history independently of count-based truncation.
   const oldest = now - HISTORY_MS;
   while (frames.length && frames[0].startTime + frames[0].duration < oldest) frames.shift();
   if (frames.length > FRAME_LIMIT) { frames.shift(); dropped.frames++; }
   if (interval.duration >= STUTTER_MS) {
    const state = readState();
    const recentAction = actions.findLast(action => action.startTime < interval.startTime && interval.startTime - action.startTime <= 2000);
    stutters.push({
     ...interval, id: ++eventId, state, stateBefore: previousState && { ...previousState },
     actions: actions.filter(action => action.startTime >= interval.startTime && action.startTime <= now).map(action => ({ ...action })),
     recentAction: recentAction ? { ...recentAction } : null,
     phases: overlappingPhases(interval.startTime, now),
    });
    if (stutters.length > EVENT_LIMIT) { stutters.shift(); dropped.stutters++; }
    cachedState = state; stateReadAt = now;
   }
  }
  previousFrame = now;
  previousState = cachedState;
  while (actions.length && actions[0].startTime < now - HISTORY_MS) actions.shift();
  frameHandle = requestAnimationFrame(frame);
 }

 function recordAction(event: Event) {
  if (!collecting() || !(event.target instanceof Element) || event.target.closest('.perf-panel')) return;
  if (event instanceof KeyboardEvent && (!['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.repeat)) return;
  if (event.type === 'pointerdown' && event.target instanceof HTMLCanvasElement) {
   actions.push({ startTime: performance.now(), label: '拖动画面 / 环顾' });
   if (actions.length > EVENT_LIMIT) actions.shift();
   return;
  }
  if (event.type === 'pointerdown') return;
  const control = event.target.closest('button, [role="button"], input, select, [role="option"], a');
  if (!control) return;
  const label = control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent?.trim() || control.id || control.tagName.toLowerCase();
  actions.push({ startTime: performance.now(), label: label.slice(0, 100) });
  if (actions.length > EVENT_LIMIT) actions.shift();
  cachedState = readState(); stateReadAt = performance.now();
 }

 function suspend() {
  frozenAt = performance.now();
  cachedState = readState(); cachedRenderer = readRenderer();
  cancelAnimationFrame(frameHandle); frameHandle = 0;
  previousFrame = null; previousState = null;
  interruptions++;
 }
 function restart() {
  segmentStart = performance.now();
  previousFrame = null; previousState = null;
  cachedState = readState(); stateReadAt = segmentStart;
  // Pending records belong to the prior observation segment.
  observer?.takeRecords();
  if (collecting()) frameHandle = requestAnimationFrame(frame);
 }
 function visibilityChanged() {
  const nextHidden = document.hidden;
  if (nextHidden === hidden) return;
  if (collecting()) { recordTasks(observer?.takeRecords() ?? []); suspend(); }
  hidden = nextHidden;
  if (collecting()) restart();
 }
 document.addEventListener('visibilitychange', visibilityChanged);
 document.addEventListener('click', recordAction, true);
 document.addEventListener('keydown', recordAction, true);
 document.addEventListener('input', recordAction, true);
 document.addEventListener('pointerdown', recordAction, true);
 if (collecting()) frameHandle = requestAnimationFrame(frame);

 const collector: RuntimeCollector = {
  snapshot() {
   recordTasks(observer?.takeRecords() ?? []);
   const now = performance.now();
   const chartEnd = collecting() ? now : frozenAt;
   // A long completed gap must remain visible immediately after recovery even
   // when it began before the rolling five-second boundary. Keep its complete
   // duration: clipping it would invent a faster callback rate.
   const selected = frames.filter(entry => entry.startTime >= lastResetAt && entry.startTime + entry.duration > chartEnd - WINDOW_MS && entry.startTime + entry.duration <= chartEnd);
   const sorted = selected.map(entry => entry.duration).sort((a, b) => a - b);
   const observedMs = sorted.reduce((sum, value) => sum + value, 0);
   const recentTasks = tasks.filter(entry => entry.startTime >= lastResetAt && entry.startTime + entry.duration > chartEnd - WINDOW_MS && entry.startTime + entry.duration <= chartEnd);
   if (collecting()) { cachedState = readState(); cachedRenderer = readRenderer(); }
   return {
    version: 1, now, chartEnd, startedAt, lastResetAt, segmentStartedAt: segmentStart,
    status: disposed ? 'stopped' : paused ? 'paused' : hidden ? 'hidden' : 'collecting',
    windowMs: WINDOW_MS, historyMs: HISTORY_MS,
    window: { count: sorted.length, rafHz: observedMs > 0 ? sorted.length * 1000 / observedMs : null,
     p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null,
     maxMs: sorted.at(-1) ?? null, observedMs, slowCount: sorted.filter(value => value >= STUTTER_MS).length },
    history: frames.filter(entry => entry.startTime + entry.duration >= chartEnd - HISTORY_MS && entry.startTime + entry.duration <= chartEnd).map(entry => ({ ...entry })),
    stutters: stutters.map(entry => ({ ...entry, state: { ...entry.state }, stateBefore: entry.stateBefore && { ...entry.stateBefore }, actions: entry.actions.map(action => ({ ...action })), recentAction: entry.recentAction && { ...entry.recentAction }, phases: [...entry.phases] })),
    state: { ...cachedState }, renderer: cachedRenderer && { ...cachedRenderer, drawSize: [...cachedRenderer.drawSize] },
    longTasks: { supported: longTaskSupported, recentCount: longTaskSupported ? recentTasks.length : null,
     recentMaxMs: longTaskSupported && recentTasks.length ? Math.max(...recentTasks.map(entry => entry.duration)) : null,
     events: tasks.map(entry => ({ ...entry })) },
    dropped: { ...dropped }, interruptions,
   };
  },
  pause() {
   if (disposed || paused) return;
   if (collecting()) { recordTasks(observer?.takeRecords() ?? []); suspend(); }
   paused = true;
  },
  resume() {
   if (disposed || !paused) return;
   paused = false;
   if (collecting()) restart();
  },
  clear() {
   if (disposed) return;
   frames.length = 0; stutters.length = 0; tasks.length = 0; actions.length = 0;
   dropped.frames = 0; dropped.stutters = 0; dropped.longTasks = 0;
   interruptions = 0;
   lastResetAt = performance.now(); segmentStart = lastResetAt; frozenAt = lastResetAt;
   previousFrame = null; previousState = null;
   observer?.takeRecords();
  },
  dispose() {
   if (disposed) return;
   if (collecting()) suspend();
   disposed = true;
   observer?.disconnect();
   document.removeEventListener('visibilitychange', visibilityChanged);
   document.removeEventListener('click', recordAction, true);
   document.removeEventListener('keydown', recordAction, true);
   document.removeEventListener('input', recordAction, true);
   document.removeEventListener('pointerdown', recordAction, true);
   if (window.__BAMBOO_RUNTIME__ === collector) delete window.__BAMBOO_RUNTIME__;
  },
 };
 window.__BAMBOO_RUNTIME__ = collector;
 return collector;
}
