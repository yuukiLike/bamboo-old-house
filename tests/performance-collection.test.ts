import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhaseRecorder } from '../tools/scene-perf/core/timings.ts';
import { createRuntimeCollector } from '../tools/scene-perf/core/runtime.ts';

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
