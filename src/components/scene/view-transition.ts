import * as T from 'three';
import type { FinishPhase, PhaseStatus } from '@/lib/performance';

const REVEAL_MS=220;
type Operation={kind:'capture'|'reveal';complete:()=>void;startedAt?:number;from:number;finish:FinishPhase;context:{view:string;place:string}};

/** One GPU snapshot of the last complete, displayed frame. Call render only
 * after the destination's normal rendering, including its postprocessing. */
export function createViewTransition(renderer:T.WebGLRenderer,timings?:Pick<typeof import('@/lib/performance'),'beginPhase'|'measurePhase'>) {
 const beginPhase=timings?.beginPhase??(()=>()=>{});
 const measurePhase:typeof import('@/lib/performance').measurePhase=timings?.measurePhase??((_name,run)=>run());
 const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,0,1);
 const geometry=new T.PlaneGeometry(2,2);
 const material=new T.ShaderMaterial({
  name:'ViewTransition',
  uniforms:{previousFrame:{value:null as T.FramebufferTexture|null},opacity:{value:0}},
  vertexShader:`varying vec2 vUv;
   void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
  // The framebuffer has already been tone mapped and output encoded. Sample
  // its bytes unchanged: neither a texture color space nor an output chunk.
  fragmentShader:`uniform sampler2D previousFrame;uniform float opacity;varying vec2 vUv;
   void main(){gl_FragColor=vec4(texture2D(previousFrame,vUv).rgb,opacity);}`,
  transparent:true,depthTest:false,depthWrite:false,toneMapped:false,
 });
 const quad=new T.Mesh(geometry,material);quad.frustumCulled=false;scene.add(quad);
 const bufferSize=new T.Vector2(),logicalSize=new T.Vector2();
 const savedViewport=new T.Vector4(),savedScissor=new T.Vector4();
 let snapshot:T.FramebufferTexture|undefined,operation:Operation|undefined;
 let alpha=0,hasSnapshot=false,disposed=false,disabled=false,released=false,visualRevision=0;
 let preparing:Promise<void>|undefined,preparationPending=false;
 let context={view:'walk',place:'courtyard'};

 function clear(status:PhaseStatus='cancelled') {
  if(hasSnapshot||alpha!==0)visualRevision++;
  operation?.finish(status);operation=undefined;alpha=0;hasSnapshot=false;
 }
 function allocate() {
  renderer.getDrawingBufferSize(bufferSize);
  if(snapshot&&snapshot.image.width===bufferSize.x&&snapshot.image.height===bufferSize.y)return false;
  measurePhase('view.snapshot-allocation',()=>{
   snapshot?.dispose();
   snapshot=new T.FramebufferTexture(Math.max(1,bufferSize.x),Math.max(1,bufferSize.y));
   snapshot.name='ViewTransitionSnapshot';
   // NoColorSpace keeps copied output bytes raw; an sRGB texture would decode
   // them again and visibly darken the frozen image.
   snapshot.colorSpace=T.NoColorSpace;
   material.uniforms.previousFrame.value=snapshot;
   renderer.initTexture(snapshot);
  },{width:bufferSize.x,height:bufferSize.y});
  return true;
 }
 function onOutput(draw:()=>void) {
  const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),level=renderer.getActiveMipmapLevel();
  const autoClear=renderer.autoClear,scissorTest=renderer.getScissorTest();
  renderer.getViewport(savedViewport);renderer.getScissor(savedScissor);renderer.getSize(logicalSize);
  try {
   renderer.setRenderTarget(null);renderer.setViewport(0,0,logicalSize.x,logicalSize.y);
   renderer.setScissorTest(false);renderer.autoClear=false;draw();
  } finally {
   renderer.autoClear=autoClear;
   renderer.setViewport(savedViewport);renderer.setScissor(savedScissor);renderer.setScissorTest(scissorTest);
   // Restore the target last: it restores an offscreen target's own physical
   // viewport, rather than replacing it with the canvas's logical viewport.
   renderer.setRenderTarget(target,face,level);
  }
 }
 function drawSnapshot(opacity:number) {
  material.uniforms.opacity.value=opacity;renderer.render(scene,camera);
 }
 function release() {
  if(released)return;
  released=true;snapshot?.dispose();snapshot=undefined;
  material.dispose();geometry.dispose();scene.clear();
 }
 function disable() {
  disabled=true;
  const current=operation;clear('error');
  if(!preparationPending)release();
  current?.complete();
 }
 function prepare():Promise<void> {
  if(disposed||disabled)return Promise.resolve();
  if(preparing)return preparing;
  preparationPending=true;
  preparing=(async()=>{
   const finish=beginPhase('view.snapshot-prepare');
   let finishCompile:FinishPhase|undefined;
   try {
    allocate();
    let compilation:Promise<T.Object3D>|undefined;
    finishCompile=beginPhase('view.snapshot-shader-compile');
    onOutput(()=>{compilation=renderer.compileAsync(scene,camera);});
    await compilation;
    finishCompile(disposed?'cancelled':'success');
    // Drivers can defer work until a draw. Warm the exact output variant at
    // zero opacity under the loading UI, without capturing or redrawing scenery.
    if(!disposed&&!disabled)measurePhase('view.snapshot-warmup-submit',()=>onOutput(()=>drawSnapshot(0)));
    finish(disposed?'cancelled':disabled?'error':'success');
   } catch {
    const status=disposed?'cancelled':'error';finishCompile?.(status);finish(status);
    // The scenery remains usable if this optional effect cannot allocate or
    // compile. Keep navigation immediate instead of failing the whole loader.
    disable();
   } finally {
    preparationPending=false;if(disposed||disabled)release();
   }
  })();
  return preparing;
 }
 function schedule(kind:Operation['kind'],complete:()=>void) {
  if(disposed)return()=>{};
  const finish=beginPhase(`view.${kind}`,context);
  if(disabled||(kind==='reveal'&&!hasSnapshot)){finish('skipped',{reason:disabled?'effect-disabled':'no-snapshot'});complete();return()=>{};}
  // Replacing/cancelling an operation freezes the last displayed alpha. The
  // next capture therefore includes the real blend, without rewinding it.
  operation?.finish('superseded');
  const next:Operation={kind,complete,from:alpha,finish,context:{...context}};operation=next;
  return()=>{if(operation===next){next.finish('cancelled');operation=undefined;}};
 }
 function render(now:number) {
  if(disposed||disabled||(!hasSnapshot&&!operation))return;
  const current=operation;
  if(current?.kind==='reveal') {
   if(current.startedAt===undefined) {
    // The regular scene/composer render immediately precedes this callback.
    // This is a CPU-submitted boundary, not GPU completion or presentation.
    beginPhase('view.target-frame-submitted',{...current.context,boundary:'cpu-submitted'})();
    current.startedAt=now;
   }
   const progress=T.MathUtils.clamp((now-current.startedAt)/REVEAL_MS,0,1);
   alpha=current.from*(1-progress*progress*(3-2*progress));
  }
  try {
   onOutput(()=>{
    if(hasSnapshot&&alpha>0)drawSnapshot(alpha);
    if(current?.kind==='capture') {
     if(!snapshot)allocate();
     // This runs after drawing any in-progress blend. GPU command ordering
     // permits reusing the same texture once its preceding draw has finished.
     renderer.copyFramebufferToTexture(snapshot!);
    }
   });
  } catch {
   // A snapshot is optional. Fall back to an immediate handoff if the GPU
   // cannot copy/draw it, after onOutput has restored the renderer. Completing
   // the operation also releases the outer scheduler's pending destination.
   clear('error');current?.complete();return;
  }
  if(current?.kind==='capture') {
   current.finish();
   hasSnapshot=true;alpha=1;operation=undefined;
   // A callback may synchronously commit a camera and request reveal. Leave
   // that request for the next render, after the new camera was actually drawn.
   current.complete();return;
  }
  if(current?.kind==='reveal'&&alpha===0) {
   clear('success');current.complete();
  }
 }
 return {
  get needsRender(){return !disposed&&!disabled&&!!operation;},
  get visualRevision(){return visualRevision;},
  prepare,
  setContext(value:{view:string;place:string}) {context={...value};},
  capture:(complete:()=>void)=>schedule('capture',complete),
  reveal:(complete:()=>void)=>schedule('reveal',complete),
  render,clear,
  resize() {
   if(disposed||disabled)return;
   renderer.getDrawingBufferSize(bufferSize);
   if(snapshot?.image.width===bufferSize.x&&snapshot.image.height===bufferSize.y)return;
   if(!snapshot&&!operation)return;
   const current=operation;
   // Safari's collapsing address bar can change the drawing-buffer height
   // several times during one scroll. An invalid old snapshot is unusable;
   // release it now and allocate once, only when another capture needs it.
   snapshot?.dispose();snapshot=undefined;material.uniforms.previousFrame.value=null;
   clear();
   // Finish the handoff immediately after a size change. Discarding only the
   // callback would strand the outer latest-destination scheduler in "cover".
   current?.complete();
  },
  dispose() {
   if(disposed)return;
   disposed=true;clear();if(!preparationPending)release();
  },
 };
}
