import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
const { ViewControls }: typeof import('../src/components/scene/view-controls') =
  await import(new URL('../src/components/scene/view-controls.ts', import.meta.url).href);

class Canvas extends EventTarget {
  style = { touchAction: '', cursor: '' };
  tabIndex = -1;
  clientHeight = 800;
  captured = new Set<number>();
  attributes = new Map<string, string>();
  focus() { document.activeElement = this; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
}
// A minimal event surface exercises the actual handlers without a browser mock
// translating gestures on their behalf. Browser acceptance covers trusted input.
const document = { activeElement: null as Canvas | null };
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
let canvas: Canvas, controls: InstanceType<typeof ViewControls>, exits: number;
function send(target: EventTarget, type: string, values: object = {}) {
  const event = Object.assign(new Event(type, { cancelable: true }), values);
  target.dispatchEvent(event);
  return event;
}
function wheel(values: object = {}) {
  return send(canvas, 'wheel', { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, ...values });
}
function pointer(type: string, id: number, x: number, y: number, pointerType = 'touch') {
  return send(canvas, type, { pointerId: id, clientX: x, clientY: y, pointerType, button: 0 });
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  document.activeElement = null; canvas = new Canvas(); exits = 0;
  controls = new ViewControls(canvas as unknown as HTMLCanvasElement, () => exits++);
});
afterEach(() => {
  controls.dispose();
  for (const [key, descriptor] of [['window', originalWindow], ['document', originalDocument]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

await test('inactive controls leave page scrolling and browser magnification alone', () => {
  assert.equal(wheel({ deltaX: 40, deltaY: 70 }).defaultPrevented, false);
  assert.equal(wheel({ deltaY: -50, ctrlKey: true }).defaultPrevented, false);
  assert.equal(send(canvas, 'gesturestart').defaultPrevented, false);
  assert.deepEqual([controls.yaw, controls.pitch, controls.zoom], [0, 0, 0]);
});

await test('pixel scrolling pans both axes immediately, reverses without a queued inertia tail, and never zooms', () => {
  controls.setActive(true);
  assert.equal(wheel({ deltaX: 40, deltaY: 20 }).defaultPrevented, true);
  assert.deepEqual([controls.yaw, controls.pitch, controls.zoom], [-.12, -.06, 0]);
  wheel({ deltaX: -40, deltaY: -20 }); controls.update(.1);
  assert.deepEqual([controls.yaw, controls.pitch, controls.zoom], [0, 0, 0]);
  wheel({ deltaX: 1.5, deltaY: .5 });
  assert.ok(Math.abs(controls.yaw + .0045) < 1e-12);
  assert.equal(controls.zoom, 0);
});

await test('pinch magnification is distinct from panning, bounded, and normalizes line/page wheels', () => {
  controls.setActive(true);
  wheel({ deltaY: -10, ctrlKey: true }); assert.equal(controls.zoom, -2);
  wheel({ deltaY: -1000, ctrlKey: true }); assert.equal(controls.zoom, -25);
  wheel({ deltaY: 1000, ctrlKey: true }); assert.equal(controls.zoom, 15);
  controls.reset(); wheel({ deltaY: 3, deltaMode: 1 });
  assert.ok(Math.abs(controls.zoom - 1.2) < 1e-12);
  controls.reset(); wheel({ deltaY: .5, deltaMode: 2 }); assert.equal(controls.zoom, 10);
  assert.deepEqual([controls.yaw, controls.pitch], [0, 0]);
});

await test('Safari cumulative scale does not compound or double-apply wheel magnification', () => {
  controls.setActive(true); send(canvas, 'gesturestart');
  send(canvas, 'gesturechange', { scale: 1.2 });
  const first = controls.zoom;
  wheel({ deltaY: -10, ctrlKey: true }); assert.equal(controls.zoom, first);
  send(canvas, 'gesturechange', { scale: 1.4 });
  assert.ok(Math.abs(controls.zoom + Math.log(1.4) * 35) < 1e-12);
  send(canvas, 'gesturechange', { scale: NaN });
  send(canvas, 'gesturechange', { scale: 0 });
  assert.ok(Number.isFinite(controls.zoom));
  send(canvas, 'gestureend'); send(canvas, 'gesturestart');
  send(canvas, 'gesturechange', { scale: 1 / 1.4 });
  assert.ok(Math.abs(controls.zoom) < 1e-12);
});

await test('touch pinch responds on its first move and resumes one-finger drag without a jump', () => {
  controls.setActive(true);
  pointer('pointerdown', 1, 100, 100); pointer('pointerdown', 2, 200, 100);
  pointer('pointermove', 2, 220, 100); assert.equal(controls.zoom, -2.4);
  send(canvas, 'gesturestart'); send(canvas, 'gesturechange', { scale: 1.2 });
  assert.equal(controls.zoom, -2.4);
  pointer('pointermove', 1, 90, 100); assert.equal(controls.zoom, -3.5999999999999996);
  pointer('pointerup', 2, 220, 100); send(canvas, 'gestureend');
  pointer('pointermove', 1, 100, 110);
  assert.deepEqual([controls.yaw, controls.pitch], [.04, .03]);
});

await test('dragged picture follows the pointer, wheel follows native scrolling direction', () => {
  controls.setActive(true);
  pointer('pointerdown', 1, 100, 100, 'mouse'); pointer('pointermove', 1, 140, 120, 'mouse');
  const camera = new T.PerspectiveCamera(60, 1, .1, 100);
  const target = new T.Vector3(0, 0, -10), fixedPoint = target.clone();
  controls.apply(camera.position, target); camera.lookAt(target); camera.updateMatrixWorld();
  const screen = fixedPoint.clone().project(camera);
  assert.ok(screen.x > 0, 'picture must follow rightward drag');
  assert.ok(screen.y < 0, 'picture must follow downward drag');
  controls.reset(); wheel({ deltaX: 40, deltaY: 20 });
  target.copy(fixedPoint); controls.apply(camera.position, target); camera.lookAt(target); camera.updateMatrixWorld();
  const scrolled = fixedPoint.clone().project(camera);
  assert.ok(scrolled.x < 0 && scrolled.y > 0, 'positive native scroll moves content left/up');
});

await test('blur, reset, mode changes and disposal release input and never leave motion running', () => {
  controls.setActive(true); pointer('pointerdown', 1, 100, 100);
  send(window, 'keydown', { key: 'ArrowLeft' }); controls.update(.1);
  send(window, 'blur'); const yaw = controls.yaw; controls.update(.1);
  assert.equal(controls.yaw, yaw); assert.equal(controls.dragging, false); assert.equal(canvas.captured.size, 0);
  send(canvas, 'gesturestart'); controls.setActive(false);
  assert.equal(canvas.style.touchAction, 'pan-y'); assert.equal(canvas.tabIndex, -1);
  assert.equal(wheel({ deltaY: 10 }).defaultPrevented, false);
  controls.setActive(true); send(window, 'keydown', { key: 'Home' });
  assert.deepEqual([controls.yaw, controls.pitch, controls.zoom], [0, 0, 0]);
  send(window, 'keydown', { key: 'Escape' }); assert.equal(exits, 1);
  controls.dispose(); assert.equal(wheel({ deltaX: 100 }).defaultPrevented, false);
});
