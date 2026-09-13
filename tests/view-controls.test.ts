import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const { ViewControls }: typeof import('../src/components/scene/view-controls') =
  await import(new URL('../src/components/scene/view-controls.ts', import.meta.url).href);
const { cameraProgress, positionPath, followWalkProgress }: typeof import('../src/components/scene/config') =
  await import(new URL('../src/components/scene/config.ts', import.meta.url).href);

class Canvas extends EventTarget {
  style = { touchAction: '', cursor: '' };
  tabIndex = -1;
  clientHeight = 800;
  focus() {}
  setPointerCapture() {}
  hasPointerCapture() { return false; }
  releasePointerCapture() {}
  setAttribute() {}
}
// Exercise the real gesture handlers; trusted input is checked in the browser.
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let canvas: Canvas, controls: InstanceType<typeof ViewControls>;
function send(target: EventTarget, type: string, values: object = {}) {
  const event = Object.assign(new Event(type, { cancelable: true }), values);
  target.dispatchEvent(event);
  return event;
}
function wheel(values: object = {}) {
  return send(canvas, 'wheel', { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, ...values });
}
function pointer(type: string, id: number, x: number, y: number) {
  return send(canvas, type, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0 });
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  canvas = new Canvas();
  controls = new ViewControls(canvas as unknown as HTMLCanvasElement, () => {});
});
afterEach(() => {
  controls.dispose();
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

await test('trackpad scrolling pans and reverses without zoom or an inertia tail; walking keeps native scrolling', () => {
  assert.equal(wheel({ deltaY: 20 }).defaultPrevented, false);
  controls.setActive(true);
  assert.equal(wheel({ deltaX: 40, deltaY: 20 }).defaultPrevented, true);
  assert.deepEqual([controls.yaw, controls.pitch, controls.zoom], [-.12, -.06, 0]);
  wheel({ deltaX: -40, deltaY: -20 });
  controls.update(.1);
  assert.deepEqual([controls.yaw, controls.pitch, controls.zoom], [0, 0, 0]);
  wheel({ deltaY: -10, ctrlKey: true });
  assert.deepEqual([controls.yaw, controls.pitch, controls.zoom], [0, 0, -2]);
  controls.setActive(false);
  assert.equal(wheel({ deltaY: 20 }).defaultPrevented, false);
  assert.equal(wheel({ deltaY: -10, ctrlKey: true }).defaultPrevented, false);
});

await test('Safari cumulative scale does not compound or double-apply wheel magnification', () => {
  controls.setActive(true);
  send(canvas, 'gesturestart');
  send(canvas, 'gesturechange', { scale: 1.2 });
  const first = controls.zoom;
  wheel({ deltaY: -10, ctrlKey: true });
  assert.equal(controls.zoom, first);
  send(canvas, 'gesturechange', { scale: 1.4 });
  assert.ok(Math.abs(controls.zoom + Math.log(1.4) * 35) < 1e-12);
});

await test('touch pinch responds on its first move and resumes one-finger drag without a jump', () => {
  controls.setActive(true);
  pointer('pointerdown', 1, 100, 100);
  pointer('pointerdown', 2, 200, 100);
  pointer('pointermove', 2, 220, 100);
  assert.equal(controls.zoom, -2.4);
  send(canvas, 'gesturestart');
  send(canvas, 'gesturechange', { scale: 1.2 });
  assert.equal(controls.zoom, -2.4);
  pointer('pointerup', 2, 220, 100);
  send(canvas, 'gestureend');
  pointer('pointermove', 1, 110, 110);
  assert.deepEqual([controls.yaw, controls.pitch], [.04, .03]);
});

await test('walking reaches the same short response at 30, 60 and 120 Hz', () => {
  const values = [30, 60, 120].map(hz => {
    let value = 0;
    for (let frame = 0; frame < hz / 10; frame++) value = followWalkProgress(value, 1, 1 / hz, 3600);
    return value;
  });
  assert.ok(Math.max(...values) - Math.min(...values) < 1e-12);
  assert.ok(values[0] > .95 && values[0] < .96, 'reach about 95% within 100 ms');
});

await test('reversing follows the newest position and stopping finishes without overshoot or a lingering tail', () => {
  const forward = followWalkProgress(.2, .8, 1 / 30, 3600);
  let current = followWalkProgress(forward, .1, 1 / 120, 3600);
  assert.ok(current < forward && current > .1);
  for (let frame = 0; frame < 60; frame++) {
    const next = followWalkProgress(current, .1, 1 / 60, 3600);
    assert.ok(next >= .1 && next <= current);
    current = next;
  }
  assert.equal(current, .1);
  assert.equal(followWalkProgress(current, .1, 1 / 30, 3600), .1);
});

await test('every small scroll moves the camera through chapter boundaries without dead zones', () => {
  let previousProgress = cameraProgress(0), previous = positionPath.getPoint(previousProgress);
  // Exercise the authored path, including the former chapter dwell regions.
  for (let step = 1; step <= 4000; step++) {
    const progress = cameraProgress(step / 4000), point = positionPath.getPoint(progress);
    assert.ok(progress > previousProgress, `scroll stalled at ${step / 4000}`);
    assert.ok(point.distanceTo(previous) > .0001, `camera did not move at ${step / 4000}`);
    previousProgress = progress; previous = point;
  }
});
