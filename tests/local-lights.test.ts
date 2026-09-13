import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'three';
const {excludeUnreachablePointLights}:typeof import('../src/components/scene/local-lights')=
 await import(new URL('../src/components/scene/local-lights.ts',import.meta.url).href);

await test('room light pruning considers hidden lamps, every instance and shared materials',()=>{
 const scene=new T.Scene(),lamp=new T.PointLight(0xffffff,0,4);lamp.visible=false;scene.add(lamp);
 const farMaterial=new T.MeshStandardMaterial(),nearMaterial=new T.MeshStandardMaterial();
 const plant=(material:T.Material,x:number)=>{const mesh=new T.InstancedMesh(new T.BoxGeometry(1,1,1),material,2);mesh.setMatrixAt(0,new T.Matrix4().makeTranslation(50,0,0));mesh.setMatrixAt(1,new T.Matrix4().makeTranslation(x,0,0));scene.add(mesh);return mesh;};
 const far=plant(farMaterial,40),sharedFar=plant(nearMaterial,40),near=plant(nearMaterial,2);
 excludeUnreachablePointLights(scene);
 assert.ok((far.material as T.Material).customProgramCacheKey().includes('no-reachable-room-lights'));
 assert.notEqual(sharedFar.material,near.material);assert.equal(near.material,nearMaterial);
 assert.ok(!nearMaterial.customProgramCacheKey().includes('no-reachable-room-lights'));
 const shader={vertexShader:'#include <shadowmap_pars_vertex>\n#include <shadowmap_vertex>',fragmentShader:'#include <lights_pars_begin>\n#include <lights_fragment_begin>',uniforms:{}} as T.WebGLProgramParametersWithUniforms;
 (far.material as T.Material).onBeforeCompile(shader,{} as T.WebGLRenderer);
 assert.ok(!/NUM_POINT_LIGHTS|NUM_POINT_LIGHT_SHADOWS/.test(shader.vertexShader+shader.fragmentShader));
 assert.ok(shader.fragmentShader.includes('NUM_DIR_LIGHTS'),'sunlight must be retained');
});

await test('unlimited lamps and potentially reachable wind envelopes retain lighting',()=>{
 for(const distance of [0,4]){
  const scene=new T.Scene();scene.add(new T.PointLight(0xffffff,1,distance));
  const material=new T.MeshStandardMaterial(),mesh=new T.InstancedMesh(new T.BoxGeometry(.2,14,.2),material,1);
  mesh.name='Stalk_edge';mesh.setMatrixAt(0,new T.Matrix4().makeTranslation(6,0,0));scene.add(mesh);
  excludeUnreachablePointLights(scene);assert.equal(mesh.material,material);
 }
});
