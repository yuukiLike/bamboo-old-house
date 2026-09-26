import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'three';
const {createIdleRendering}:typeof import('../src/components/scene/rendering-idle')=
 await import(new URL('../src/components/scene/rendering-idle.ts',import.meta.url).href);
const {createWeatherState}:typeof import('../src/components/scene/weather-state')=
 await import(new URL('../src/components/scene/weather-state.ts',import.meta.url).href);

await test('only identical frozen pictures stop drawing; camera, projection and external changes wake immediately',()=>{
 const parent=new T.Group(),camera=new T.PerspectiveCamera(70,1,.1,100);parent.add(camera);
 const time={value:0},night={value:0},uniforms=[time,night];
 const idle=createIdleRendering(camera,uniforms),draw=()=>idle.needsRender(true,false);
 assert.equal(draw(),true);
 for(let i=0;i<60;i++)assert.equal(draw(),false);
 for(const change of [
  ()=>{camera.position.x+=1e-10;},()=>{camera.rotateY(.01);},
  ()=>{parent.position.z+=1;},()=>{camera.zoom=1.2;camera.updateProjectionMatrix();},
  ()=>{time.value+=1e-10;},()=>{night.value=.7;},()=>idle.invalidate(),
 ]){
  change();assert.equal(draw(),true);assert.equal(draw(),false);
 }
 assert.equal(idle.needsRender(true,false,1),true,'out-of-clock weather or cleared overlay redraws');
 assert.equal(idle.needsRender(true,false,1),false);
 for(let i=0;i<120;i++)assert.equal(idle.needsRender(false,false,1),true,'animation keeps its existing cadence');
 assert.equal(idle.needsRender(true,false,1),true,'pause submits a final exact picture');
 assert.equal(idle.needsRender(true,false,1),false);
 assert.equal(idle.needsRender(false,false,1),true,'resume submits on its first tick');
});

await test('pending transition/refinement continues until its final frame, even with unchanged visual inputs',()=>{
 const idle=createIdleRendering(new T.PerspectiveCamera(),[]);
 assert.equal(idle.needsRender(true,false),true);
 assert.equal(idle.needsRender(true,false),false);
 for(let i=0;i<20;i++)assert.equal(idle.needsRender(true,true),true);
 assert.equal(idle.needsRender(true,false),false);
});

await test('paused weather keeps every easing step, then becomes idle only at the actual final uniforms',()=>{
 const time={value:0},night={value:0},weather=createWeatherState(time,night);
 const idle=createIdleRendering(new T.PerspectiveCamera(),Object.values(weather.uniforms));
 weather.update(1/60);assert.equal(idle.needsRender(true,false),true);assert.equal(idle.needsRender(true,false),false);
 weather.set({wind:.86,rain:1,autumn:1});
 let draws=0;
 for(let i=0;i<7000;i++){
  const previous=Object.values(weather.uniforms).map(uniform=>uniform.value);
  weather.update(1/60);
  const changed=Object.values(weather.uniforms).some((uniform,index)=>uniform.value!==previous[index]);
  const rendered=idle.needsRender(true,false);assert.equal(rendered,changed);
  if(rendered)draws++;
 }
 assert.ok(draws>4000,'wet surfaces must finish their authored slow absorption');
 assert.deepEqual([weather.uniforms.wind.value,weather.uniforms.rain.value,weather.uniforms.wetness.value,weather.uniforms.autumn.value],[.86,1,1,1]);
 assert.equal(idle.needsRender(true,false),false);
 weather.set({wind:.28,rain:0});weather.update(1/60,true);
 assert.equal(idle.needsRender(true,false),true,'reduced motion applies a new setting immediately');
 assert.equal(idle.needsRender(true,false),false);
});
