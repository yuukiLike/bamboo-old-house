import * as T from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addEnvironment } from './environment';
import { addUnderstoryAssets, addBackgroundFoliage } from './understory';
import { addBamboo, addPorchBamboo } from './bamboo';
import { addDryFuel } from './dry-fuel';
import { addPineBank } from './pine-bank';
import { addForestFloor } from './forest-floor';
import { addForestRemains } from './forest-remains';
import { addWoodlandFinish } from './woodland-finish';
import { forestWindGust, createInstanceWind } from './wind';
import { createWeatherState, mudResistance, type WeatherSettings } from './weather-state';
import { createWeather } from './weather';
import { createFallingLeaves } from './falling-leaves';
import { createVegetationVisibility } from './vegetation-visibility';
import { ViewControls } from './view-controls';
import { createInteriorContact } from './interior-contact';
import { createViewTransition } from './view-transition';
import { createIdleRendering } from './rendering-idle';
import { DEFAULT_RENDER_SETTINGS, scenePixelRatio, resizeSceneRenderer, createDirectionalShadowUpdates, createFramePacer, type RenderSettings } from './render-settings';
import { skipZeroPointLightContributions } from './point-light-shading';
import { beginPhase, measurePhase, phaseStatus, performanceEnabled, performanceCollectionStopped, performanceCollectionGeneration, type FinishPhase } from '@/lib/performance';
import { shadeWindowRecesses } from './window-light';
import { stabilizeHouseSurfaces } from './house-surfaces';
import { BUILD_ID, PORCH_VIEW, MOON_VIEW, BREEZE_VIEW, WELL_RAIN_VIEW, ROOM_VIEWS, PLACE_VIEWS, groundHeight, pathClearance, treePositions, cameraProgress, followWalkProgress, positionPath, targetPath, type ViewMode, type TimeOfDay, type PlaceId } from './config';
export interface SceneHandle { transition:ReturnType<typeof createViewTransition>;dispose:()=>void;setRenderSettings:(value:RenderSettings)=>void;setWeather:(value:WeatherSettings)=>void;setPaused:(value:boolean)=>void;reset:()=>void;setView:(view:ViewMode)=>void;setTimeOfDay:(value:TimeOfDay)=>void;setPanorama:(value:boolean)=>void;setPlace:(value:PlaceId)=>void; }
interface Hooks {onProgress:(state:string,value:number|null)=>void;onFailure:()=>void;onPanorama:(value:boolean)=>void;onBearing:(value:number)=>void;onGust?:(strength:number)=>void;onRunoff?:(flow:number)=>void;}
interface Diagnostics {programs:number;cpuUpdateMs:number|null;cpuRenderSubmitMs:number|null;renderSettings:RenderSettings;directionalShadowRequests:number;startupMs:number;pixelRatio:number;windGust:number;weather:{wind:number;rain:number;wetness:number;mud:number;autumn:number};fallingLeaves:Record<string,number>;rainEffects:Record<string,unknown>;build:string;quality:string;gpu:string;viewport:number[];drawSize:number[];progress:number;camera:number[];target:number[];drawCalls:number;triangles:number;textures:number;geometries:number;frames:number[];windTime:number;paused:boolean;bambooCount:number;viewMode:ViewMode;place:PlaceId;timeOfDay:TimeOfDay;nightMix:number;noonMix:number;dawnMix:number;duskMix:number;panorama:boolean;yaw:number;pitch:number;fov:number;getPoster:()=>string;reset:()=>void;}
declare global { interface Window { __BAMBOO__?:Diagnostics; } }

const include=/^[ \t]*#include +<([\w\d./]+)>/gm;
function expand(source:string):string{
 return source.replace(include,(directive,name:string)=>{
  const chunk=T.ShaderChunk[name as keyof typeof T.ShaderChunk];
  return typeof chunk==='string'?expand(chunk):directive;
 });
}

/** Fixed room lamps cannot illuminate plants beyond their finite ranges.
 * Prove that for every instance in a spatial batch, then share an unlit
 * material clone only between unreachable batches. Nearby batches retain
 * their original lights and shadows. */
