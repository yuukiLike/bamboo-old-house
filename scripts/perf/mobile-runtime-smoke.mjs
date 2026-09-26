// Functional checks in a real WebGL browser, not an iPhone FPS/thermal benchmark.
// Run from the repository root; see scripts/perf/README.md.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium }=await import(process.env.PERF_PLAYWRIGHT ? pathToFileURL(process.env.PERF_PLAYWRIGHT).href : 'playwright');
function validateWorkload(workload){
 assert.deepEqual([workload.sampleIntervalMs,workload.initialLimit,workload.recentLimit],[1000,60,120]);
 assert.ok(workload.samples.length>0&&workload.samples.length<=180);
 assert.equal(new Set(workload.samples.map(sample=>sample.timestamp)).size,workload.samples.length);
 for(const sample of workload.samples){
  assert.ok(sample.timestamp>sample.startTime);
  assert.ok(sample.count>0&&sample.observedMs>=1000&&Number.isFinite(sample.rafHz));
  assert.ok(Math.abs(sample.rafHz-sample.count*1000/sample.observedMs)<1e-9);
  for(const name of ['programs','cpuUpdateMs','cpuRenderSubmitMs']){
   const value=sample.renderer?.[name];
   assert.ok(value===undefined||value===null||(Number.isFinite(value)&&value>=0),`${name} must be finite or explicitly unavailable`);
  }
 }
 assert.ok(workload.samples.some(sample=>sample.renderer?.programs>0&&Number.isFinite(sample.renderer.cpuUpdateMs)&&Number.isFinite(sample.renderer.cpuRenderSubmitMs)),
  'a rendered scene must export real CPU measurements and shader program counts');
}
(async()=>{
 const out=process.env.PERF_OUT || 'outputs/performance/mobile-runtime-smoke';
 const audioSoakSeconds=Number(process.env.PERF_AUDIO_SOAK_SECONDS??90);
 assert.ok(Number.isFinite(audioSoakSeconds)&&audioSoakSeconds>=0);
 await fs.mkdir(out,{recursive:true});
 const url=new URL(process.env.PERF_URL || 'http://127.0.0.1:4175/');
 url.searchParams.set('perf','1');url.searchParams.set('perfUI','1');
 const browser=await chromium.launch({headless:false,executablePath:process.env.PERF_CHROME || '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'});
 try{
  const context=await browser.newContext({viewport:{width:402,height:874},deviceScaleFactor:3,isMobile:true,hasTouch:true,acceptDownloads:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',message=>{if(message.type()==='error'&&/WebGL|shader|THREE|自然声|Ambience/.test(message.text()))errors.push(message.text());});
  await page.addInitScript(()=>{
   const owned=()=>/performance-panel/.test(new Error().stack||'');
   const intervals=new Set(),rafs=new Set(),observers=new Set(),audioIntervals=new Set();
   const audio=window.__audioProbe={activeDecodes:0,peakDecodes:0,decodedBytes:0,decodes:0,sources:0,peakSources:0,contexts:[],intervals:audioIntervals};
   // Each wrapper forwards with the original AudioContext as its receiver.
   // eslint-disable-next-line @typescript-eslint/unbound-method
   const decode=AudioContext.prototype.decodeAudioData,createSource=AudioContext.prototype.createBufferSource;
   AudioContext.prototype.decodeAudioData=async function(...args){
    if(!audio.contexts.includes(this))audio.contexts.push(this);
    audio.activeDecodes++;audio.peakDecodes=Math.max(audio.peakDecodes,audio.activeDecodes);
    try{const buffer=await decode.apply(this,args);audio.decodes++;audio.decodedBytes+=buffer.length*buffer.numberOfChannels*4;return buffer;}finally{audio.activeDecodes--;}
   };
   AudioContext.prototype.createBufferSource=function(...args){
    const source=createSource.apply(this,args);audio.sources++;audio.peakSources=Math.max(audio.peakSources,audio.sources);
    source.addEventListener('ended',()=>audio.sources--,{once:true});return source;
   };
   window.__collectionProbe={intervals,rafs,observers,ticks:0,observerCalls:0,draws:0};
   const set=window.setInterval,clear=window.clearInterval,request=window.requestAnimationFrame,cancel=window.cancelAnimationFrame;
   window.setInterval=function(callback,delay,...args){if(delay===1500){const id=set(callback,delay,...args);audioIntervals.add(id);return id;}if(!owned())return set(callback,delay,...args);const id=set(()=>{window.__collectionProbe.ticks++;callback(...args);},delay);intervals.add(id);return id;};
   window.clearInterval=function(id){intervals.delete(id);audioIntervals.delete(id);return clear(id);};
   window.requestAnimationFrame=function(callback){if(!owned())return request(callback);const id=request(now=>{rafs.delete(id);callback(now);});rafs.add(id);return id;};
   window.cancelAnimationFrame=function(id){rafs.delete(id);return cancel(id);};
   const OriginalObserver=window.PerformanceObserver;
   window.PerformanceObserver=class extends OriginalObserver{
    constructor(callback){const tracked=owned();super((...args)=>{if(tracked)window.__collectionProbe.observerCalls++;callback(...args);});this.tracked=tracked;}
    observe(...args){if(this.tracked)observers.add(this);return super.observe(...args);}
    disconnect(){observers.delete(this);return super.disconnect();}
   };
   // Forward each call with the original WebGL context as its receiver.
   // eslint-disable-next-line @typescript-eslint/unbound-method
   const draw=WebGL2RenderingContext.prototype.drawElements;
   WebGL2RenderingContext.prototype.drawElements=function(...args){window.__collectionProbe.draws++;return draw.apply(this,args);};
  });
  await page.goto(url.href);
  await page.waitForFunction(()=>window.__BAMBOO__?.frames.length>30,{},{timeout:120000});
  const defaults=await page.evaluate(()=>({settings:window.__BAMBOO__.renderSettings,ratio:window.__BAMBOO__.pixelRatio,size:window.__BAMBOO__.drawSize}));
  assert.equal(defaults.ratio,1.5);assert.deepEqual(defaults.settings,{resolution:'balanced',shadows:'alternate',frameRate:'60'});
  assert.deepEqual(defaults.size,[603,1311]);
  const resizeWrites=await page.evaluate(async()=>{
   const canvas=document.querySelector('.scene-mount canvas')??document.querySelector('canvas');
   let writes=0;
   const width=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'width');
   Object.defineProperty(canvas,'width',{configurable:true,get(){return width.get.call(this);},set(value){writes++;width.set.call(this,value);}});
   for(let i=0;i<30;i++)window.dispatchEvent(new Event('resize'));
   await new Promise(resolve=>setTimeout(resolve,100));
   delete canvas.width;return writes;
  });
  assert.equal(resizeWrites,0,'same-size browser events must not reset the drawing buffer');
  await page.setViewportSize({width:874,height:402});
  await page.waitForFunction(()=>document.querySelector('canvas')?.width===1311&&document.querySelector('canvas')?.height===603);
  await page.setViewportSize({width:402,height:874});
  await page.waitForFunction(()=>document.querySelector('canvas')?.width===603&&document.querySelector('canvas')?.height===1311);
  await page.getByRole('button',{name:'画面设置',exact:true}).click();
  await page.getByRole('button',{name:'省电 30 帧',exact:true}).click();
  await page.getByRole('button',{name:'收起画面设置',exact:true}).click();
  const first=await page.evaluate(()=>({frames:window.__BAMBOO__.frames.length,now:performance.now()}));
  await page.waitForTimeout(4000);
  const later=await page.evaluate(()=>({frames:window.__BAMBOO__.frames.length,now:performance.now(),ratio:window.__BAMBOO__.pixelRatio}));
  const submissions=(later.frames-first.frames)*1000/(later.now-first.now);
  assert.ok(submissions>20&&submissions<31,`30-frame submission rate ${submissions}`);assert.equal(later.ratio,1.5);
  await page.getByRole('button',{name:'画面设置',exact:true}).click();
  await page.getByRole('button',{name:'恢复完整效果',exact:true}).click();
  const full=await page.evaluate(()=>({settings:window.__BAMBOO__.renderSettings,ratio:window.__BAMBOO__.pixelRatio,size:window.__BAMBOO__.drawSize}));
  assert.deepEqual(full.settings,{resolution:'full',shadows:'full',frameRate:'display'});assert.equal(full.ratio,2);assert.deepEqual(full.size,[804,1748]);
  await page.getByRole('button',{name:'稍柔和',exact:true}).click();
  const reduced=await page.evaluate(()=>window.__BAMBOO__.pixelRatio);assert.equal(reduced,1.0625);
  await page.getByRole('button',{name:'均衡清晰（默认）',exact:true}).click();
  await page.getByRole('button',{name:'隔帧更新（默认）',exact:true}).click();
  await page.getByRole('button',{name:'60 帧（默认）',exact:true}).click();
  await page.waitForFunction(()=>window.__BAMBOO__.renderSettings.frameRate==='60');
  await page.waitForTimeout(400);
  await page.screenshot({path:`${out}/settings.png`});
  await page.getByRole('button',{name:'收起画面设置',exact:true}).click();
  await page.locator('.breeze-toggle').click();
  await page.waitForFunction(()=>document.querySelector('.sound-toggle')?.getAttribute('aria-pressed')==='true',{},{timeout:60000});
  await page.waitForTimeout(5000);
  const probe=()=>page.evaluate(()=>({timers:window.__collectionProbe.intervals.size,raf:window.__collectionProbe.rafs.size,observers:window.__collectionProbe.observers.size,ticks:window.__collectionProbe.ticks,callbacks:window.__collectionProbe.observerCalls,draws:window.__collectionProbe.draws,frames:window.__BAMBOO__.frames.length,phases:window.__BAMBOO_PERF__.phases.length,active:window.__BAMBOO_PERF__.activePhases?.length,enabled:window.__BAMBOO_PERF__.enabled,measures:performance.getEntriesByType('measure').filter(x=>x.name.startsWith('bamboo:')).length}));
  const running=await probe();assert.equal(running.timers,1);assert.equal(running.raf,1);assert.ok(running.observers>=1);
  const workloadBeforeStop=await page.evaluate(()=>{
   // Keep only the test's reference after the production bridge is detached.
   window.__stoppedCollector=window.__BAMBOO_RUNTIME__;
   return window.__stoppedCollector.snapshot().workload;
  });
  validateWorkload(workloadBeforeStop);
  await page.getByRole('button',{name:'停止性能检测',exact:true}).click();
  const stopped=await probe();
  const frozenWorkload=await page.evaluate(()=>window.__stoppedCollector.snapshot().workload);
  assert.equal(stopped.timers,0);assert.equal(stopped.raf,0);assert.equal(stopped.observers,0);assert.equal(stopped.enabled,false);assert.equal(stopped.active,0);assert.equal(stopped.measures,0);
  await page.getByRole('button',{name:'廊下望竹',exact:true}).click();
  await page.locator('.well-toggle').click();
  await page.waitForTimeout(5000);
  await page.locator('.free-toggle').click();
  await page.locator('.room-selector').click();
  await page.getByRole('option',{name:'一楼堂屋',exact:true}).click();
  await page.waitForTimeout(4000);
  await page.getByRole('button',{name:'画面设置',exact:true}).click();
  await page.getByRole('button',{name:'完整清晰',exact:true}).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button',{name:'均衡清晰（默认）',exact:true}).click();
  await page.getByRole('button',{name:'收起画面设置',exact:true}).click();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('.experience.is-static').count(),0);
  assert.equal(await page.locator('.weather-message').count(),0);
  await page.evaluate(()=>fetch('/audio/frog-call.mp3?stop-probe=1').then(r=>r.arrayBuffer()));
  await page.waitForTimeout(12000);
  const final=await probe();
  assert.deepEqual(await page.evaluate(()=>window.__stoppedCollector.snapshot().workload),frozenWorkload,'workload observations must freeze after stop while scenery remains interactive');
  for(const key of ['ticks','callbacks','frames','phases','active','measures','raf','timers','observers'])assert.equal(final[key],stopped[key],`${key} must freeze after stop`);
  assert.ok(final.draws>stopped.draws,'scene keeps drawing');
  assert.equal(await page.locator('.sound-toggle').getAttribute('aria-pressed'),'true');
  await page.locator('.perf-panel-title').click();
  await page.screenshot({path:`${out}/stopped-mobile.png`});
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'导出 JSON',exact:true}).click();
  const download=await downloadEvent;const exported=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal(exported.runtime.status,'stopped');assert.equal(exported.businessPhases.enabled,false);assert.equal(exported.businessPhases.phases.length,stopped.phases);
  assert.deepEqual(exported.runtime.workload,frozenWorkload,'the stopped export must preserve the final workload observations');
  const restarts=[];
  for(let round=0;round<3;round++){
   await page.getByRole('button',{name:'清空并重新检测',exact:true}).click();
   const started=await page.waitForFunction(()=>{
    if(!window.__BAMBOO_RUNTIME__||!window.__BAMBOO_PERF__.enabled||window.__BAMBOO_PERF__.phases.length!==0)return false;
    const snapshot=window.__BAMBOO_RUNTIME__.snapshot();
    return {startedAt:snapshot.startedAt,workload:snapshot.workload};
   });
   const freshStart=await started.jsonValue();await started.dispose();
   assert.deepEqual(freshStart.workload.samples,[],'a newly attached collector starts with no old workload records');
   assert.equal(freshStart.workload.dropped,0);
   await page.waitForTimeout(300);
   const active=await probe();assert.equal(active.timers,1);assert.equal(active.raf,1);assert.equal(active.observers,running.observers);assert.ok(active.frames<stopped.frames);
   await page.evaluate(round=>fetch(`/audio/frog-call.mp3?restart-probe=${round}`).then(r=>r.arrayBuffer()),round);
   await page.waitForTimeout(1200);
   await page.waitForFunction(()=>window.__BAMBOO_RUNTIME__.snapshot().workload.samples.some(sample=>sample.renderer?.programs>0&&Number.isFinite(sample.renderer.cpuUpdateMs)&&Number.isFinite(sample.renderer.cpuRenderSubmitMs)),{},{timeout:10000,polling:100});
   if(await page.locator('.perf-panel-title').getAttribute('aria-expanded')==='false')await page.locator('.perf-panel-title').click();
   const freshDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出 JSON',exact:true}).click();
   const fresh=JSON.parse(await fs.readFile(await (await freshDownload).path(),'utf8'));
   assert.ok(fresh.collectionStartedAt>0);assert.deepEqual(fresh.navigation,[]);assert.deepEqual(fresh.businessPhases.phases,[]);
   assert.ok(fresh.resources.length>=1);assert.ok(fresh.resources.every(r=>r.startTime>=fresh.collectionStartedAt));
   assert.ok(fresh.runtime.history.every(r=>r.startTime>=fresh.collectionStartedAt));
   validateWorkload(fresh.runtime.workload);
   assert.ok(fresh.runtime.workload.samples.every(sample=>sample.startTime>=fresh.collectionStartedAt&&sample.startTime>=freshStart.startedAt),'restarted workload cannot contain intervals from the previous collection');
   assert.equal(fresh.runtime.status,'collecting');
   await page.getByRole('button',{name:'停止性能检测',exact:true}).click();
   const again=await probe();assert.equal(again.timers,0);assert.equal(again.raf,0);assert.equal(again.observers,0);
   restarts.push({active,stopped:again,resources:fresh.resources.length,collectionStartedAt:fresh.collectionStartedAt,initialWorkload:freshStart.workload,workload:fresh.runtime.workload});
  }
  const audioProbe=()=>page.evaluate(()=>({decodes:__audioProbe.decodes,peakDecodes:__audioProbe.peakDecodes,decodedBytes:__audioProbe.decodedBytes,sources:__audioProbe.sources,peakSources:__audioProbe.peakSources,states:__audioProbe.contexts.map(c=>c.state),timers:__audioProbe.intervals.size}));
  const soundBefore=await audioProbe();assert.equal(soundBefore.peakDecodes,1);assert.equal(soundBefore.decodes,9);assert.equal(soundBefore.timers,1);
  await page.locator('.sound-toggle').click();await page.waitForTimeout(1600);
  const muted=await audioProbe();assert.deepEqual(muted.states,['suspended']);assert.equal(muted.timers,0);
  await page.locator('.sound-toggle').click();await page.waitForFunction(()=>document.querySelector('.sound-toggle').getAttribute('aria-pressed')==='true');
  await page.waitForTimeout(500);const resumed=await audioProbe();assert.equal(resumed.timers,1);assert.equal(resumed.decodes,soundBefore.decodes);assert.deepEqual(resumed.states,['running']);
  await page.getByRole('button',{name:'清空并重新检测',exact:true}).click();
  await page.waitForTimeout(1200);await page.screenshot({path:`${out}/restarted-mobile.png`});
  await page.getByRole('button',{name:'停止性能检测',exact:true}).click();
  // Longer than the longest recording: exercise overlap cleanup and replay.
  for(let elapsed=0;elapsed<audioSoakSeconds;elapsed+=15){
   await page.waitForTimeout(Math.min(15,audioSoakSeconds-elapsed)*1000);
   const sample=await audioProbe();assert.equal(sample.decodes,soundBefore.decodes);assert.equal(sample.decodedBytes,soundBefore.decodedBytes);assert.ok(sample.sources<=18);
  }
  const soundAfter=await audioProbe();assert.ok(soundAfter.peakSources<=18);
  assert.equal(errors.length,0);
  await fs.writeFile(`${out}/acceptance.json`,JSON.stringify({capturedAt:new Date().toISOString(),browser:await browser.version(),url:url.href,defaults,full,reduced,submissions,resizeWrites,running,stopped,final,workload:{beforeStop:workloadBeforeStop,frozen:frozenWorkload},exportedStatus:exported.runtime.status,errors,afterStopViews:['porch','well-rain','free/hall'],restarts,audioSoakSeconds,audio:{soundBefore,muted,resumed,soundAfter},note:'Headed desktop Canary, 402x874 @ DPR3 touch emulation; lifecycle/layout/quality checks, not iPhone thermal evidence.'},null,2));
  console.log(JSON.stringify({defaults,full,submissions,running,stopped,final,restarts,audio:{soundBefore,muted,resumed,soundAfter},errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
