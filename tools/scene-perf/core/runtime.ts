import type { Diagnostics } from './timings';

/** Local, opt-in runtime observation. RAF gaps measure callback scheduling,
 * never display FPS or GPU execution. No scene function is replaced. */
export type RuntimeState = Record<string, string | number | boolean | null>;
export interface RuntimeAdapter {
 readState?(): RuntimeState;
 readRenderer?(): RendererSnapshot | null;
 readBusinessPhases?(): Diagnostics | null;
 /** Return null to omit an action; the default recognizes ordinary controls. */
 describeAction?(event: Event): string | null;
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
export interface RendererSnapshot {
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
 /** Failed adapter readers; never interpret absent context as a healthy state. */
 adapterErrors: string[];
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

const WINDOW_MS = 5000;
const HISTORY_MS = 30000;
const FRAME_LIMIT = 12000;
const EVENT_LIMIT = 120;
const STUTTER_MS = 50;
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function plainRecord(value: unknown): value is Record<string, unknown> {
 if (value === null || typeof value !== 'object') return false;
 const prototype = Object.getPrototypeOf(value);
 return prototype === null || prototype === Object.prototype;
}

function cloneState(state: RuntimeState): RuntimeState {
 if (!plainRecord(state)) throw new TypeError('Runtime state must be a plain record.');
 const entries = Object.entries(state);
 for (const [, value] of entries) {
  if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) {
   throw new TypeError('Runtime state values must be finite, serializable primitives.');
  }
 }
 return Object.fromEntries(entries);
}

function cloneRenderer(value: RendererSnapshot | null): RendererSnapshot | null {
 if (value === null) return null;
 if (!plainRecord(value)
  || ![value.drawCalls, value.triangles, value.textures, value.geometries, value.pixelRatio].every(item => item === null || finiteNumber(item))
  || ![value.quality, value.gpu].every(item => item === null || typeof item === 'string')
  || !Array.isArray(value.drawSize) || ![...value.drawSize].every(finiteNumber)) {
  throw new TypeError('Renderer diagnostics must contain finite numbers, strings or explicit nulls.');
 }
 return {
  drawCalls: value.drawCalls, triangles: value.triangles,
  textures: value.textures, geometries: value.geometries,
  pixelRatio: value.pixelRatio, drawSize: [...value.drawSize],
  quality: value.quality, gpu: value.gpu,
 };
}

function validPhase(value: unknown, active: boolean): boolean {
 return plainRecord(value) && finiteNumber(value.startTime) && value.startTime >= 0
  && plainRecord(value.detail) && typeof value.detail.phase === 'string'
  && (active || (finiteNumber(value.duration) && value.duration >= 0
   && typeof value.detail.status === 'string'
   && ['success', 'error', 'cancelled', 'superseded', 'skipped'].includes(value.detail.status)));
}
function validatePhases(data: Diagnostics): void {
 if (!plainRecord(data) || data.version !== 1 || data.enabled !== true
  || !Array.isArray(data.phases) || ![...data.phases].every(phase => validPhase(phase, false))
  || (data.activePhases !== undefined && (!Array.isArray(data.activePhases) || ![...data.activePhases].every(phase => validPhase(phase, true))))) {
  throw new TypeError('Business phases must be synchronous recorder diagnostics.');
 }
}

function defaultAction(event: Event): string | null {
 if (!(event.target instanceof Element)) return null;
 if (event.type === 'pointerdown') return event.target instanceof HTMLCanvasElement ? 'Canvas interaction' : null;
 const control = event.target.closest('button, [role="button"], input, select, [role="option"], a');
 if (!control) return null;
 return control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent?.trim() || control.id || control.tagName.toLowerCase();
}

export function createRuntimeCollector(adapter: RuntimeAdapter = {}): RuntimeCollector {
 const adapterErrors = new Set<string>();
 function readSafely<T>(name: keyof RuntimeAdapter, read: () => T, fallback: T): T {
  try {
   const value = read();
   adapterErrors.delete(name);
   return value;
  } catch {
   adapterErrors.add(name);
   return fallback;
  }
 }
 function readState(): RuntimeState {
  return readSafely('readState', () => cloneState(adapter.readState ? adapter.readState() : {}), {});
 }
 function readRenderer(): RendererSnapshot | null {
  return readSafely('readRenderer', () => cloneRenderer(adapter.readRenderer ? adapter.readRenderer() : null), null);
 }
 function overlappingPhases(start: number, end: number): string[] {
  return readSafely('readBusinessPhases', () => {
   const data = adapter.readBusinessPhases ? adapter.readBusinessPhases() : null;
   if (data === null) return [];
   validatePhases(data);
   const complete = data.phases.filter(phase => phase.startTime < end && phase.startTime + phase.duration > start)
    .map(phase => `${phase.detail.phase} (${phase.detail.status})`);
   const active = (data.activePhases ?? []).filter(phase => phase.startTime < end)
    .map(phase => `${phase.detail.phase} (running)`);
   return [...new Set([...complete, ...active])].slice(0, 12);
  }, []);
 }
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
  if (!collecting() || !(event.target instanceof Element) || event.target.closest('[data-scene-perf]')) return;
  if (event instanceof KeyboardEvent && (!['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.repeat)) return;
  const label = readSafely('describeAction', () => {
   const value = adapter.describeAction ? adapter.describeAction(event) : defaultAction(event);
   if (value !== null && typeof value !== 'string') throw new TypeError('Action descriptions must be strings or null.');
   return value;
  }, null);
  if (!label) return;
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
   if (collecting()) {
    cachedState = readState(); cachedRenderer = readRenderer();
    // Poll the phase reader too, so a transient failure recovers without a new stutter.
    overlappingPhases(chartEnd - WINDOW_MS, chartEnd);
   }
   return {
    version: 1, now, chartEnd, startedAt, lastResetAt, segmentStartedAt: segmentStart,
    status: disposed ? 'stopped' : paused ? 'paused' : hidden ? 'hidden' : 'collecting',
    adapterErrors: [...adapterErrors],
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
  },
 };
 return collector;
}
