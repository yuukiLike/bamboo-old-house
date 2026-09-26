import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'three';
import { WebGLShadowMap } from 'three/src/renderers/webgl/WebGLShadowMap.js';
import type { WebGLObjects } from 'three/src/renderers/webgl/WebGLObjects.js';
import type { WebGLCapabilities } from 'three/src/renderers/webgl/WebGLCapabilities.js';
const {DEFAULT_RENDER_SETTINGS,FULL_RENDER_SETTINGS,scenePixelRatio,resizeSceneRenderer,createDirectionalShadowUpdates,createFramePacer}:typeof import('../src/components/scene/render-settings')=
 await import(new URL('../src/components/scene/render-settings.ts',import.meta.url).href);
const {skipZeroPointLightContributions}:typeof import('../src/components/scene/point-light-shading')=
 await import(new URL('../src/components/scene/point-light-shading.ts',import.meta.url).href);

/** Use Three's real light-frustum traversal and needsUpdate consumption, with
 * only GPU submissions replaced. These tests do not compare rendered pixels. */
function setup(){
 const scene=new T.Scene(),parent=new T.Group(),sun=new T.DirectionalLight(),lamp=new T.PointLight(0xffffff,1,10);
 sun.name='sun';sun.castShadow=true;sun.position.set(2,4,3);
 lamp.name='lamp';lamp.castShadow=true;lamp.shadow.autoUpdate=false;lamp.shadow.needsUpdate=true;
 parent.add(sun,sun.target);scene.add(parent,lamp);
 const mesh=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());mesh.castShadow=true;scene.add(mesh);
 let target:T.WebGLRenderTarget|null=null;
 const clears:string[]=[],draws:T.Camera[]=[];
 const renderer={
  state:{setBlending(){},setScissorTest(){},viewport(){},buffers:{depth:{getReversed:()=>false,setTest(){}},color:{setClear(){}}}},
  getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
  setRenderTarget:(value:T.WebGLRenderTarget|null)=>{target=value;},
  clear:()=>{clears.push(target?.depthTexture?.name??'');},
  renderBufferDirect:(camera:T.Camera)=>{draws.push(camera);},
  properties:{get:()=>({})},
 };
 const shadowMap=new WebGLShadowMap(renderer as unknown as T.WebGLRenderer,
  {update:(object:T.Mesh)=>object.geometry} as unknown as WebGLObjects,{maxTextureSize:4096} as WebGLCapabilities);
 shadowMap.enabled=true;
 const camera=new T.PerspectiveCamera(),updates=createDirectionalShadowUpdates(sun);
 const frame=(time:number,wind=.9,mode:'full'|'alternate'='full')=>{
  const before=clears.length,requested=updates.update(time,wind,mode);
  scene.updateMatrixWorld(true);shadowMap.render([sun,lamp],scene,camera);
  assert.equal(target,null,'Three restores the main render target');
  return {requested,clears:clears.slice(before)};
 };
 const dispose=()=>{updates.dispose();sun.shadow.dispose();lamp.shadow.dispose();mesh.geometry.dispose();mesh.material.dispose();};
 return {scene,parent,sun,lamp,camera,updates,frame,draws,dispose};
}

await test('mobile clarity increases without removing the former light or complete-effect settings',()=>{
 assert.deepEqual(DEFAULT_RENDER_SETTINGS,{resolution:'balanced',shadows:'alternate',frameRate:'60'});
 assert.deepEqual(FULL_RENDER_SETTINGS,{resolution:'full',shadows:'full',frameRate:'display'});
 for(const mobile of [false,true])for(const ratio of [.75,1,1.25,1.5,2,3]){
  const full=Math.min(ratio,mobile?2:1.6);
  const reduced=Math.min(ratio,mobile?1.25:1.6)*.85;
  const balanced=mobile?Math.min(ratio,1.5):Math.min(ratio,1.6)*.85;
  for(const shadows of ['full','alternate'] as const)for(const frameRate of ['display','60','30'] as const){
   assert.equal(scenePixelRatio(ratio,mobile,{resolution:'full',shadows,frameRate}),full);
   assert.equal(scenePixelRatio(ratio,mobile,{resolution:'reduced',shadows,frameRate}),reduced);
   assert.equal(scenePixelRatio(ratio,mobile,{resolution:'balanced',shadows,frameRate}),balanced);
  }
  assert.equal(scenePixelRatio(ratio,mobile,DEFAULT_RENDER_SETTINGS),balanced);
  assert.equal(scenePixelRatio(ratio,mobile,FULL_RENDER_SETTINGS),full);
 }
 assert.ok(scenePixelRatio(3,true,DEFAULT_RENDER_SETTINGS)>1.25);
});

