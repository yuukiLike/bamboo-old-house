import assert from 'node:assert/strict';
import test from 'node:test';
const {followWalkProgress}:typeof import('../src/components/scene/walk-motion')=
 await import(new URL('../src/components/scene/walk-motion.ts',import.meta.url).href);

await test('walking follows the same elapsed-time response at 30, 60 and 120 Hz',()=>{
 const values=[30,60,120].map(hz=>{
  let value=0;
  for(let frame=0;frame<hz/10;frame++)value=followWalkProgress(value,1,1/hz,3600);
  return value;
 });
 for(const value of values)assert.ok(Math.abs(value-(1-Math.exp(-3)))<1e-12);
 assert.ok(values[0]>.95&&values[0]<.96,'reach about 95% within 100 ms');
});

await test('a delayed frame catches up using actual time instead of the physics cap',()=>{
 const value=followWalkProgress(0,1,.2,3600);
 assert.ok(Math.abs(value-(1-Math.exp(-6)))<1e-12);
 assert.ok(value>.997);
});

await test('small wheel movements keep advancing through every chapter boundary',()=>{
 const range=3600;
 for(const boundary of [.25,.5,.75]) {
  let target=boundary-2/range,current=target;
  for(let step=0;step<12;step++) {
   target+=.5/range;
   const next=followWalkProgress(current,target,1/60,range);
   assert.ok(next>current,'each small input must move the camera');
   assert.ok(next<=target,'chapter boundaries cannot introduce overshoot');
   current=next;
  }
  assert.ok(current>boundary);
 }
 for(const target of [.1/3600,1-.1/3600]) {
  const start=target<.5?0:1;
  assert.equal(followWalkProgress(start,target,1/60,range),target,'subpixel input is retained at both route ends');
 }
});

await test('stopping approaches the latest target monotonically and finishes exactly',()=>{
 for(const [start,target] of [[.1,.7],[.8,.2],[0,1],[1,0]]) {
  let current=start;
  for(let frame=0;frame<120;frame++) {
   const next=followWalkProgress(current,target,1/60,3600);
   assert.ok(next>=Math.min(current,target)&&next<=Math.max(current,target));
   assert.ok(Math.abs(target-next)<=Math.abs(target-current));
   current=next;
  }
  assert.equal(current,target);
  assert.equal(followWalkProgress(current,target,1/30,3600),target);
 }
});

await test('reversing or replacing input follows the newest target without a queued leg',()=>{
 const forward=followWalkProgress(.2,.8,1/30,3600);
 const reversed=followWalkProgress(forward,.1,1/120,3600);
 assert.ok(reversed<forward&&reversed>.1);
 // The input can reverse while the camera is still behind the new page
 // position. It must head toward that nearer position, not the old goal.
 const behind=followWalkProgress(.2,.8,1/120,3600);
 const closer=followWalkProgress(behind,.4,1/120,3600);
 assert.ok(closer>behind&&closer<.4);
 const replaced=followWalkProgress(closer,.05,1/120,3600);
 assert.ok(replaced<closer&&replaced>.05);
});

await test('the finishing tolerance stays below a quarter CSS pixel at any page length',()=>{
 for(const range of [1200,3600,8000]) {
  assert.equal(followWalkProgress(0,.249/range,0,range),.249/range);
  assert.equal(followWalkProgress(0,.251/range,0,range),0);
  assert.equal(followWalkProgress(0,.4/range,1/60,range),.4/range,'snap after applying the current frame response');
 }
});
