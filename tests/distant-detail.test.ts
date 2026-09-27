import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BREEZE_VIEW, MOON_VIEW, PLACE_VIEWS, PORCH_VIEW, WELL_RAIN_VIEW, positionPath, targetPath, treePositions, groundHeight, pathClearance, porchBranchPlacements } from '../src/components/scene/config.ts';

const modules=new Map<string,string>();
function moduleUrl(source:URL):string {
 const cached=modules.get(source.href);if(cached)return cached;
 const text=readFileSync(source,'utf8');
 const code=source.pathname.endsWith('.json')?`export default ${text}`:
  stripTypeScriptTypes(text,{mode:'transform',sourceUrl:source.href}).replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier:string)=>{
   const url=specifier.startsWith('.')?moduleUrl(new URL(specifier+(specifier.endsWith('.json')?'':'.ts'),source)):import.meta.resolve(specifier);
   return `from ${JSON.stringify(url)}`;
  });
 const url=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;modules.set(source.href,url);return url;
}
const load=(name:string)=>import(moduleUrl(new URL(`../src/components/scene/${name}.ts`,import.meta.url)));
const {createHouseLod,decodeHouseLod,loadHouseLod}:typeof import('../src/components/scene/house-lod')=await load('house-lod');
const {createWeather}:typeof import('../src/components/scene/weather')=await load('weather');
const {createWeatherState}:typeof import('../src/components/scene/weather-state')=await load('weather-state');
const {stabilizeHouseSurfaces}:typeof import('../src/components/scene/house-surfaces')=await load('house-surfaces');
const houseBytes=readFileSync(new URL('../public/models/architecture-lod.bin',import.meta.url));

async function model(name:string){
 const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),texture=new T.Texture();
 loader.register(()=>({name:'CPU_GEOMETRY_ONLY',loadTexture:()=>Promise.resolve(texture)}));
 const bytes=readFileSync(new URL(`../public/models/${name}.glb`,import.meta.url));
 const group=(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
 return {group,texture};
}
function dispose(...roots:T.Object3D[]){
 const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();
 for(const root of roots)root.traverse(object=>{
  if(!(object instanceof T.Mesh))return;
  geometries.add(object.geometry);
  for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
  if(object.customDepthMaterial)materials.add(object.customDepthMaterial);
 });
 geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());
}
function triangles(root:T.Object3D,camera?:T.Camera){
 const frustum=new T.Frustum();
 if(camera){root.updateMatrixWorld(true);camera.updateMatrixWorld(true);frustum.setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));}
 let count=0;root.traverseVisible(object=>{if(object instanceof T.Mesh&&(!camera||!object.frustumCulled||frustum.intersectsObject(object)))count+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3*(object instanceof T.InstancedMesh?object.count:1);});
 return count;
}

function placementFingerprint(trees:ReturnType<typeof treePositions>){
 // Trigonometric last bits differ across V8 platforms; retain 10 nm precision
 // for positions rather than requiring byte-identical floating-point strings.
 const source=JSON.stringify(trees,(_key,value:unknown)=>typeof value==='number'?Number(value.toFixed(8)):value);
 return createHash('sha256').update(source).digest('hex');
}

