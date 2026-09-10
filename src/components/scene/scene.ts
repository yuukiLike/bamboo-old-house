import * as T from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addEnvironment } from './environment';
import { addUnderstoryAssets, addBackgroundFoliage } from './understory';
import { addBamboo, addPorchBamboo } from './bamboo';
import { addDryFuel } from './dry-fuel';
import { addForestFloor } from './forest-floor';
import { addForestRemains } from './forest-remains';
import { addWoodlandFinish } from './woodland-finish';
import { forestWindGust } from './wind';
import { createVegetationVisibility } from './vegetation-visibility';
import { ViewControls } from './view-controls';
import { createInteriorContact } from './interior-contact';
import { shadeWindowRecesses } from './window-light';
import { BUILD_ID, PORCH_VIEW, ROOM_VIEWS, DETAIL_VIEWS, groundHeight, pathClearance, treePositions, cameraProgress, positionPath, targetPath, type ViewMode, type TimeOfDay, type RoomId, type DetailId } from './config';
export interface SceneHandle { dispose:()=>void;setPaused:(value:boolean)=>void;reset:()=>void;setView:(view:ViewMode)=>void;setTimeOfDay:(value:TimeOfDay)=>void;setPanorama:(value:boolean)=>void;setRoom:(value:RoomId)=>void;setDetail:(value:DetailId)=>void; }
interface Hooks {onProgress:(state:string,value:number|null)=>void;onFailure:()=>void;onPanorama:(value:boolean)=>void;onBearing:(value:number)=>void;}
interface Diagnostics {windGust:number;build:string;quality:string;gpu:string;viewport:number[];drawSize:number[];progress:number;camera:number[];target:number[];drawCalls:number;triangles:number;textures:number;geometries:number;frames:number[];windTime:number;paused:boolean;bambooCount:number;viewMode:ViewMode;room:RoomId;timeOfDay:TimeOfDay;nightMix:number;noonMix:number;panorama:boolean;yaw:number;pitch:number;fov:number;getPoster:()=>string;reset:()=>void;}
declare global { interface Window { __BAMBOO__?:Diagnostics; } }

