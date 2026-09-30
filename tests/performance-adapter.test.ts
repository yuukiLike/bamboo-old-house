import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { bambooPerformanceAdapter as adapter } from '../src/performance/bamboo-adapter.ts';

const readRenderer = adapter.readRenderer?.bind(adapter);
const readState = adapter.readState?.bind(adapter);
assert.ok(readRenderer);
assert.ok(readState);

function scene(context: TestContext, diagnostics: Record<string, unknown> | undefined, attributes: Record<string, string> = {}) {
 const original = Object.getOwnPropertyDescriptors(globalThis);
 const root = {
  classList: Object.assign(['is-walk'], { contains: (name: string) => name === 'is-walk' }),
  getAttribute: (name: string) => attributes[name] ?? null,
  hasAttribute: (name: string) => name in attributes,
 };
 Object.defineProperty(globalThis, 'window', { configurable: true, value: { __BAMBOO__: diagnostics } });
 Object.defineProperty(globalThis, 'document', { configurable: true, value: {
  querySelector: (selector: string) => selector === '.experience' ? root : null,
 } });
 context.after(() => {
  for (const name of ['window', 'document']) {
   if (original[name]) Object.defineProperty(globalThis, name, original[name]);
   else Reflect.deleteProperty(globalThis, name);
  }
 });
}

const originalDiagnostics = {
 quality: 'desktop', gpu: 'test', drawSize: [800, 600], pixelRatio: 1,
 drawCalls: 100, triangles: 1000, textures: 10, geometries: 20,
 viewMode: 'walk', place: 'courtyard', paused: false,
};

await test('the common panel reads legacy diagnostics without inventing unavailable CPU measurements', context => {
 scene(context, originalDiagnostics);
 const renderer = readRenderer();
 assert.ok(renderer);
 assert.equal(renderer.quality, 'desktop/full/full/display');
 assert.equal(renderer.drawCalls, 100);
 assert.equal(renderer.programs, null);
 assert.equal(renderer.cpuUpdateMs, null);
 assert.equal(renderer.cpuRenderSubmitMs, null);
 assert.notEqual(renderer.drawSize, originalDiagnostics.drawSize);
 const state = readState();
 assert.deepEqual([state.resolution, state.shadows, state.frameRate, state.houseDetail], ['full', 'full', 'display', 'full']);
});

await test('modern diagnostics preserve measured values and requested DOM settings', context => {
 scene(context, { ...originalDiagnostics,
  renderSettings: { resolution: 'reduced', shadows: 'alternate', frameRate: '30', houseDetail: 'lean', freeMode: false },
  programs: 12, cpuUpdateMs: 2.5, cpuRenderSubmitMs: 4,
 }, { 'data-resolution': 'full', 'data-frame-rate': '60' });
 const renderer = readRenderer();
 assert.ok(renderer);
 assert.equal(renderer.quality, 'desktop/reduced/alternate/30');
 assert.deepEqual([renderer.programs, renderer.cpuUpdateMs, renderer.cpuRenderSubmitMs], [12, 2.5, 4]);
 const state = readState();
 assert.deepEqual([state.resolution, state.shadows, state.frameRate, state.houseDetail, state.freeMode], ['full', 'alternate', '60', 'lean', false]);
});

await test('missing scenes and invalid diagnostics remain explicitly unavailable', context => {
 scene(context, undefined);
 assert.equal(readRenderer(), null);
 assert.equal(readState().resolution, null);
 window.__BAMBOO__ = { ...originalDiagnostics, programs: NaN, cpuUpdateMs: Infinity } as unknown as NonNullable<Window['__BAMBOO__']>;
 const renderer = readRenderer();
 assert.ok(renderer);
 assert.equal(renderer.programs, null);
 assert.equal(renderer.cpuUpdateMs, null);
});
