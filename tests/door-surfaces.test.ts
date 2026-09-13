import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'three';
const { stabilizeDoorSurfaces }: typeof import('../src/components/scene/door-surfaces') =
  await import(new URL('../src/components/scene/door-surfaces.ts', import.meta.url).href);
const { loadArchitecture }: typeof import('./helpers/architecture') =
  await import(new URL('./helpers/architecture.ts', import.meta.url).href);

await test('real entrance jambs clear the facade while retaining wall-foot stains and closed edges', async () => {
  const house = await loadArchitecture(); house.updateMatrixWorld(true);
  const jambs = house.getObjectByName('Architecture__Reference_damp_lime_wall_foot') as T.Mesh;
  const facade = house.getObjectByName('Architecture__Reference_lime_facade_subtle_rain_and_chalk') as T.Mesh;
  const geometry = jambs.geometry, original = geometry.getAttribute('position');
  assert.ok(original.normalized, 'exercise the exported quantized positions');
  const before = Array.from({ length: original.count }, (_, i) =>
    new T.Vector3().fromBufferAttribute(original, i).applyMatrix4(jambs.matrixWorld));
  const attributes = { ...geometry.attributes }, index = geometry.index;
  const facadePosition = facade.geometry.getAttribute('position');
  const ray = new T.Raycaster(new T.Vector3(-2.30, 2, 1), new T.Vector3(0, 0, -1));
  const facadeDepth = ray.intersectObject(facade, false)[0]?.point.z;
  const originalJambDepth = ray.intersectObject(jambs, false)[0]?.point.z;
  assert.ok(facadeDepth !== undefined && originalJambDepth !== undefined);
  assert.ok(Math.abs(originalJambDepth - facadeDepth) < .00002, 'both real surfaces overlap at this doorway pixel');
  const changed = stabilizeDoorSurfaces(house);
  assert.equal(changed, 24, 'move the four front triangles and all duplicated adjoining edge vertices');
  assert.equal(stabilizeDoorSurfaces(house), 0, 'repeated initialization must not keep moving the doorway');
  assert.equal(jambs.geometry, geometry); assert.equal(geometry.index, index);
  assert.equal(facade.geometry.getAttribute('position'), facadePosition);
  assert.ok(ray.intersectObject(jambs, false)[0].point.z - facadeDepth > .0029);
  for (const [name, attribute] of Object.entries(attributes)) {
    if (name !== 'position') assert.equal(geometry.getAttribute(name), attribute);
  }
  const after = geometry.getAttribute('position'); let moved = 0;
  for (let i = 0; i < after.count; i++) {
    const point = new T.Vector3().fromBufferAttribute(after, i).applyMatrix4(jambs.matrixWorld);
    if (point.distanceTo(before[i]) < .000002) continue;
    moved++;
    assert.ok(Math.abs(Math.abs(before[i].x) - 2.25) < .10 && before[i].y >= .19 && before[i].y <= 3.01);
    assert.ok(Math.abs(before[i].z - .000015899) < .00000001, 'reproduce the 0.016 mm depth conflict');
    assert.ok(Math.abs(point.x - before[i].x) < .000002 && Math.abs(point.y - before[i].y) < .000002);
    assert.ok(Math.abs(point.z - .003) < .000002, 'keep a real 3 mm separation without depth-test overrides');
  }
  assert.equal(moved, changed);
});

await test('unrelated or updated architecture is not moved', () => {
  assert.equal(stabilizeDoorSurfaces(new T.Group()), 0);
  const house = new T.Group(), geometry = new T.BoxGeometry(1, 1, 1);
  const mesh = new T.Mesh(geometry); mesh.name = 'Architecture__Reference_damp_lime_wall_foot'; house.add(mesh);
  const position = geometry.getAttribute('position');
  assert.equal(stabilizeDoorSurfaces(house), 0); assert.equal(geometry.getAttribute('position'), position);
});
