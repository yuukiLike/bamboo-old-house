import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as T from 'three';
import type { WeatherUniforms } from '../src/components/scene/weather-state';

// Import the production modules without changing their exports. Observe the
// real exact index's lifetime, and retain it only in the comparison renderer.
const exactURL=new URL('../src/components/scene/rain-occlusion.ts',import.meta.url).href;
const dataURL=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const probeURL=dataURL(`
 import {createRainOcclusion as create} from ${JSON.stringify(exactURL)};
 export const records=[];
 export let retain=false;
 export function setRetain(value){retain=value;}
 export function createRainOcclusion(...args){
  const index=create(...args),record={queries:0,disposals:0,bytes:index.stats.bufferBytes};
  records.push(record);
  return {...index,blocked(...args){record.queries++;return index.blocked(...args);},
   dispose(){record.disposals++;index.dispose();}};
 }
`);
const probe:{records:{queries:number;disposals:number;bytes:number}[];retain:boolean;setRetain:(value:boolean)=>void}=await import(probeURL);
const modules=new Map<string,string>();
async function moduleURL(url:URL):Promise<string>{
 const key=url.href,cached=modules.get(key);if(cached)return cached;
 let source=stripTypeScriptTypes(readFileSync(url,'utf8'),{mode:'transform',sourceUrl:key});
 if(url.pathname.endsWith('/rain-shelter.ts')){
  source+=`\nimport {retain} from ${JSON.stringify(probeURL)};`;
  const replacement=source.replace(/const releaseExposureData\s*=\s*\(\)\s*=>\s*\{/,match=>match+' if(retain)return;');
  assert.notEqual(replacement,source,'the comparison must actually retain the exposure index');source=replacement;
 }
 for(const match of [...source.matchAll(/\bfrom\s+(['"])([^'"]+)\1/g)].reverse()){
  const specifier=match[2];
  const dependency=specifier==='./rain-occlusion'?probeURL:specifier.startsWith('.')
   ?await moduleURL(new URL(specifier+'.ts',url)):specifier.startsWith('data:')?specifier:import.meta.resolve(specifier);
  source=source.slice(0,match.index)+`from ${JSON.stringify(dependency)}`+source.slice(match.index!+match[0].length);
 }
 const result=dataURL(source);modules.set(key,result);return result;
}
const {createRainShelter}:typeof import('../src/components/scene/rain-shelter')=
 await import(await moduleURL(new URL('../src/components/scene/rain-shelter.ts',import.meta.url)));
const {createWeather}:typeof import('../src/components/scene/weather')=
 await import(await moduleURL(new URL('../src/components/scene/weather.ts',import.meta.url)));

function fixture(){
 const scene=new T.Scene(),house=new T.Group();
 const roofMaterial=new T.MeshStandardMaterial();roofMaterial.name='Grey_clay_tile_test';
 const roof=new T.Mesh(new T.PlaneGeometry(4,4),roofMaterial);roof.name='Grey_clay_tile_test';
 roof.rotation.x=-Math.PI/2+.12;roof.position.y=2.5;house.add(roof);
 const floorMaterial=new T.MeshStandardMaterial();floorMaterial.name='Interior_floor_test';
 const floor=new T.Mesh(new T.BoxGeometry(6,.1,6),floorMaterial);floor.name='Test_floor';house.add(floor);
 const wall=new T.Mesh(new T.BoxGeometry(.12,2.5,4),new T.MeshStandardMaterial());
 wall.position.set(-2,1.25,0);house.add(wall);scene.add(house);scene.updateMatrixWorld(true);
 return {scene,house,floor};
}
function disposeFixture(house:T.Group){house.traverse(object=>{if(object instanceof T.Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}});}
function attributes(scene:T.Object3D,bakedOnly=false){
 const hash=createHash('sha256');
 scene.traverse(object=>{
  if(!(object instanceof T.Mesh||object instanceof T.LineSegments))return;
  hash.update(`${object.name}|${object.visible}|${object.geometry.drawRange.start}|${object.geometry.drawRange.count}`);
  if(object.geometry instanceof T.InstancedBufferGeometry)hash.update(String(object.geometry.instanceCount));
  for(const [name,value]of Object.entries(object.geometry.attributes)){
   if(bakedOnly&&!['rainIngress','rainExposure'].includes(name))continue;
   const attribute=value as T.BufferAttribute|T.InterleavedBufferAttribute;
   const data=attribute instanceof T.InterleavedBufferAttribute?attribute.data.array:attribute.array;
   hash.update(name);hash.update(Buffer.from(data.buffer,data.byteOffset,data.byteLength));
  }
 });
 return hash.digest('hex');
}

await test('releasing exact exposure preserves particle voxels and is idempotent',()=>{
 const {house}=fixture(),shelter=createRainShelter(house,(x,z)=>Math.abs(x)<2&&Math.abs(z)<2?2.5:-100);
 const record=probe.records.at(-1)!;
 try {
  const samples=Array.from({length:160},(_,i)=>[i%10*.5-2.5,Math.floor(i/10)%4*.8,i%4-1.5] as const);
  const expected=samples.map(([x,y,z])=>({solid:shelter.solid(x,y,z),clip:shelter.clip(x,y+3,z,0,-4,0)}));
  assert.ok(expected.some(value=>value.solid)&&expected.some(value=>value.clip<1));
  const exposure=shelter.exposure(1.8,.1,0);
  assert.deepEqual(shelter.exposure(1.8,.1,0),exposure,'standalone exact callers retain their query contract');
  assert.equal(record.disposals,0);assert.ok(record.bytes>0);
  shelter.releaseExposureData();shelter.releaseExposureData();
  assert.equal(record.disposals,1,'release clears the real triangle/grid buffers once');
  assert.throws(()=>shelter.exposure(1.8,.1,0),/RAIN_EXPOSURE_DATA_RELEASED/,'released queries cannot silently rebuild or return incorrect exposure');
  assert.deepEqual(samples.map(([x,y,z])=>({solid:shelter.solid(x,y,z),clip:shelter.clip(x,y+3,z,0,-4,0)})),expected);
  shelter.dispose();shelter.dispose();assert.equal(record.disposals,1);
 } finally {shelter.dispose();disposeFixture(house);}
});

await test('weather releases after all surface baking and preserves subsequent views, storms and drying',()=>{
 for(const mobile of [true,false]){
  const controls=[false,true].map(retain=>{
   const {scene,house}=fixture(),camera=new T.PerspectiveCamera(72,1,.1,100);
   const uniforms:WeatherUniforms={time:{value:0},night:{value:0},wind:{value:.28},rain:{value:0},wetness:{value:0},autumn:{value:0}};
   probe.setRetain(retain);
   const weather=createWeather(scene,house,camera,mobile,uniforms),record=probe.records.at(-1)!;
   return {scene,house,camera,uniforms,weather,record};
  });
  probe.setRetain(false);
  const [released,retained]=controls;
  try {
   assert.equal(released.record.disposals,1);assert.equal(retained.record.disposals,0);
   assert.ok(released.record.queries>0,'the full exact bake ran before its data was released');
   assert.equal(attributes(released.scene),attributes(retained.scene),'all initially baked attributes and particle pools match');
   const baked=attributes(released.house,true),queries=released.record.queries;
   assert.equal('ingressAt' in released.weather.diagnostics(),false,'runtime diagnostics do not expose released exact-query closures');
   for(let frame=0;frame<240;frame++){
    for(const current of controls){
     const {uniforms,camera}=current;
     uniforms.time.value+=.05;uniforms.rain.value=frame<40?0:frame<160?1:0;
     uniforms.wind.value=frame<80?.28:.9;uniforms.wetness.value=frame<160?frame/160:1-(frame-160)/100;
     uniforms.night.value=frame>=120?1:0;
     camera.position.set(frame<80?0:frame<160?4:-4,1.5,frame<120?0:5);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
     current.weather.update(.05,frame%60===0);
    }
    if(frame%40===0)assert.equal(attributes(released.scene),attributes(retained.scene),`same rain geometry at frame ${frame}, mobile=${mobile}`);
   }
   assert.equal(attributes(released.house,true),baked);
   assert.equal(released.record.queries,queries,'runtime never needs another exact exposure query');
   assert.equal(released.record.disposals,1);
  } finally {for(const current of controls){
   const geometry=(current.scene.getObjectByName('Wind_slanted_world_rain') as T.LineSegments).geometry;
   let disposals=0;geometry.addEventListener('dispose',()=>{disposals++;});
   current.weather.dispose();current.weather.dispose();assert.equal(disposals,1);
   const before=Array.from(geometry.attributes.position.array);current.uniforms.time.value+=1;current.weather.update(1);
   assert.deepEqual(Array.from(geometry.attributes.position.array),before,'disposed weather cannot resume particle updates');
   disposeFixture(current.house);
  }}
  assert.equal(released.record.disposals,1);assert.equal(retained.record.disposals,1);
 }
});

await test('frozen weather preserves geometry, shader uniforms and visual revision after settling',()=>{
 probe.setRetain(false);
 for(const mobile of [true,false])for(const reduced of [false,true])for(const rain of [0,.42,1])for(const animated of [false,true]){
  const label=`mobile=${mobile}, reduced=${reduced}, rain=${rain}, animated=${animated}`;
  const {scene,house,floor}=fixture(),camera=new T.PerspectiveCamera(72,1,.1,100);
  camera.position.set(4,1.5,5);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
  // Warm, mostly dry ground keeps vapor visible in the rainy cases too.
  const uniforms:WeatherUniforms={time:{value:0},night:{value:0},wind:{value:.86},rain:{value:rain},wetness:{value:.08},autumn:{value:0}};
  const weather=createWeather(scene,house,camera,mobile,uniforms);
  try {
   // Capture the real material's injected uniforms without constructing a GL
   // renderer. Ingress, absorption and local rain time are private otherwise.
   const surface={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader} as T.WebGLProgramParametersWithUniforms;
   floor.material.onBeforeCompile(surface,{} as T.WebGLRenderer);
   assert.equal(surface.uniforms.weatherTime,uniforms.time);
   assert.equal(surface.uniforms.weatherWetness,uniforms.wetness);
   for(const name of ['weatherRainTime','weatherAbsorptionActivity','weatherIngressWater'])assert.ok(surface.uniforms[name],name);
   const picture=()=>{
    const objects:unknown[]=[];
    scene.traverse(object=>{
     objects.push({name:object.name,visible:object.visible});
     if(object instanceof T.Mesh&&object.material instanceof T.ShaderMaterial)objects.push(object.material.uniforms);
    });
    return JSON.stringify({attributes:attributes(scene),objects,surface:surface.uniforms});
   };
   if(animated)for(let frame=0;frame<120;frame++){uniforms.time.value+=.05;weather.update(.05,false);}
   // The first frozen update may initialize particles or apply reduced-motion
   // static water amounts. Subsequent nonzero CPU deltas must leave them still.
   weather.update(.05,reduced);
   if(rain>0)assert.equal(scene.getObjectByName('First_rain_over_warm_ground')?.visible,true,`rainy fixture includes vapor: ${label}`);
   const expected=picture(),revision=weather.visualRevision;
   for(let frame=0;frame<60;frame++){
    weather.update(.05,reduced);
    assert.equal(picture(),expected,`unchanged weather picture at frozen frame ${frame}: ${label}`);
    assert.equal(weather.visualRevision,revision,`unchanged visual revision at frozen frame ${frame}: ${label}`);
   }
  } finally {weather.dispose();disposeFixture(house);}
 }
});
