import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as T from 'three';

const source=new URL('../src/components/scene/interior-contact.ts',import.meta.url);
// Exercise the real pipeline without adding test exports. Transform its
// constructor parameter property and resolve imports for Node 22.13 as well
// as newer runtimes; module loader hooks require a newer Node release.
const transformed=stripTypeScriptTypes(readFileSync(source,'utf8'),{mode:'transform',sourceUrl:source.href})
 .replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier:string)=>{
  const url=specifier.startsWith('.')?new URL(specifier+'.ts',source).href:import.meta.resolve(specifier);
  return `from ${JSON.stringify(url)}`;
 });
const {createInteriorContact}:typeof import('../src/components/scene/interior-contact')=
 await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`);

await test('contact refinement uses the live render target and survives pending preparation cleanup',async()=>{
 const materials=new Set<T.Material>(),targets:T.WebGLRenderTarget[]=[];
 let finishCompilation=()=>{},released=0,currentTarget:T.WebGLRenderTarget|null=null;
 const compilation=new Promise<void>(resolve=>{finishCompilation=resolve;});
 const renderer={
  getSize:(size:T.Vector2)=>size.set(800,600),
  getPixelRatio:()=>1.6,
  getRenderTarget:()=>currentTarget,
  setRenderTarget:(target:T.WebGLRenderTarget|null)=>{currentTarget=target;},
  initRenderTarget:(target:T.WebGLRenderTarget)=>{targets.push(target);target.addEventListener('dispose',()=>released++);},
  compileAsync:(scene:T.Scene)=>{
   scene.traverse(object=>{if(object instanceof T.Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);});
   return compilation;
  },
 };
 const contact=createInteriorContact(renderer as unknown as T.WebGLRenderer,new T.Scene(),new T.PerspectiveCamera(),new T.Group(),false);
 const pending=contact.prepare();
 try {
  const blend=[...materials].find(material=>material.name==='CachedInteriorContact') as T.ShaderMaterial|undefined;
  assert.ok(blend,'preparation must compile the actual ShaderPass material');
  const detailMap=targets[4].texture;
  assert.equal(detailMap.isRenderTargetTexture,true);
  assert.equal(blend.uniforms.tRefined.value,detailMap,'ShaderPass must not clone or null out the refinement render target');
  assert.equal(blend.uniforms.tContact.value,detailMap);
  assert.equal(currentTarget,null,'preparation restores the caller render target before yielding');
  contact.dispose();
  assert.equal(released,0,'compilation retains its render targets until it settles');
 } finally {
  contact.dispose();finishCompilation();await pending;
 }
 assert.equal(released,targets.length,'both contact resolutions and composer targets are released once');
});