export async function createScene(mount:HTMLDivElement,hooks:Hooks,signal?:AbortSignal):Promise<SceneHandle>{
 signal?.throwIfAborted();
 const mobile=matchMedia('(max-width:700px)').matches;
 let renderer:T.WebGLRenderer;
 try{renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});}catch{throw new Error('WEBGL_UNAVAILABLE');}
 renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
 renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.25:1.6));renderer.setSize(innerWidth,innerHeight);
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
 renderer.info.autoReset=false;
 mount.appendChild(renderer.domElement);
 const scene=new T.Scene();const camera=new T.PerspectiveCamera(54,innerWidth/innerHeight,.12,750);camera.name='Bamboo_View';
 const time={value:0},night={value:0},noon={value:1};let cleanEnvironment=()=>{},cleanContact=()=>{};
 const loadedGroups:T.Group[]=[];const controller=new AbortController();let disposed=false,compiling=false,resourcesReleased=false,raf=0;
 const textureSet=new Set<T.Texture>(),materialSet=new Set<T.Material>(),geometrySet=new Set<T.BufferGeometry>();
 const disposeObjects=(root:T.Object3D)=>root.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Points){geometrySet.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materialSet.add(m);for(const value of Object.values(m))if(value instanceof T.Texture)textureSet.add(value);}if(o.customDepthMaterial)materialSet.add(o.customDepthMaterial);}if(o instanceof T.Light&&'shadow' in o)(o.shadow as T.LightShadow).dispose();});
 const releaseResources=()=>{const bitmaps=new Set<ImageBitmap>();textureSet.forEach(t=>{const data:unknown=t.source?.data;if(typeof ImageBitmap!=='undefined'&&data instanceof ImageBitmap)bitmaps.add(data);t.dispose();});materialSet.forEach(m=>m.dispose());geometrySet.forEach(g=>g.dispose());bitmaps.forEach(bitmap=>bitmap.close());textureSet.clear();materialSet.clear();geometrySet.clear();};
 const finalizeResources=()=>{if(resourcesReleased)return;resourcesReleased=true;cleanContact();disposeObjects(scene);loadedGroups.forEach(disposeObjects);if(scene.environment)textureSet.add(scene.environment);releaseResources();cleanEnvironment();renderer.dispose();renderer.forceContextLoss();};
 const cleanup=()=>{if(disposed)return;disposed=true;signal?.removeEventListener('abort',cleanup);controller.abort();cancelAnimationFrame(raf);removeEvents();renderer.domElement.remove();delete window.__BAMBOO__;if(!compiling)finalizeResources();};
 let removeEvents=()=>{};
 signal?.addEventListener('abort',cleanup,{once:true});
 try{
  const environment=addEnvironment(scene,renderer,mobile,time,night,noon);cleanEnvironment=environment.dispose;
  hooks.onProgress('正在载入老屋与竹林…',null);
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);const completed=Array(6).fill(0),totals=Array(6).fill(0);
  const fetchModel=async(url:string,index:number)=>{
   const response=await fetch(`${url}?v=${encodeURIComponent(BUILD_ID)}`,{signal:controller.signal});if(!response.ok)throw new Error(`资源未能载入 (${response.status})`);
   totals[index]=Number(response.headers.get('content-length'))||0;
   if(!response.body)throw new Error('资源为空');const reader=response.body.getReader(),chunks:Uint8Array[]=[];
   while(true){const {value,done}=await reader.read();if(done)break;chunks.push(value);completed[index]+=value.length;
    const progress=totals.every(n=>n>0)?Math.min(100,completed.reduce((a,b)=>a+b,0)/totals.reduce((a,b)=>a+b,0)*100):null;hooks.onProgress('正在载入老屋与竹林…',progress);
   }
   const buffer=new Uint8Array(completed[index]);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
   const gltf=await loader.parseAsync(buffer.buffer,'/models/');if(disposed){disposeObjects(gltf.scene);releaseResources();throw new Error('SCENE_DISPOSED');}loadedGroups.push(gltf.scene);return gltf.scene;
  };
  const [house,bamboo,understory,foliage,porchBamboo,fuel]=await Promise.all([fetchModel('/models/architecture.glb',0),fetchModel('/models/bamboo.glb',1),fetchModel('/models/understory.glb',2),fetchModel('/models/background-foliage.glb',3),fetchModel('/models/porch-bamboo.glb',4),fetchModel('/models/dry-fuel.glb',5)]);
  house.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;const materials=Array.isArray(o.material)?o.material:[o.material];for(const material of materials){if(material instanceof T.MeshStandardMaterial){material.envMapIntensity=.45;for(const tex of [material.map,material.normalMap,material.roughnessMap])if(tex)tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
   // glTF packs roughness and metalness together. With a zero metalness
   // factor this second texture read cannot affect the surface, but can push
   // the night-light shader beyond WebGL's 16 fragment texture units.
   if(material.metalness===0)material.metalnessMap=null;
   if((material.name.startsWith('Interior_frosted_lamp_glass') || material.name.startsWith('Kitchen_frosted_bare_bulb')))o.castShadow=false;
   if(material.name.startsWith('Window_memory_old_clear_glass')){
    // A thin old pane admits the courtyard daylight. Three's default depth
    // shadow pass otherwise treats alpha-blended glass as an opaque shutter.
    o.castShadow=false;material.depthWrite=false;material.envMapIntensity=.12;
   }
   if(material.name.startsWith('Annex_worn_cement_and_thin_earth_gutter')){
    material.transparent=true;material.depthWrite=false;
    material.onBeforeCompile=shader=>{
     shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 courtyardWorld;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\ncourtyardWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
     shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 courtyardWorld;').replace('#include <color_fragment>','#include <color_fragment>\nfloat courtEdge=min(min(courtyardWorld.x+10.95,-4.35-courtyardWorld.x),6.30-courtyardWorld.z);\ndiffuseColor.a*=smoothstep(.04,.80,courtEdge);');
    };material.customProgramCacheKey=()=> 'courtyard-edge-feather-1';
   }
   shadeWindowRecesses(material,night);
  }}}});
  scene.add(house);addBackgroundFoliage(scene,foliage);addUnderstoryAssets(scene,understory,mobile);bamboo.updateMatrixWorld(true);const field=addBamboo(scene,bamboo,time,mobile,night);
  addPorchBamboo(scene,porchBamboo,time,night,bamboo);
  addDryFuel(scene,fuel);
  addForestFloor(scene,mobile);
  addForestRemains(scene);
  addWoodlandFinish(scene,mobile,groundHeight,pathClearance,treePositions());
  stabilizeShadowSampling(scene);
  const vegetationVisibility=createVegetationVisibility(scene);
  const interiorContact=createInteriorContact(renderer,scene,camera,house,mobile);cleanContact=()=>interiorContact.dispose();
  hooks.onProgress('日光正落进竹林…',100);
  const pos=new T.Vector3(),target=new T.Vector3(),basePos=new T.Vector3(),baseTarget=new T.Vector3(),mobileOffset=new T.Vector3();
  let viewMode:ViewMode='porch',timeOfDay:TimeOfDay='noon',room:RoomId='upstairs',detail:DetailId='wall';
  const controls=new ViewControls(renderer.domElement,()=>setPanorama(false));
  let progress=0,displayProgress=0,lastScroll=0,paused=matchMedia('(prefers-reduced-motion:reduce)').matches,dragging=false,dragX=0,dragY=0,pointerX=0,pointerY=0,previousX=0,previousY=0;
  const media=matchMedia('(prefers-reduced-motion:reduce)');let reduced=media.matches;
  const scroll=()=>{if(controls.active||viewMode!=='walk')return;progress=T.MathUtils.clamp(scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight),0,1);lastScroll=performance.now();dragging=false;};
  const resize=()=>{camera.aspect=innerWidth/innerHeight;renderer.setSize(innerWidth,innerHeight);camera.updateProjectionMatrix();interiorContact.resize();};
  const change=()=>{reduced=media.matches;};
  const release=()=>{dragging=false;pointerX=0;pointerY=0;};
  const pointerdown=(e:PointerEvent)=>{if(controls.active||e.pointerType!=='mouse'||e.button!==0||reduced)return;dragging=true;previousX=e.clientX;previousY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId);};
  const pointermove=(e:PointerEvent)=>{if(controls.active||e.pointerType!=='mouse'||reduced)return;pointerX=(e.clientX/innerWidth-.5);pointerY=(e.clientY/innerHeight-.5);if(dragging){dragX=T.MathUtils.clamp(dragX+(e.clientX-previousX)*.002,-.18,.18);dragY=T.MathUtils.clamp(dragY+(e.clientY-previousY)*.0015,-.095,.095);previousX=e.clientX;previousY=e.clientY;}};
  const reset=()=>{dragX=dragY=pointerX=pointerY=0;dragging=false;controls.reset();};
  const setPanorama=(value:boolean)=>{if(controls.active===value)return;reset();controls.setActive(value);hooks.onPanorama(value);};
  const setView=(value:ViewMode)=>{if(viewMode===value)return;viewMode=value;setPanorama(value==='interior'||value==='detail');reset();scroll();displayProgress=progress;};
  const setRoom=(value:RoomId)=>{if(room===value)return;room=value;reset();if(viewMode==='interior')setPanorama(true);};
  const setDetail=(value:DetailId)=>{if(detail===value)return;detail=value;reset();if(viewMode==='detail')setPanorama(true);};
  let last=performance.now(),hidden=document.hidden;const visibility=()=>{hidden=document.hidden;last=performance.now();release();controls.cancelInput();};
  const contextLost=(e:Event)=>{e.preventDefault();hooks.onFailure();mount.classList.remove('ready');};
  window.addEventListener('scroll',scroll,{passive:true});window.addEventListener('resize',resize);window.addEventListener('blur',release);document.addEventListener('visibilitychange',visibility);media.addEventListener('change',change);
  renderer.domElement.addEventListener('pointerdown',pointerdown);renderer.domElement.addEventListener('pointermove',pointermove);renderer.domElement.addEventListener('pointerup',release);renderer.domElement.addEventListener('pointerleave',release);renderer.domElement.addEventListener('pointercancel',release);renderer.domElement.addEventListener('lostpointercapture',release);renderer.domElement.addEventListener('webglcontextlost',contextLost);
  removeEvents=()=>{controls.dispose();window.removeEventListener('scroll',scroll);window.removeEventListener('resize',resize);window.removeEventListener('blur',release);document.removeEventListener('visibilitychange',visibility);media.removeEventListener('change',change);renderer.domElement.removeEventListener('pointerdown',pointerdown);renderer.domElement.removeEventListener('pointermove',pointermove);for(const name of ['pointerup','pointerleave','pointercancel','lostpointercapture'])renderer.domElement.removeEventListener(name,release);renderer.domElement.removeEventListener('webglcontextlost',contextLost);};
  const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  const renderFrame=(delta=0)=>{renderer.info.reset();if(viewMode==='interior')interiorContact.render(delta);else renderer.render(scene,camera);};
  const diagnostics:Diagnostics={windGust:0,build:BUILD_ID,quality:mobile?'mobile':'desktop',gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unavailable',viewport:[],drawSize:[],progress:0,camera:[],target:[],drawCalls:0,triangles:0,textures:0,geometries:0,frames:[],windTime:0,paused,bambooCount:field.count,viewMode,room,timeOfDay,nightMix:0,noonMix:1,panorama:false,yaw:0,pitch:0,fov:70,getPoster:()=>{renderFrame();return renderer.domElement.toDataURL('image/webp',.9);},reset};window.__BAMBOO__=diagnostics;
  scroll();displayProgress=progress;
  const updateCamera=()=>{
   const effectiveProgress=reduced?0:displayProgress;
   const p=cameraProgress(effectiveProgress);positionPath.getPoint(p,basePos);targetPath.getPoint(p,baseTarget);
   camera.fov=54;
   if(viewMode==='porch'){
    basePos.set(...PORCH_VIEW.p as [number,number,number]);baseTarget.set(...PORCH_VIEW.t as [number,number,number]);camera.fov=innerWidth/innerHeight<1?78:PORCH_VIEW.fov;
   }else if(viewMode==='interior'){
    const view=ROOM_VIEWS[room];basePos.set(...view.p as [number,number,number]);baseTarget.set(...view.t as [number,number,number]);camera.fov=innerWidth/innerHeight<1?80:view.fov;
   }else if(viewMode==='detail'){
    const view=DETAIL_VIEWS[detail];basePos.fromArray(view.p);baseTarget.fromArray(view.t);camera.fov=innerWidth/innerHeight<1?Math.min(76,view.fov+9):view.fov;
   }else if(innerWidth/innerHeight<1){
    const focus=mobileOffset.copy(basePos).sub(baseTarget);const factor=1.08;
    basePos.x=baseTarget.x+focus.x*factor; basePos.z=baseTarget.z+focus.z*factor;
    basePos.y=groundHeight(basePos.x,basePos.z)+1.65;camera.fov=70;
   }
   if(viewMode==='walk')basePos.y=groundHeight(basePos.x,basePos.z)+1.70;
   if(controls.active)camera.fov=T.MathUtils.clamp(camera.fov+controls.zoom,35,90);
   camera.updateProjectionMatrix();pos.copy(basePos);target.copy(baseTarget);
   if(controls.active)controls.apply(pos,target);
   else if(!reduced){const distance=pos.distanceTo(target);target.x+=Math.sin(dragX)*distance+pointerX*.22;target.y+=Math.sin(dragY)*distance-pointerY*.12;}
   camera.position.copy(pos);camera.lookAt(target);vegetationVisibility.update(camera);
  };
  updateCamera();environment.update();compiling=true;
  // Three polls program readiness asynchronously; retain its material properties until that settles.
  try{await renderer.compileAsync(scene,camera);}finally{compiling=false;if(disposed)finalizeResources();}
  if(disposed)throw new Error('SCENE_DISPOSED');
  renderFrame();
  let frame=0;
  const tick=(now:number)=>{
   if(disposed)return;raf=requestAnimationFrame(tick);if(hidden)return;
   const delta=Math.min((now-last)/1000,.075);const actual=now-last;last=now;
   if(!paused&&!reduced)time.value+=delta;
   if(!dragging){const decay=Math.exp(-delta*(now-lastScroll<180?9:2));dragX*=decay;dragY*=decay;}
   if(!controls.active)displayProgress=T.MathUtils.damp(displayProgress,progress,12,delta);
   if(Math.abs(displayProgress-progress)<.00001)displayProgress=progress;
   night.value=reduced?Number(timeOfDay==='night'):T.MathUtils.damp(night.value,Number(timeOfDay==='night'),2.4,delta);
   if(Math.abs(night.value-Number(timeOfDay==='night'))<.001)night.value=Number(timeOfDay==='night');
   noon.value=reduced?Number(timeOfDay==='noon'):T.MathUtils.damp(noon.value,Number(timeOfDay==='noon'),2.4,delta);
   if(Math.abs(noon.value-Number(timeOfDay==='noon'))<.001)noon.value=Number(timeOfDay==='noon');
   controls.update(delta);environment.update();updateCamera();renderFrame(delta);frame++;
   if(frame>30){diagnostics.frames.push(actual);if(diagnostics.frames.length>15000)diagnostics.frames.shift();}
   if(frame%15===0){diagnostics.windGust=forestWindGust(time.value,camera.position.x,camera.position.z);diagnostics.viewport=[innerWidth,innerHeight];diagnostics.drawSize=[renderer.domElement.width,renderer.domElement.height];diagnostics.progress=progress;diagnostics.camera=camera.position.toArray();diagnostics.target=target.toArray();diagnostics.drawCalls=renderer.info.render.calls;diagnostics.triangles=renderer.info.render.triangles;diagnostics.textures=renderer.info.memory.textures;diagnostics.geometries=renderer.info.memory.geometries;diagnostics.windTime=time.value;diagnostics.paused=paused||reduced;diagnostics.viewMode=viewMode;diagnostics.room=room;diagnostics.timeOfDay=timeOfDay;diagnostics.nightMix=night.value;diagnostics.noonMix=noon.value;diagnostics.panorama=controls.active;diagnostics.yaw=controls.yaw;diagnostics.pitch=controls.pitch;diagnostics.fov=camera.fov;hooks.onBearing(Math.round(controls.bearing)%360);}
  };raf=requestAnimationFrame(tick);
  return {dispose:cleanup,setPaused:(value:boolean)=>{paused=value;},reset,setView,setRoom,setDetail,setPanorama,setTimeOfDay:(value:TimeOfDay)=>{timeOfDay=value;}};
 }catch(error){cleanup();throw error;}
}

function stabilizeShadowSampling(scene:T.Scene){
 // This scene has no temporal accumulation. Three's per-pixel IGN rotation
 // otherwise reads as a permanent woven pattern on weathered wood and cement.
 // Keep the five hardware-filtered samples and true contact shadows, but use
 // a stable disk orientation. No shared ShaderChunk is mutated.
 const chunk=T.ShaderChunk.shadowmap_pars_fragment.replaceAll('float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;','float phi = 0.0;');
 const seen=new Set<T.Material>();
 scene.traverse(object=>{if(!(object instanceof T.Mesh))return;
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
   if(seen.has(material))continue;seen.add(material);
   const compile=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey();
   material.onBeforeCompile=(shader:T.WebGLProgramParametersWithUniforms,renderer:T.WebGLRenderer)=>{compile(shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmap_pars_fragment>',chunk);};
   material.customProgramCacheKey=()=>key+'|stable-shadow-disk';
  }
 });
}
