import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as T from 'three';
const {createViewTransition}:typeof import('../src/components/scene/view-transition')=
 await import(new URL('../src/components/scene/view-transition.ts',import.meta.url).href);
const {createSceneTransition}:typeof import('../src/components/scene-transition')=
 await import(new URL('../src/components/scene-transition.ts',import.meta.url).href);

/** Model only output pixels and renderer state, not animation scheduling. This
 * makes copying the wrong framebuffer or rewinding a blend observable. */
class Renderer {
 autoClear=true;
 size=new T.Vector2(800,500);
 ratio=1.6;
 viewport=new T.Vector4(3,4,700,400);
 scissor=new T.Vector4(5,6,650,350);
 scissorTest=true;
 target:T.WebGLRenderTarget|null=null;
 face=0;level=0;
 activeViewport=this.viewport.clone().multiplyScalar(this.ratio);
 framebuffer=.2;
 textures=new Map<T.Texture,number>();
 draws=0;copies=0;compiles=0;
 material:T.ShaderMaterial|undefined;
 compilation:Promise<T.Object3D>|undefined;
 failDraw=false;failCopy=false;
 getDrawingBufferSize(out:T.Vector2){return out.copy(this.size).multiplyScalar(this.ratio).floor();}
 getSize(out:T.Vector2){return out.copy(this.size);}
 getViewport(out:T.Vector4){return out.copy(this.viewport);}
 getScissor(out:T.Vector4){return out.copy(this.scissor);}
 getScissorTest(){return this.scissorTest;}
 getRenderTarget(){return this.target;}
 getActiveCubeFace(){return this.face;}
 getActiveMipmapLevel(){return this.level;}
 setViewport(value:T.Vector4|number,y=0,width=0,height=0){
  if(value instanceof T.Vector4)this.viewport.copy(value);else this.viewport.set(value,y,width,height);
  this.activeViewport.copy(this.viewport).multiplyScalar(this.ratio);
 }
 setScissor(value:T.Vector4){this.scissor.copy(value);}
 setScissorTest(value:boolean){this.scissorTest=value;}
 setRenderTarget(target:T.WebGLRenderTarget|null,face=0,level=0){
  this.target=target;this.face=face;this.level=level;
  if(target)this.activeViewport.copy(target.viewport);
  else this.activeViewport.copy(this.viewport).multiplyScalar(this.ratio);
 }
 initTexture(texture:T.Texture){
  this.textures.set(texture,0);
 }
 compileAsync(scene:T.Object3D){this.compiles++;return this.compilation??Promise.resolve(scene);}
 render(scene:T.Scene){
  assert.equal(this.target,null);assert.equal(this.autoClear,false);assert.equal(this.scissorTest,false);
  const mesh=scene.children[0] as T.Mesh<T.BufferGeometry,T.ShaderMaterial>;
  this.material=mesh.material;this.draws++;
  if(this.failDraw)throw Error('draw failed');
  const opacity=mesh.material.uniforms.opacity.value as number;
  const texture=mesh.material.uniforms.previousFrame.value as T.Texture;
  this.framebuffer=(this.textures.get(texture)??0)*opacity+this.framebuffer*(1-opacity);
 }
 copyFramebufferToTexture(texture:T.Texture){
  assert.equal(this.target,null);this.copies++;
  if(this.failCopy)throw Error('copy failed');
  this.textures.set(texture,this.framebuffer);
 }
 state(){return {autoClear:this.autoClear,target:this.target,face:this.face,level:this.level,
  viewport:this.viewport.toArray(),activeViewport:this.activeViewport.toArray(),scissor:this.scissor.toArray(),scissorTest:this.scissorTest};}
}
function setup(){
 const renderer=new Renderer(),transition=createViewTransition(renderer as unknown as T.WebGLRenderer);
 const frame=(color:number,time:number)=>{renderer.framebuffer=color;transition.render(time);return renderer.framebuffer;};
 return {renderer,transition,frame};
}
function close(actual:number,expected:number){assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);}

await test('rapid navigation waits for a complete frame and fades only to the latest destination',()=>{
 const {renderer,transition,frame}=setup(),navigation=createSceneTransition(()=>transition);
 const applied:string[]=[];
 navigation.request(()=>applied.push('hall'));
 navigation.request(()=>applied.push('kitchen'));
 assert.deepEqual(applied,[]);
 close(frame(.8,0),.8);
 assert.deepEqual(applied,['kitchen']);
 // A long pause before the destination renders must not skip its first fade frame.
 close(frame(.2,10_000),.8);
 close(frame(.2,10_110),.5);
 close(frame(.2,10_220),.2);
 const draws=renderer.draws;
 frame(.3,20_000);
 assert.equal(renderer.draws,draws);
 navigation.dispose();transition.dispose();
});

await test('redirecting mid-fade starts from the displayed blend without flashing backwards',()=>{
 const {transition,frame}=setup(),navigation=createSceneTransition(()=>transition);
 const applied:string[]=[];
 navigation.request(()=>applied.push('hall'));frame(.8,0);
 frame(.2,10);close(frame(.2,120),.5);
 navigation.request(()=>applied.push('well'));
 navigation.request(()=>applied.push('porch'));
 close(frame(.2,200),.5);
 close(frame(.1,210),.5);
 close(frame(.1,320),.3);
 close(frame(.1,430),.1);
 assert.deepEqual(applied,['hall','porch']);
 navigation.dispose();transition.dispose();
});