function excludeUnreachablePointLights(scene:T.Scene){
 scene.updateMatrixWorld(true);
 const lights:{position:T.Vector3;range:number}[]=[];
 scene.traverse(object=>{if(object instanceof T.PointLight)lights.push({position:object.getWorldPosition(new T.Vector3()),range:object.distance});});
 if(!lights.length||lights.some(light=>light.range===0))return;
 const variants=new Map<T.Material,T.Material>(),matrix=new T.Matrix4(),box=new T.Box3();
 scene.traverse(object=>{
  if(!(object instanceof T.Mesh))return;
  const materials:T.Material[]=Array.isArray(object.material)?object.material:[object.material];
  let unreachable=false;
  if(object instanceof T.InstancedMesh&&!object.name.includes('falling')){
   object.geometry.computeBoundingBox();
   const margin=/^(Stalk_|Leaves_|Porch_)/.test(object.name)?2.6:.55;
   unreachable=true;
   for(let i=0;i<object.count&&unreachable;i++){
    object.getMatrixAt(i,matrix);matrix.premultiply(object.matrixWorld);
    box.copy(object.geometry.boundingBox!).applyMatrix4(matrix).expandByScalar(margin);
    if(lights.some(light=>box.distanceToPoint(light.position)<=light.range))unreachable=false;
   }
  }
  if(!unreachable)return;
  const specializeMaterial=(material:T.Material)=>{
   let variant=variants.get(material);if(variant)return variant;
   variant=material.clone();
   const compile=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey();
   variant.onBeforeCompile=(shader,renderer)=>{
    compile(shader,renderer);
    const specialize=(source:string)=>expand(source).replace(/NUM_POINT_LIGHT_SHADOWS|NUM_POINT_LIGHTS/g,'0');
    shader.vertexShader=specialize(shader.vertexShader);shader.fragmentShader=specialize(shader.fragmentShader);
   };
   variant.customProgramCacheKey=()=>key+'|no-reachable-room-lights';
   variants.set(material,variant);return variant;
  };
  object.material=Array.isArray(object.material)?materials.map(specializeMaterial):specializeMaterial(materials[0]);
 });
}

