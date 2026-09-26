import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as T from 'three';

// Run the actual Three composer and passes, with a renderer that records the
// attachments they draw into. Node 22.13 needs parameter properties transformed.
const source=new URL('../src/components/scene/interior-contact.ts',import.meta.url);
const transformed=stripTypeScriptTypes(readFileSync(source,'utf8'),{mode:'transform',sourceUrl:source.href})
 .replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier:string)=>{
  const url=specifier.startsWith('.')?new URL(specifier+'.ts',source).href:import.meta.resolve(specifier);
  return `from ${JSON.stringify(url)}`;
 });
const {createInteriorContact}:typeof import('../src/components/scene/interior-contact')=
 await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`);

class Renderer {
 autoClear=true;autoClearColor=true;autoClearDepth=true;autoClearStencil=true;
 toneMapping=T.ACESFilmicToneMapping;toneMappingExposure=.98;outputColorSpace=T.SRGBColorSpace;
 size=new T.Vector2(402,758);ratio=2;target:T.WebGLRenderTarget|null=null;
 color=new T.Color();alpha=1;
 targets=new Set<T.WebGLRenderTarget>();resident=new Set<T.WebGLRenderTarget>();
 disposals=new Map<T.WebGLRenderTarget,number>();
 materials=new Set<T.Material>();disposedMaterials=new Set<T.Material>();
 allocations:{target:T.WebGLRenderTarget;width:number;height:number}[]=[];
 draws:{target:T.WebGLRenderTarget|null;object:T.Object3D;material:T.Material|undefined;width:number;height:number}[]=[];
 compilation:Promise<void>|undefined;
 getSize(out:T.Vector2){return out.copy(this.size);}
 getPixelRatio(){return this.ratio;}
 getRenderTarget(){return this.target;}
 getClearColor(out:T.Color){return out.copy(this.color);}
 getClearAlpha(){return this.alpha;}
 setClearColor(value:T.ColorRepresentation){this.color.set(value);}
 setClearAlpha(value:number){this.alpha=value;}
 clear(){}
 compileAsync(){return this.compilation??Promise.resolve();}
 initRenderTarget(target:T.WebGLRenderTarget){
  if(!this.targets.has(target)){
   this.targets.add(target);this.disposals.set(target,0);
   target.addEventListener('dispose',()=>{this.resident.delete(target);this.disposals.set(target,this.disposals.get(target)!+1);});
  }
  if(this.resident.has(target))return;
  this.resident.add(target);this.allocations.push({target,width:target.width,height:target.height});
 }
 setRenderTarget(target:T.WebGLRenderTarget|null){this.target=target;if(target)this.initRenderTarget(target);}
 render(object:T.Object3D){
  const material=object instanceof T.Scene?object.overrideMaterial:object instanceof T.Mesh&&!Array.isArray(object.material)?object.material:undefined;
  if(material&&!this.materials.has(material)){
   this.materials.add(material);material.addEventListener('dispose',()=>this.disposedMaterials.add(material));
  }
  this.draws.push({target:this.target,object,material:material??undefined,width:this.target?.width??0,height:this.target?.height??0});
 }
}

function setup(mobile=true){
 const renderer=new Renderer(),scene=new T.Scene(),camera=new T.PerspectiveCamera();
 const contact=createInteriorContact(renderer as unknown as T.WebGLRenderer,scene,camera,new T.Group(),mobile);
 return {renderer,scene,camera,contact};
}

await test('indoor beauty keeps MSAA while fullscreen targets remain single-sample across consecutive frames',()=>{
 for(const mobile of [true,false]){
  const {renderer,scene,camera,contact}=setup(mobile);
  try {
   for(let frame=0;frame<5;frame++){
    camera.rotateY(.01);contact.render(1/60);assert.equal(renderer.target,null);
   }
   const beauties=renderer.draws.filter(draw=>draw.object===scene);
   const composites=renderer.draws.filter(draw=>draw.material?.name==='CachedInteriorContact');
   assert.equal(beauties.length,5);assert.equal(composites.length,5);
   const beauty=beauties[0].target!,composite=composites[0].target!;
   assert.notEqual(beauty,composite);
   assert.ok(beauties.every(draw=>draw.target===beauty),'the scene never lands in the fullscreen-only target after a swap');
   assert.ok(composites.every(draw=>draw.target===composite));
   assert.equal(beauty.samples,mobile?2:4);assert.equal(beauty.depthBuffer,true);
   assert.equal(beauty.resolveDepthBuffer,false,'no later pass samples the beauty depth');
   assert.equal(composite.samples,0);assert.equal(composite.depthBuffer,false);
   for(const target of [beauty,composite]){
    assert.equal(target.texture.type,T.HalfFloatType);assert.equal(target.width,804);assert.equal(target.height,1516);
   }
   const normals=renderer.draws.filter(draw=>draw.material instanceof T.MeshNormalMaterial);
   assert.ok(normals.some(draw=>draw.width===402&&draw.height===758),'full detail retains half-resolution contact normals');
   assert.ok(normals.some(draw=>draw.width===201&&draw.height===379),'movement retains its original quarter-resolution contact normals');
   for(const draw of normals){assert.equal(draw.target!.depthBuffer,true);assert.ok(draw.target!.depthTexture);}
   for(const target of renderer.targets){
    if(target!==beauty&&target!==composite&&!target.depthTexture)assert.equal(target.depthBuffer,false,'AO and denoise never allocate an unused depth attachment');
   }
  } finally {contact.dispose();}
 }
});

await test('leaving a mobile room releases only target storage and reentry redraws full detail',async()=>{
 const {renderer,camera,contact}=setup();
 try {
  await contact.prepare();
  assert.equal(renderer.targets.size,8);assert.equal(renderer.resident.size,8);
  const targets=[...renderer.targets],materials=[...renderer.materials];
  contact.deactivate();assert.equal(renderer.resident.size,0);
  assert.ok(targets.every(target=>renderer.disposals.get(target)===1));
  assert.equal(renderer.disposedMaterials.size,0,'eviction keeps compiled materials alive');
  contact.deactivate();assert.ok(targets.every(target=>renderer.disposals.get(target)===1),'idle outdoor frames do not repeatedly dispose');

  renderer.draws.length=0;camera.position.x=6;contact.render(1/60);
  assert.equal(renderer.targets.size,8,'reentry reuses target objects instead of rebuilding the pipeline');
  assert.ok(materials.every(material=>renderer.materials.has(material)));assert.equal(renderer.disposedMaterials.size,0);
  const normals=renderer.draws.filter(draw=>draw.material instanceof T.MeshNormalMaterial);
  assert.equal(normals.length,1);assert.deepEqual([normals[0].width,normals[0].height],[402,758]);
  const composite=renderer.draws.find(draw=>draw.material?.name==='CachedInteriorContact')!.material as T.ShaderMaterial;
  assert.equal(composite.uniforms.tContact.value,composite.uniforms.tRefined.value);
  assert.equal(composite.uniforms.refinement.value,0,'a released or previous-room AO image is never sampled');
  assert.equal(renderer.target,null);
 } finally {contact.dispose();}
});

await test('desktop keeps its prepared targets and mobile deactivation waits for pending preparation',async()=>{
 const desktop=setup(false);
 try {
  await desktop.contact.prepare();desktop.contact.deactivate();
  assert.equal(desktop.renderer.resident.size,8);assert.ok([...desktop.renderer.disposals.values()].every(count=>count===0));
 } finally {desktop.contact.dispose();}
 const {renderer,contact}=setup();
 let finish!:()=>void;renderer.compilation=new Promise<void>(resolve=>{finish=resolve;});
 try {
  const preparing=contact.prepare();contact.deactivate();
  assert.equal(renderer.resident.size,8,'do not release attachments while preparation is pending');
  finish();await preparing;
  assert.equal(renderer.resident.size,0);assert.equal(renderer.draws.length,0,'skip a deferred warmup after leaving the room');
  assert.equal(renderer.disposedMaterials.size,0);
  contact.render();assert.ok(renderer.resident.size>0);
 } finally {contact.dispose();}
});

await test('resize updates physical dimensions once and leaves inactive targets unallocated until reentry',async()=>{
 const {renderer,contact}=setup();
 try {
  await contact.prepare();const initialAllocations=renderer.allocations.length;
  contact.resize();assert.ok([...renderer.disposals.values()].every(count=>count===0));
  assert.equal(renderer.allocations.length,initialAllocations);
  renderer.ratio=1.5;renderer.size.set(420,800);contact.resize();
  assert.ok([...renderer.disposals.values()].every(count=>count===1),'one real change causes one invalidation per target');
  assert.equal(renderer.allocations.length,initialAllocations,'resizing does not eagerly reallocate targets');
  contact.render();
  const sizes=renderer.allocations.slice(initialAllocations).map(({width,height})=>[width,height]);
  assert.ok(sizes.some(([width,height])=>width===630&&height===1200));
  assert.ok(sizes.some(([width,height])=>width===315&&height===600));
  assert.ok(sizes.every(([width,height])=>(width===630&&height===1200)||(width===315&&height===600)),'no allocation uses the old viewport with a new DPR');

  contact.deactivate();const allocationCount=renderer.allocations.length;
  renderer.ratio=2;renderer.size.set(402,758);contact.resize();
  assert.equal(renderer.resident.size,0);assert.equal(renderer.allocations.length,allocationCount);
  contact.render();
  assert.ok(renderer.allocations.slice(allocationCount).some(({width,height})=>width===804&&height===1516));
  assert.ok(renderer.allocations.slice(allocationCount).some(({width,height})=>width===402&&height===758));
 } finally {contact.dispose();}
});
