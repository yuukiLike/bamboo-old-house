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

await test('a destination jump draws full detail on its first frame and cancels the prior refinement',context=>{
 let now=1,target:T.WebGLRenderTarget|null=null,alpha=1;
 context.mock.method(performance,'now',()=>now*1000);
 const clearColor=new T.Color();
 const frames:{contact:T.Texture;refined:T.Texture;refinement:number}[]=[];
 const normals:{width:number;x:number}[]=[];
 const renderer={
  autoClear:true,autoClearColor:true,autoClearDepth:true,autoClearStencil:true,
  toneMapping:T.ACESFilmicToneMapping,toneMappingExposure:.98,outputColorSpace:T.SRGBColorSpace,
  getSize:(size:T.Vector2)=>size.set(800,600),getPixelRatio:()=>1.6,
  getRenderTarget:()=>target,setRenderTarget:(value:T.WebGLRenderTarget|null)=>{target=value;},
  getClearColor:(value:T.Color)=>value.copy(clearColor),getClearAlpha:()=>alpha,
  setClearColor:(value:T.ColorRepresentation)=>clearColor.set(value),setClearAlpha:(value:number)=>{alpha=value;},
  clear:()=>{},
  render:(object:T.Object3D,view:T.Camera)=>{
   if(object instanceof T.Scene&&object.overrideMaterial instanceof T.MeshNormalMaterial&&target)
    normals.push({width:target.width,x:view.position.x});
   if(!(object instanceof T.Mesh)||!(object.material instanceof T.ShaderMaterial)||object.material.name!=='CachedInteriorContact')return;
   const uniforms=object.material.uniforms;
   frames.push({contact:uniforms.tContact.value,refined:uniforms.tRefined.value,refinement:uniforms.refinement.value});
  },
 };
 const camera=new T.PerspectiveCamera(),contact=createInteriorContact(renderer as unknown as T.WebGLRenderer,new T.Scene(),camera,new T.Group(),false);
 const render=()=>{contact.render(1/60);assert.equal(target,null);return frames.at(-1)!;};
 try {
  const initial=render();assert.equal(initial.contact,initial.refined);
  now=1.016;camera.rotateY(.1);
  const moving=render();assert.notEqual(moving.contact,moving.refined);
  now=1.15;render();now=1.20;
  assert.ok(render().refinement>0,'start a real motion-to-detail refinement in the old room');

  now=1.22;camera.position.x=5;contact.resetForViewChange();const beforeArrival=normals.length;
  const arrived=render();
  assert.equal(normals.length,beforeArrival+1,'recompute contact for the destination instead of sampling the old detail map');
  assert.deepEqual(normals.at(-1),{width:640,x:5});
  assert.equal(arrived.contact,arrived.refined,'the first destination frame already samples full detail');
  assert.equal(arrived.refinement,0,'the old room cannot contribute a refinement tail');
  for(const time of [1.25,1.35,1.5]) {
   now=time;const still=render();assert.equal(still.contact,arrived.contact);assert.equal(still.refinement,0);
  }
  now=1.52;camera.rotateY(.1);
  const panning=render();assert.notEqual(panning.contact,panning.refined,'continuous input retains the cheaper aligned contact pass');

  // Returning from an outdoor view can leave a stale motion cache for a long
  // time without any interior render. It still needs full detail immediately.
  now=9;camera.position.x=-3;contact.resetForViewChange();
  const returned=render();assert.equal(returned.contact,returned.refined);assert.equal(returned.refinement,0);
  assert.deepEqual(normals.at(-1),{width:640,x:-3});
 } finally {contact.dispose();}
});