export async function createScene(mount:HTMLDivElement,hooks:Hooks,signal?:AbortSignal):Promise<SceneHandle>{
 signal?.throwIfAborted();
 const started=performance.now();
 const mobile=matchMedia('(max-width:700px), (hover:none) and (pointer:coarse)').matches;
 let renderer:T.WebGLRenderer;
 try{renderer=measurePhase('startup.webgl-renderer',()=>new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'}),{mobile});}catch{throw new Error('WEBGL_UNAVAILABLE');}
 renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
 let renderSettings:RenderSettings={...DEFAULT_RENDER_SETTINGS};
 // Use the selected configuration from startup; never adapt it to frame time.
 renderer.setPixelRatio(scenePixelRatio(devicePixelRatio,mobile,renderSettings));renderer.setSize(innerWidth,innerHeight);
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
 renderer.info.autoReset=false;
 mount.appendChild(renderer.domElement);
 const viewTransition=createViewTransition(renderer,{beginPhase,measurePhase});
 const scene=new T.Scene();const camera=new T.PerspectiveCamera(54,innerWidth/innerHeight,.12,750);camera.name='Bamboo_View';
 const time={value:0},night={value:0},noon={value:0},dawn={value:0},dusk={value:1};let cleanEnvironment=()=>{},cleanContact=()=>{},cleanWeather=()=>{},cleanLeaves=()=>{},cleanWind=()=>{},cleanShadows=()=>{};
 const weatherState=createWeatherState(time,night),weather=weatherState.uniforms;
 const idleRendering=createIdleRendering(camera,[time,night,noon,dawn,dusk,weather.wind,weather.rain,weather.wetness,weather.autumn]);
 const loadedGroups:T.Group[]=[];const controller=new AbortController();let disposed=false,compiling=false,resourcesReleased=false,raf=0;
 const textureSet=new Set<T.Texture>(),materialSet=new Set<T.Material>(),geometrySet=new Set<T.BufferGeometry>();
 const disposeObjects=(root:T.Object3D)=>root.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Points){geometrySet.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materialSet.add(m);for(const value of Object.values(m))if(value instanceof T.Texture)textureSet.add(value);}if(o.customDepthMaterial)materialSet.add(o.customDepthMaterial);}if(o instanceof T.Light&&'shadow' in o)(o.shadow as T.LightShadow).dispose();});
 const releaseResources=()=>{const bitmaps=new Set<ImageBitmap>();textureSet.forEach(t=>{const data:unknown=t.source?.data;if(typeof ImageBitmap!=='undefined'&&data instanceof ImageBitmap)bitmaps.add(data);t.dispose();});materialSet.forEach(m=>m.dispose());geometrySet.forEach(g=>g.dispose());bitmaps.forEach(bitmap=>bitmap.close());textureSet.clear();materialSet.clear();geometrySet.clear();};
 const finalizeResources=()=>{if(resourcesReleased)return;resourcesReleased=true;viewTransition.dispose();cleanContact();cleanLeaves();cleanWind();cleanShadows();cleanWeather();disposeObjects(scene);loadedGroups.forEach(disposeObjects);if(scene.environment)textureSet.add(scene.environment);releaseResources();cleanEnvironment();renderer.dispose();renderer.forceContextLoss();};
 const cleanup=()=>{if(disposed)return;disposed=true;signal?.removeEventListener('abort',cleanup);controller.abort();cancelAnimationFrame(raf);removeEvents();renderer.domElement.remove();delete window.__BAMBOO__;if(!compiling)finalizeResources();};
 let removeEvents=()=>{};
 let finishConstruction:FinishPhase|undefined;
 signal?.addEventListener('abort',cleanup,{once:true});
 try{
  hooks.onProgress('正在载入老屋与竹林…',null);
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);const completed=Array(6).fill(0),totals=Array(6).fill(0);let lastProgress=0;
  // The house alone embeds 116 images. Avoid parallel ImageBitmap decoding
  // on mobile WebKit; share one image queue across all six model parsers.
  if(mobile){
   let decoded=Promise.resolve();
   loader.register(parser=>{
    parser.textureLoader=new T.TextureLoader(parser.options.manager).setCrossOrigin(parser.options.crossOrigin);
    return {name:'BAMBOO_mobile_images',loadTexture:index=>{
     const pending=decoded.then(async()=>{
      controller.signal.throwIfAborted();
      const texture=await parser.loadTexture(index);
      if(!texture)throw new Error(`模型贴图未能载入 (${index})`);
      textureSet.add(texture);
      if(disposed){releaseResources();throw new Error('SCENE_DISPOSED');}
      return texture;
     });
     decoded=pending.then(()=>{},()=>{});return pending;
    }};
   });
  }
  const fetchModel=async(url:string,index:number)=>{
   let finish=beginPhase('model.download',{model:url,index});
   try {
   const response=await fetch(`${url}?v=${encodeURIComponent(BUILD_ID)}`,{signal:controller.signal});if(!response.ok)throw new Error(`资源未能载入 (${response.status})`);
   totals[index]=Number(response.headers.get('content-length'))||0;
   if(!response.body)throw new Error('资源为空');const reader=response.body.getReader(),chunks:Uint8Array[]=[];
   while(true){const {value,done}=await reader.read();if(done)break;chunks.push(value);completed[index]+=value.length;
    const progress=totals.every(n=>n>0)?Math.min(100,completed.reduce((a,b)=>a+b,0)/totals.reduce((a,b)=>a+b,0)*100):null;if(performance.now()-lastProgress>100){lastProgress=performance.now();hooks.onProgress('正在载入老屋与竹林…',progress);}
   }
   finish('success',{bytes:completed[index]});
   finish=beginPhase('model.buffer-assembly',{model:url,index,bytes:completed[index]});
   const buffer=new Uint8Array(completed[index]);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
   finish();
   finish=beginPhase('model.parse',{model:url,index});
   const gltf=await loader.parseAsync(buffer.buffer,'/models/');if(disposed){disposeObjects(gltf.scene);releaseResources();throw new Error('SCENE_DISPOSED');}loadedGroups.push(gltf.scene);finish();return gltf.scene;
   }catch(error){finish(controller.signal.aborted?'cancelled':phaseStatus(error));throw error;}
  };
  const models=Promise.all([fetchModel('/models/architecture.glb',0),fetchModel('/models/bamboo.glb',1),fetchModel('/models/understory.glb',2),fetchModel('/models/background-foliage.glb',3),fetchModel('/models/porch-bamboo.glb',4),fetchModel('/models/dry-fuel.glb',5)]);
  // Begin downloads before generating terrain and textures on the main thread.
  // Attach a rejection handler while construction yields to avoid an unhandled rejection.
  void models.catch(()=>{});
  const yieldLoading=async(state:string)=>{hooks.onProgress(state,null);await new Promise<void>(resolve=>setTimeout(resolve,0));if(disposed)throw new Error('SCENE_DISPOSED');};
  await yieldLoading('正在铺开竹林…');
  const environment=measurePhase('scene.environment-build',()=>addEnvironment(scene,renderer,mobile,time,night,noon,dawn,dusk,weather),{mobile});cleanEnvironment=environment.dispose;
  const [house,bamboo,understory,foliage,porchBamboo,fuel]=await models;
  measurePhase('scene.house-surfaces',()=>stabilizeHouseSurfaces(house));
  await yieldLoading('正在安放老屋…');
  finishConstruction=beginPhase('scene.house-and-vegetation-build',{mobile});
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
   shadeWindowRecesses(material,night,dawn,dusk,noon,weather);
  }}}});
  scene.add(house);addBackgroundFoliage(scene,foliage,weather);addUnderstoryAssets(scene,understory,mobile,weather);bamboo.updateMatrixWorld(true);const field=addBamboo(scene,bamboo,time,mobile,night,weather);
  addPorchBamboo(scene,porchBamboo,time,night,bamboo,weather);
  finishConstruction();
  await yieldLoading('正在铺开林下草地…');
  finishConstruction=beginPhase('scene.forest-floor-build',{mobile});
  addDryFuel(scene,fuel);
  addForestFloor(scene,mobile);
  addForestRemains(scene);
  addWoodlandFinish(scene,mobile,groundHeight,pathClearance,treePositions());
  addPineBank(scene,mobile,weather);
  finishConstruction();
  await yieldLoading('正在准备风雨…');
  finishConstruction=beginPhase('scene.weather-build',{mobile});
  const weatherEffects=createWeather(scene,house,camera,mobile,weather);cleanWeather=()=>weatherEffects.dispose();
  finishConstruction();
  finishConstruction=beginPhase('scene.falling-leaves-build',{mobile});
  const fallingLeaves=createFallingLeaves(scene,camera,mobile,weather,(x,z)=>weatherEffects.surfaceHeightAt(x,z));cleanLeaves=()=>fallingLeaves.dispose();
  finishConstruction();
  finishConstruction=beginPhase('scene.render-setup',{mobile});
  stabilizeShadowSampling(scene);
  skipZeroPointLightContributions(scene);
  const vegetationVisibility=createVegetationVisibility(scene);
  excludeUnreachablePointLights(scene);
  const instanceWind=createInstanceWind(scene,renderer.capabilities.maxAttributes);cleanWind=()=>instanceWind.dispose();
  const shadowUpdates=createDirectionalShadowUpdates(environment.sun);cleanShadows=()=>shadowUpdates.dispose();
  let directionalShadowRequests=0;
  const interiorContact=createInteriorContact(renderer,scene,camera,house,mobile);cleanContact=()=>interiorContact.dispose();
  finishConstruction();
  hooks.onProgress('日光正落进竹林…',100);
  const pos=new T.Vector3(),target=new T.Vector3(),basePos=new T.Vector3(),baseTarget=new T.Vector3(),mobileOffset=new T.Vector3();
  let viewMode:ViewMode='walk',timeOfDay:TimeOfDay='dusk',place:PlaceId='courtyard';
  viewTransition.setContext({view:viewMode,place});
  const houseMeshes=new Set<T.Object3D>();house.traverse(object=>{if(object instanceof T.Mesh)houseMeshes.add(object);});
  renderer.setOpaqueSort((a,b)=>{
   const order=a.groupOrder-b.groupOrder||a.renderOrder-b.renderOrder;if(order)return order;
   // Room walls reject hidden forest fragments before their lighting runs.
   // Preserve Three's material ordering within each group.
   if(viewMode==='free'&&Object.hasOwn(ROOM_VIEWS,place)){
    const occlusion=Number(!houseMeshes.has(a.object))-Number(!houseMeshes.has(b.object));if(occlusion)return occlusion;
   }
   return a.material.id-b.material.id||a.z-b.z||a.id-b.id;
  });
  const controls=new ViewControls(renderer.domElement,()=>setPanorama(false));
  let progress=0,displayProgress=0,lastScroll=0,resyncWalkCamera=true,walkScrollRange=0,paused=matchMedia('(prefers-reduced-motion:reduce)').matches,dragging=false,dragX=0,dragY=0,pointerX=0,pointerY=0,previousX=0,previousY=0;
  const media=matchMedia('(prefers-reduced-motion:reduce)');let reduced=media.matches;
  const syncWalkScroll=()=>{if(!controls.active&&viewMode==='walk')progress=T.MathUtils.clamp(scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight),0,1);};
  const scroll=()=>{if(controls.active||viewMode!=='walk')return;lastScroll=performance.now();dragging=false;};
  let resizePending=false;
  const requestResize=()=>{resizePending=true;};
  const resize=()=>{
   resizePending=false;resyncWalkCamera=true;
   if(!resizeSceneRenderer(renderer,innerWidth,innerHeight,scenePixelRatio(devicePixelRatio,mobile,renderSettings)))return;
   camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();interiorContact.resize();viewTransition.resize();shadowUpdates.invalidate();idleRendering.invalidate();
  };
  const change=()=>{reduced=media.matches;resyncWalkCamera=true;shadowUpdates.invalidate();idleRendering.invalidate();};
  const release=()=>{dragging=false;pointerX=0;pointerY=0;};
  const pointerdown=(e:PointerEvent)=>{if(controls.active||e.pointerType!=='mouse'||e.button!==0||reduced)return;dragging=true;previousX=e.clientX;previousY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId);};
  const pointermove=(e:PointerEvent)=>{if(controls.active||e.pointerType!=='mouse'||reduced)return;pointerX=(e.clientX/innerWidth-.5);pointerY=(e.clientY/innerHeight-.5);if(dragging){dragX=T.MathUtils.clamp(dragX-(e.clientX-previousX)*.002,-.18,.18);dragY=T.MathUtils.clamp(dragY+(e.clientY-previousY)*.0015,-.095,.095);previousX=e.clientX;previousY=e.clientY;}};
  const reset=()=>{dragX=dragY=pointerX=pointerY=0;dragging=false;controls.reset();idleRendering.invalidate();};
  const setPanorama=(value:boolean)=>{if(controls.active===value)return;reset();resyncWalkCamera=true;controls.setActive(value);hooks.onPanorama(value);};
  const setView=(value:ViewMode)=>{if(viewMode===value)return;shadowUpdates.invalidate();viewMode=value;viewTransition.setContext({view:viewMode,place});resyncWalkCamera=true;interiorContact.resetForViewChange();setPanorama(value==='free');reset();syncWalkScroll();displayProgress=progress;};
  const setPlace=(value:PlaceId)=>{if(!Object.hasOwn(PLACE_VIEWS,value)||place===value)return;shadowUpdates.invalidate();place=value;viewTransition.setContext({view:viewMode,place});interiorContact.resetForViewChange();reset();if(viewMode==='free')setPanorama(true);};
  let last=performance.now(),hidden=document.hidden;const visibility=()=>{hidden=document.hidden;shadowUpdates.invalidate();idleRendering.invalidate();last=performance.now();resyncWalkCamera=true;release();controls.cancelInput();};
  const contextLost=(e:Event)=>{e.preventDefault();cleanup();hooks.onFailure();mount.classList.remove('ready');};
  window.addEventListener('scroll',scroll,{passive:true});window.addEventListener('resize',requestResize);window.addEventListener('blur',release);document.addEventListener('visibilitychange',visibility);media.addEventListener('change',change);
  renderer.domElement.addEventListener('pointerdown',pointerdown);renderer.domElement.addEventListener('pointermove',pointermove);renderer.domElement.addEventListener('pointerup',release);renderer.domElement.addEventListener('pointerleave',release);renderer.domElement.addEventListener('pointercancel',release);renderer.domElement.addEventListener('lostpointercapture',release);renderer.domElement.addEventListener('webglcontextlost',contextLost);
  removeEvents=()=>{controls.dispose();window.removeEventListener('scroll',scroll);window.removeEventListener('resize',requestResize);window.removeEventListener('blur',release);document.removeEventListener('visibilitychange',visibility);media.removeEventListener('change',change);renderer.domElement.removeEventListener('pointerdown',pointerdown);renderer.domElement.removeEventListener('pointermove',pointermove);for(const name of ['pointerup','pointerleave','pointercancel','lostpointercapture'])renderer.domElement.removeEventListener(name,release);renderer.domElement.removeEventListener('webglcontextlost',contextLost);};
  const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  // Every main-scene draw, including indoor prewarming, shares the policy.
  const renderScene=(interior:boolean,delta=0)=>{
   if(shadowUpdates.update(time.value,weather.wind.value,renderSettings.shadows)&&!performanceCollectionStopped())directionalShadowRequests++;
   if(interior)interiorContact.render(delta);else {interiorContact.deactivate();renderer.render(scene,camera);}
   if(!performanceCollectionStopped())diagnostics.directionalShadowRequests=directionalShadowRequests;
  };
  const renderFrame=(delta=0)=>{renderer.info.reset();renderScene(viewMode==='free'&&Object.hasOwn(ROOM_VIEWS,place),delta);viewTransition.render(performance.now());};
  const diagnostics:Diagnostics={programs:0,cpuUpdateMs:null,cpuRenderSubmitMs:null,renderSettings:{...renderSettings},directionalShadowRequests:0,startupMs:0,pixelRatio:renderer.getPixelRatio(),windGust:0,weather:{wind:weather.wind.value,rain:0,wetness:0,mud:0,autumn:0},fallingLeaves:{},rainEffects:{},build:BUILD_ID,quality:mobile?'mobile':'desktop',gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unavailable',viewport:[],drawSize:[],progress:0,camera:[],target:[],drawCalls:0,triangles:0,textures:0,geometries:0,frames:[],windTime:0,paused,bambooCount:field.count,viewMode,place,timeOfDay,nightMix:0,noonMix:0,dawnMix:0,duskMix:1,panorama:false,yaw:0,pitch:0,fov:70,getPoster:()=>{renderFrame();return renderer.domElement.toDataURL('image/webp',.9);},reset};window.__BAMBOO__=diagnostics;

  const setRenderSettings=(value:RenderSettings)=>{
   if(value.resolution===renderSettings.resolution&&value.shadows===renderSettings.shadows&&value.frameRate===renderSettings.frameRate)return;
   const resolutionChanged=value.resolution!==renderSettings.resolution;
   renderSettings={...value};shadowUpdates.invalidate();idleRendering.invalidate();
   if(resolutionChanged)resize();
   diagnostics.renderSettings={...renderSettings};diagnostics.pixelRatio=renderer.getPixelRatio();
   diagnostics.drawSize=[renderer.domElement.width,renderer.domElement.height];
  };
  syncWalkScroll();displayProgress=progress;
  const updateCamera=()=>{
   const effectiveProgress=reduced?0:displayProgress;
   let fov=54;
   if(viewMode==='well-rain'){
    basePos.fromArray(WELL_RAIN_VIEW.p);
    baseTarget.fromArray(WELL_RAIN_VIEW.direction).add(basePos);fov=innerWidth/innerHeight<1?76:WELL_RAIN_VIEW.fov;
   }else if(viewMode==='moon'||viewMode==='breeze'){
    const view=viewMode==='moon'?MOON_VIEW:BREEZE_VIEW;
    basePos.fromArray(view.p);basePos.y=groundHeight(basePos.x,basePos.z)+1.70;
    baseTarget.fromArray(view.direction).add(basePos);fov=innerWidth/innerHeight<1?72:view.fov;
   }else if(viewMode==='porch'){
    basePos.set(...PORCH_VIEW.p as [number,number,number]);baseTarget.set(...PORCH_VIEW.t as [number,number,number]);fov=innerWidth/innerHeight<1?78:PORCH_VIEW.fov;
   }else if(viewMode==='free'){
    const view=PLACE_VIEWS[place];basePos.fromArray(view.p);baseTarget.fromArray(view.t);fov=innerWidth/innerHeight<1?80:view.fov;
   }else {
    const p=cameraProgress(effectiveProgress);positionPath.getPoint(p,basePos);targetPath.getPoint(p,baseTarget);
    if(innerWidth/innerHeight<1){
    const focus=mobileOffset.copy(basePos).sub(baseTarget);const factor=1.08;
    basePos.x=baseTarget.x+focus.x*factor; basePos.z=baseTarget.z+focus.z*factor;
    basePos.y=groundHeight(basePos.x,basePos.z)+1.65;fov=70;
    }
   }
   if(viewMode==='walk')basePos.y=groundHeight(basePos.x,basePos.z)+1.70;
   if(controls.active)fov=T.MathUtils.clamp(fov+controls.zoom,35,90);
   if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}
   pos.copy(basePos);target.copy(baseTarget);
   if(controls.active)controls.apply(pos,target);
   else if(!reduced){const distance=pos.distanceTo(target);target.x+=Math.sin(dragX)*distance+pointerX*.22;target.y+=Math.sin(dragY)*distance-pointerY*.12;}
   camera.position.copy(pos);camera.lookAt(target);vegetationVisibility.update(camera);
  };
  updateCamera();instanceWind.update(time.value,weather.wind.value);environment.update();compiling=true;
  const finishPrewarm=beginPhase('startup.prewarm',{mobile});
  let finishCompile:FinishPhase|undefined;
  // Three polls program readiness asynchronously; retain its material properties until that settles.
  try{
   await viewTransition.prepare();
   // Phones need the opening view first. Eager night shadows and indoor
   // HDR/MSAA passes add a large GPU allocation/draw burst after model loading.
   // Keep desktop prewarming; mobile builds the room pipeline on first entry.
   for(const mix of mobile?[0]:[0,1]){
    night.value=mix;environment.update();
    hooks.onProgress(mix?'正在点亮屋内灯火…':'正在准备日光与阴影…',100);
    finishCompile=beginPhase('startup.shader-compile',{mobile,nightMix:mix});
    await renderer.compileAsync(scene,camera);finishCompile(disposed?'cancelled':'success');if(disposed)break;
    if(mobile)continue;
    await interiorContact.prepare();if(disposed)break;
    measurePhase('startup.scene-warmup-submit',()=>renderFrame(),{nightMix:mix});
    // Drivers can defer HDR/MSAA and postprocessing pipeline creation until
    // the first draw even after linking succeeds. Exercise the actual room
    // path while the loading cover is still up, for both lighting states.
    measurePhase('startup.interior-warmup-submit',()=>renderScene(true),{nightMix:mix});
   }
   finishPrewarm(disposed?'cancelled':'success');
  }catch(error){const status=disposed?'cancelled':phaseStatus(error);finishCompile?.(status);finishPrewarm(status);throw error;
  }finally{night.value=0;environment.update();compiling=false;if(disposed)finalizeResources();}
  if(disposed)throw new Error('SCENE_DISPOSED');
  measurePhase('startup.initial-frame-submit',()=>renderFrame(),{mobile,view:viewMode,place,boundary:'cpu-submitted'});
  diagnostics.startupMs=performance.now()-started;last=performance.now();
  let frame=0,cpuSamples=0,cpuUpdateTotal=0,cpuRenderTotal=0;
  let collectionGeneration=performanceCollectionGeneration();
  const shouldRender=createFramePacer();
  const tick=(now:number)=>{
   if(disposed)return;raf=requestAnimationFrame(tick);if(hidden)return;
   if(!shouldRender(now,renderSettings.frameRate))return;
   if(collectionGeneration!==performanceCollectionGeneration()){
    collectionGeneration=performanceCollectionGeneration();
    diagnostics.frames.length=0;directionalShadowRequests=0;frame=0;
    cpuSamples=cpuUpdateTotal=cpuRenderTotal=0;diagnostics.cpuUpdateMs=diagnostics.cpuRenderSubmitMs=null;
   }
   const measuring=performanceEnabled()&&!performanceCollectionStopped();
   const updateStarted=measuring?performance.now():0;
   if(resizePending)resize();
   const delta=Math.min((now-last)/1000,.075);const actual=now-last;last=now;
   if(!paused&&!reduced)time.value+=delta;
   if(!dragging){const decay=Math.exp(-delta*(now-lastScroll<180?9:2));dragX*=decay;dragY*=decay;}
   // Both trackpad input and chapter links follow the same short camera easing.
   // Keep native scrolling; never add wheel queues, chapter dwell or mud delay.
   // Recheck the range after React restores the walking layout, and immediately
   // align restored views instead of animating from a stale scroll position.
   if(!controls.active&&viewMode==='walk'){
    const range=Math.max(1,document.documentElement.scrollHeight-innerHeight);
    syncWalkScroll();
    displayProgress=resyncWalkCamera||range!==walkScrollRange||reduced?progress:followWalkProgress(displayProgress,progress,actual/1000,range);
    walkScrollRange=range;resyncWalkCamera=false;
   }
   for(const [mix,period] of [[night,'night'],[noon,'noon'],[dawn,'dawn'],[dusk,'dusk']] as const){
    const goal=Number(timeOfDay===period);mix.value=reduced?goal:T.MathUtils.damp(mix.value,goal,2.4,delta);
    if(Math.abs(mix.value-goal)<.001)mix.value=goal;
   }
   weatherState.update(delta,reduced);controls.update(delta);environment.update();updateCamera();instanceWind.update(time.value,weather.wind.value);weatherEffects.update(delta,reduced);fallingLeaves.update(delta);hooks.onGust?.(paused||reduced?0:forestWindGust(time.value,camera.position.x,camera.position.z));
   // A frozen clock alone is insufficient: daylight/weather can still ease,
   // input can move the camera, and room contact shade/transition must finish.
   // Both revisions are monotonic and mark changes outside those inputs.
   const interior=viewMode==='free'&&Object.hasOwn(ROOM_VIEWS,place);
   const renderSubmitted=idleRendering.needsRender(paused||reduced,viewTransition.needsRender||(interior&&interiorContact.needsRender),weatherEffects.visualRevision+viewTransition.visualRevision);
   const renderStarted=measuring?performance.now():0;
   if(renderSubmitted)renderFrame(delta);
   frame++;
   if(measuring){cpuSamples++;cpuUpdateTotal+=renderStarted-updateStarted;if(renderSubmitted)cpuRenderTotal+=performance.now()-renderStarted;}
   if(frame%15===0){hooks.onRunoff?.(weatherEffects.runoffFlow);hooks.onBearing(Math.round(controls.bearing)%360);}
   if(performanceCollectionStopped())return;
   if(frame>30){diagnostics.frames.push(actual);if(diagnostics.frames.length>15000)diagnostics.frames.shift();}
   if(frame%15===0){
    const mud=mudResistance(camera.position.x,camera.position.z,weather.wetness.value,pathClearance(camera.position.x,camera.position.z));
    diagnostics.pixelRatio=renderer.getPixelRatio();
    diagnostics.windGust=forestWindGust(time.value,camera.position.x,camera.position.z);
    diagnostics.weather={wind:weather.wind.value,rain:weather.rain.value,wetness:weather.wetness.value,mud,autumn:weather.autumn.value};
    diagnostics.fallingLeaves={...fallingLeaves.stats};
    const rainInfo=weatherEffects.diagnostics();
    diagnostics.rainEffects={...Object.fromEntries(Object.entries(rainInfo).filter(([,value])=>typeof value==='number')),sheltered:weatherEffects.isSheltered(camera.position.x,camera.position.y,camera.position.z)};
    diagnostics.viewport=[innerWidth,innerHeight];diagnostics.drawSize=[renderer.domElement.width,renderer.domElement.height];
    diagnostics.progress=progress;diagnostics.camera=camera.position.toArray();diagnostics.target=target.toArray();
    diagnostics.drawCalls=renderSubmitted?renderer.info.render.calls:0;diagnostics.triangles=renderSubmitted?renderer.info.render.triangles:0;
    diagnostics.textures=renderer.info.memory.textures;diagnostics.geometries=renderer.info.memory.geometries;
    diagnostics.programs=renderer.info.programs?.length??0;
    // CPU averages over 15 paced update ticks; an idle tick contributes zero
    // submission time. Includes driver waits, never GPU/presentation timings.
    diagnostics.cpuUpdateMs=cpuSamples?cpuUpdateTotal/cpuSamples:null;
    diagnostics.cpuRenderSubmitMs=cpuSamples?cpuRenderTotal/cpuSamples:null;
    cpuSamples=cpuUpdateTotal=cpuRenderTotal=0;
    diagnostics.windTime=time.value;diagnostics.paused=paused||reduced;diagnostics.viewMode=viewMode;diagnostics.place=place;
    diagnostics.timeOfDay=timeOfDay;diagnostics.nightMix=night.value;diagnostics.noonMix=noon.value;diagnostics.dawnMix=dawn.value;diagnostics.duskMix=dusk.value;
    diagnostics.panorama=controls.active;diagnostics.yaw=controls.yaw;diagnostics.pitch=controls.pitch;diagnostics.fov=camera.fov;
   }
  };raf=requestAnimationFrame(tick);
  return {transition:viewTransition,dispose:cleanup,setRenderSettings,setWeather:(value)=>weatherState.set(value),setPaused:(value:boolean)=>{if(paused!==value){idleRendering.invalidate();shadowUpdates.invalidate();}paused=value;},reset,setView,setPlace,setPanorama,setTimeOfDay:(value:TimeOfDay)=>{timeOfDay=value;}};
 }catch(error){finishConstruction?.(phaseStatus(error));cleanup();throw error;}
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
