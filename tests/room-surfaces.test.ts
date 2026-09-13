import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'three';
const { stabilizeRoomSurfaces }: typeof import('../src/components/scene/room-surfaces') =
  await import(new URL('../src/components/scene/room-surfaces.ts', import.meta.url).href);
const { ROOM_VIEWS }: typeof import('../src/components/scene/config') =
  await import(new URL('../src/components/scene/config.ts', import.meta.url).href);
const { loadArchitecture }: typeof import('./helpers/architecture') =
  await import(new URL('./helpers/architecture.ts', import.meta.url).href);

await test('room-one post clears the real lining without changing other walls or their outer faces', async () => {
  const house = await loadArchitecture(); house.updateMatrixWorld(true);
  const post = house.getObjectByName('Architecture__Reference_old_soft_lime_plaster') as T.Mesh;
  const lining = house.getObjectByName('Architecture__Upper_room_old_warm_lime') as T.Mesh;
  const geometry = post.geometry, original = geometry.getAttribute('position');
  assert.ok(original.normalized);
  const before = Array.from({ length: original.count }, (_, i) =>
    new T.Vector3().fromBufferAttribute(original, i).applyMatrix4(post.matrixWorld));
  const attributes = { ...geometry.attributes }, index = geometry.index;
  const otherPositions = new Map<T.Mesh, T.BufferAttribute | T.InterleavedBufferAttribute>();
  house.traverse(object => { if (object instanceof T.Mesh && object !== post) otherPositions.set(object, object.geometry.getAttribute('position')); });
  const ray = new T.Raycaster(new T.Vector3(.65, 5.2, -9.45), new T.Vector3(-1, 0, 0));
  const liningDistance = ray.intersectObject(lining, false)[0].distance;
  assert.ok(Math.abs(ray.intersectObject(post, false)[0].distance - liningDistance) < .000011);
  assert.equal(stabilizeRoomSurfaces(house), 16);
  assert.equal(stabilizeRoomSurfaces(house), 0);
  assert.ok(ray.intersectObject(post, false)[0].distance - liningDistance > .003);
  assert.equal(post.geometry, geometry); assert.equal(geometry.index, index);
  for (const [mesh, position] of otherPositions) assert.equal(mesh.geometry.getAttribute('position'), position);
  for (const [name, attribute] of Object.entries(attributes)) if (name !== 'position') assert.equal(geometry.getAttribute(name), attribute);
  const after = geometry.getAttribute('position'); let moved = 0;
  for (let i = 0; i < after.count; i++) {
    const point = new T.Vector3().fromBufferAttribute(after, i).applyMatrix4(post.matrixWorld);
    if (point.distanceTo(before[i]) < .000002) continue;
    moved++;
    assert.ok(Math.abs(before[i].x + .7999765455666419) < .00000001);
    assert.ok(before[i].z >= -9.613 && before[i].z <= -9.307);
    assert.ok(Math.abs(point.y - before[i].y) < .000002 && Math.abs(point.z - before[i].z) < .000002);
    assert.ok(Math.abs(point.x + .803) < .000002);
  }
  assert.equal(moved, 16, 'move all copies of the four post-face corners together');
});

await test('every authored room eye clears the full rotating near plane at maximum zoom-out', async () => {
  const house = await loadArchitecture(); house.updateMatrixWorld(true);
  stabilizeRoomSurfaces(house);
  // This sphere contains the near-plane corners at 90 degrees vertical FOV,
  // including 32:9 screens. If clear, every yaw/pitch also clears geometry.
  const near = .12, widestAspect = 32 / 9;
  const cornerRadius = near * Math.sqrt(2 + widestAspect * widestAspect);
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  const triangle = new T.Triangle(a, b, c), closest = new T.Vector3(), bounds = new T.Box3();
  for (const [id, view] of Object.entries(ROOM_VIEWS)) {
    const eye = new T.Vector3(...view.p); let distance = Infinity;
    house.traverse(object => {
      if (!(object instanceof T.Mesh) || bounds.setFromObject(object).distanceToPoint(eye) >= distance) return;
      const position = object.geometry.getAttribute('position'), indices = object.geometry.index!;
      for (let i = 0; i < indices.count; i += 3) {
        a.fromBufferAttribute(position, indices.getX(i)).applyMatrix4(object.matrixWorld);
        b.fromBufferAttribute(position, indices.getX(i + 1)).applyMatrix4(object.matrixWorld);
        c.fromBufferAttribute(position, indices.getX(i + 2)).applyMatrix4(object.matrixWorld);
        if (triangle.getArea() === 0) continue; // Quantization collapses a few microscopic detail triangles.
        distance = Math.min(distance, triangle.closestPointToPoint(eye, closest).distanceTo(eye));
      }
    });
    assert.ok(distance > cornerRadius + .01, `${id}: near plane needs ${cornerRadius.toFixed(3)} m, clearance is ${distance.toFixed(3)} m`);
  }
});
