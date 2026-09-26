import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {dirname,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import * as T from 'three';
import {WebGLShadowMap} from 'three/src/renderers/webgl/WebGLShadowMap.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

// Real source, assets, lights and Three shadow-frustum traversal; GPU commands
// are counted, not executed. These are workload counts, never FPS estimates.
const {values}=parseArgs({options:{ref:{type:'string'},out:{type:'string'},profile:{type:'string',default:'full'}}});
const profiles={full:{resolution:'full',shadows:'full'},soft:{resolution:'reduced',shadows:'full'},alternate:{resolution:'full',shadows:'alternate'},combined:{resolution:'reduced',shadows:'alternate'}};
const settings=profiles[values.profile];assert.ok(settings,'unknown profile');
const root=fileURLToPath(new URL('../../',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const ref=values.ref?git('rev-parse',values.ref).trim():null;
const sourceHashes={},assetHashes={},modules=new Map();
const hash=value=>createHash('sha256').update(value).digest('hex');
function readSource(file){const source=ref?git('show',`${ref}:${file}`):readFileSync(resolve(root,file),'utf8');sourceHashes[file]=hash(source);return source;}
async function moduleURL(file){
 if(modules.has(file))return modules.get(file);
 let code=readSource(file);
 if(file.endsWith('.json'))code='export default '+code;
 else{
  code=stripTypeScriptTypes(code,{mode:'transform'});
  for(const match of [...code.matchAll(/\bfrom\s+(['"])([^'"]+)\1/g)].reverse()){
   const specifier=match[2],url=specifier.startsWith('.')
    ?await moduleURL(relative(root,resolve(root,dirname(file),specifier+(specifier.endsWith('.json')?'':'.ts'))))
    :import.meta.resolve(specifier);
   code=code.slice(0,match.index)+`from ${JSON.stringify(url)}`+code.slice(match.index+match[0].length);
  }
 }
 const url=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;modules.set(file,url);return url;
}
const load=name=>moduleURL(`src/components/scene/${name}.ts`).then(url=>import(url));
const config=await load('config'),{createWeatherState,WEATHER_PRESETS}=await load('weather-state');
const {addEnvironment}=await load('environment'),{stabilizeHouseSurfaces}=await load('house-surfaces');
const {addBamboo,addPorchBamboo}=await load('bamboo'),{addUnderstoryAssets,addBackgroundFoliage}=await load('understory');
const {addDryFuel}=await load('dry-fuel'),{addForestFloor}=await load('forest-floor');
const {addForestRemains}=await load('forest-remains'),{addWoodlandFinish}=await load('woodland-finish'),{addPineBank}=await load('pine-bank');
const {createVegetationVisibility}=await load('vegetation-visibility');
const sceneSource=readSource('src/components/scene/scene.ts');
const hasPolicy=sceneSource.includes('createDirectionalShadowUpdates(environment.sun)');
assert.ok(hasPolicy||!sceneSource.includes('shadow.autoUpdate'),'baseline must retain automatic directional shadows');
assert.ok(hasPolicy||values.profile==='full','the parent version has no optional quality settings');
const policy=hasPolicy?await load('render-settings'):null;
if(hasPolicy)readSource('src/components/scene/point-light-shading.ts');
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(()=>({name:'CPU_GEOMETRY_ONLY',loadTexture:()=>Promise.resolve(null)}));
async function model(name){
 const bytes=readFileSync(resolve(root,`public/models/${name}.glb`));assetHashes[name]=hash(bytes);
 return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
}
const views=[
 ...config.CAMERA_STOPS.map((pose,i)=>({id:`walk-${i}`,pose:{...pose,fov:54}})),
 {id:'porch',pose:config.PORCH_VIEW},
 ...[['moon',config.MOON_VIEW],['breeze',config.BREEZE_VIEW],['well-rain',config.WELL_RAIN_VIEW]].map(([id,pose])=>({id,pose:{...pose,t:pose.p.map((n,i)=>n+pose.direction[i])}})),
 ...Object.entries(config.PLACE_VIEWS).map(([id,pose])=>({id:`free/${id}`,pose})),
];
const totals=new Map(),geometryHashes={},frames=30;
for(const mobile of [false,true]){
 const scene=new T.Scene(),time={value:0},night={value:0},noon={value:0},dawn={value:0},dusk={value:0};
 const weather=createWeatherState(time,night),ratio=policy?policy.scenePixelRatio(2,mobile,settings):Math.min(2,mobile?1.25:1.6);
 let target=null,clears=0,draws=0,triangles=0;
 const renderer={
  getPixelRatio:()=>ratio,
  getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
  setRenderTarget:value=>{target=value;},
  state:{setBlending(){},setScissorTest(){},viewport(){},buffers:{depth:{getReversed:()=>false,setTest(){}},color:{setClear(){}}}},
  properties:{get:()=>({})},
  clear:()=>{clears++;},
  renderBufferDirect:(_camera,_scene,geometry,_material,object,group)=>{
   draws++;
   const available=geometry.index?.count??geometry.attributes.position.count;
   const start=Math.max(geometry.drawRange.start,group?.start??0);
   const end=Math.min(available,geometry.drawRange.start+geometry.drawRange.count,(group?.start??0)+(group?.count??Infinity));
   triangles+=Math.max(0,end-start)/3*(object.isInstancedMesh?object.count:1);
  },
 };
 const originalPMREM=Object.getOwnPropertyDescriptor(T.PMREMGenerator.prototype,'fromScene');
 assert.ok(originalPMREM);
 let environment;
 try{
  T.PMREMGenerator.prototype.fromScene=()=>new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType});
  environment=addEnvironment(scene,renderer,mobile,time,night,noon,dawn,dusk,weather.uniforms);
 }finally{Object.defineProperty(T.PMREMGenerator.prototype,'fromScene',originalPMREM);}
 const [house,bamboo,understory,foliage,porch,fuel]=await Promise.all(['architecture','bamboo','understory','background-foliage','porch-bamboo','dry-fuel'].map(model));
 stabilizeHouseSurfaces(house);
 house.traverse(object=>{if(object instanceof T.Mesh){object.castShadow=true;object.receiveShadow=true;
  const materials=Array.isArray(object.material)?object.material:[object.material];
  if(materials.some(m=>/^(Interior_frosted_lamp_glass|Kitchen_frosted_bare_bulb|Window_memory_old_clear_glass)/.test(m.name)))object.castShadow=false;
 }});
 scene.add(house);addBackgroundFoliage(scene,foliage,weather.uniforms);addUnderstoryAssets(scene,understory,mobile,weather.uniforms);
 addBamboo(scene,bamboo,time,mobile,night,weather.uniforms);addPorchBamboo(scene,porch,time,night,bamboo,weather.uniforms);
 addDryFuel(scene,fuel);addForestFloor(scene,mobile);addForestRemains(scene);
 addWoodlandFinish(scene,mobile,config.groundHeight,config.pathClearance,config.treePositions());addPineBank(scene,mobile,weather.uniforms);
 const visibility=createVegetationVisibility(scene),sun=scene.children.find(object=>object instanceof T.DirectionalLight);
 assert.ok(sun?.castShadow);
 const digest=createHash('sha256');let casters=0;
 scene.updateMatrixWorld(true);scene.traverse(object=>{
  if(!(object instanceof T.Mesh)||!object.castShadow)return;casters++;
  digest.update(object.name+JSON.stringify(object.matrixWorld.elements));
  for(const attribute of [object.geometry.attributes.position,object.geometry.index,object.instanceMatrix,object.instanceColor])if(attribute){
   digest.update(Buffer.from(attribute.array.buffer,attribute.array.byteOffset,attribute.array.byteLength));
  }
 });
 geometryHashes[mobile?'mobile':'desktop']={casters,hash:digest.digest('hex')};
 const shadowMap=new WebGLShadowMap(renderer,{update:object=>object.geometry},{maxTextureSize:4096});shadowMap.enabled=true;
 const camera=new T.PerspectiveCamera(54,mobile?9/16:16/9,.12,750);
 const scheduler=policy?.createDirectionalShadowUpdates(sun);
 for(const [period]of Object.entries(config.SUN_PRESETS))for(const [preset,weatherSettings]of Object.entries(WEATHER_PRESETS)){
  for(const [value,name]of [[night,'night'],[noon,'noon'],[dawn,'dawn'],[dusk,'dusk']])value.value=Number(period===name);
  weather.set(weatherSettings);weather.update(0,true);environment.update();
  for(const {id,pose}of views)for(const panorama of [false,true])for(const paused of [false,true]){
   camera.position.fromArray(pose.p);camera.fov=mobile?80:pose.fov;camera.updateProjectionMatrix();camera.lookAt(new T.Vector3(...pose.t));
   if(panorama)camera.rotateY(Math.PI);
   visibility.update(camera);scheduler?.invalidate();
   const key=`${mobile?'mobile':'desktop'}/${id}/${paused?'paused':'moving'}`;
   let row=totals.get(key);
   if(!row){row={device:mobile?'mobile':'desktop',view:id,paused,cases:0,frames:0,shadowRefreshes:0,shadowDraws:0,shadowTriangles:0};totals.set(key,row);}
   row.cases++;clears=draws=triangles=0;
   for(let frame=0;frame<frames;frame++){
    if(!paused)time.value+=1/60;
    environment.update();scheduler?.update(time.value,weather.uniforms.wind.value,settings.shadows);
    scene.updateMatrixWorld(true);shadowMap.render([sun],scene,camera);
    assert.equal(target,null);
   }
   row.frames+=frames;row.shadowRefreshes+=clears;row.shadowDraws+=draws;row.shadowTriangles+=triangles;
   assert.equal(clears,hasPolicy?(paused?1:settings.shadows==='alternate'?frames/2:frames):frames,`${key}/${period}/${preset}`);
  }
 }
 scheduler?.dispose();environment.dispose();
 scene.traverse(object=>{
  if(object instanceof T.Mesh||object instanceof T.Points){object.geometry.dispose();for(const m of Array.isArray(object.material)?object.material:[object.material])m.dispose();}
  if(object instanceof T.Light&&object.shadow)object.shadow.dispose();
 });
 console.error(`${mobile?'mobile':'desktop'}: ${views.length} viewpoints × 5 times × 4 weathers × 2 orientations × 2 motion states`);
}
const resolutions=[{device:'desktop',width:1920,height:1080,mobile:false},{device:'mobile',width:390,height:844,mobile:true}].map(({mobile,...size})=>{
 const ratio=policy?policy.scenePixelRatio(2,mobile,settings):Math.min(2,mobile?1.25:1.6);
 return {...size,pixelRatio:ratio,drawSize:[Math.floor(size.width*ratio),Math.floor(size.height*ratio)],pixels:Math.floor(size.width*ratio)*Math.floor(size.height*ratio)};
});
const result={kind:'CPU shadow submission simulation; not GPU time, rendered pixels or FPS',createdAt:new Date().toISOString(),ref:ref??'working-tree',head:git('rev-parse','HEAD').trim(),three:T.REVISION,node:process.version,fixtureHash:hash(readFileSync(fileURLToPath(import.meta.url))),profile:values.profile,settings,framesPerCase:frames,coverage:{views:views.map(v=>v.id),times:Object.keys(config.SUN_PRESETS),weather:Object.keys(WEATHER_PRESETS),orientations:['authored','rotated-180'],motion:['moving','paused'],device:['desktop','mobile']},limits:['No GPU, shader compilation, texture sampling or image comparison.','Shadow workload only; rain and falling leaves do not cast shadows and are omitted.','Indoor composer pixels and contact-pass timings are not measured.','Point-light BRDF savings require GPU measurement; this fixture counts directional shadows only.'],geometryHashes,resolutions,rows:[...totals.values()],assetHashes,sourceHashes};
const json=JSON.stringify(result,null,2)+'\n';
if(values.out){const file=resolve(root,values.out);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,json,{flag:'wx'});}else console.log(json);
