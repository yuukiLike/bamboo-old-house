import assert from 'node:assert/strict';
import { test } from 'node:test';
const {ContactRefresh}:typeof import('../src/components/scene/contact-refresh')=
 await import(new URL('../src/components/scene/contact-refresh.ts',import.meta.url).href);

await test('a still room draws full contact detail once and reuses it',()=>{
 const refresh=new ContactRefresh();
 assert.equal(refresh.next(true,0),'detail');
 for(let frame=1;frame<600;frame++)assert.equal(refresh.next(false,frame/60),undefined);
 assert.equal(refresh.quality,'detail');assert.equal(refresh.refining,false);
});

await test('continuous motion refreshes aligned contact without running detail',()=>{
 const refresh=new ContactRefresh();refresh.next(false,0);
 for(let frame=1;frame<=120;frame++) {
  assert.equal(refresh.next(true,frame/120),'motion');
  assert.equal(refresh.quality,'motion');assert.equal(refresh.refining,false);
 }
});

await test('gaps between wheel events do not trigger repeated full detail work',()=>{
 const refresh=new ContactRefresh();refresh.next(false,0);
 for(const time of [1,1.1,1.2,1.3,1.4]) {
  assert.equal(refresh.next(true,time),'motion');
  assert.equal(refresh.next(false,time+.06),undefined);
  assert.equal(refresh.quality,'motion');
 }
 assert.equal(refresh.next(false,1.51),undefined);
 assert.equal(refresh.next(false,1.53),'detail');
 assert.equal(refresh.next(false,1.54),undefined);
});

await test('detail returns once after settling and fades over the cached motion image',()=>{
 const refresh=new ContactRefresh();refresh.next(false,0);refresh.next(true,1);
 assert.equal(refresh.next(false,1.13),'detail');
 assert.equal(refresh.refining,true);assert.equal(refresh.refinement,0);
 assert.equal(refresh.next(false,1.18),undefined);
 assert.ok(Math.abs(refresh.refinement-.5)<1e-10);
 assert.equal(refresh.next(false,1.24),undefined);
 assert.equal(refresh.refining,false);assert.equal(refresh.quality,'detail');
 assert.equal(refresh.next(false,100),undefined);
});

await test('new movement interrupts refinement before old-camera shade can be used',()=>{
 const refresh=new ContactRefresh();refresh.next(false,0);refresh.next(true,1);
 refresh.next(false,1.13);refresh.next(false,1.18);
 assert.equal(refresh.refining,true);
 assert.equal(refresh.next(true,1.19),'motion');
 assert.equal(refresh.refinement,0);assert.equal(refresh.refining,false);
 assert.equal(refresh.next(false,1.3),undefined);
 assert.equal(refresh.next(false,1.32),'detail');
});

await test('resizing invalidates both cached quality and an unfinished refinement',()=>{
 const refresh=new ContactRefresh();refresh.next(false,0);refresh.next(true,1);
 refresh.next(false,1.13);refresh.next(false,1.18);refresh.invalidate();
 assert.equal(refresh.refining,false);assert.equal(refresh.refinement,0);
 assert.equal(refresh.next(false,1.2),'detail');
 assert.equal(refresh.next(false,1.3),undefined);
 assert.equal(refresh.next(true,1.4),'motion');
});