await test('frame limits bound scene submissions on 60/120 Hz displays and recover without catch-up bursts',()=>{
 for(const refresh of [60,120])for(const limit of ['display','60','30'] as const){
  const render=createFramePacer();let count=0;
  for(let tick=0;tick<refresh*10;tick++)if(render(tick*1000/refresh,limit))count++;
  assert.equal(count,10*(limit==='display'?refresh:Number(limit)));
 }
 const render=createFramePacer();
 assert.equal(render(0,'30'),true);
 assert.equal(render(10,'30'),false);
 assert.equal(render(10,'display'),true,'a choice takes effect on the next callback');
 assert.equal(render(12,'display'),true);
 assert.equal(render(15,'60'),true);
 assert.equal(render(20000,'60'),true,'resuming after a hidden page draws immediately');
 assert.equal(render(20001,'60'),false,'never catch up old frames');
 assert.equal(render(20020,'60'),true);
 for(const limit of ['60','30'] as const){
  const jittered=createFramePacer();let count=0;
  for(let tick=0;tick<1200;tick++)if(jittered(tick*1000/120+Math.sin(tick*1.7)*.8,limit))count++;
  assert.ok(Math.abs(count-Number(limit)*10)<=2,`${limit} Hz must not accumulate callback jitter: ${count}`);
 }
});

await test('complete-effect shadows draw every animated frame and reuse only unchanged depth inputs',()=>{
 const h=setup();
 try{
  assert.deepEqual(h.frame(0).clears,['sun.shadowMap',...Array<string>(6).fill('lamp.shadowMap')]);
  assert.ok(h.draws.includes(h.sun.shadow.camera));
  const originalMap=h.sun.shadow.map;
  for(let i=1;i<=60;i++)assert.deepEqual(h.frame(i/60).clears,['sun.shadowMap']);
  // Moving the viewing camera never changes this fixed world-space depth map.
  for(let i=0;i<60;i++){
   h.camera.position.set(i,1.7,20);h.camera.lookAt(0,2,0);
   assert.deepEqual(h.frame(1).clears,[]);
  }
  assert.equal(h.sun.shadow.map,originalMap,'reuse the same shadow texture');
  assert.deepEqual(h.frame(1,.34).clears,['sun.shadowMap'],'weather can change wind while paused');
  assert.deepEqual(h.frame(1,.34).clears,[]);
  assert.deepEqual(h.frame(1.016,.34).clears,['sun.shadowMap'],'resume refreshes immediately');
  assert.equal(h.lamp.shadow.autoUpdate,false,'leave authored lamp shadows cached');
 }finally{h.dispose();}
});

await test('light transforms, projection, explicit invalidation and missing maps always refresh',()=>{
 const h=setup();
 try{
  h.frame(0);
  const changes=[
   ()=>{h.sun.position.x+=1e-10;},()=>{h.sun.target.position.z+=1;},
   ()=>{h.parent.position.y+=2;},()=>{h.sun.shadow.camera.zoom=1.1;h.sun.shadow.camera.updateProjectionMatrix();},
   ()=>{h.sun.shadow.normalBias+=.001;},()=>{h.sun.shadow.needsUpdate=true;},
   ()=>{h.updates.invalidate();},
   ()=>{h.sun.shadow.dispose();h.sun.shadow.map=null;},
  ];
  for(const change of changes){
   change();assert.deepEqual(h.frame(0,.9,'alternate').clears,['sun.shadowMap']);
   assert.deepEqual(h.frame(0,.9,'alternate').clears,[]);
  }
  h.sun.visible=false;h.updates.invalidate();assert.equal(h.updates.update(0,.9,'full'),false);
  h.sun.visible=true;assert.deepEqual(h.frame(0).clears,['sun.shadowMap']);
 }finally{h.dispose();}
 assert.equal(h.sun.shadow.autoUpdate,true,'release restores original light ownership');
});

await test('optional shadow cadence defers at most one wind frame and switching back is immediate',()=>{
 const h=setup();
 try{
  for(let i=0;i<120;i++)assert.equal(h.frame(i/60,.9,'alternate').requested,i%2===0);
  h.updates.invalidate();assert.deepEqual(h.frame(119/60,.9,'full').clears,['sun.shadowMap']);
  for(let i=120;i<130;i++)assert.deepEqual(h.frame(i/60).clears,['sun.shadowMap']);
  h.updates.invalidate();h.frame(130/60,.9,'alternate');
  h.sun.position.x+=.01;
  assert.deepEqual(h.frame(131/60,.9,'alternate').clears,['sun.shadowMap'],'sun motion overrides the optional cadence');
  assert.deepEqual(h.frame(132/60,.34,'alternate').clears,['sun.shadowMap'],'weather changes override cadence');
 }finally{h.dispose();}
});

