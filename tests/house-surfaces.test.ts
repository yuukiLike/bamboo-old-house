import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const { stabilizeHouseSurfaces }: typeof import('../src/components/scene/house-surfaces') =
  await import(new URL('../src/components/scene/house-surfaces.ts', import.meta.url).href);

async function loadArchitecture() {
  const file = readFileSync(new URL('../public/models/architecture.glb', import.meta.url));
  const jsonLength = file.readUInt32LE(12), binary = file.subarray(28 + jsonLength);
  const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
  // Retain the actual compressed geometry without requiring browser image decoding.
  gltf.materials = gltf.materials.map((material: { name: string }) => ({ name: material.name, doubleSided: true }));
  delete gltf.textures; delete gltf.images;
  const json = Buffer.from(JSON.stringify(gltf)), padding = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const result = Buffer.alloc(28 + json.length + padding.length + binary.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length + padding.length, 12); result.writeUInt32LE(0x4e4f534a, 16);
  json.copy(result, 20); padding.copy(result, 20 + json.length);
  result.writeUInt32LE(binary.length, 20 + json.length + padding.length);
  result.writeUInt32LE(0x004e4942, 24 + json.length + padding.length);
  binary.copy(result, 28 + json.length + padding.length);
  return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(result.buffer, '')).scene;
}

await test('real doorway and room-one faces separate without changing unrelated geometry', async () => {
  const house = await loadArchitecture(); house.updateMatrixWorld(true);
  const mesh = (name: string) => house.getObjectByName(name) as T.Mesh;
  const jambs = mesh('Architecture__Reference_damp_lime_wall_foot');
  const post = mesh('Architecture__Reference_old_soft_lime_plaster');
  const facade = mesh('Architecture__Reference_lime_facade_subtle_rain_and_chalk');
  const lining = mesh('Architecture__Upper_room_old_warm_lime');
  const doorRay = new T.Raycaster(new T.Vector3(-2.30, 2, 1), new T.Vector3(0, 0, -1));
  const roomRay = new T.Raycaster(new T.Vector3(.65, 5.2, -9.45), new T.Vector3(-1, 0, 0));
  const facadeDepth = doorRay.intersectObject(facade, false)[0].point.z;
  const liningDistance = roomRay.intersectObject(lining, false)[0].distance;
  assert.ok(Math.abs(doorRay.intersectObject(jambs, false)[0].point.z - facadeDepth) < .00002);
  assert.ok(Math.abs(roomRay.intersectObject(post, false)[0].distance - liningDistance) < .000011);
  assert.ok(jambs.geometry.attributes.position.normalized && post.geometry.attributes.position.normalized);
  const snapshots: { mesh: T.Mesh; geometry: T.BufferGeometry; index: T.BufferAttribute | null;
    attributes: T.BufferGeometry['attributes']; material: T.Mesh['material'] }[] = [];
  house.traverse(object => {
    if (object instanceof T.Mesh) snapshots.push({ mesh: object, geometry: object.geometry,
      index: object.geometry.index, attributes: { ...object.geometry.attributes }, material: object.material });
  });
  assert.equal(stabilizeHouseSurfaces(house), 40);
  assert.equal(stabilizeHouseSurfaces(house), 0, 'repeated initialization cannot keep moving the faces');
  assert.ok(doorRay.intersectObject(jambs, false)[0].point.z - facadeDepth > .0029);
  assert.ok(roomRay.intersectObject(post, false)[0].distance - liningDistance > .003);
  for (const { mesh, geometry, index, attributes, material } of snapshots) {
    assert.equal(mesh.geometry, geometry); assert.equal(geometry.index, index); assert.equal(mesh.material, material);
    for (const [name, attribute] of Object.entries(attributes)) {
      if (name !== 'position' || (mesh !== jambs && mesh !== post)) assert.equal(geometry.getAttribute(name), attribute);
    }
    if (mesh !== jambs && mesh !== post) continue;
    const before = attributes.position, after = geometry.getAttribute('position'); let moved = 0;
    for (let i = 0; i < before.count; i++) {
      const from = new T.Vector3().fromBufferAttribute(before, i).applyMatrix4(mesh.matrixWorld);
      const to = new T.Vector3().fromBufferAttribute(after, i).applyMatrix4(mesh.matrixWorld);
      if (to.distanceTo(from) < .000002) continue;
      moved++;
      if (mesh === jambs) {
        assert.ok(Math.abs(Math.abs(from.x) - 2.25) < .10 && from.y >= .19 && from.y <= 3.01);
        assert.ok(Math.abs(from.z - .000015899) < .00000001);
        assert.ok(Math.abs(to.x - from.x) < .000002 && Math.abs(to.y - from.y) < .000002);
        assert.ok(Math.abs(to.z - .003) < .000002);
      } else {
        assert.ok(Math.abs(from.x + .7999765455666419) < .00000001 && from.z >= -9.613 && from.z <= -9.307);
        assert.ok(Math.abs(to.y - from.y) < .000002 && Math.abs(to.z - from.z) < .000002);
        assert.ok(Math.abs(to.x + .803) < .000002);
      }
    }
    assert.equal(moved, mesh === jambs ? 24 : 16, 'only target faces and their duplicated edge vertices move');
  }
});

await test('unrelated or updated architecture is not moved', () => {
  assert.equal(stabilizeHouseSurfaces(new T.Group()), 0);
  const house = new T.Group(), geometry = new T.BoxGeometry(1, 1, 1);
  for (const name of ['Architecture__Reference_damp_lime_wall_foot', 'Architecture__Reference_old_soft_lime_plaster']) {
    const mesh = new T.Mesh(geometry); mesh.name = name; house.add(mesh);
  }
  const position = geometry.getAttribute('position');
  assert.equal(stabilizeHouseSurfaces(house), 0); assert.equal(geometry.getAttribute('position'), position);
});