await test('resizing during navigation clears the old image and leaves later navigation usable',()=>{
 const {renderer,transition,frame}=setup(),navigation=createSceneTransition(()=>transition);
 const applied:string[]=[];
 navigation.request(()=>applied.push('hall'));frame(.8,0);frame(.2,10);
 renderer.size.set(400,700);transition.resize();
 close(frame(.2,120),.2);
 navigation.request(()=>applied.push('well'));
 renderer.ratio=1;transition.resize();
 assert.deepEqual(applied,['hall','well']);
 assert.equal(navigation.covering,false);
 navigation.request(()=>applied.push('porch'));frame(.2,130);
 assert.deepEqual(applied,['hall','well','porch']);
 navigation.dispose();transition.dispose();
});

await test('backgrounding and reduced motion finish immediately; unmount discards pending navigation',()=>{
 const {renderer,transition,frame}=setup(),navigation=createSceneTransition(()=>transition);
 const applied:string[]=[];
 navigation.request(()=>applied.push('hall'));
 navigation.request(()=>applied.push('well'));navigation.finish();
 assert.deepEqual(applied,['well']);
 close(frame(.2,0),.2);assert.equal(renderer.copies,0);
 navigation.request(()=>applied.push('porch'),false);
 assert.deepEqual(applied,['well','porch']);
 navigation.request(()=>applied.push('kitchen'));
 navigation.dispose();transition.dispose();frame(.2,10);
 assert.deepEqual(applied,['well','porch']);
});

for(const failure of ['copy','draw'])await test(`a GPU ${failure} failure restores renderer state and keeps navigation usable`,()=>{
 const {renderer,transition,frame}=setup(),navigation=createSceneTransition(()=>transition);
 const target=new T.WebGLRenderTarget(99,77),applied:string[]=[];
 target.viewport.set(1,2,90,70);renderer.setRenderTarget(target,3,2);
 const initial=renderer.state();
 renderer.failCopy=failure==='copy';renderer.failDraw=failure==='draw';
 navigation.request(()=>applied.push('hall'));
 assert.doesNotThrow(()=>{frame(.8,0);frame(.2,10);});
 assert.deepEqual(renderer.state(),initial);
 assert.deepEqual(applied,['hall']);assert.equal(navigation.covering,false);
 renderer.failCopy=false;renderer.failDraw=false;
 navigation.request(()=>applied.push('well'));frame(.2,20);
 close(frame(.1,30),.2);close(frame(.1,250),.1);
 assert.deepEqual(applied,['hall','well']);
 navigation.dispose();transition.dispose();target.dispose();
});

await test('shader preparation preserves displayed pixels and runs only once',async()=>{
 const {renderer,transition}=setup(),initial=renderer.state();
 await transition.prepare();await transition.prepare();
 close(renderer.framebuffer,.2);assert.deepEqual(renderer.state(),initial);
 assert.equal(renderer.compiles,1);assert.equal(renderer.draws,1);
 assert.equal(renderer.material?.toneMapped,false);
 assert.equal([...renderer.textures.keys()][0].colorSpace,T.NoColorSpace);
 transition.dispose();
});

await test('an unavailable transition shader falls back to immediate navigation',async()=>{
 const {renderer,transition,frame}=setup(),navigation=createSceneTransition(()=>transition);
 renderer.compilation=Promise.reject(Error('compilation failed'));
 await assert.doesNotReject(transition.prepare());
 const applied:string[]=[];
 navigation.request(()=>applied.push('hall'));
 navigation.request(()=>applied.push('well'));
 assert.deepEqual(applied,['hall','well']);assert.equal(navigation.covering,false);
 close(frame(.4,100),.4);
 navigation.dispose();transition.dispose();
});

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

await test('a destination jump draws full detail on its first frame and cancels the prior refinement',context=>{
 let now=1,target:T.WebGLRenderTarget|null=null,alpha=1,pixelRatio=1.6;
 context.mock.method(performance,'now',()=>now*1000);
 const clearColor=new T.Color();
 const frames:{contact:T.Texture;refined:T.Texture;refinement:number}[]=[];
 const normals:{width:number;x:number}[]=[];
 const renderer={
  autoClear:true,autoClearColor:true,autoClearDepth:true,autoClearStencil:true,
  toneMapping:T.ACESFilmicToneMapping,toneMappingExposure:.98,outputColorSpace:T.SRGBColorSpace,
  getSize:(size:T.Vector2)=>size.set(800,600),getPixelRatio:()=>pixelRatio,
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

  // The shared renderer's explicit resolution setting must resize indoor
  // contact targets too, then restore the exact original target dimensions.
  for(const ratio of [1.6*.85,1.6]){
   pixelRatio=ratio;contact.resize();const count=normals.length;
   now+=.016;const resized=render();
   assert.equal(normals.length,count+1,'refresh contact immediately after a resolution change');
   assert.deepEqual(normals.at(-1),{width:Math.round(800*ratio*.5),x:-3});
   assert.equal(resized.contact,resized.refined,'never blend with an old-resolution contact map');
   assert.equal(resized.refinement,0);
  }
 } finally {contact.dispose();}
});
