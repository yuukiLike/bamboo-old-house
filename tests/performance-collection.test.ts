import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createPhaseRecorder } from '../tools/scene-perf/core/timings.ts';
import { createRuntimeCollector, type RendererSnapshot } from '../tools/scene-perf/core/runtime.ts';

function runtimeClock(context: TestContext) {
 let now = 0, nextFrame = 0;
 const frames = new Map<number, FrameRequestCallback>();
 const events = new Map<string, Set<EventListener>>();
 const document = {
  hidden: false,
  addEventListener(type: string, callback: EventListener) { const listeners = events.get(type) ?? new Set(); listeners.add(callback); events.set(type, listeners); },
  removeEventListener(type: string, callback: EventListener) { events.get(type)?.delete(callback); },
 };
 const original = Object.getOwnPropertyDescriptors(globalThis);
 Object.assign(globalThis, {
  document,
  requestAnimationFrame(callback: FrameRequestCallback) { const id = ++nextFrame; frames.set(id, callback); return id; },
  cancelAnimationFrame(id: number) { frames.delete(id); },
  PerformanceObserver: undefined,
 });
 context.mock.method(performance, 'now', () => now);
 context.after(() => {
  for (const key of ['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'PerformanceObserver']) {
   if (original[key]) Object.defineProperty(globalThis, key, original[key]);
   else Reflect.deleteProperty(globalThis, key);
  }
 });
 return {
  advance(ms: number) {
   now += ms;
   const pending = [...frames.values()]; frames.clear();
   for (const callback of pending) callback(now);
  },
  hidden(value: boolean) {
   document.hidden = value;
   for (const callback of events.get('visibilitychange') ?? []) callback(new Event('visibilitychange'));
  },
  pendingFrames: () => frames.size,
 };
}

function rendererSnapshot(): RendererSnapshot {
 return { drawCalls: 200, triangles: 8000000, textures: 100, geometries: 250, pixelRatio: 2, drawSize: [804, 1516], quality: 'full', gpu: 'test' };
}

await test('stopping business collection freezes history, releases owned measures and rejects late completions', () => {
 const recorder = createPhaseRecorder({ namespace: 'stop-test', enabled: true });
 performance.measure('another-recorder', { start: 0, end: 1 });
 try {
  for (let index = 0; index < 700; index++) recorder.beginPhase('view')();
  const pending = recorder.beginPhase('audio.decode');
  assert.equal(recorder.read()?.phases.length, 500);
  assert.equal(recorder.read()?.droppedPhases, 200);
  recorder.stop();
  const frozen = JSON.stringify(recorder.read());
  pending();
  recorder.beginPhase('later-view')();
  assert.equal(recorder.enabled(), false);
  assert.equal(recorder.read()?.enabled, false);
  assert.equal(recorder.read()?.activePhases?.length, 0);
  assert.equal(JSON.stringify(recorder.read()), frozen);
  assert.equal(performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('stop-test:')).length, 0);
  assert.equal(performance.getEntriesByName('another-recorder').length, 1);
  assert.equal(recorder.measurePhase('still-runs', () => 42), 42);
  const failure = new Error('original failure');
  assert.throws(() => recorder.measurePhase('still-throws', () => { throw failure; }), error => error === failure);
 } finally { recorder.dispose(); performance.clearMeasures('another-recorder'); }
});

