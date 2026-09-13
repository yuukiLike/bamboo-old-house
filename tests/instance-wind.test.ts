import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'three';

const {createInstanceWind,forestWindTip}:typeof import('../src/components/scene/wind')=
 await import(new URL('../src/components/scene/wind.ts',import.meta.url).href);
const {createVegetationVisibility}:typeof import('../src/components/scene/vegetation-visibility')=
 await import(new URL('../src/components/scene/vegetation-visibility.ts',import.meta.url).href);

function near(actual:number,expected:number){assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);}
function viewAt(x:number){const camera=new T.PerspectiveCamera(45,1,.1,100);camera.position.set(x,0,8);camera.lookAt(x,0,0);return camera;}

await test('cached root forces follow visibility compaction, including while paused',()=>{
 const scene=new T.Scene(),material=new T.MeshStandardMaterial();material.userData.instanceWind={height:14};
 const source=new T.BoxGeometry(.1,.1,.1),mesh=new T.InstancedMesh(source,material,3);mesh.name='Stalk_far';
 [-40,0,40].forEach((x,i)=>mesh.setMatrixAt(i,new T.Matrix4().makeTranslation(x,0,0)));scene.add(mesh);
 const visibility=createVegetationVisibility(scene),wind=createInstanceWind(scene);
 for(const x of [0,40,-40,0]){
  visibility.update(viewAt(x));wind.update(4,.7);assert.equal(mesh.count,1);
  const attribute=mesh.geometry.getAttribute('aInstanceWind'),expected=forestWindTip(4,x,0,14,.7);
  near(attribute.getX(0),expected[0]);near(attribute.getY(0),expected[1]);
 }
 const attribute=mesh.geometry.getAttribute('aInstanceWind') as T.InstancedBufferAttribute,version=attribute.version;
 wind.update(4,.7);assert.equal(attribute.version,version);
 wind.update(4,0);near(attribute.getX(0),0);near(attribute.getY(0),0);
 wind.dispose();assert.equal(mesh.geometry,source);assert.equal(source.getAttribute('aInstanceWind'),undefined);
});

await test('shared geometry gets independent forces for scale, position and offscreen shadow batches',()=>{
 const scene=new T.Scene(),geometry=new T.BoxGeometry(),material=new T.MeshStandardMaterial();material.userData.instanceWind={height:.85};
 const meshes=[0,40].map(x=>{const mesh=new T.InstancedMesh(geometry,material,1);mesh.setMatrixAt(0,new T.Matrix4().makeScale(1,2,1).setPosition(x,0,0));mesh.castShadow=true;mesh.customDepthMaterial=new T.MeshDepthMaterial();scene.add(mesh);return mesh;});
 const wind=createInstanceWind(scene);wind.update(7,1);
 assert.notEqual(meshes[0].geometry,meshes[1].geometry);
 for(const [i,mesh]of meshes.entries()){
  const a=mesh.geometry.getAttribute('aInstanceWind'),expected=forestWindTip(7,i*40,0,1.7,1);
  near(a.getX(0),expected[0]);near(a.getY(0),expected[1]);
  assert.equal(mesh.geometry.getAttribute('position'),geometry.getAttribute('position'));
  assert.ok(mesh.customDepthMaterial!.customProgramCacheKey().includes('cached-root-wind'));
 }
 meshes[0].visible=false;wind.update(9,.4);meshes[0].visible=true;wind.update(9,.4);
 near(meshes[0].geometry.getAttribute('aInstanceWind').getX(0),forestWindTip(9,0,0,1.7,.4)[0]);
 wind.dispose();assert.ok(meshes.every(mesh=>mesh.geometry===geometry));
});

await test('hanging branches use their parent culm root and height, not their own transform',()=>{
 const scene=new T.Scene(),geometry=new T.BoxGeometry(),material=new T.MeshStandardMaterial();material.userData.instanceWind={height:14,branch:true};
 geometry.setAttribute('aBranchRoot',new T.InstancedBufferAttribute(new Float32Array([20,1,-10,4]),4));
 geometry.setAttribute('aBranchFrame',new T.InstancedBufferAttribute(new Float32Array([0,1,0,18]),4));
 const mesh=new T.InstancedMesh(geometry,material,1);mesh.setMatrixAt(0,new T.Matrix4().makeTranslation(100,100,100));scene.add(mesh);
 const wind=createInstanceWind(scene);wind.update(5,.7);
 const attribute=mesh.geometry.getAttribute('aInstanceWind'),expected=forestWindTip(5,20,-10,18,.7);
 near(attribute.getX(0),expected[0]);near(attribute.getY(0),expected[1]);wind.dispose();
});

await test('a full vertex-input budget retains the original animated shader',()=>{
 const scene=new T.Scene(),geometry=new T.BoxGeometry(),material=new T.MeshStandardMaterial();material.userData.instanceWind={height:14};
 for(let i=0;i<9;i++)geometry.setAttribute(`binding${i}`,new T.InstancedBufferAttribute(new Float32Array(4),4));
 const mesh=new T.InstancedMesh(geometry,material,1),compile=material.onBeforeCompile.bind(material);material.onBeforeCompile=compile;scene.add(mesh);
 const wind=createInstanceWind(scene,16);wind.update(1,.5);
 assert.equal(mesh.geometry,geometry);assert.equal(geometry.getAttribute('aInstanceWind'),undefined);wind.dispose();
});

await test('root force extraction preserves the original analytic bends',async()=>{
 const {forestWindBend}=await import(new URL('../src/components/scene/wind.ts',import.meta.url).href);
 const samples=[
  {args:[4,-18,20,7,14,.28],offset:[-.014743923714837383,-.000020211495064611274,-.002251610937743104]},
  {args:[12,25,-13,10,18,1],offset:[.012432578035968471,-.000009995514296828992,.0018787922999874496]},
  {args:[38,-5,8,.2,.15,.7],offset:[.006479547943712971,-.00014907242883416253,.0025449529265818664]},
 ];
 for(const {args,offset}of samples){const actual=forestWindBend(...args).offset;actual.forEach((value:number,i:number)=>near(value,offset[i]));}
});
