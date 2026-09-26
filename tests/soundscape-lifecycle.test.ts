import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(readFileSync(new URL('../src/components/scene/soundscape.ts',import.meta.url),'utf8'))
 .replace("from '../../lib/performance'",`from '${new URL('../src/lib/performance.ts',import.meta.url).href}'`);
const {createSoundscape}:typeof import('../src/components/scene/soundscape')=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};

function browser(mobile:boolean){
 let paramWrites=0,active=0,peak=0;
 const pending:{resolve:(buffer:AudioBuffer)=>void;reject:(error:Error)=>void}[]=[];
 const param=()=>({value:0,cancelScheduledValues(){paramWrites++;},setTargetAtTime(){paramWrites++;},setValueAtTime(){paramWrites++;},linearRampToValueAtTime(){paramWrites++;},setValueCurveAtTime(){paramWrites++;}});
 const node=()=>({connect(){},disconnect(){},gain:param(),frequency:param(),Q:param(),pan:param(),onended:null,start(){},stop(){}});
 class Context {
  currentTime=0;state='suspended';destination=node();decodes=0;
  resume(){this.state='running';return Promise.resolve();}
  suspend(){this.state='suspended';return Promise.resolve();}
  close(){this.state='closed';return Promise.resolve();}
  createGain=node;createBiquadFilter=node;createStereoPanner=node;createBufferSource=node;
  decodeAudioData(){
   this.decodes++;active++;peak=Math.max(peak,active);
   return new Promise<AudioBuffer>((resolve,reject)=>pending.push({resolve,reject})).finally(()=>active--);
  }
 }
 const instances:Context[]=[];
 const original=Object.getOwnPropertyDescriptors(globalThis);
 Object.assign(globalThis,{
  window:{location:{search:''},AudioContext:class extends Context {constructor(){super();instances.push(this);}}},
  document:{hidden:false,addEventListener(){},removeEventListener(){}},
  matchMedia:()=>({matches:mobile}),
  fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(10)}),
 });
 return {
  instances,pending,get peak(){return peak;},get paramWrites(){return paramWrites;},
  async decodeAll(){
   for(let i=0;i<20;i++){
    await flush();
    for(const item of pending.splice(0))item.resolve({duration:60,numberOfChannels:2,sampleRate:44100} as AudioBuffer);
   }
   await flush();
  },
  restore(){for(const key of ['window','document','matchMedia','fetch']){
   if(original[key])Object.defineProperty(globalThis,key,original[key]);else Reflect.deleteProperty(globalThis,key);
  }},
 };
}

await test('mobile base and rain loads share one decoder; mute suspends audio and avoids per-frame automation, re-enable reuses buffers',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const b=browser(true),sound=createSoundscape();
 try{
  await sound.setWeather({wind:.8,rain:1,autumn:0});
  const enabled=sound.setEnabled(true);await flush();
  assert.equal(b.pending.length,1);
  await b.decodeAll();await enabled;
  assert.equal(b.peak,1);assert.equal(b.instances[0].decodes,8);
  await sound.setEnabled(false);t.mock.timers.tick(1200);await flush();
  assert.equal(b.instances[0].state,'suspended');
  const writes=b.paramWrites;sound.setGust(.7);sound.setRoofRunoff(.6);t.mock.timers.tick(5000);
  assert.equal(b.paramWrites,writes,'muting stops timer and animation-driven audio work');
  await sound.setEnabled(true);assert.equal(b.instances[0].state,'running');assert.equal(b.instances[0].decodes,8);
  sound.dispose();assert.equal(b.instances[0].state,'closed');
 }finally{sound.dispose();b.restore();}
});

await test('disposal cancels queued mobile decoders and prevents late loads from reopening audio',async()=>{
 const b=browser(true),sound=createSoundscape();
 try{
  const enabled=sound.setEnabled(true);await flush();assert.equal(b.pending.length,1);
  sound.dispose();await b.decodeAll();await enabled;
  assert.equal(b.instances[0].decodes,1);assert.equal(b.instances[0].state,'closed');
 }finally{sound.dispose();b.restore();}
});

await test('desktop loading retains parallel decode and a failed mobile group remains retryable',async()=>{
 for(const mobile of [false,true]){
  const b=browser(mobile),sound=createSoundscape();
  try{
   const enabled=sound.setEnabled(true);const result=assert.rejects(enabled,/decode failure/);
   await flush();assert.equal(b.pending.length,mobile?1:4);
   b.pending.shift()!.reject(new Error('decode failure'));await b.decodeAll();await result;
   const retried=sound.setEnabled(true);await b.decodeAll();await retried;
   assert.equal(b.instances[0].state,'running');assert.equal(b.instances.length,1);
  }finally{sound.dispose();b.restore();}
 }
});
