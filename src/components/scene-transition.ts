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

/** Capture the displayed GPU frame before committing a new viewpoint. The
 * renderer starts revealing only after it has drawn that destination. */
interface ViewTransition {
 capture:(complete:()=>void)=>()=>void;
 reveal:(complete:()=>void)=>()=>void;
 clear:()=>void;
}
export function createSceneTransition(current:()=>ViewTransition|undefined) {
 return new SceneTransition({
  animate(capture,complete) {
   const transition=current();
   if(!transition){complete();return()=>{};}
   return capture?transition.capture(complete):transition.reveal(complete);
  },
  clear(){current()?.clear();},
 });
}
