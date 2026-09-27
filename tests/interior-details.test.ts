import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { WebGLShadowMap } from 'three/src/renderers/webgl/WebGLShadowMap.js';
import type { WebGLObjects } from 'three/src/renderers/webgl/WebGLObjects.js';
import type { WebGLCapabilities } from 'three/src/renderers/webgl/WebGLCapabilities.js';
import { createInteriorDetails } from '../src/components/scene/interior-details.ts';

await test('repeated toggles preserve resource identities and originally hidden objects',()=>{
 const house=new T.Group(),geometry=new T.BoxGeometry(),material=new T.MeshStandardMaterial();
 const visible=new T.Mesh(geometry,material),invisible=new T.Mesh(geometry,material),wall=new T.Mesh(geometry,material);
 visible.name='Props__Owner_individual_unpolished_white_rice_grain';
 invisible.name='Props__Interior_undyed_washed_cotton';invisible.visible=false;
 wall.name='Architecture__Interior_floor_wide_weathered_grey_brown_boards';
 house.add(visible,invisible,wall);
 let disposals=0;geometry.addEventListener('dispose',()=>disposals++);material.addEventListener('dispose',()=>disposals++);
 const details=createInteriorDetails(house);
 for(let repeat=0;repeat<20;repeat++){
  details.setHidden(true);details.setHidden(true);
  assert.equal(visible.visible,false);assert.equal(invisible.visible,false);assert.equal(wall.visible,true);
  details.setHidden(false);details.setHidden(false);
  assert.equal(visible.visible,true);assert.equal(invisible.visible,false);assert.equal(wall.visible,true);
  assert.equal(visible.geometry,geometry);assert.equal(visible.material,material);assert.equal(visible.parent,house);
 }
 assert.equal(disposals,0);geometry.dispose();material.dispose();
});

await test('real house detail batches leave beauty and shadow traversal without removing its shell or chimney',async context=>{
 const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),texture=new T.Texture();
 loader.register(()=>({name:'CPU_GEOMETRY_ONLY',loadTexture:()=>Promise.resolve(texture)}));
 const bytes=readFileSync(new URL('../public/models/architecture.glb',import.meta.url));
 const house=(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
 const scene=new T.Scene(),sun=new T.DirectionalLight(),camera=new T.PerspectiveCamera();
 sun.position.set(22,20,30);sun.castShadow=true;sun.shadow.autoUpdate=false;
 Object.assign(sun.shadow.camera,{left:-30,right:30,top:30,bottom:-30,near:1,far:150});
 sun.shadow.camera.updateProjectionMatrix();scene.add(house,sun,sun.target);
 const meshes:T.Mesh[]=[];
 house.traverse(object=>{
  if(!(object instanceof T.Mesh))return;
  const materials=Array.isArray(object.material)?object.material:[object.material];
  object.castShadow=!materials.some(material=>/^(Interior_frosted_lamp_glass|Kitchen_frosted_bare_bulb|Window_memory_old_clear_glass)/.test(material.name));
  meshes.push(object);
 });
 const snapshots=meshes.map(mesh=>({mesh,geometry:mesh.geometry,material:mesh.material}));
 const details=createInteriorDetails(house);
 let target:T.WebGLRenderTarget|null=null;
 const submitted:T.Mesh[]=[];
 const renderer={
  state:{setBlending(){},setScissorTest(){},viewport(){},buffers:{depth:{getReversed:()=>false,setTest(){}},color:{setClear(){}}}},
  getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
  setRenderTarget:(value:T.WebGLRenderTarget|null)=>{target=value;},clear(){},properties:{get:()=>({})},
  renderBufferDirect:(_camera:T.Camera,_scene:T.Scene,_geometry:T.BufferGeometry,_material:T.Material,mesh:T.Mesh)=>submitted.push(mesh),
 };
 const shadowMap=new WebGLShadowMap(renderer as unknown as T.WebGLRenderer,
  {update:(object:T.Mesh)=>object.geometry} as unknown as WebGLObjects,{maxTextureSize:4096} as WebGLCapabilities);
 shadowMap.enabled=true;
 const shadowFrame=()=>{
  submitted.length=0;sun.shadow.needsUpdate=true;scene.updateMatrixWorld(true);shadowMap.render([sun],scene,camera);
  assert.equal(target,null);return new Set(submitted);
 };
 const triangles=(items:T.Mesh[])=>items.reduce((total,mesh)=>total+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0);
 try {
  const fullShadow=shadowFrame();
  assert.equal(fullShadow.size,meshes.filter(mesh=>mesh.castShadow).length,'the fixture light encloses the entire house');
  details.setHidden(true);
  const hidden=meshes.filter(mesh=>!mesh.visible),visible:T.Mesh[]=[];
  house.traverseVisible(object=>{if(object instanceof T.Mesh)visible.push(object);});
  assert.equal(hidden.length,29);
  assert.ok(triangles(hidden)>400000,'the expensive furnishings must actually be excluded');
  assert.ok(visible.some(mesh=>mesh.name==='Props__Kitchen_worn_handmade_hearth_brick'),'the chimney shares the hearth brick batch');
  for(const {mesh,geometry,material} of snapshots){
   assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);
   if(mesh.name.startsWith('Architecture__')||/Props__(Owner_broom_|Owner_festive_|Owner_happiness_|Reference_|Memory_)/.test(mesh.name))assert.equal(mesh.visible,true,mesh.name);
  }
  const lightShadow=shadowFrame();
  assert.equal(lightShadow.size,fullShadow.size-hidden.filter(mesh=>mesh.castShadow).length);
  for(const mesh of hidden)assert.equal(lightShadow.has(mesh),false,mesh.name);
  for(const mesh of visible)assert.equal(lightShadow.has(mesh),mesh.castShadow,mesh.name);
  context.diagnostic(JSON.stringify({totalTriangles:triangles(meshes),hiddenTriangles:triangles(hidden),remainingTriangles:triangles(visible),hiddenMeshes:hidden.length,
   fullShadowDraws:fullShadow.size,hiddenDetailShadowDraws:lightShadow.size,note:'Static geometry and CPU shadow submissions only, not FPS or GPU timings'}));
  details.setHidden(false);assert.deepEqual(shadowFrame(),fullShadow);
 } finally {
  for(const mesh of meshes){mesh.geometry.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.dispose();}
  sun.shadow.dispose();texture.dispose();
 }
});