await test('real house LOD retains weather attributes, omits only distant furnishings and restores exact near resources',async context=>{
 const {group:house,texture}=await model('architecture'),scene=new T.Scene(),camera=new T.PerspectiveCamera(64,1,.1,750);
 stabilizeHouseSurfaces(house);scene.add(house);
 const state=createWeatherState({value:0},{value:0});
 const weather=createWeather(scene,house,camera,true,state.uniforms);
 const nearMeshes:T.Mesh[]=[];house.traverse(object=>{if(object instanceof T.Mesh)nearMeshes.push(object);});
 const originals=nearMeshes.map(mesh=>({mesh,geometry:mesh.geometry,material:mesh.material}));
 const detail=createHouseLod(house,await decodeHouseLod(houseBytes));scene.add(detail.root);
 try {
  const far=detail.root.levels[1].object;
  let reduced=0;
  for(const {mesh,geometry,material} of originals){
   const copy=far.getObjectByName(mesh.name) as T.Mesh;
   assert.ok(copy);assert.equal(copy.material,material);assert.equal(copy.castShadow,mesh.castShadow);
   if(copy.geometry!==geometry){
    reduced++;assert.ok(copy.geometry.index!.count<geometry.index!.count);
    assert.deepEqual(Object.keys(copy.geometry.attributes),Object.keys(geometry.attributes));
    for(const [key,attribute] of Object.entries(geometry.attributes))assert.equal(copy.geometry.attributes[key],attribute);
    assert.equal(copy.geometry.attributes.rainExposure,geometry.attributes.rainExposure);
   }
  }
  assert.ok(reduced>=15,'the actual rain-refined model must still benefit');
  const records=[];
  for(const lean of [false,true,false,true]){
   camera.position.fromArray(BREEZE_VIEW.p);
   detail.update(camera,false);const full=triangles(detail.root);
   detail.update(camera,true,lean);assert.equal(detail.distant,true);const distant=triangles(detail.root);
   assert.ok(distant<full-(300000),'remove expensive geometry, not just rename a level');
   assert.equal(detail.root.children.filter(child=>child.visible).length,1,'never render both house levels');
   records.push({lean,full,distant,reduction:Number((1-distant/full).toFixed(3))});
   const roomProp='Props__Owner_individual_unpolished_white_rice_grain';
   assert.equal(house.getObjectByName(roomProp)?.visible,true);
   assert.equal(detail.root.levels[detail.root.getCurrentLevel()].object.getObjectByName(roomProp)?.visible,false);
   for(const {mesh,geometry,material} of originals){assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);}
   detail.update(camera,false);assert.equal(triangles(detail.root),full);
  }
  context.diagnostic(JSON.stringify({house:records.slice(0,2),changedMeshes:reduced,compressedBytes:houseBytes.length,note:'CPU geometry counts after real weather setup, not FPS'}));
 } finally {weather.dispose();dispose(scene,house);texture.dispose();}
});

await test('house distance hysteresis, phone views, zoom and a disabled switch select one correct level',async()=>{
 const {group:house,texture}=await model('architecture');
 const detail=createHouseLod(house,await decodeHouseLod(houseBytes)),camera=new T.PerspectiveCamera(60,1,.1,750);
 try {
  const move=(z:number)=>{camera.position.set(0,0,z);return detail.update(camera,true);};
  move(23.9);assert.equal(detail.distant,false);
  assert.equal(move(24.1),true);assert.equal(detail.distant,true);
  for(const z of [24,23.9,24.05,23,19.3]){assert.equal(move(z),false);assert.equal(detail.distant,true);}
  assert.equal(move(19.1),true);assert.equal(detail.distant,false);
  move(23.9);assert.equal(detail.distant,false);
  for(const fov of [64,72]){
   camera.fov=fov;camera.position.fromArray(BREEZE_VIEW.p);detail.update(camera,true);assert.equal(detail.distant,true);
   camera.fov=35;detail.update(camera,true);assert.equal(detail.distant,false,'zoom brings back detail');
  }
  for(const view of [PORCH_VIEW,WELL_RAIN_VIEW,...Object.values(PLACE_VIEWS)]){
   camera.position.fromArray(view.p);camera.fov=view.fov;detail.update(camera,true);
   assert.equal(detail.distant,false,'all nearby and indoor eyes retain the original house');
  }
  camera.position.fromArray(MOON_VIEW.p);camera.fov=72;detail.update(camera,true);assert.equal(detail.distant,true);
  for(let i=0;i<30;i++){
   detail.update(camera,false);assert.equal(detail.distant,false);assert.equal(house.visible,true);
   detail.update(camera,true);assert.equal(detail.distant,true);assert.equal(house.visible,false);
  }
 } finally {dispose(detail.root);texture.dispose();}
});

await test('missing or invalid optional indices fall back to full detail; cancellation remains cancellation',async context=>{
 const request=context.mock.method(globalThis,'fetch',async()=>new Response('',{status:404}));
 context.mock.method(console,'warn',()=>{});
 const controller=new AbortController();
 const indices=await loadHouseLod(controller.signal);assert.equal(indices.size,0);
 const house=new T.Group(),detail=createHouseLod(house,indices),camera=new T.PerspectiveCamera();
 camera.position.z=100;detail.update(camera,true);assert.equal(detail.distant,false);assert.equal(house.visible,true);
 request.mock.mockImplementation(async()=>new Response(new Uint8Array(30)));
 assert.equal((await loadHouseLod(controller.signal)).size,0);
 await assert.rejects(()=>decodeHouseLod(houseBytes.subarray(0,-1)),/HOUSE_LOD_ASSET_MISMATCH/);
 controller.abort();await assert.rejects(()=>loadHouseLod(controller.signal),{name:'AbortError'});
});

