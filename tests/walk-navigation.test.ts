import assert from 'node:assert/strict';
import test from 'node:test';
import { WALK_CHAPTERS, walkScrollPosition, walkScrollTop, walkChapter, wrapWalkProgress } from '../src/components/walk-navigation.ts';
import { CAMERA_STOPS, positionPath, targetPath, followWalkProgress } from '../src/components/scene/config.ts';

const close=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

await test('four unique chapters share a closed path with a continuous position and look direction',()=>{
 assert.equal(WALK_CHAPTERS.length,4);
 assert.equal(CAMERA_STOPS.length,4);
 assert.equal(new Set(CAMERA_STOPS.map(stop=>JSON.stringify(stop.p))).size,4);
 assert.equal(WALK_CHAPTERS.some(chapter=>String(chapter.id)==='return'),false);
 for(const path of [positionPath,targetPath]){
  assert.equal(path.closed,true);
  assert.ok(path.getPoint(0).distanceTo(path.getPoint(1))<1e-10);
  // Three's endpoint tangent samples clamp rather than wrap. Compare the
  // converging one-sided directions at the join instead of those finite samples.
  const step=1e-6;
  const arriving=path.getPoint(1).sub(path.getPoint(1-step)).normalize();
  const leaving=path.getPoint(step).sub(path.getPoint(0)).normalize();
  assert.ok(arriving.dot(leaving)>.999999);
 }
});

await test('the opening bamboo position has native scroll room in both directions',()=>{
 const range=12000,opening=walkScrollTop(0,range);
 assert.ok(opening>0&&opening<range);
 const before=walkScrollPosition(opening-10,range),after=walkScrollPosition(opening+10,range);
 close(before.progress,.9975);close(after.progress,.0025);
 assert.equal(walkChapter(before.progress),0);assert.equal(walkChapter(after.progress),0);
 for(const progress of [before.progress,after.progress]){
  assert.ok(positionPath.getPoint(progress).distanceTo(positionPath.getPoint(0))>.001);
  assert.ok(targetPath.getPoint(progress).distanceTo(targetPath.getPoint(0))>.01);
 }
});

await test('native scroll recentering preserves the exact scene after repeated forward and reverse laps',()=>{
 for(const direction of [-1,1]){
  const range=12000,cycle=range/3,visited=new Set<number>();
  let top=walkScrollTop(0,range),progress=0,resets=0;
  for(let step=0;step<1000;step++){
   top+=direction*97;
   const next=walkScrollPosition(top,range);
   const expected=wrapWalkProgress(progress+direction*97/cycle);
   assert.ok(Math.abs(next.progress-expected)<1e-9);
   close(walkScrollPosition(next.scrollTop,range).progress,next.progress);
   if(next.scrollTop!==top)resets++;
   top=next.scrollTop;progress=next.progress;visited.add(walkChapter(progress));
   assert.ok(top>0&&top<range);
  }
  assert.equal(visited.size,4);assert.ok(resets>10);
 }
});

await test('chapter links and viewport restoration keep the same node with space on either side',()=>{
 for(const range of [1200,3371,12000])for(let index=0;index<WALK_CHAPTERS.length;index++){
  const progress=index/WALK_CHAPTERS.length,top=walkScrollTop(progress,range);
  close(walkScrollPosition(top,range).progress,progress);
  assert.equal(walkChapter(progress),index);
  assert.ok(top>range/4&&top<range*.75);
 }
});

await test('camera easing crosses the loop join in the requested direction without traversing the other nodes',()=>{
 const forward=followWalkProgress(.998,.002,1/60,4000,true);
 const backward=followWalkProgress(.002,.998,1/60,4000,true);
 assert.ok(forward>.998);assert.ok(backward<.002);
 assert.ok(positionPath.getPoint(forward).distanceTo(positionPath.getPoint(.998))<.25);
 assert.ok(positionPath.getPoint(backward).distanceTo(positionPath.getPoint(.002))<.25);
 let current=forward;
 for(let index=0;index<60;index++)current=followWalkProgress(current,.002,1/60,4000,true);
 close(current,.002);
});
