import assert from 'node:assert/strict';
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
 draws=0;copies=0;compiles=0;allocations=0;disposedTextures=0;
 material:T.ShaderMaterial|undefined;
 geometry:T.BufferGeometry|undefined;
 compilation:Promise<T.Object3D>|undefined;
 failDraw=false;failCopy=false;failAllocate=false;
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
  this.allocations++;this.textures.set(texture,0);
  texture.addEventListener('dispose',()=>{this.disposedTextures++;});
  if(this.failAllocate)throw Error('allocation failed');
 }
 compileAsync(scene:T.Object3D){this.compiles++;return this.compilation??Promise.resolve(scene);}
 render(scene:T.Scene){
  assert.equal(this.target,null);assert.equal(this.autoClear,false);assert.equal(this.scissorTest,false);
  const mesh=scene.children[0] as T.Mesh<T.BufferGeometry,T.ShaderMaterial>;
  this.material=mesh.material;this.geometry=mesh.geometry;this.draws++;
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

await test('a destination is committed only after capture and revealed only after a newly rendered frame',()=>{
 const {renderer,transition,frame}=setup();let captured=0,revealed=0;
 transition.capture(()=>{captured++;transition.reveal(()=>{revealed++;});});
 assert.equal(captured,0);assert.equal(renderer.copies,0);
 close(frame(.8,0),.8);assert.equal(captured,1);assert.equal(renderer.copies,1);assert.equal(renderer.draws,0);
 // Even an arbitrarily stalled renderer cannot finish or expose the new view.
 assert.equal(revealed,0);
 close(frame(.2,10_000),.8);assert.equal(revealed,0);
 close(frame(.2,10_110),.5);assert.equal(revealed,0);
 close(frame(.2,10_220),.2);assert.equal(revealed,1);
 const draws=renderer.draws;frame(.3,20_000);assert.equal(renderer.draws,draws);
 transition.dispose();
});

await test('redirecting a half-finished reveal captures the displayed blend, never its older source',()=>{
 const {renderer,transition,frame}=setup();let oldComplete=0,newComplete=0;
 transition.capture(()=>{});frame(.8,0);
 const cancel=transition.reveal(()=>{oldComplete++;});
 frame(.2,10);close(frame(.2,120),.5);cancel();
 transition.capture(()=>{transition.reveal(()=>{newComplete++;});});
 // A later timestamp must not advance the cancelled fade before recapturing.
 close(frame(.2,200),.5);
 close(frame(.1,210),.5);close(frame(.1,320),.3);close(frame(.1,430),.1);
 assert.equal(oldComplete,0);assert.equal(newComplete,1);assert.equal(renderer.allocations,1);
 assert.equal(renderer.copies,2);transition.dispose();
});

await test('replaced and cancelled work cannot finish a newer handoff, and clear removes frozen frames',()=>{
 const {renderer,transition,frame}=setup();const completed:string[]=[];
 const staleCancel=transition.capture(()=>completed.push('stale'));
 transition.capture(()=>completed.push('latest'));staleCancel();frame(.6,0);
 assert.deepEqual(completed,['latest']);
 const cancelReveal=transition.reveal(()=>completed.push('reveal'));frame(.2,10);cancelReveal();
 close(frame(.2,10_000),.6);assert.deepEqual(completed,['latest']);
 transition.clear();const draws=renderer.draws;close(frame(.2,20_000),.2);assert.equal(renderer.draws,draws);
 const cancelCapture=transition.capture(()=>completed.push('cancelled'));cancelCapture();frame(.2,30_000);
 assert.equal(renderer.copies,1);
 transition.reveal(()=>completed.push('empty'));assert.deepEqual(completed,['latest','empty']);transition.dispose();
});

await test('resizing completes an active handoff without stretching or stranding pending navigation',()=>{
 const {renderer,transition,frame}=setup();let captured=0,revealed=0,disposedTextures=0;
 transition.capture(()=>{captured++;transition.reveal(()=>{revealed++;});});
 frame(.8,0);frame(.2,10);
 const oldTexture=[...renderer.textures.keys()][0];oldTexture.addEventListener('dispose',()=>{disposedTextures++;});
 transition.resize();assert.equal(revealed,0);assert.equal(renderer.allocations,1);
 renderer.size.set(400,700);transition.resize();
 assert.equal(captured,1);assert.equal(revealed,1);assert.equal(disposedTextures,1);
 const draws=renderer.draws;close(frame(.2,120),.2);assert.equal(renderer.draws,draws);
 transition.capture(()=>{captured++;transition.reveal(()=>{revealed++;});});
 renderer.ratio=1;transition.resize();assert.equal(captured,2);assert.equal(revealed,2);
 assert.equal(renderer.copies,1);assert.equal(renderer.allocations,3);
 transition.dispose();
});

await test('capture and overlay drawing restore canvas and offscreen renderer state, including failures',()=>{
 const {renderer,transition,frame}=setup();
 const target=new T.WebGLRenderTarget(99,77);target.viewport.set(1,2,90,70);
 renderer.setRenderTarget(target,3,2);const initial=renderer.state();
 transition.capture(()=>{assert.deepEqual(renderer.state(),initial);});frame(.8,0);
 assert.deepEqual(renderer.state(),initial);
 transition.reveal(()=>{});frame(.2,10);assert.deepEqual(renderer.state(),initial);
 renderer.failDraw=true;assert.doesNotThrow(()=>frame(.2,20));assert.deepEqual(renderer.state(),initial);
 renderer.failDraw=false;renderer.failCopy=true;transition.capture(()=>{});
 assert.doesNotThrow(()=>frame(.2,30));assert.deepEqual(renderer.state(),initial);
 renderer.failCopy=false;const draws=renderer.draws;frame(.2,40);assert.equal(renderer.draws,draws);
 transition.dispose();target.dispose();
});

await test('a failed GPU copy immediately settles the production scheduler and later choices still work',()=>{
 const {renderer,transition,frame}=setup(),navigation=createSceneTransition(()=>transition);
 const applied:string[]=[],initial=renderer.state();renderer.failCopy=true;
 navigation.request(()=>applied.push('hall'));navigation.request(()=>applied.push('kitchen'));
 assert.equal(navigation.covering,true);assert.doesNotThrow(()=>frame(.8,0));
 assert.deepEqual(applied,['kitchen']);assert.equal(navigation.covering,false);
 assert.deepEqual(renderer.state(),initial);
 renderer.failCopy=false;navigation.request(()=>applied.push('well'));
 assert.equal(navigation.covering,true);frame(.2,10);assert.deepEqual(applied,['kitchen','well']);
 close(frame(.1,20),.2);close(frame(.1,240),.1);
 navigation.request(()=>applied.push('porch'));frame(.1,250);
 assert.deepEqual(applied,['kitchen','well','porch']);navigation.dispose();transition.dispose();
});

await test('failed overlay drawing settles both reveal and redirected capture in the production scheduler',()=>{
 const {renderer,transition,frame}=setup(),navigation=createSceneTransition(()=>transition);
 const applied:string[]=[];
 navigation.request(()=>applied.push('hall'));frame(.8,0);
 renderer.failDraw=true;assert.doesNotThrow(()=>frame(.2,10));assert.equal(navigation.covering,false);
 renderer.failDraw=false;navigation.request(()=>applied.push('well'));frame(.2,20);frame(.1,30);
 navigation.request(()=>applied.push('porch'));assert.equal(navigation.covering,true);
 renderer.failDraw=true;assert.doesNotThrow(()=>frame(.1,40));
 assert.equal(navigation.covering,false);assert.deepEqual(applied,['hall','well','porch']);
 renderer.failDraw=false;navigation.request(()=>applied.push('walk'));frame(.3,50);
 close(frame(.4,60),.3);close(frame(.4,280),.4);
 assert.deepEqual(applied,['hall','well','porch','walk']);navigation.dispose();transition.dispose();
});

await test('preparation compiles and draws the raw output shader without changing displayed pixels',async()=>{
 const {renderer,transition,frame}=setup();const initial=renderer.state();
 const first=transition.prepare(),second=transition.prepare();assert.equal(first,second);await first;
 close(renderer.framebuffer,.2);assert.deepEqual(renderer.state(),initial);
 assert.equal(renderer.compiles,1);assert.equal(renderer.draws,1);assert.equal(renderer.copies,0);
 assert.equal(renderer.material?.toneMapped,false);assert.equal(renderer.material?.depthWrite,false);
 const texture=[...renderer.textures.keys()][0];assert.equal(texture.colorSpace,T.NoColorSpace);
 assert.equal(texture.generateMipmaps,false);
 transition.capture(()=>{});frame(.8,0);transition.clear();transition.capture(()=>{});frame(.6,10);
 await transition.prepare();assert.equal(renderer.compiles,1);assert.equal(renderer.allocations,1);
 transition.dispose();
});

for(const failure of ['allocation','compilation','warmup'] as const)await test(`failed ${failure} disables only the optional transition and keeps production navigation working`,async()=>{
 const {renderer,transition,frame}=setup(),navigation=createSceneTransition(()=>transition);
 const applied:string[]=[],initial=renderer.state();
 renderer.failAllocate=failure==='allocation';renderer.failDraw=failure==='warmup';
 if(failure==='compilation')renderer.compilation=Promise.reject(Error('compilation failed'));
 await assert.doesNotReject(transition.prepare());assert.deepEqual(renderer.state(),initial);
 assert.equal(renderer.disposedTextures,1);
 const allocations=renderer.allocations,draws=renderer.draws,compiles=renderer.compiles;
 navigation.request(()=>applied.push('hall'));navigation.request(()=>applied.push('well'));
 assert.deepEqual(applied,['hall','well']);assert.equal(navigation.covering,false);
 close(frame(.4,100),.4);renderer.size.set(400,700);transition.resize();await transition.prepare();
 assert.equal(renderer.allocations,allocations);assert.equal(renderer.draws,draws);assert.equal(renderer.compiles,compiles);
 assert.equal(renderer.copies,0);navigation.dispose();transition.dispose();assert.equal(renderer.disposedTextures,1);
});

await test('a resize allocation failure completes pending navigation and disables future GPU handoffs',async()=>{
 const {renderer,transition,frame}=setup(),navigation=createSceneTransition(()=>transition);
 const applied:string[]=[];await transition.prepare();
 navigation.request(()=>applied.push('hall'));assert.equal(navigation.covering,true);
 renderer.size.set(400,700);renderer.failAllocate=true;
 assert.doesNotThrow(()=>transition.resize());assert.deepEqual(applied,['hall']);assert.equal(navigation.covering,false);
 assert.equal(renderer.disposedTextures,2);
 const allocations=renderer.allocations,draws=renderer.draws;
 navigation.request(()=>applied.push('well'));assert.deepEqual(applied,['hall','well']);
 close(frame(.4,100),.4);transition.resize();await transition.prepare();
 assert.equal(renderer.allocations,allocations);assert.equal(renderer.draws,draws);assert.equal(renderer.copies,0);
 navigation.dispose();transition.dispose();assert.equal(renderer.disposedTextures,2);
});

await test('disposing during asynchronous preparation defers release safely and discards queued callbacks',async()=>{
 const {renderer,transition,frame}=setup();let finishCompile:(scene:T.Object3D)=>void=()=>{},completed=0,released=0;
 renderer.compilation=new Promise(resolve=>{finishCompile=resolve;});
 const pending=transition.prepare();const texture=[...renderer.textures.keys()][0];
 texture.addEventListener('dispose',()=>{released++;});
 transition.capture(()=>{completed++;});transition.dispose();transition.dispose();frame(.2,1);
 assert.equal(completed,0);assert.equal(released,0);assert.equal(renderer.draws,0);
 finishCompile(new T.Scene());await pending;
 assert.equal(released,1);assert.equal(renderer.draws,0);assert.equal(renderer.copies,0);
 await transition.prepare();assert.equal(renderer.compiles,1);transition.resize();assert.equal(renderer.allocations,1);
});

await test('a callback failure does not prevent an already-requested reveal or corrupt renderer state',()=>{
 const {renderer,transition,frame}=setup();const initial=renderer.state();let revealed=0;
 transition.capture(()=>{transition.reveal(()=>{revealed++;});throw Error('handoff failed');});
 assert.throws(()=>frame(.8,0),/handoff failed/);assert.deepEqual(renderer.state(),initial);
 close(frame(.2,10),.8);close(frame(.2,230),.2);assert.equal(revealed,1);transition.dispose();
});
