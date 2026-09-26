// Functional checks in a real WebGL browser, not an iPhone FPS/thermal benchmark.
// Run from the repository root; see scripts/perf/README.md.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium }=await import(process.env.PERF_PLAYWRIGHT ? pathToFileURL(process.env.PERF_PLAYWRIGHT).href : 'playwright');
(async()=>{
 const out=process.env.PERF_OUT || 'outputs/performance/mobile-runtime-smoke';
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
   const intervals=new Set(),rafs=new Set(),observers=new Set();
   window.__collectionProbe={intervals,rafs,observers,ticks:0,observerCalls:0,draws:0};
   const set=window.setInterval,clear=window.clearInterval,request=window.requestAnimationFrame,cancel=window.cancelAnimationFrame;
   window.setInterval=function(callback,delay,...args){if(!owned())return set(callback,delay,...args);const id=set(()=>{window.__collectionProbe.ticks++;callback(...args);},delay);intervals.add(id);return id;};
   window.clearInterval=function(id){intervals.delete(id);return clear(id);};
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
  await page.getByRole('button',{name:'停止性能检测',exact:true}).click();
  const stopped=await probe();
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
  for(const key of ['ticks','callbacks','frames','phases','active','measures','raf','timers','observers'])assert.equal(final[key],stopped[key],`${key} must freeze after stop`);
  assert.ok(final.draws>stopped.draws,'scene keeps drawing');
  assert.equal(await page.locator('.sound-toggle').getAttribute('aria-pressed'),'true');
  await page.locator('.perf-panel-title').click();
  await page.screenshot({path:`${out}/stopped-mobile.png`});
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'导出 JSON',exact:true}).click();
  const download=await downloadEvent;const exported=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal(exported.runtime.status,'stopped');assert.equal(exported.businessPhases.enabled,false);assert.equal(exported.businessPhases.phases.length,stopped.phases);
  assert.equal(errors.length,0);
  await fs.writeFile(`${out}/acceptance.json`,JSON.stringify({capturedAt:new Date().toISOString(),browser:await browser.version(),url:url.href,defaults,full,reduced,submissions,running,stopped,final,exportedStatus:exported.runtime.status,errors,afterStopViews:['porch','well-rain','free/hall'],note:'Headed desktop Canary, 402x874 @ DPR3 touch emulation; lifecycle/layout/quality checks, not iPhone thermal evidence.'},null,2));
  console.log(JSON.stringify({defaults,full,submissions,running,stopped,final,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
