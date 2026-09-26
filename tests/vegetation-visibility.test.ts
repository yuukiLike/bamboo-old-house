import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'three';

// A URL lets Node run the TypeScript source directly without changing the
// application's bundler module-resolution settings.
const { createVegetationVisibility }: typeof import('../src/components/scene/vegetation-visibility') =
 await import(new URL('../src/components/scene/vegetation-visibility.ts', import.meta.url).href);

function viewAt(x: number, y = 0) {
 const camera = new T.PerspectiveCamera(60, 1, .1, 100);
 camera.position.set(x, y, 10);
 camera.lookAt(x, y, 0);
 return camera;
}

function assertInstance(mesh: T.InstancedMesh, index: number, x: number, color: T.Color) {
 const matrix = new T.Matrix4(), actualColor = new T.Color();
 mesh.getMatrixAt(index, matrix);
 mesh.getColorAt(index, actualColor);
 assert.deepEqual(matrix.elements, new T.Matrix4().makeTranslation(x, 0, 0).elements);
 assert.ok(actualColor.equals(color));
}

await test('ground details leave the view and return with their original transforms and colors', () => {
 const scene = new T.Scene(), group = new T.Group();
 group.position.set(3, 2, 0);
 scene.add(group);
 const mesh = new T.InstancedMesh(new T.BoxGeometry(.5, .5, .5), new T.MeshBasicMaterial(), 3);
 mesh.name = 'Curled_bamboo_leaf_litter';
 const positions = [40, 0, -40], colors = [new T.Color(1, 0, 0), new T.Color(0, 1, 0), new T.Color(0, 0, 1)];
 positions.forEach((x, i) => {
  mesh.setMatrixAt(i, new T.Matrix4().makeTranslation(x, 0, 0));
  mesh.setColorAt(i, colors[i]);
 });
 group.add(mesh);
 const visibility = createVegetationVisibility(scene);

 for (const index of [1, 0, 2, 1]) {
  visibility.update(viewAt(positions[index] + 3, 2));
  assert.equal(mesh.count, 1);
  assert.equal(mesh.visible, true);
  assertInstance(mesh, 0, positions[index], colors[index]);
 }

 visibility.update(viewAt(103, 2));
 assert.equal(mesh.count, 0);
 assert.equal(mesh.visible, false);

 const wideView = viewAt(3, 2);
 wideView.fov = 160;
 wideView.updateProjectionMatrix();
 visibility.update(wideView);
 assert.equal(mesh.count, positions.length);
 assert.equal(mesh.visible, true);
 positions.forEach((x, i) => assertInstance(mesh, i, x, colors[i]));
});

await test('offscreen shadow casters retain every instance and their animated depth material', () => {
 const scene = new T.Scene();
 const source = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial(), 2);
 source.name = 'Stalk_bamboo';
 source.position.set(1, 2, 3);
 source.rotation.y = .15;
 source.scale.setScalar(1.2);
 source.castShadow = source.receiveShadow = true;
 source.customDepthMaterial = new T.MeshDepthMaterial();
 source.customDistanceMaterial = new T.MeshDistanceMaterial();
 source.customDepthMaterial.onBeforeCompile = shader => {
  shader.uniforms.uWindTime = { value: 0 };
 };
 const colors = [new T.Color(1, 0, 0), new T.Color(0, 1, 0)];
 for (let i = 0; i < 2; i++) {
  source.setMatrixAt(i, new T.Matrix4().makeTranslation(i * 64, 0, 0));
  source.setColorAt(i, colors[i]);
 }
 scene.add(source);
 const visibility = createVegetationVisibility(scene);
 visibility.update(viewAt(0));

 const batches = scene.children.filter((object): object is T.InstancedMesh => object instanceof T.InstancedMesh);
 assert.equal(source.parent, null);
 assert.equal(batches.length, 2);
 assert.equal(batches.reduce((count, batch) => count + batch.count, 0), 2);
 for (const batch of batches) {
  assert.equal(batch.visible, true);
  assert.equal(batch.frustumCulled, true);
  assert.equal(batch.castShadow, true);
  assert.equal(batch.receiveShadow, true);
  assert.equal(batch.geometry, source.geometry);
  assert.equal(batch.material, source.material);
  assert.equal(batch.customDepthMaterial, source.customDepthMaterial);
  assert.equal(batch.customDistanceMaterial, source.customDistanceMaterial);
  assert.ok(batch.position.equals(source.position));
  assert.ok(batch.quaternion.equals(source.quaternion));
  assert.ok(batch.scale.equals(source.scale));
  const matrix = new T.Matrix4();
  batch.getMatrixAt(0, matrix);
  const index = matrix.elements[12] / 64;
  assertInstance(batch, 0, index * 64, colors[index]);
 }
});