await test('runtime collection remains bounded over sustained stutters and disposes every active hook', context => {
 let now = 0, nextFrame = 0, reads = 0;
 const frames = new Map<number, FrameRequestCallback>();
 const events = new Map<string, Set<EventListener>>();
 let disconnected = false;
 class Observer {
  static supportedEntryTypes = ['longtask'];
  observe() { disconnected = false; }
  disconnect() { disconnected = true; }
  takeRecords() { return []; }
 }
 const original = Object.getOwnPropertyDescriptors(globalThis);
 Object.assign(globalThis, {
  document: { hidden: false,
   addEventListener(type: string, callback: EventListener) { const listeners = events.get(type) ?? new Set(); listeners.add(callback); events.set(type, listeners); },
   removeEventListener(type: string, callback: EventListener) { events.get(type)?.delete(callback); },
  },
  requestAnimationFrame(callback: FrameRequestCallback) { const id = ++nextFrame; frames.set(id, callback); return id; },
  cancelAnimationFrame(id: number) { frames.delete(id); },
  PerformanceObserver: Observer,
 });
 context.mock.method(performance, 'now', () => now);
 const collector = createRuntimeCollector({ readState: () => { reads++; return { view: 'breeze', sound: true }; } });
 try {
  // Thirty minutes at the reported 12.5 Hz. Virtual RAF preserves actual
  // collector boundaries without depending on the machine's render speed.
  for (let index = 0; index < 22500; index++) {
   now += 80;
   const pending = [...frames.values()]; frames.clear();
   for (const callback of pending) callback(now);
  }
  const latest = collector.snapshot();
  assert.equal(latest.window.rafHz, 12.5);
  assert.ok(latest.history.length <= 377);
  assert.equal(latest.stutters.length, 120);
  collector.dispose();
  const stopped = collector.snapshot(), stoppedReads = reads;
  now += 30000;
  assert.equal(collector.snapshot().chartEnd, stopped.chartEnd);
  assert.equal(collector.snapshot().status, 'stopped');
  assert.equal(reads, stoppedReads);
  assert.equal(frames.size, 0);
  assert.equal(disconnected, true);
  assert.ok([...events.values()].every(listeners => listeners.size === 0));
 } finally {
  collector.dispose();
  for (const key of ['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'PerformanceObserver']) {
   if (original[key]) Object.defineProperty(globalThis, key, original[key]);
   else Reflect.deleteProperty(globalThis, key);
  }
 }
});

await test('a fresh collection discards old history and cannot be contaminated by pending work from earlier runs', () => {
 const recorder = createPhaseRecorder({ namespace: 'restart-test', enabled: true, readyPhase: 'ready' });
 try {
  recorder.beginPhase('ready')();
  const oldRequest = recorder.beginPhase('slow-download');
  recorder.stop();
  const oldSnapshot = JSON.stringify(recorder.read());
  recorder.restart();
  assert.equal(recorder.enabled(), true);
  assert.deepEqual(recorder.read()?.phases, []);
  assert.equal(recorder.read()?.startupReadyAt, undefined);
  oldRequest();
  assert.deepEqual(recorder.read()?.phases, []);
  const freshRequest = recorder.beginPhase('new-view');
  freshRequest();
  assert.deepEqual(recorder.read()?.phases.map(phase => phase.detail.phase), ['new-view']);
  assert.notEqual(JSON.stringify(recorder.read()), oldSnapshot);
  const nextOldRequest = recorder.beginPhase('pending-again');
  recorder.stop();recorder.restart();nextOldRequest();
  assert.deepEqual(recorder.read()?.phases, []);
  assert.equal(performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('restart-test:')).length, 0);
  recorder.dispose();recorder.restart();
  assert.equal(recorder.enabled(), false);
 } finally { recorder.dispose(); }
});

await test('workload history retains the beginning and recent observations with bounded, independent snapshots', context => {
 const clock = runtimeClock(context);
 let rendererReads = 0;
 const state = { view: 'initial' };
 const renderer = { ...rendererSnapshot(), programs: 0, cpuUpdateMs: 1.2, cpuRenderSubmitMs: 3.4 };
 const collector = createRuntimeCollector({
  readState: () => state,
  readRenderer: () => { rendererReads++; return renderer; },
 });
 try {
  clock.advance(0);
  for (let second = 1; second <= 210; second++) {
   state.view = `view-${second}`; renderer.programs = second;
   for (let frame = 0; frame < 50; frame++) clock.advance(20);
  }
  // The existing RAF samples drive at most one renderer read per second;
  // taking a UI/export snapshot is a separate, existing reader operation.
  assert.equal(rendererReads, 211);
  const data = collector.snapshot();
  assert.deepEqual({ ...data.workload, samples: undefined }, { sampleIntervalMs: 1000, initialLimit: 60, recentLimit: 120, dropped: 30, samples: undefined });
  assert.equal(data.workload.samples.length, 180);
  assert.equal(new Set(data.workload.samples.map(entry => entry.timestamp)).size, 180);
  const first = data.workload.samples[0], initialEnd = data.workload.samples[59], recentStart = data.workload.samples[60], latest = data.workload.samples.at(-1)!;
  assert.deepEqual([first.timestamp, initialEnd.timestamp, recentStart.timestamp, latest.timestamp], [1000, 60000, 91000, 210000]);
  assert.deepEqual([first.count, first.observedMs, first.rafHz], [50, 1000, 50]);
  assert.equal(first.state.view, 'view-1');
  assert.equal(first.renderer?.programs, 1);
  assert.equal(first.renderer?.cpuUpdateMs, 1.2);
  assert.equal(first.renderer?.cpuRenderSubmitMs, 3.4);
  state.view = 'changed'; renderer.drawSize[0] = 1; renderer.programs = 999;
  assert.equal(latest.state.view, 'view-210');
  assert.equal(latest.renderer?.drawSize[0], 804);
  first.state.view = 'caller mutation'; first.renderer!.drawSize[0] = 2; first.renderer!.programs = -1;
  const retained = collector.snapshot().workload.samples[0];
  assert.equal(retained.state.view, 'view-1');
  assert.equal(retained.renderer?.drawSize[0], 804);
  assert.equal(retained.renderer?.programs, 1);
 } finally { collector.dispose(); }
});