await test('an optional LOD download cannot hold startup indefinitely and abort cancels its request',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});context.mock.method(console,'warn',()=>{});
 let requestSignal:AbortSignal|undefined;
 context.mock.method(globalThis,'fetch',(_url:unknown,options?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
  requestSignal=options?.signal??undefined;
  requestSignal?.addEventListener('abort',()=>reject(requestSignal!.reason),{once:true});
 }));
 const timeout=loadHouseLod(new AbortController().signal);
 context.mock.timers.tick(5000);assert.equal((await timeout).size,0);assert.equal(requestSignal?.aborted,true);
 const controller=new AbortController(),aborted=loadHouseLod(controller.signal);
 controller.abort();await assert.rejects(()=>aborted,{name:'AbortError'});assert.equal(requestSignal?.aborted,true);
});

await test('lake-facing density adds layered clumps without changing existing culms, branch bindings or camera clearance',context=>{
 const trees=treePositions(),original=trees.slice(0,1448),added=trees.slice(1448);
 assert.equal(placementFingerprint(original),'c09b5a7a1168133cb8ba37be04f4eacc915f0441cd898f8414002b744f0f6879');
 assert.deepEqual(trees,treePositions());assert.deepEqual(porchBranchPlacements(trees),porchBranchPlacements(original));
 assert.ok(added.length>=160);
 const bank=(items:typeof trees)=>items.filter(p=>p.x>18&&p.x<36&&p.z>8&&p.z<42);
 assert.ok(bank(trees).length>bank(original).length*2);
 assert.ok(bank(trees).filter(p=>p.s<.55).length>bank(original).filter(p=>p.s<.55).length*2,'low crowns must fill the empty horizon too');
 for(const tree of added){
  assert.ok(tree.x>19&&tree.x<36&&tree.z>6&&tree.z<53);assert.ok(groundHeight(tree.x,tree.z)>=-.9);assert.ok(pathClearance(tree.x,tree.z)>=.6);
  for(const view of [PORCH_VIEW,WELL_RAIN_VIEW,BREEZE_VIEW,MOON_VIEW,...Object.values(PLACE_VIEWS)])assert.ok(Math.hypot(view.p[0]-tree.x,view.p[2]-tree.z)>.85);
 }
 for(let i=0;i<=500;i++){
  const p=positionPath.getPoint(i/500),t=targetPath.getPoint(i/500),phone=p.clone().sub(t).multiplyScalar(1.08).add(t);
  for(const tree of added)assert.ok(Math.min(Math.hypot(tree.x-p.x,tree.z-p.z),Math.hypot(tree.x-phone.x,tree.z-phone.z))>.75);
 }
 context.diagnostic(JSON.stringify({before:original.length,after:trees.length,added:added.length,bankBefore:bank(original).length,bankAfter:bank(trees).length}));
});

await test('placement fingerprint ignores numeric tail noise but detects geometry and branch changes',()=>{
 const original=treePositions().slice(0,1448),fingerprint=placementFingerprint(original);
 const tailNoise=original.map(tree=>({...tree,x:tree.x+Number.EPSILON*tree.x,z:tree.z-Number.EPSILON*tree.z,leanX:tree.leanX+Number.EPSILON}));
 assert.equal(placementFingerprint(tailNoise),fingerprint);
 for(const key of ['x','z','s','rotation','variant','leanX','leanZ'] as const){
  const changed=original.map(tree=>({...tree}));changed[0][key]+=.0001;
  assert.notEqual(placementFingerprint(changed),fingerprint,`${key} changes must remain observable`);
 }
 assert.notEqual(placementFingerprint(original.slice(1)),fingerprint,'missing culms remain observable');
 assert.notEqual(placementFingerprint([...original].reverse()),fingerprint,'branch-binding order remains observable');
});
