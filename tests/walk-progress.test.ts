import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
const { cameraProgress, positionPath, CAMERA_STOPS }: typeof import('../src/components/scene/config') =
  await import(new URL('../src/components/scene/config.ts', import.meta.url).href);

await test('every small scroll moves the camera through chapter boundaries without dead zones', () => {
  let previousProgress = cameraProgress(0), previous = positionPath.getPoint(previousProgress);
  // The former dwell discarded 17% of each chapter's input, including the
  // region either side of its boundary. Exercise the actual authored path.
  for (let step = 1; step <= 4000; step++) {
    const progress = cameraProgress(step / 4000), point = positionPath.getPoint(progress);
    assert.ok(progress > previousProgress, `scroll stalled at ${step / 4000}`);
    assert.ok(point.distanceTo(previous) > .0001, `camera did not move at ${step / 4000}`);
    previousProgress = progress; previous = point;
  }
});

await test('chapter links retain their authored destinations and overscroll stays inside the route', () => {
  for (let i = 0; i < CAMERA_STOPS.length; i++) {
    const point = positionPath.getPoint(cameraProgress(i / 4));
    assert.ok(point.distanceTo(new Vector3(...CAMERA_STOPS[i].p)) < .000001);
  }
  assert.equal(cameraProgress(-.2), 0);
  assert.equal(cameraProgress(1.2), 1);
});
