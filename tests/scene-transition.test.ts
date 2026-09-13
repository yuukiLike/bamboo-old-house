import assert from 'node:assert/strict';
import test from 'node:test';
const {SceneTransition}:typeof import('../src/components/scene-transition')=
 await import(new URL('../src/components/scene-transition.ts',import.meta.url).href);

function setup() {
 const animations:{covered:boolean;complete:()=>void;cancelled:boolean}[]=[],applied:string[]=[];
 let clears=0;
 const transition=new SceneTransition({
  animate(covered,complete) {const animation={covered,complete,cancelled:false};animations.push(animation);return()=>{animation.cancelled=true;};},
  clear(){clears++;},
 });
 return {transition,animations,applied,get clears(){return clears;}};
}

await test('a location changes only once covered and clears only after reveal finishes',()=>{
 const state=setup();state.transition.request(()=>state.applied.push('hall'));
 assert.deepEqual(state.applied,[]);assert.equal(state.animations[0].covered,true);
 state.animations[0].complete();assert.deepEqual(state.applied,['hall']);
 assert.equal(state.animations[1].covered,false);assert.equal(state.clears,0);
 state.animations[1].complete();assert.equal(state.clears,1);
});

await test('rapid choices replace the target without restarting the covering animation',()=>{
 const state=setup();
 for(const place of ['hall','kitchen','courtyard'])state.transition.request(()=>state.applied.push(place));
 assert.equal(state.animations.length,1);
 state.animations[0].complete();assert.deepEqual(state.applied,['courtyard']);
 state.animations[1].complete();assert.equal(state.clears,1);
});

await test('redirecting during reveal cancels that animation and ignores its late completion',()=>{
 const state=setup();state.transition.request(()=>state.applied.push('hall'));
 state.animations[0].complete();state.transition.request(()=>state.applied.push('porch'));
 assert.equal(state.animations[1].cancelled,true);assert.equal(state.animations[2].covered,true);
 state.animations[1].complete();assert.equal(state.clears,0);
 state.animations[2].complete();assert.deepEqual(state.applied,['hall','porch']);
 state.animations[3].complete();assert.equal(state.clears,1);
});

await test('initial load and reduced motion apply immediately with no covering animation',()=>{
 const state=setup();state.transition.request(()=>state.applied.push('porch'),false);
 assert.deepEqual(state.applied,['porch']);assert.equal(state.animations.length,0);assert.equal(state.clears,1);
 state.transition.request(()=>state.applied.push('hall'));
 state.transition.request(()=>state.applied.push('walk'),false);
 assert.deepEqual(state.applied,['porch','walk']);assert.equal(state.animations[0].cancelled,true);
 state.animations[0].complete();assert.deepEqual(state.applied,['porch','walk']);
});

await test('backgrounding finishes the latest target and never leaves a curtain on return',()=>{
 const state=setup();state.transition.request(()=>state.applied.push('hall'));
 state.transition.request(()=>state.applied.push('well'));state.transition.finish();
 assert.deepEqual(state.applied,['well']);assert.equal(state.clears,1);
 state.animations[0].complete();assert.equal(state.animations.length,1);
 state.transition.request(()=>state.applied.push('porch'));state.animations[1].complete();
 state.transition.finish();assert.equal(state.animations[2].cancelled,true);assert.equal(state.clears,2);
});

await test('unmount discards pending camera changes and invalidates late callbacks',()=>{
 const state=setup();state.transition.request(()=>state.applied.push('hall'));state.transition.dispose();
 state.animations[0].complete();state.transition.request(()=>state.applied.push('porch'));state.transition.finish();
 assert.deepEqual(state.applied,[]);assert.equal(state.animations[0].cancelled,true);assert.equal(state.clears,1);
});

await test('a failed handoff still reveals the scene, including the immediate path',()=>{
 const state=setup();state.transition.request(()=>{throw Error('lost context');});
 assert.throws(()=>state.animations[0].complete(),/lost context/);
 assert.equal(state.animations[1].covered,false);state.animations[1].complete();assert.equal(state.clears,1);
 assert.throws(()=>state.transition.request(()=>{throw Error('lost context');},false),/lost context/);
 assert.equal(state.clears,2);
});