await test('batches with their own instance attributes keep their original ordering', () => {
 for (const interleaved of [false, true]) {
  const scene = new T.Scene(), geometry = new T.BoxGeometry(1, 1, 1);
  const attribute = interleaved
   ? new T.InterleavedBufferAttribute(new T.InstancedInterleavedBuffer(new Float32Array([10, 20]), 1), 1, 0)
   : new T.InstancedBufferAttribute(new Float32Array([10, 20]), 1);
  geometry.setAttribute('branchBinding', attribute);
  const mesh = new T.InstancedMesh(geometry, new T.MeshBasicMaterial(), 2);
  mesh.name = 'Leaves_bound_branches';
  mesh.setMatrixAt(0, new T.Matrix4().makeTranslation(64, 0, 0));
  mesh.setMatrixAt(1, new T.Matrix4());
  const originalMatrices = Array.from(mesh.instanceMatrix.array);
  scene.add(mesh);
  const visibility = createVegetationVisibility(scene);
  visibility.update(viewAt(0));

  assert.equal(mesh.parent, scene);
  assert.equal(mesh.count, 2);
  assert.deepEqual(Array.from(mesh.instanceMatrix.array), originalMatrices);
  assert.equal(mesh.geometry.getAttribute('branchBinding'), attribute);
  assert.deepEqual([attribute.getX(0), attribute.getX(1)], [10, 20]);
 }
});

await test('small stone and meadow shadow batches remain whole to avoid extra draw calls', () => {
 for (const name of ['Embedded_angular_bank_stones', 'Meadow_grass_beside_house_0']) {
  const scene = new T.Scene();
  const mesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial(), 2);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.setMatrixAt(0, new T.Matrix4());
  mesh.setMatrixAt(1, new T.Matrix4().makeTranslation(20, 0, 0));
  scene.add(mesh);
  const visibility = createVegetationVisibility(scene);
  visibility.update(viewAt(0));

  assert.deepEqual(scene.children, [mesh]);
  assert.equal(mesh.count, 2);
  assert.equal(mesh.castShadow, true);
 }
});

await test('spatial cells preserve exact sphere visibility across camera changes and parent transforms',()=>{
 const scene=new T.Scene(),group=new T.Group();group.position.set(-3,2,7);group.rotation.y=.3;group.scale.setScalar(1.4);scene.add(group);
 const mesh=new T.InstancedMesh(new T.BoxGeometry(.2,.5,.2),new T.MeshBasicMaterial(),900);
 mesh.name='Fallen_bamboo_leaves';group.add(mesh);
 const matrices:T.Matrix4[]=[],spheres:T.Sphere[]=[];
 const color=new T.Color();
 for(let i=0;i<900;i++){
  const matrix=new T.Matrix4().makeTranslation((i%30-15)*4,0,(Math.floor(i/30)-15)*4);matrices.push(matrix);
  mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,color.setRGB(i/900,0,1-i/900));
 }
 scene.updateMatrixWorld(true);mesh.geometry.computeBoundingSphere();
 for(const matrix of matrices){const sphere=mesh.geometry.boundingSphere!.clone().applyMatrix4(matrix.clone().premultiply(mesh.matrixWorld));sphere.radius+=.05;spheres.push(sphere);}
 const visibility=createVegetationVisibility(scene),projection=new T.Matrix4(),frustum=new T.Frustum();
 for(let step=0;step<24;step++){
  const camera=viewAt(Math.sin(step)*30,2);camera.position.z=Math.cos(step)*30;
  camera.lookAt(0,2,0);camera.fov=35+step*2;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  const expected=spheres.flatMap((sphere,index)=>frustum.intersectsSphere(sphere)?[index]:[]);
  visibility.update(camera);assert.equal(mesh.count,expected.length);
  expected.forEach((index,slot)=>{const actual=new T.Matrix4();mesh.getMatrixAt(slot,actual);assert.deepEqual(actual.elements,matrices[index].elements);assert.ok(Math.abs(mesh.instanceColor!.getX(slot)-index/900)<1e-6);});
 }
});

await test('a removed suffix needs no upload; later updates retain all pending dirty slots',()=>{
 const scene=new T.Scene(),mesh=new T.InstancedMesh(new T.BoxGeometry(.1,.1,.1),new T.MeshBasicMaterial(),3);
 mesh.name='Fallen_bamboo_leaves';scene.add(mesh);
 [0,2,20].forEach((x,i)=>{mesh.setMatrixAt(i,new T.Matrix4().makeTranslation(x,0,0));mesh.setColorAt(i,new T.Color(i/3,0,0));});
 const visibility=createVegetationVisibility(scene),wide=viewAt(0);wide.fov=150;wide.updateProjectionMatrix();
 visibility.update(wide);assert.equal(mesh.count,3);
 mesh.instanceMatrix.clearUpdateRanges();mesh.instanceColor!.clearUpdateRanges();
 const version=mesh.instanceMatrix.version;
 visibility.update(viewAt(0));assert.equal(mesh.count,2);assert.equal(mesh.instanceMatrix.version,version);assert.deepEqual(mesh.instanceMatrix.updateRanges,[]);
 visibility.update(wide);assert.equal(mesh.count,3);assert.deepEqual(mesh.instanceMatrix.updateRanges,[{start:32,count:16}]);
 // No render/upload occurs between these two updates. Slot 2 must remain
 // pending even though the second update changes only the first slot.
 visibility.update(viewAt(20));assert.equal(mesh.count,1);
 assert.deepEqual(mesh.instanceMatrix.updateRanges,[{start:32,count:16},{start:0,count:16}]);
 assert.deepEqual(mesh.instanceColor!.updateRanges,[{start:6,count:3},{start:0,count:3}]);
});