await test('workload sampling never combines paused or hidden intervals and stops and resets with the collector', context => {
 const clock = runtimeClock(context);
 let reads = 0;
 const adapter = { readRenderer: () => { reads++; return rendererSnapshot(); } };
 const collector = createRuntimeCollector(adapter);
 try {
  clock.advance(0); clock.advance(600);
  collector.pause();
  const pausedReads = reads;
  clock.advance(5000);
  assert.equal(collector.snapshot().workload.samples.length, 0);
  assert.equal(reads, pausedReads);
  collector.resume();
  clock.advance(10); clock.advance(600);
  clock.hidden(true);
  const hiddenReads = reads;
  clock.advance(5000);
  assert.equal(collector.snapshot().workload.samples.length, 0);
  assert.equal(reads, hiddenReads);
  clock.hidden(false);
  clock.advance(10); clock.advance(500); clock.advance(500);
  const sample = collector.snapshot().workload.samples[0];
  assert.deepEqual([sample.startTime, sample.timestamp, sample.count, sample.observedMs, sample.rafHz], [11220, 12220, 2, 1000, 2]);
  collector.clear();
  assert.deepEqual(collector.snapshot().workload.samples, []);
  assert.equal(collector.snapshot().workload.dropped, 0);
  clock.advance(20); clock.advance(1000);
  assert.equal(collector.snapshot().workload.samples[0].startTime, 12240);
  collector.dispose();
  const stoppedReads = reads, frozen = collector.snapshot().workload;
  clock.advance(10000);
  assert.deepEqual(collector.snapshot().workload, frozen);
  assert.equal(reads, stoppedReads);
  assert.equal(clock.pendingFrames(), 0);
  const restarted = createRuntimeCollector(adapter);
  try {
   assert.deepEqual(restarted.snapshot().workload.samples, []);
   clock.advance(0); clock.advance(1000);
   assert.equal(restarted.snapshot().workload.samples.length, 1);
  } finally { restarted.dispose(); }
 } finally { collector.dispose(); }
});

await test('optional renderer observations accept older adapters and reject invalid measurements without corrupting history', context => {
 const clock = runtimeClock(context);
 let renderer: RendererSnapshot = rendererSnapshot();
 const collector = createRuntimeCollector({ readRenderer: () => renderer });
 try {
  clock.advance(0); clock.advance(1000);
  assert.deepEqual(collector.snapshot().workload.samples[0].renderer, renderer);
  for (const [field, value] of [
   ['programs', NaN], ['cpuUpdateMs', Infinity], ['cpuRenderSubmitMs', '4'], ['cpuRenderSubmitMs', -1],
  ] as const) {
   renderer = { ...rendererSnapshot(), [field]: value } as RendererSnapshot;
   clock.advance(1000);
   const data = collector.snapshot();
   assert.equal(data.workload.samples.at(-1)?.renderer, null);
   assert.ok(data.adapterErrors.includes('readRenderer'));
  }
  renderer = { ...rendererSnapshot(), programs: null, cpuUpdateMs: null, cpuRenderSubmitMs: null };
  clock.advance(1000);
  const recovered = collector.snapshot();
  assert.equal(recovered.workload.samples.at(-1)?.renderer?.cpuUpdateMs, null);
  assert.deepEqual(recovered.adapterErrors, []);
  assert.deepEqual(recovered.workload.samples[0].renderer, rendererSnapshot());
 } finally { collector.dispose(); }
});