await test('pending shadow requests survive a render that has not consumed them',()=>{
 const h=setup();
 try{
  h.frame(0);
  assert.equal(h.updates.update(1,.9,'full'),true);
  assert.equal(h.updates.update(1,.9,'full'),true,'a pending request must not be cancelled as unchanged');
  assert.deepEqual(h.frame(1).clears,['sun.shadowMap']);
  assert.deepEqual(h.frame(1).clears,[]);
 }finally{h.dispose();}
});

await test('zero-contribution point-light guard preserves original nonzero path, other lights and material hooks',()=>{
 const scene=new T.Scene(),standard=new T.MeshStandardMaterial(),physical=new T.MeshPhysicalMaterial();
 const raw=new T.ShaderMaterial(),basic=new T.MeshBasicMaterial();
 const original=T.ShaderChunk.lights_fragment_begin,shadowOriginal=T.ShaderChunk.shadowmap_pars_fragment;
 let calls=0;
 standard.onBeforeCompile=shader=>{calls++;shader.uniforms.custom={value:42};shader.fragmentShader='// authored material\n'+shader.fragmentShader;};
 standard.customProgramCacheKey=()=> 'authored-key';
 for(const material of [standard,standard,physical,raw,basic])scene.add(new T.Mesh(new T.BoxGeometry(),material));
 skipZeroPointLightContributions(scene);
 for(const material of [standard,physical,raw,basic]){
  const shader={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader} as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader,{} as T.WebGLRenderer);
  if(material===raw||material===basic){assert.equal(shader.fragmentShader,T.ShaderLib.standard.fragmentShader);continue;}
  assert.equal(shader.vertexShader,T.ShaderLib.standard.vertexShader,'preserve vertices and shadow coordinates');
  const begin=shader.fragmentShader.indexOf(original.slice(0,original.indexOf('getPointLightInfo(')));
  const last=shader.fragmentShader.indexOf('#include <lights_fragment_maps>',begin);
  const patched=shader.fragmentShader.slice(begin,last).trim();
  assert.equal((patched.match(/if \( directLight.visible \) \{/g)??[]).length,1);
  // Removing exactly the new guard recovers the complete original lighting
  // chunk: same attenuation, point shadows, BRDF calls and all other lights.
  const restored=patched.replace('\n\t\tif ( directLight.visible ) {','')
   .replace('reflectedLight );\n\t\t}\n','reflectedLight );');
  assert.equal(restored,original.trim());
  assert.ok(material.customProgramCacheKey().endsWith('|nonzero-point-light-contributions'));
  if(material===standard){assert.equal(shader.uniforms.custom.value,42);assert.ok(shader.fragmentShader.startsWith('// authored material'));}
 }
 assert.equal(calls,1,'a shared material is wrapped once');
 assert.equal(T.ShaderChunk.lights_fragment_begin,original,'do not mutate shared Three shader chunks');
 assert.equal(T.ShaderChunk.shadowmap_pars_fragment,shadowOriginal);
 scene.traverse(object=>{if(object instanceof T.Mesh)object.geometry.dispose();});
 for(const material of [standard,physical,raw,basic])material.dispose();
});

await test('repeated mobile resize events avoid buffer resets; real size and quality changes still apply',()=>{
 let width=402,height=874,ratio=1.5,resets=0;
 const renderer={getSize:(out:T.Vector2)=>out.set(width,height),getPixelRatio:()=>ratio,
  setPixelRatio:(value:number)=>{ratio=value;resets++;},
  setSize:(w:number,h:number)=>{width=w;height=h;resets++;},
 } as unknown as T.WebGLRenderer;
 for(let i=0;i<30;i++)assert.equal(resizeSceneRenderer(renderer,402,874,1.5),false);
 assert.equal(resets,0);
 assert.equal(resizeSceneRenderer(renderer,402,760,1.5),true);assert.equal(resets,1);
 assert.equal(resizeSceneRenderer(renderer,402,760,2),true);assert.equal(resets,2);
 assert.equal(resizeSceneRenderer(renderer,874,402,1.5),true);
 assert.deepEqual([width,height,ratio],[874,402,1.5]);
});
