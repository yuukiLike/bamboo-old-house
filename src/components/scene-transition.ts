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

/** A single compositor opacity layer. No canvas readback or second scene draw. */
export function createSceneTransition(overlay:HTMLDivElement) {
 return new SceneTransition({
  animate(covered,complete) {
   const opacity=Number.parseFloat(getComputedStyle(overlay).opacity)||0,target=covered?1:0;
   const duration=(covered?120:220)*Math.abs(target-opacity);
   let frame=0,animation:Animation|undefined,finished=false;
   overlay.style.opacity=String(opacity);overlay.style.visibility='visible';
   overlay.style.willChange='opacity';overlay.dataset.phase=covered?'cover':'reveal';
   const timer=setTimeout(done,duration+180);
   function done() {
    if(finished)return;finished=true;
    clearTimeout(timer);cancelAnimationFrame(frame);
    overlay.style.opacity=String(target);
    if(animation){animation.onfinish=null;animation.cancel();}
    complete();
   }
   const begin=()=>{
    if(finished)return;
    if(duration<1||typeof overlay.animate!=='function'){done();return;}
    animation=overlay.animate([{opacity},{opacity:target}],{
     duration,easing:covered?'cubic-bezier(.4,0,.8,1)':'cubic-bezier(.16,1,.3,1)',fill:'forwards',
    });
    animation.onfinish=done;
   };
   if(covered)begin();
   // Let React's destination layout and the next Three frame reach the screen
   // while fully covered before revealing it, without copying the canvas.
   else frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(begin);});
   return()=>{
    if(finished)return;finished=true;
    const current=getComputedStyle(overlay).opacity;
    clearTimeout(timer);cancelAnimationFrame(frame);
    if(animation){animation.onfinish=null;animation.cancel();}
    overlay.style.opacity=current;
   };
  },
  clear() {
   overlay.style.opacity='0';overlay.style.visibility='hidden';overlay.style.willChange='';
   delete overlay.dataset.phase;
  },
 });
}
