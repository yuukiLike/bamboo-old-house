interface TransitionDriver {
 animate:(covered:boolean,complete:()=>void)=>()=>void;
 clear:()=>void;
}

/** One handoff for every viewpoint entry. A new choice replaces pending work;
 * it never queues a tour through the places the user has already passed over. */
export class SceneTransition {
 private driver:TransitionDriver;
 private phase:'idle'|'cover'|'reveal'='idle';
 private pending:(()=>void)|undefined;
 private cancelAnimation:(()=>void)|undefined;
 private generation=0;
 private disposed=false;
 constructor(driver:TransitionDriver) {this.driver=driver;}
 get covering() {return this.phase==='cover';}
 request(apply:()=>void,animate=true) {
  if(this.disposed)return;
  this.pending=apply;
  if(!animate){this.finish();return;}
  if(this.phase!=='cover')this.start(true);
 }
 private start(covered:boolean) {
  const generation=++this.generation;
  this.cancelAnimation?.();this.cancelAnimation=undefined;
  this.phase=covered?'cover':'reveal';
  let complete=false;
  const cancel=this.driver.animate(covered,()=>{
   complete=true;
   if(this.disposed||generation!==this.generation)return;
   this.cancelAnimation=undefined;
   if(covered) {
    const apply=this.pending;this.pending=undefined;
    try {apply?.();} finally {if(generation===this.generation)this.start(false);}
   }else {this.phase='idle';this.driver.clear();}
  });
  if(!complete&&generation===this.generation)this.cancelAnimation=cancel;
  else cancel();
 }
 /** Hidden tabs and reduced motion commit the latest choice without a curtain. */
 finish() {
  if(this.disposed)return;
  ++this.generation;this.cancelAnimation?.();this.cancelAnimation=undefined;this.phase='idle';
  const apply=this.pending;this.pending=undefined;
  try {apply?.();} finally {this.driver.clear();}
 }
 dispose() {
  if(this.disposed)return;
  this.disposed=true;++this.generation;this.pending=undefined;
  this.cancelAnimation?.();this.cancelAnimation=undefined;this.driver.clear();
 }
}

/** Commit behind a compositor transition, then reveal after the destination
 * frame is submitted. GPU snapshots remain a fallback for older browsers. */
interface ViewTransition {
 capture:(complete:()=>void)=>()=>void;
 reveal:(complete:()=>void)=>()=>void;
 clear:()=>void;
}
interface TransitionCurtain {
 element:()=>HTMLElement|null;
 waitForFrame:(complete:()=>void)=>()=>void;
}
export function createSceneTransition(current:()=>ViewTransition|undefined,curtain?:TransitionCurtain) {
 return new SceneTransition({
  animate(capture,complete) {
   const element=curtain?.element();
   if(element?.animate){
    let cancelled=false,animation:Animation|undefined,cancelFrame:(()=>void)|undefined;
    let deadline:ReturnType<typeof setTimeout>|undefined;
    const releaseAnimation=()=>{
     clearTimeout(deadline);deadline=undefined;
     if(animation){animation.onfinish=null;animation.oncancel=null;animation.cancel();animation=undefined;}
    };
    const run=()=>{
     if(cancelled)return;
     const opacity=capture ? 0.045 : 0;
     const from=Number(element.style.opacity)||0,duration=capture?180:240;
     let settled=false;
     const settle=()=>{
      if(cancelled||settled)return;
      settled=true;element.style.opacity=String(opacity);releaseAnimation();
      // Leave time for button feedback to paint before scene mutations begin.
      complete();
     };
     try{animation=element.animate([{opacity:from},{opacity}],{duration,easing:'ease-in-out',fill:'forwards'});}
     catch{settle();return;}
     animation.onfinish=settle;animation.oncancel=settle;
     // The visual effect must not own navigation indefinitely if its completion
     // event is interrupted or never delivered. New choices still replace pending work.
     deadline=setTimeout(settle,duration+100);
    };
    if(capture)run();else cancelFrame=curtain!.waitForFrame(run);
    return()=>{
     cancelled=true;cancelFrame?.();
     if(animation)element.style.opacity=element.ownerDocument.defaultView?.getComputedStyle(element).opacity??element.style.opacity;
     releaseAnimation();
    };
   }
   const transition=current();
   if(!transition){complete();return()=>{};}
   return capture?transition.capture(complete):transition.reveal(complete);
  },
  clear(){const element=curtain?.element();if(element)element.style.opacity='0';current()?.clear();},
 });
}

/** Independent feedback and curtain listeners share a frame boundary. A request
 * made while drawing cannot be completed by that older frame. */
export function createFrameReadySignal() {
 const pending=new Set<{complete:()=>void}>();
 const noop=()=>{};
 return {
  wait(complete:()=>void) {
   const request={complete};pending.add(request);
   return()=>{pending.delete(request);};
  },
  beginFrame() {
   if(!pending.size)return noop;
   const requests=[...pending];
   return()=>{for(const request of requests)if(pending.delete(request))request.complete();};
  },
  clear(){pending.clear();},
 };
}
